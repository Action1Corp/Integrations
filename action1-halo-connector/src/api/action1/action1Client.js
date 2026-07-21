// action1Client.js
//
// Action1 Public Repository Material
//
// Use of this file is subject to TERMS_OF_USE.md (https://github.com/Action1Corp/PSAction1/blob/main/TERMS_OF_USE.md) in this repository.
// Provided AS IS, without warranties.
// Use at your own risk.
// Review, test, and validate before production use.
// © Action1 Corporation. All rights reserved.
const { LOG_EVENT_TYPES, emitLog } = require("../../platform/logging");
const { createSafeHttpClient, ensureUrl, joinUrl, toAbsoluteUrl } = require("../../platform/http");

const TOKEN_REUSE_SAFETY_MARGIN_MS = 60 * 1000;
const ACTION1_RATE_LIMIT_BASE_DELAY_MS = 2000;
const ACTION1_RATE_LIMIT_MAX_DELAY_MS = 60 * 1000;

/**
 * @param {{
 *  runLogger?: any,
 *  httpClient?: {requestJson: Function},
 *  now?: () => number,
 *  connectionProvider?: () => Promise<Object>|Object,
 * }} [opts]
 */
function createAction1Client(opts = {}) {
  const runLogger = opts.runLogger || null;
  const now = typeof opts.now === "function" ? opts.now : Date.now;
  const httpClient =
    opts.httpClient ||
    createSafeHttpClient({
      name: "action1",
      runLogger,
      now,
    });
  const connectionProvider = opts.connectionProvider || null;
  const action1RateLimitMaxRetries = opts.action1RateLimitMaxRetries === undefined || opts.action1RateLimitMaxRetries === null
    ? null
    : Number.isInteger(Number(opts.action1RateLimitMaxRetries))
    ? Math.max(0, Number(opts.action1RateLimitMaxRetries))
    : null;

  /** @type {{ cacheKey: string|null, accessToken: string|null, expiresAtMs: number }} */
  let tokenCache = {
    cacheKey: null,
    accessToken: null,
    expiresAtMs: 0,
  };

  return {
    testConnection,
    listOrganizations,
    listEndpoints,
    listVulnerabilityFindingsByOrg,
    listMissingUpdatesByOrg,
    listAutomationFailuresByOrg,
    collectEndpointSignals,
    // exposed for internal runtime use and testability
    getAccessToken,
  };

  /**
   * @param {Object} connectionInput
   * @returns {Promise<{ok: boolean, statusCode?: number, message?: string}>}
   */
  async function testConnection(connectionInput) {
    const runId = "connection-test-action1";
    await emitLog({
      runLogger,
      runId,
      eventType: LOG_EVENT_TYPES.CONNECTION_TEST,
      message: "Action1 connection test started",
    });

    try {
      const connection = await resolveConnection(connectionInput);
      await probeOrganizationsPage(connection, runId);
      await emitLog({
        runLogger,
        runId,
        eventType: LOG_EVENT_TYPES.CONNECTION_TEST,
        message: "Action1 connection test succeeded",
      });
      return { ok: true, message: "Action1 connection succeeded" };
    } catch (error) {
      await emitLog({
        runLogger,
        runId,
        level: "ERROR",
        eventType: LOG_EVENT_TYPES.PARTIAL_FAILURE,
        message: "Action1 connection test failed",
        context: {
          statusCode: error?.statusCode || null,
          code: error?.code || null,
          detail: error?.message || "unknown error",
        },
      });
      return {
        ok: false,
        statusCode: error?.statusCode || null,
        message: error?.message || "Action1 connection test failed",
      };
    }
  }

  async function probeOrganizationsPage(connection, runId) {
    const response = await requestAction1GetWithRateLimitRetry({
      runId,
      url: joinUrl(connection.baseUrl, "/organizations"),
      resolveAccessToken: buildAccessTokenResolver(connection, runId),
    });
    validateOrganizationsProbePayload(response?.data);
  }

  /**
   * @param {{connection?: Object, token?: string, pageLimit?: number, runId?: string}} [opts]
   */
  async function listOrganizations(opts = {}) {
    const runId = String(opts.runId || "action1-discovery");
    const connection = await resolveConnection(opts.connection);
    const firstUrl = joinUrl(connection.baseUrl, "/organizations");
    const pageLimit = Number.isFinite(Number(opts.pageLimit)) ? Math.max(1, Math.floor(Number(opts.pageLimit))) : 200;
    const normalized = await fetchPagedCollection({
      runId,
      firstUrl,
      pageLimit,
      resolveAccessToken: buildAccessTokenResolver(connection, runId),
      resourceName: "Action1 organizations",
      normalizeItem: normalizeOrganization,
      baseUrl: connection.baseUrl,
      abortSignal: opts.abortSignal || null,
      debugLogging: Boolean(opts.debugLogging),
    });
    return normalized;
  }

  /**
   * @param {string} orgId
   * @param {{connection?: Object, token?: string, pageLimit?: number, runId?: string}} [opts]
   * @returns {Promise<Array<{id: string, name: string, lastSeenAt?: string}>>}
   */
  async function listEndpoints(orgId, opts = {}) {
    if (!orgId) {
      throw new Error("Action1 listEndpoints requires orgId");
    }
    const runId = String(opts.runId || "action1-discovery");
    const connection = await resolveConnection(opts.connection);
    const firstUrl = joinUrl(connection.baseUrl, `/endpoints/managed/${encodeURIComponent(String(orgId))}?limit=100&from=0&fields=*`);
    const pageLimit = Number.isFinite(Number(opts.pageLimit)) ? Math.max(1, Math.floor(Number(opts.pageLimit))) : 200;
    const rows = await fetchPagedCollection({
      runId,
      firstUrl,
      pageLimit,
      resolveAccessToken: buildAccessTokenResolver(connection, runId),
      resourceName: `Action1 endpoints org=${orgId}`,
      normalizeItem: normalizeEndpoint,
      baseUrl: connection.baseUrl,
      orgId: String(orgId),
      abortSignal: opts.abortSignal || null,
      debugLogging: Boolean(opts.debugLogging),
    });
    return rows;
  }

  /**
   * Collect vulnerability findings expanded to endpoint-level rows for one org.
   * Returns rows shaped for Stage 4 normalizer input.
   *
   * @param {string} orgId
   * @param {{connection?: Object, token?: string, runId?: string, listLimit?: number, endpointLimit?: number, pageLimit?: number}} [opts]
   * @returns {Promise<Array<any>>}
   */
  async function listVulnerabilityFindingsByOrg(orgId, opts = {}) {
    if (!orgId) throw new Error("Action1 listVulnerabilityFindingsByOrg requires orgId");
    const runId = String(opts.runId || "action1-vulnerabilities");
    const connection = await resolveConnection(opts.connection);
    const listLimit = Number.isFinite(Number(opts.listLimit)) ? Math.max(1, Math.floor(Number(opts.listLimit))) : 200;
    const endpointLimit = Number.isFinite(Number(opts.endpointLimit))
      ? Math.max(1, Math.floor(Number(opts.endpointLimit)))
      : 200;
    const pageLimit = Number.isFinite(Number(opts.pageLimit)) ? Math.max(1, Math.floor(Number(opts.pageLimit))) : 500;
    const resolveAccessToken = buildAccessTokenResolver(connection, runId);

    const vulnerabilities = await fetchPagedCollection({
      runId,
      firstUrl: joinUrl(connection.baseUrl, `/vulnerabilities/${encodeURIComponent(String(orgId))}?limit=${listLimit}&from=0`),
      pageLimit,
      resolveAccessToken,
      resourceName: `Action1 vulnerabilities org=${orgId}`,
      normalizeItem: (item) => item,
      baseUrl: connection.baseUrl,
      orgId: String(orgId),
      abortSignal: opts.abortSignal || null,
      progressReporter: opts.progressReporter || null,
      debugLogging: Boolean(opts.debugLogging),
    });

    const out = [];
    for (const vuln of vulnerabilities) {
      throwIfAborted(opts.abortSignal || null);
      const cveId = String(vuln?.cve_id || vuln?.id || "").trim();
      if (!cveId) continue;
      reportProgress(opts.progressReporter, {
        phase: "signal_fetch",
        orgId: String(orgId),
        signal: "VULNERABILITY",
        resource: "vulnerability_endpoint_fanout",
        cveId,
      });
      const endpointRows = await fetchPagedCollection({
        runId,
        firstUrl: joinUrl(
          connection.baseUrl,
          `/vulnerabilities/${encodeURIComponent(String(orgId))}/${encodeURIComponent(cveId)}/endpoints?limit=${endpointLimit}&from=0`
        ),
        pageLimit,
        resolveAccessToken,
        resourceName: `Action1 vulnerability endpoints org=${orgId} cve=${cveId}`,
        normalizeItem: (item) => item,
        baseUrl: connection.baseUrl,
        orgId: String(orgId),
        abortSignal: opts.abortSignal || null,
        progressReporter: opts.progressReporter || null,
        debugLogging: Boolean(opts.debugLogging),
      });
      for (const endpointRow of endpointRows) {
        const endpointId = String(endpointRow?.id || endpointRow?.endpoint_id || "").trim();
        if (!endpointId) continue;
        out.push({
          endpointId,
          cve_id: cveId,
          severity: vuln?.severity !== undefined ? vuln.severity : undefined,
          security_severity: vuln?.security_severity !== undefined ? vuln.security_severity : undefined,
          cvss_score: vuln?.cvss_score !== undefined ? vuln.cvss_score : vuln?.cvssScore,
          published_date:
            vuln?.published_date !== undefined
              ? vuln.published_date
              : vuln?.publishedDate !== undefined
                ? vuln.publishedDate
                : vuln?.published,
          remediation_deadline:
            vuln?.remediation_deadline !== undefined
              ? vuln.remediation_deadline
              : vuln?.remediationDeadline !== undefined
                ? vuln.remediationDeadline
                : vuln?.deadline,
          remediation_status:
            vuln?.remediation_status !== undefined
              ? vuln.remediation_status
              : vuln?.remediationStatus !== undefined
              ? vuln.remediationStatus
              : vuln?.slaStatus,
          remediationStatus: vuln?.remediationStatus,
          slaStatus: vuln?.slaStatus,
          cisa_kev: vuln?.cisa_kev !== undefined ? vuln.cisa_kev : vuln?.cisaKev,
          software: Array.isArray(vuln?.software) ? vuln.software : [],
        });
      }
    }
    return out;
  }

  /**
   * Collect missing updates expanded to endpoint-level rows for one org.
   * Returns rows shaped for Stage 4 normalizer input.
   *
   * @param {string} orgId
   * @param {{connection?: Object, token?: string, runId?: string, listLimit?: number, endpointLimit?: number, pageLimit?: number}} [opts]
   * @returns {Promise<Array<any>>}
   */
  async function listMissingUpdatesByOrg(orgId, opts = {}) {
    if (!orgId) throw new Error("Action1 listMissingUpdatesByOrg requires orgId");
    const runId = String(opts.runId || "action1-updates");
    const connection = await resolveConnection(opts.connection);
    const listLimit = Number.isFinite(Number(opts.listLimit)) ? Math.max(1, Math.floor(Number(opts.listLimit))) : 50;
    const endpointLimit = Number.isFinite(Number(opts.endpointLimit))
      ? Math.max(1, Math.floor(Number(opts.endpointLimit)))
      : 200;
    const pageLimit = Number.isFinite(Number(opts.pageLimit)) ? Math.max(1, Math.floor(Number(opts.pageLimit))) : 500;
    const resolveAccessToken = buildAccessTokenResolver(connection, runId);

    const updates = await fetchPagedCollection({
      runId,
      firstUrl: joinUrl(
        connection.baseUrl,
        `/updates/${encodeURIComponent(String(orgId))}?fields=*&limit=${listLimit}&from=0`
      ),
      pageLimit,
      resolveAccessToken,
      resourceName: `Action1 updates org=${orgId}`,
      normalizeItem: (item) => item,
      baseUrl: connection.baseUrl,
      orgId: String(orgId),
      abortSignal: opts.abortSignal || null,
      progressReporter: opts.progressReporter || null,
      debugLogging: Boolean(opts.debugLogging),
    });

    const out = [];
    for (const updateItem of updates) {
      const versionDescriptors = extractUpdateVersionDescriptors(updateItem);
      for (const version of versionDescriptors) {
        reportProgress(opts.progressReporter, {
          phase: "signal_fetch",
          orgId: String(orgId),
          signal: "UPDATE",
          resource: "update_endpoint_fanout",
          packageId: String(version.packageId || ""),
          versionId: String(version.versionId || ""),
        });
        const endpointRows = await fetchPagedCollection({
          runId,
          firstUrl: joinUrl(
            connection.baseUrl,
            `/updates/${encodeURIComponent(String(orgId))}/${encodeURIComponent(version.packageId)}/versions/${encodeURIComponent(
              version.versionId
            )}/endpoints?limit=${endpointLimit}&from=0`
          ),
          pageLimit,
          resolveAccessToken,
          resourceName: `Action1 update endpoints org=${orgId} package=${version.packageId} version=${version.versionId}`,
          normalizeItem: (item) => item,
          baseUrl: connection.baseUrl,
          orgId: String(orgId),
          abortSignal: opts.abortSignal || null,
          progressReporter: opts.progressReporter || null,
          debugLogging: Boolean(opts.debugLogging),
        });
        for (const endpointRow of endpointRows) {
          const endpointId = String(endpointRow?.id || endpointRow?.endpoint_id || "").trim();
          if (!endpointId) continue;
          out.push({
            endpointId,
            packageId: version.packageId,
            versionId: version.versionId,
            id: `${version.packageId}:${version.versionId}`,
            security_severity: version.securitySeverity,
            severity: version.severity,
            update_sla_status: version.updateSlaStatus,
            update_sla_deadline: version.updateSlaDeadline,
            security_CVE: version.securityCve,
            package_name: version.packageName,
            version_name: version.versionName,
            vendor: version.vendor,
            update_type: version.updateType,
            classification: version.classification,
            slaStatus: version.slaStatus,
            remediation_status: version.remediationStatus,
            remediationStatus: version.remediationStatus,
          });
        }
      }
    }

    return out;
  }

  /**
   * Collect automation failures expanded to endpoint-level rows for one org.
   * Returns rows shaped for Stage 4 normalizer input.
   *
   * @param {string} orgId
   * @param {{connection?: Object, token?: string, runId?: string, instanceLimit?: number, endpointLimit?: number, pageLimit?: number}} [opts]
   * @returns {Promise<Array<any>>}
   */
  async function listAutomationFailuresByOrg(orgId, opts = {}) {
    if (!orgId) throw new Error("Action1 listAutomationFailuresByOrg requires orgId");
    const runId = String(opts.runId || "action1-automation-failed");
    const connection = await resolveConnection(opts.connection);
    const instanceLimit = Number.isFinite(Number(opts.instanceLimit))
      ? Math.max(1, Math.floor(Number(opts.instanceLimit)))
      : 50;
    const endpointLimit = Number.isFinite(Number(opts.endpointLimit))
      ? Math.max(1, Math.floor(Number(opts.endpointLimit)))
      : 50;
    const pageLimit = Number.isFinite(Number(opts.pageLimit)) ? Math.max(1, Math.floor(Number(opts.pageLimit))) : 500;
    const cutoffEndTime = asTrimmedString(opts.cutoffEndTime);
    const watermarkEndTime = asTrimmedString(opts.watermarkEndTime);
    const resolveAccessToken = buildAccessTokenResolver(connection, runId);
    const meta = opts.meta && typeof opts.meta === "object" ? opts.meta : null;
    if (meta) {
      meta.instancesSeen = 0;
      meta.instancesSkippedOld = 0;
      meta.instancesQualified = 0;
      meta.instancesFailed = 0;
      meta.maxSeenEndTime = "";
      meta.lastInstanceId = "";
    }

    const instances = await fetchPagedCollection({
      runId,
      firstUrl: joinUrl(
        connection.baseUrl,
        `/automations/instances/${encodeURIComponent(String(orgId))}?status=${encodeURIComponent("Warning")}&completed=${encodeURIComponent(
          "yes"
        )}&sortby=${encodeURIComponent("-end_time")}&limit=${instanceLimit}&from=0`
      ),
      pageLimit,
      resolveAccessToken,
      resourceName: `Action1 automation instances org=${orgId}`,
      normalizeItem: (item) => item,
      baseUrl: connection.baseUrl,
      orgId: String(orgId),
      abortSignal: opts.abortSignal || null,
      progressReporter: opts.progressReporter || null,
      debugLogging: Boolean(opts.debugLogging),
    });

    const out = [];
    for (const instance of instances) {
      const instanceEndTime = asTrimmedString(instance?.end_time || instance?.completed_at || instance?.updated_at || instance?.created_at);
      if (meta) meta.instancesSeen += 1;
      if (instanceEndTime) {
        if (meta && (!meta.maxSeenEndTime || instanceEndTime > meta.maxSeenEndTime)) {
          meta.maxSeenEndTime = instanceEndTime;
          meta.lastInstanceId = asTrimmedString(instance?.id);
        }
        if (cutoffEndTime && instanceEndTime < cutoffEndTime) {
          if (meta) meta.instancesSkippedOld += 1;
          await emitLog({
            runLogger,
            runId,
            eventType: LOG_EVENT_TYPES.SKIP,
            message: "[AUTOMATION INSTANCE SKIP] reason=older_than_cutoff",
            context: { org: String(orgId), cutoff: cutoffEndTime, endTime: instanceEndTime },
          });
          break;
        }
        if (watermarkEndTime && instanceEndTime <= watermarkEndTime) {
          if (meta) meta.instancesSkippedOld += 1;
          await emitLog({
            runLogger,
            runId,
            eventType: LOG_EVENT_TYPES.SKIP,
            message: "[AUTOMATION INSTANCE SKIP] reason=older_than_cutoff",
            context: { org: String(orgId), watermark: watermarkEndTime, endTime: instanceEndTime },
          });
          break;
        }
      }
      const instanceId = asTrimmedString(instance?.id);
      if (!instanceId) continue;
      reportProgress(opts.progressReporter, {
        phase: "signal_fetch",
        orgId: String(orgId),
        signal: "AUTOMATION_FAILED",
        resource: "automation_endpoint_fanout",
        automationInstanceId: instanceId,
      });
      let endpointResults = [];
      try {
        endpointResults = await fetchPagedCollection({
          runId,
          firstUrl: joinUrl(
            connection.baseUrl,
            `/automations/instances/${encodeURIComponent(String(orgId))}/${encodeURIComponent(
              instanceId
            )}/endpoint-results?last_status=${encodeURIComponent("Error")}&limit=${endpointLimit}&from=0`
          ),
          pageLimit,
          resolveAccessToken,
          resourceName: `Action1 automation endpoint-results org=${orgId} instance=${instanceId}`,
          normalizeItem: (item) => item,
          baseUrl: connection.baseUrl,
          orgId: String(orgId),
          abortSignal: opts.abortSignal || null,
          progressReporter: opts.progressReporter || null,
          debugLogging: Boolean(opts.debugLogging),
        });
      } catch (error) {
        if (meta) meta.instancesFailed += 1;
        throw error;
      }
      for (const row of endpointResults) {
        const endpointId = asTrimmedString(row?.id || row?.endpoint_id || row?.endpointId);
        if (!endpointId) continue;
        const status = asTrimmedString(row?.status || row?.last_status || row?.lastStatus || "ERROR");
        out.push({
          endpointId,
          endpoint_id: endpointId,
          id: endpointId,
          instanceId,
          instanceName: asTrimmedString(instance?.name),
          instanceStartTime: asTrimmedString(instance?.start_time || instance?.started_at || instance?.created_at),
          instanceEndTime: asTrimmedString(instance?.end_time),
          status,
          last_status: status,
          failed: status.toUpperCase() === "ERROR" || status.toUpperCase() === "FAILED",
          severity: "UNSPECIFIED",
          description: asTrimmedString(row?.description),
          action_name: asTrimmedString(row?.action_name),
          percent_completed: row?.percent_completed,
        });
      }
      if (meta) meta.instancesQualified += 1;
    }
    return out;
  }

  /**
   * Stage-2 placeholder to keep contract stable.
   * Signal collection logic remains part of later stages.
   *
   * @param {string} orgId
   * @param {string} endpointId
   * @param {{connection?: Object, runId?: string}} [opts]
   * @returns {Promise<Object>}
   */
  async function collectEndpointSignals(orgId, endpointId, opts = {}) {
    if (!orgId) throw new Error("Action1 collectEndpointSignals requires orgId");
    if (!endpointId) throw new Error("Action1 collectEndpointSignals requires endpointId");

    const runId = String(opts.runId || "action1-discovery");
    return {
      orgId: String(orgId),
      endpointId: String(endpointId),
      endpoint: null,
      signals: {
        vulnerabilities: [],
        updates: [],
        automationFailed: [],
      },
      supportedSignals: ["OFFLINE", "REBOOT_REQUIRED", "AUTOMATION_FAILED", "VULNERABILITY", "UPDATE"],
      collectedAt: new Date().toISOString(),
      detail:
        "Signal collection is not implemented in Stage 2. Stage 4 pipeline consumes normalized endpoint + signals shape when provided.",
    };
  }

  async function fetchPagedCollection(input) {
    const rows = [];
    const seen = new Set();
    let nextUrl = input.firstUrl;
    let page = 0;
    const startedAtMs = Date.now();

    while (nextUrl) {
      throwIfAborted(input.abortSignal);
      page += 1;
      if (page > input.pageLimit) {
        throw new Error(`${input.resourceName} paging exceeded limit ${input.pageLimit}`);
      }

      const absolute = toAbsoluteUrl(input.baseUrl, nextUrl);
      if (seen.has(absolute)) {
        throw new Error(`${input.resourceName} paging loop detected`);
      }
      seen.add(absolute);

      if (input.debugLogging) {
        await emitLog({
          runLogger,
          runId: input.runId,
          eventType: LOG_EVENT_TYPES.DISCOVERY_FETCH,
          message: `${input.resourceName} page fetch`,
          context: {
            page,
            url: absolute,
          },
        });
      }
      reportProgress(input.progressReporter, {
        phase: "action1_paged_fetch",
        orgId: String(input.orgId || ""),
        signal: inferSignalFromResource(input.resourceName),
        resource: String(input.resourceName || ""),
        page,
        url: absolute,
      });

      const response = await requestAction1GetWithRateLimitRetry({
        runId: input.runId,
        url: absolute,
        resolveAccessToken: input.resolveAccessToken,
        orgId: input.orgId || "",
        abortSignal: input.abortSignal || null,
      });

      const payload = response.data && typeof response.data === "object" ? response.data : {};
      const pageItems = Array.isArray(payload.items) ? payload.items : [];
      for (const item of pageItems) {
        rows.push(input.normalizeItem(item));
      }

      const nextPage =
        payload.next_page ||
        payload.nextPage ||
        payload.next ||
        payload.nextLink ||
        buildOffsetNextPage({
          baseUrl: input.baseUrl,
          currentPath: absolute,
          totalItems: payload.total_items,
          from: payload.from,
          pageItemCount: pageItems.length,
        });
      nextUrl = nextPage ? String(nextPage) : null;
    }

    await emitLog({
      runLogger,
      runId: input.runId,
      eventType: LOG_EVENT_TYPES.DISCOVERY_FETCH,
      message: "[ACTION1 PAGED FETCH]",
      context: {
        resource: String(input.resourceName || ""),
        org: String(input.orgId || ""),
        pagesFetched: page,
        recordsFetched: rows.length,
        durationMs: Math.max(0, Date.now() - startedAtMs),
      },
    });
    return rows;
  }

  async function requestAction1GetWithRateLimitRetry(input) {
    const maxRetries = action1RateLimitMaxRetries;
    let retryAttempt = 0;
    let consecutive429 = 0;

    while (true) {
      throwIfAborted(input.abortSignal);
      try {
        const accessToken = await resolveRequestAccessToken(input);
        const response = await httpClient.requestJson({
          method: "GET",
          url: input.url,
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          runId: input.runId,
          abortSignal: input.abortSignal || null,
          // Action1 deep GET retry policy is owned by this wrapper.
          maxAttempts: 1,
        });
        consecutive429 = 0;
        return response;
      } catch (error) {
        const statusCode = Number(error?.statusCode || 0);
        const isRateLimited = statusCode === 429 || String(error?.code || "").toUpperCase() === "RATE_LIMITED";
        const retriesExceeded = Number.isFinite(maxRetries) && retryAttempt >= maxRetries;
        if (!isRateLimited || retriesExceeded) {
          if (isRateLimited) {
            await emitLog({
              runLogger,
              runId: input.runId,
              level: "ERROR",
              eventType: LOG_EVENT_TYPES.PARTIAL_FAILURE,
              message: "[ACTION1 FETCH FAILED]",
              context: {
                org: String(input.orgId || ""),
                phase: "endpoints",
                error: 429,
                retriesExceeded: true,
                retryAttempt,
              },
            });
          }
          throw error;
        }

        retryAttempt += 1;
        consecutive429 += 1;
        const retryAfterMs = resolveRetryAfterMs(error);
        const delayMs = computeAction1RateLimitDelayMs(retryAfterMs, consecutive429);
        await emitLog({
          runLogger,
          runId: input.runId,
          level: "WARN",
          eventType: LOG_EVENT_TYPES.RETRY,
          message: "[Action1][rate-limit] 429",
          context: {
            org: String(input.orgId || ""),
            retryAttempt,
            consecutive429Count: consecutive429,
            delayMs,
            retryAfterMs: retryAfterMs ?? null,
          },
        });
        await sleepMs(delayMs, input.abortSignal || null);
      }
    }
  }

  async function getAccessToken(connectionInput, runId = "action1-auth") {
    const connection = await resolveConnection(connectionInput);
    const cacheKey = `${connection.baseUrl}|${connection.clientId}|${connection.clientSecret}`;
    const current = now();
    if (
      tokenCache.cacheKey === cacheKey &&
      tokenCache.accessToken &&
      current < tokenCache.expiresAtMs - TOKEN_REUSE_SAFETY_MARGIN_MS
    ) {
      return tokenCache.accessToken;
    }

    await emitLog({
      runLogger,
      runId,
      eventType: LOG_EVENT_TYPES.CONNECTION_TEST,
      message: "Action1 token fetch started",
      context: {
        baseUrl: connection.baseUrl,
        clientId: connection.clientId,
      },
    });

    const response = await httpClient.requestJson({
      method: "POST",
      url: joinUrl(connection.baseUrl, "/oauth2/token"),
      body: {
        grant_type: "client_credentials",
        client_id: connection.clientId,
        client_secret: connection.clientSecret,
      },
      runId,
    });

    const payload = response.data && typeof response.data === "object" ? response.data : {};
    const accessToken = payload.access_token ? String(payload.access_token) : "";
    if (!accessToken) {
      throw new Error("Action1 token response did not include access_token");
    }
    const expiresInRaw = Number(payload.expires_in);
    const expiresInMs = Number.isFinite(expiresInRaw) && expiresInRaw > 0 ? Math.floor(expiresInRaw * 1000) : 3600000;
    tokenCache = {
      cacheKey,
      accessToken,
      expiresAtMs: now() + expiresInMs,
    };

    await emitLog({
      runLogger,
      runId,
      eventType: LOG_EVENT_TYPES.CONNECTION_TEST,
      message: "Action1 token fetch succeeded",
      context: {
        expiresInSeconds: Math.floor(expiresInMs / 1000),
      },
    });

    return accessToken;
  }

  async function resolveConnection(connectionInput) {
    const raw =
      connectionInput ||
      (typeof connectionProvider === "function" ? await connectionProvider() : connectionProvider) ||
      null;
    if (!raw || typeof raw !== "object") {
      throw new Error("Action1 connection is not configured");
    }

    const baseUrl = ensureUrl(raw.baseUrl, "Action1 baseUrl");
    const clientId = String(raw.clientId || "").trim();
    const clientSecret = String(raw.clientSecret || "").trim();
    if (!clientId) throw new Error("Action1 clientId is required");
    if (!clientSecret) throw new Error("Action1 clientSecret is required");

    return {
      baseUrl,
      clientId,
      clientSecret,
    };
  }

  function buildAccessTokenResolver(connection, runId) {
    return async () => getAccessToken(connection, runId);
  }
}

function validateOrganizationsProbePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Action1 organizations response malformed");
  }
  if (!Array.isArray(payload.items)) {
    throw new Error("Action1 organizations response malformed");
  }
  for (const item of payload.items) {
    const normalized = normalizeOrganization(item);
    if (!normalized.id || !normalized.name) {
      throw new Error("Action1 organizations response malformed");
    }
  }
}


function normalizeOrganization(item) {
  return {
    id: String(item?.id || item?.org_id || ""),
    name: String(item?.name || item?.org_name || ""),
  };
}

function normalizeEndpoint(item) {
  const rebootRaw =
    item?.rebootRequired !== undefined
      ? item.rebootRequired
      : item?.reboot_required !== undefined
        ? item.reboot_required
        : item?.reboot;

  return {
    id: String(item?.id || item?.endpoint_id || ""),
    name: String(item?.name || item?.endpoint_name || ""),
    lastSeenAt: item?.last_seen ? String(item.last_seen) : undefined,
    rebootRequired: toOptionalBoolean(rebootRaw),
  };
}

function toOptionalBoolean(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = String(value).trim().toUpperCase();
  if (!normalized) return undefined;
  return normalized === "TRUE" || normalized === "YES" || normalized === "Y" || normalized === "1";
}

function buildOffsetNextPage({ baseUrl, currentPath, totalItems, from, pageItemCount }) {
  const total = Number(totalItems);
  const currentFrom = Number(from);
  const currentCount = Number(pageItemCount);
  if (!Number.isFinite(total) || !Number.isFinite(currentFrom) || !Number.isFinite(currentCount) || currentCount <= 0) {
    return null;
  }
  const nextFrom = currentFrom + currentCount;
  if (nextFrom >= total) return null;
  if (nextFrom <= currentFrom) return null;

  const url = new URL(currentPath || baseUrl);
  url.searchParams.set("from", String(nextFrom));
  const currentLimitRaw = Number(url.searchParams.get("limit"));
  if (Number.isFinite(currentLimitRaw) && currentLimitRaw > 0) {
    url.searchParams.set("limit", String(Math.floor(currentLimitRaw)));
  }
  return url.toString();
}

function computeAction1RateLimitDelayMs(retryAfterMs, consecutive429Count) {
  const normalizedCount = Number.isFinite(Number(consecutive429Count)) ? Math.max(1, Math.floor(Number(consecutive429Count))) : 1;
  const calculatedBackoffMs = Math.min(
    ACTION1_RATE_LIMIT_MAX_DELAY_MS,
    ACTION1_RATE_LIMIT_BASE_DELAY_MS * Math.pow(2, normalizedCount - 1)
  );
  if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
    return Math.max(Math.floor(calculatedBackoffMs), Math.floor(retryAfterMs));
  }
  return Math.floor(calculatedBackoffMs);
}

function resolveRetryAfterMs(error) {
  if (Number.isFinite(Number(error?.retryAfterMs)) && Number(error.retryAfterMs) >= 0) {
    return Math.floor(Number(error.retryAfterMs));
  }
  const headerValue =
    error?.responseHeaders?.["retry-after"] ||
    error?.responsePayload?.headers?.["retry-after"] ||
    error?.responsePayload?.headers?.["Retry-After"];
  return parseRetryAfterMs(headerValue);
}

function parseRetryAfterMs(value) {
  if (value === undefined || value === null || value === "") return null;
  const numericSeconds = Number(value);
  if (Number.isFinite(numericSeconds) && numericSeconds >= 0) {
    return Math.floor(numericSeconds * 1000);
  }
  const absoluteEpochMs = Date.parse(String(value));
  if (!Number.isFinite(absoluteEpochMs)) return null;
  return Math.max(0, absoluteEpochMs - Date.now());
}

function sleepMs(ms, abortSignal) {
  return new Promise((resolve) => {
    const handle = setTimeout(resolve, ms);
    if (abortSignal && typeof abortSignal.addEventListener === "function") {
      const onAbort = () => {
        clearTimeout(handle);
        resolve();
      };
      abortSignal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

module.exports = {
  createAction1Client,
};

function extractUpdateVersionDescriptors(updateItem) {
  const rows = [];
  const packageIdDirect = asTrimmedString(
    updateItem?.packageId || updateItem?.package_id || updateItem?.package?.id || updateItem?.id
  );
  const versionIdDirect = asTrimmedString(updateItem?.versionId || updateItem?.version_id || updateItem?.version?.id);
  if (packageIdDirect && versionIdDirect) {
    rows.push(buildUpdateVersionDescriptor(packageIdDirect, versionIdDirect, updateItem));
  }

  const versions = Array.isArray(updateItem?.versions) ? updateItem.versions : [];
  for (const versionRow of versions) {
    const packageId = packageIdDirect || asTrimmedString(updateItem?.id || updateItem?.package?.id || versionRow?.packageId);
    const versionId = asTrimmedString(versionRow?.versionId || versionRow?.version_id || versionRow?.id);
    if (!packageId || !versionId) continue;
    rows.push(buildUpdateVersionDescriptor(packageId, versionId, {
      ...updateItem,
      ...versionRow,
    }));
  }

  const deduped = [];
  const seen = new Set();
  for (const row of rows) {
    const key = `${row.packageId}|${row.versionId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }
  return deduped;
}

function buildUpdateVersionDescriptor(packageId, versionId, source) {
  const securitySeverity = asTrimmedString(
    source?.security_severity || source?.securitySeverity || source?.severity || source?.severityBucket
  );
  const updateSlaStatus = asTrimmedString(
    source?.update_sla_status || source?.updateSlaStatus || source?.slaStatus || source?.remediation_status || source?.remediationStatus
  );
  const remediationStatus = asTrimmedString(
    source?.remediation_status || source?.remediationStatus || source?.slaStatus || source?.update_sla_status
  );
  return {
    packageId,
    versionId,
    securitySeverity,
    severity: asTrimmedString(source?.severity || source?.security_severity || source?.severityBucket),
    updateSlaStatus,
    updateSlaDeadline: asTrimmedString(source?.update_sla_deadline || source?.updateSlaDeadline || source?.slaDeadline),
    securityCve: asTrimmedString(source?.security_CVE || source?.securityCVE || source?.cves),
    packageName: asTrimmedString(source?.package_name || source?.packageName || source?.name || source?.title),
    versionName: asTrimmedString(source?.version_name || source?.version || source?.displayVersion),
    vendor: asTrimmedString(source?.vendor || source?.publisher),
    updateType: asTrimmedString(source?.update_type || source?.updateType),
    classification: asTrimmedString(source?.classification || source?.category),
    slaStatus: asTrimmedString(source?.slaStatus || source?.update_sla_status || source?.remediation_status),
    remediationStatus,
  };
}

function asTrimmedString(value) {
  return String(value || "").trim();
}

function reportProgress(progressReporter, update) {
  if (typeof progressReporter !== "function") return;
  progressReporter(update || {});
}

function inferSignalFromResource(resourceName) {
  const name = String(resourceName || "").toUpperCase();
  if (name.includes("VULNERABILITY")) return "VULNERABILITY";
  if (name.includes("UPDATE")) return "UPDATE";
  if (name.includes("AUTOMATION")) return "AUTOMATION_FAILED";
  return "";
}

function throwIfAborted(abortSignal) {
  if (!abortSignal || !abortSignal.aborted) return;
  const error = new Error("Action1 request aborted");
  error.name = "AbortError";
  error.code = "ABORT_ERR";
  throw error;
}

async function resolveRequestAccessToken(input) {
  if (typeof input?.resolveAccessToken === "function") {
    return input.resolveAccessToken();
  }
  throw new Error("Action1 access token could not be resolved");
}
