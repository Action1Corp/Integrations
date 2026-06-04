// apiServer.js
//
// Action1 Public Repository Material
//
// Use of this file is subject to TERMS_OF_USE.md (https://github.com/Action1Corp/PSAction1/blob/main/TERMS_OF_USE.md) in this repository.
// Provided AS IS, without warranties.
// Use at your own risk.
// Review, test, and validate before production use.
// © Action1 Corporation. All rights reserved.
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { URL } = require("node:url");
const { getUiShellModel } = require("../../ui");
const { LOG_EVENT_TYPES, emitLog, createFileRunLogger, createCompositeRunLogger } = require("../logging");
const { normalizeConnectorConfig } = require("../config");
const { createStage4CandidatePreviewService } = require("./stage4CandidatePreviewService");
const { createCandidatePreparationService } = require("./candidatePreparationService");
const { createLifecycleRunService } = require("./lifecycleRunService");
const { createInMemoryLifecycleRunAuditStore } = require("./lifecycleRunAuditStore");
const {
  createSyncSchedulerRuntime,
  createInMemorySyncSchedulerStateStore,
  normalizeSyncSchedulerConfig,
  SUPPORTED_INTERVAL_HOURS,
} = require("./syncSchedulerRuntime");
const { createLifecycleRunMutex } = require("./lifecycleRunMutex");

const LIFECYCLE_RUN_CONFIRMATION = "RUN_LIFECYCLE_ONCE";
const DEFAULT_LIFECYCLE_PREVIEW_TIMEOUT_MS = 30000;
const DEFAULT_LIFECYCLE_MANUAL_CANDIDATE_PREPARATION_TIMEOUT_MS = 0;
const DEFAULT_LIFECYCLE_RUN_HISTORY_LIMIT = 20;
const MAX_LIFECYCLE_RUN_HISTORY_LIMIT = 100;

/**
 * @param {{
 *  configStore: any,
 *  action1Client: any,
 *  haloAuthClient: any,
 *  haloDiscoveryClient: any,
 *  haloTicketsClient?: any,
 *  correlationStore?: any,
 *  stage4CandidatePreviewService?: any,
 *  candidatePreparationService?: any,
 *  lifecycleRunService?: any,
 *  lifecycleRunAuditStore?: any,
 *  lifecyclePreviewTimeoutMs?: number,
 *  lifecycleManualCandidatePreparationTimeoutMs?: number,
 *  now?: () => number,
 *  runLogger?: any,
 *  host?: string,
 *  port?: number,
 * }} deps
 */
function createApiServer(deps) {
  const host = String(deps.host || "127.0.0.1");
  const configuredPort = Number.isFinite(Number(deps.port)) ? Number(deps.port) : 4300;
  let boundPort = configuredPort;
  let server = null;
  const staticRoot = path.join(__dirname, "..", "..", "ui", "public");
  const stage4CandidatePreviewService =
    deps.stage4CandidatePreviewService ||
    createStage4CandidatePreviewService({
      configStore: deps.configStore,
      action1Client: deps.action1Client,
      runLogger: deps.runLogger,
      signalWatermarkStore: deps.signalWatermarkStore,
    });
  const candidatePreparationService =
    deps.candidatePreparationService ||
    createCandidatePreparationService({
      stage4CandidatePreviewService,
    });
  const lifecyclePreviewTimeoutMs = toPositiveInt(deps.lifecyclePreviewTimeoutMs, DEFAULT_LIFECYCLE_PREVIEW_TIMEOUT_MS);
  const lifecycleManualCandidatePreparationTimeoutMs = toNonNegativeInt(
    deps.lifecycleManualCandidatePreparationTimeoutMs,
    DEFAULT_LIFECYCLE_MANUAL_CANDIDATE_PREPARATION_TIMEOUT_MS
  );
  const nowFn = typeof deps.now === "function" ? deps.now : Date.now;
  let lifecycleRunService = deps.lifecycleRunService || null;
  const lifecycleRunAuditStore = deps.lifecycleRunAuditStore || createInMemoryLifecycleRunAuditStore();
  const lifecycleRunMutex = deps.lifecycleRunMutex || createLifecycleRunMutex();
  let schedulerRuntime =
    deps.schedulerRuntime ||
    createSyncSchedulerRuntime({
      configProvider: async () => {
        const cfg = await deps.configStore.loadConnectorConfig();
        return cfg.syncScheduler || { enabled: false, intervalHours: 24 };
      },
      stateStore: deps.syncSchedulerStateStore || createInMemorySyncSchedulerStateStore(),
      lifecycleRunner: async () => {
        const execution = await runLifecycleOnceInternal({
          confirm: LIFECYCLE_RUN_CONFIRMATION,
          trigger: "scheduled",
          maxCandidates: 0,
        });
        if (execution.statusCode === 200 && execution.payload?.ok) return execution.payload;
        const code = String(execution.payload?.error || "scheduled_run_failed");
        const detail = String(execution.payload?.message || "").trim();
        const error = new Error(detail ? `${code}: ${detail}` : code);
        error.code = code;
        throw error;
      },
      now: nowFn,
    });

  return {
    start,
    stop,
    get url() {
      return `http://${host}:${boundPort}`;
    },
  };

  async function start() {
    if (server) return;
    server = http.createServer(async (req, res) => {
      try {
        await handleRequest(req, res);
      } catch (error) {
        await emitLog({
          runLogger: deps.runLogger,
          runId: "runtime-api",
          level: "ERROR",
          eventType: LOG_EVENT_TYPES.PARTIAL_FAILURE,
          message: "Unhandled API error",
          context: {
            detail: error?.message || "unknown",
          },
        });
        writeJson(res, 500, { ok: false, error: "internal_error", message: error?.message || "internal error" });
      }
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(configuredPort, host, () => {
        const address = server.address();
        if (address && typeof address === "object" && address.port) {
          boundPort = address.port;
        }
        resolve();
      });
    });
    if (schedulerRuntime && typeof schedulerRuntime.start === "function") {
      await schedulerRuntime.start();
    }
  }

  async function stop() {
    if (schedulerRuntime && typeof schedulerRuntime.stop === "function") {
      await schedulerRuntime.stop();
    }
    if (!server) return;
    await new Promise((resolve) => server.close(() => resolve()));
    server = null;
  }

  async function handleRequest(req, res) {
    const parsed = new URL(req.url, `http://${req.headers.host || `${host}:${boundPort}`}`);
    const pathname = parsed.pathname;
    const method = String(req.method || "GET").toUpperCase();

    if (method === "OPTIONS") {
      writeCors(res);
      res.statusCode = 204;
      res.end();
      return;
    }

    if (method === "GET" && pathname === "/api/health") {
      writeJson(res, 200, { ok: true, service: "action1-halo-connector", stage: "stage2" });
      return;
    }

    if (method === "GET" && pathname === "/") {
      await writeStaticFile(res, staticRoot, "index.html", "text/html; charset=utf-8");
      return;
    }

    if (method === "GET" && pathname === "/assets/app.js") {
      await writeStaticFile(res, staticRoot, "app.js", "application/javascript; charset=utf-8");
      return;
    }

    if (method === "GET" && pathname === "/assets/styles.css") {
      await writeStaticFile(res, staticRoot, "styles.css", "text/css; charset=utf-8");
      return;
    }

    if (method === "GET" && pathname === "/api/ui-shell") {
      writeJson(res, 200, { ok: true, data: getUiShellModel() });
      return;
    }

    if (method === "GET" && pathname === "/api/config/load") {
      await handleConfigLoad(res);
      return;
    }

    if (method === "POST" && pathname === "/api/config/save") {
      const body = await readJsonBody(req);
      await handleConfigSave(res, body);
      return;
    }

    if (method === "POST" && pathname === "/api/connection/action1/test") {
      const body = await readJsonBody(req);
      await handleAction1ConnectionTest(res, body);
      return;
    }

    if (method === "POST" && pathname === "/api/connection/halo/test") {
      const body = await readJsonBody(req);
      await handleHaloConnectionTest(res, body);
      return;
    }

    if (method === "GET" && pathname === "/api/discovery") {
      await handleDiscovery(res, parsed.searchParams);
      return;
    }

    if (method === "GET" && pathname === "/api/stage4/candidates/preview") {
      await handleStage4CandidatePreview(res);
      return;
    }

    if (method === "POST" && pathname === "/api/lifecycle/run-once") {
      const body = await readJsonBody(req);
      await handleLifecycleRunOnce(res, body);
      return;
    }

    if (method === "GET" && pathname === "/api/scheduler/status") {
      await handleSchedulerStatus(res);
      return;
    }

    if (method === "POST" && pathname === "/api/scheduler/config") {
      const body = await readJsonBody(req);
      await handleSchedulerConfig(res, body);
      return;
    }

    if (method === "GET" && pathname === "/api/lifecycle/runs") {
      await handleLifecycleRunHistory(res, parsed.searchParams);
      return;
    }

    const ticketTypeDetailMatch = pathname.match(/^\/api\/discovery\/ticket-type\/([^/]+)$/);
    if (method === "GET" && ticketTypeDetailMatch) {
      const ticketTypeId = decodeURIComponent(ticketTypeDetailMatch[1]);
      await handleTicketTypeDetail(res, ticketTypeId);
      return;
    }

    writeJson(res, 404, { ok: false, error: "not_found" });
  }

  async function handleConfigLoad(res) {
    const config = await deps.configStore.loadConnectorConfig();
    const secrets = await deps.configStore.loadConnectionSecrets();
    writeJson(res, 200, {
      ok: true,
      data: {
        config: redactConfig(config, secrets),
        uiShell: getUiShellModel(),
      },
    });
  }

  async function handleConfigSave(res, body) {
    const existing = await deps.configStore.loadConnectorConfig();
    const nextConfig = normalizeConnectorConfig({
      ...existing,
      ...(body?.config || {}),
    });
    const patches = extractConnectionPatch(body);
    if (patches.action1) {
      nextConfig.connections.action1 = {
        ...nextConfig.connections.action1,
        baseUrl: valueOrExisting(patches.action1.baseUrl, nextConfig.connections.action1.baseUrl),
        clientId: valueOrExisting(patches.action1.clientId, nextConfig.connections.action1.clientId),
      };
      if (patches.action1.clientSecret !== undefined) {
        nextConfig.connections.action1.clientSecretRef = patches.action1.clientSecret ? "action1.primary" : "";
      }
    }
    if (patches.halo) {
      nextConfig.connections.halo = {
        ...nextConfig.connections.halo,
        resourceServer: valueOrExisting(patches.halo.resourceServer, nextConfig.connections.halo.resourceServer),
        authorisationServer: valueOrExisting(
          patches.halo.authorisationServer,
          nextConfig.connections.halo.authorisationServer
        ),
        tenant: valueOrExisting(patches.halo.tenant, nextConfig.connections.halo.tenant),
        clientId: valueOrExisting(patches.halo.clientId, nextConfig.connections.halo.clientId),
      };
      if (patches.halo.clientSecret !== undefined) {
        nextConfig.connections.halo.clientSecretRef = patches.halo.clientSecret ? "halo.primary" : "";
      }
    }

    await deps.configStore.saveConnectorConfig(nextConfig);

    const secretPatch = {};
    if (patches.action1 && patches.action1.clientSecret !== undefined) {
      secretPatch.action1ClientSecret = String(patches.action1.clientSecret || "");
    }
    if (patches.halo && patches.halo.clientSecret !== undefined) {
      secretPatch.haloClientSecret = String(patches.halo.clientSecret || "");
    }
    if (Object.keys(secretPatch).length > 0) {
      await deps.configStore.saveConnectionSecrets(secretPatch);
    }

    const secrets = await deps.configStore.loadConnectionSecrets();
    writeJson(res, 200, {
      ok: true,
      data: {
        config: redactConfig(nextConfig, secrets),
      },
    });
  }

  async function handleAction1ConnectionTest(res, body) {
    const fallback = await loadStoredConnections();
    const explicit = body?.connection || body?.action1 || body?.connections?.action1 || null;
    const connection = {
      ...fallback.action1,
      ...(explicit || {}),
      clientSecret:
        explicit && Object.prototype.hasOwnProperty.call(explicit, "clientSecret")
          ? String(explicit.clientSecret || "")
          : fallback.action1.clientSecret,
    };
    const result = await deps.action1Client.testConnection(connection);
    writeJson(res, result.ok ? 200 : 400, { ok: result.ok, data: result });
  }

  async function handleHaloConnectionTest(res, body) {
    const fallback = await loadStoredConnections();
    const explicit = body?.connection || body?.halo || body?.connections?.halo || null;
    const connection = {
      ...fallback.halo,
      ...(explicit || {}),
      clientSecret:
        explicit && Object.prototype.hasOwnProperty.call(explicit, "clientSecret")
          ? String(explicit.clientSecret || "")
          : fallback.halo.clientSecret,
    };
    const result = await deps.haloAuthClient.testConnection(connection);
    writeJson(res, result.ok ? 200 : 400, { ok: result.ok, data: result });
  }

  async function handleDiscovery(res, searchParams) {
    await emitLog({
      runLogger: deps.runLogger,
      runId: "discovery-load",
      eventType: LOG_EVENT_TYPES.DISCOVERY_FETCH,
      message: "[halo-discovery-debug] /api/discovery requested",
      context: {
        includeSites: shouldIncludeSites(searchParams.get("includeSites")),
        ticketTypeId: String(searchParams.get("ticketTypeId") || "").trim(),
      },
    });
    const includeSites = shouldIncludeSites(searchParams.get("includeSites"));
    const ticketTypeId = String(searchParams.get("ticketTypeId") || "").trim();
    const runId = "discovery-load";
    const connections = await loadStoredConnections();
    const action1Configured = isAction1DiscoveryConfigured(connections.action1);
    const haloConfigured = isHaloDiscoveryConfigured(connections.halo);

    const tasks = [];
    if (action1Configured) {
      tasks.push(runTask("action1Organizations", () => deps.action1Client.listOrganizations({ runId })));
    }
    if (haloConfigured) {
      tasks.push(runTask("teams", () => deps.haloDiscoveryClient.listTeams()));
      tasks.push(runTask("ticketTypes", () => deps.haloDiscoveryClient.listTicketTypes()));
      tasks.push(runTask("statuses", () => deps.haloDiscoveryClient.listStatuses()));
      tasks.push(runTask("categories", () => deps.haloDiscoveryClient.listCategories()));
      tasks.push(runTask("clients", () => deps.haloDiscoveryClient.listClients()));
    }
    if (haloConfigured && includeSites) {
      tasks.push(runTask("sites", () => deps.haloDiscoveryClient.listSites()));
    }
    if (haloConfigured && ticketTypeId) {
      tasks.push(runTask("ticketTypeDetail", () => deps.haloDiscoveryClient.getTicketTypeDetails(ticketTypeId)));
    }

    const settled = await Promise.all(tasks);
    const data = {
      action1Organizations: [],
      halo: {
        teams: [],
        ticketTypes: [],
        statuses: [],
        categories: [],
        clients: [],
        sites: [],
      },
      categories: [],
      clients: [],
      ticketTypeDetail: null,
      notConfigured: {
        action1: !action1Configured,
        halo: !haloConfigured,
      },
      partialFailures: [],
    };

    for (const item of settled) {
      if (item.ok) {
        if (item.key === "action1Organizations") data.action1Organizations = item.value;
        if (item.key === "teams") data.halo.teams = item.value;
        if (item.key === "ticketTypes") data.halo.ticketTypes = item.value;
        if (item.key === "statuses") data.halo.statuses = item.value;
        if (item.key === "categories") data.halo.categories = item.value;
        if (item.key === "clients") data.halo.clients = item.value;
        if (item.key === "sites") data.halo.sites = item.value;
        if (item.key === "ticketTypeDetail") data.ticketTypeDetail = item.value;
      } else {
        data.partialFailures.push({
          source: item.key,
          statusCode: item.error?.statusCode || null,
          message: item.error?.message || "discovery fetch failed",
        });
      }
    }

    data.categories = data.halo.categories;
    data.clients = data.halo.clients;

    await emitLog({
      runLogger: deps.runLogger,
      runId: "discovery-load",
      eventType: LOG_EVENT_TYPES.DISCOVERY_FETCH,
      message: "[halo-discovery-debug] /api/discovery response counts",
      context: {
        teams: data.halo.teams.length,
        ticketTypes: data.halo.ticketTypes.length,
        statuses: data.halo.statuses.length,
        categories: data.halo.categories.length,
        clients: data.halo.clients.length,
        sites: data.halo.sites.length,
        partialFailures: data.partialFailures.length,
      },
    });

    writeJson(res, 200, { ok: true, data });
  }

  async function handleTicketTypeDetail(res, ticketTypeId) {
    try {
      const detail = await deps.haloDiscoveryClient.getTicketTypeDetails(ticketTypeId);
      writeJson(res, 200, { ok: true, data: detail });
    } catch (error) {
      writeJson(res, 400, {
        ok: false,
        error: "ticket_type_detail_failed",
        message: error?.message || "failed to fetch ticket type detail",
      });
    }
  }

  async function handleStage4CandidatePreview(res) {
    const previewRunId = `stage4-preview-${createId()}`;
    const previewAbort = typeof AbortController === "function" ? new AbortController() : null;
    try {
      await emitLog({
        runLogger: deps.runLogger,
        runId: "stage4-preview",
        eventType: LOG_EVENT_TYPES.DISCOVERY_FETCH,
        message: "Stage 4 candidate preview requested",
      });
      const preview = await withTimeoutAbort(
        ({ signal }) =>
          candidatePreparationService.generateDebugPreview({
            runId: previewRunId,
            abortSignal: signal,
          }),
        lifecyclePreviewTimeoutMs,
        "stage4_preview_timeout",
        previewAbort
      );
      await emitLog({
        runLogger: deps.runLogger,
        runId: "stage4-preview",
        eventType: LOG_EVENT_TYPES.DISCOVERY_FETCH,
        message: "Stage 4 candidate preview completed",
        context: {
          candidates: Array.isArray(preview?.candidates) ? preview.candidates.length : 0,
          skipped: Array.isArray(preview?.skipped) ? preview.skipped.length : 0,
          warnings: Array.isArray(preview?.diagnostics?.warnings) ? preview.diagnostics.warnings.length : 0,
        },
      });
      writeJson(res, 200, {
        ok: true,
        preview: {
          candidates: Array.isArray(preview?.candidates) ? preview.candidates : [],
          skipped: Array.isArray(preview?.skipped) ? preview.skipped : [],
          summary: {
            orgsSeen: Number(preview?.summary?.orgsSeen || 0),
            endpointsSeen: Number(preview?.summary?.endpointsSeen || 0),
            candidatesBySignalType:
              preview?.summary?.candidatesBySignalType && typeof preview.summary.candidatesBySignalType === "object"
                ? preview.summary.candidatesBySignalType
                : {},
            skippedByReason:
              preview?.summary?.skippedByReason && typeof preview.summary.skippedByReason === "object"
                ? preview.summary.skippedByReason
                : {},
          },
          diagnostics: {
            partial: Boolean(preview?.diagnostics?.partial),
            warnings: Array.isArray(preview?.diagnostics?.warnings) ? preview.diagnostics.warnings : [],
            preparation:
              preview?.diagnostics?.preparation && typeof preview.diagnostics.preparation === "object"
                ? preview.diagnostics.preparation
                : { phase: "", orgsSeen: 0, failedOrgs: [] },
            signalCollection:
              preview?.diagnostics?.signalCollection && typeof preview.diagnostics.signalCollection === "object"
                ? preview.diagnostics.signalCollection
                : {},
          },
        },
      });
    } catch (error) {
      if (String(error?.code || "") === "candidate_preparation_blocked_by_manual_run") {
        writeJson(res, 409, {
          ok: false,
          error: "candidate_preparation_blocked_by_manual_run",
          message: "Candidate preview is blocked while manual sync candidate preparation is in progress.",
        });
        return;
      }
      if (String(error?.message || "") === "stage4_preview_timeout") {
        await emitLog({
          runLogger: deps.runLogger,
          runId: "stage4-preview",
          level: "WARN",
          eventType: LOG_EVENT_TYPES.PARTIAL_FAILURE,
          message: "[CANDIDATE PREP TIMEOUT]",
          context: { runId: previewRunId, timeoutMs: lifecyclePreviewTimeoutMs },
        });
        await emitLog({
          runLogger: deps.runLogger,
          runId: "stage4-preview",
          level: "WARN",
          eventType: LOG_EVENT_TYPES.PARTIAL_FAILURE,
          message: "[CANDIDATE PREP ABORTED]",
          context: { runId: previewRunId },
        });
      }
      await emitLog({
        runLogger: deps.runLogger,
        runId: "stage4-preview",
        level: "ERROR",
        eventType: LOG_EVENT_TYPES.PARTIAL_FAILURE,
        message: "Stage 4 candidate preview failed",
        context: {
          detail: error?.message || "unknown",
        },
      });
      writeJson(res, 500, {
        ok: false,
        error: "stage4_preview_failed",
        message: "failed to generate stage4 candidate preview",
      });
    }
  }

  async function handleLifecycleRunOnce(res, body) {
    const result = await runLifecycleOnceInternal(body);
    writeJson(res, Number(result.statusCode || 500), result.payload || { ok: false, error: "internal_error" });
  }

  async function runLifecycleOnceInternal(body) {
    const trigger = String(body?.trigger || "").trim().toLowerCase() === "scheduled" ? "scheduled" : "manual";
    const lockAcquired = lifecycleRunMutex.acquire({ trigger });
    if (!lockAcquired) {
      return {
        statusCode: 409,
        payload: {
        ok: false,
        error: "lifecycle_run_in_progress",
        message: "A lifecycle run is already in progress.",
        },
      };
    }
    try {
    const startedAt = nowFn();
    const startedAtIso = new Date(startedAt).toISOString();
    let lifecycleDebugLoggingEnabled = false;
    try {
      const runtimeConfigForLogging = await deps.configStore.loadConnectorConfig();
      lifecycleDebugLoggingEnabled = Boolean(runtimeConfigForLogging?.operationalSafeguards?.enableDebugLogging);
    } catch (_) {
      lifecycleDebugLoggingEnabled = false;
    }
    const lifecycleRunId = `lifecycle-run-once-${createId()}`;
    const candidatePrepRunId = `lifecycle-run-once-candidate-prep-${createId()}`;
    const scopedRunLogger = createScopedLifecycleRunLogger({
      baseRunLogger: deps.runLogger,
      lifecycleRunId,
      candidatePrepRunId,
      lifecycleDebugScope: true,
      debugLoggingEnabled: lifecycleDebugLoggingEnabled,
    });
    const diagnostics = {
      partial: false,
      warnings: [],
      ticketModels: {
        vulnerabilities: "endpoint",
        updates: "endpoint",
        automationFailed: "endpoint",
        maxImpactedEndpointsInGroupedTicket: 25,
      },
      candidateModels: {
        endpoint: 0,
        grouped: 0,
        bySignalAndModel: {},
      },
      candidateOrdering: "explicit_signal_priority",
      preparation: {
        phase: "",
        orgsSeen: 0,
        failedOrgs: [],
      },
      signalCollection: {},
      timeoutFlags: {
        candidateGeneration: false,
        categoryLookup: false,
        lifecycleRun: false,
      },
      timings: {
        candidateGenerationMs: 0,
        categoryLookupMs: 0,
        lifecycleRunMs: 0,
        totalMs: 0,
      },
    };

    if (String(body?.confirm || "").trim() !== LIFECYCLE_RUN_CONFIRMATION) {
      await emitLog({
        runLogger: scopedRunLogger,
        runId: "lifecycle-run-once",
        level: "WARN",
        eventType: LOG_EVENT_TYPES.SKIP,
        message: "Lifecycle run blocked: confirmation missing/invalid",
      });
      return {
        statusCode: 400,
        payload: {
        ok: false,
        error: "confirmation_required",
        message: "Lifecycle run requires explicit confirmation.",
        },
      };
    }

    if (body?.dryRun === true) {
      return {
        statusCode: 400,
        payload: {
        ok: false,
        error: "dry_run_not_supported",
        message: "Dry-run mode is not implemented for lifecycle run-once.",
        },
      };
    }

    const maxCandidatesInput = resolveMaxCandidatesInput(body?.maxCandidates);
    if (!maxCandidatesInput.ok) {
      return {
        statusCode: 400,
        payload: {
        ok: false,
        error: "invalid_max_candidates",
        message: "maxCandidates must be a non-negative integer.",
        },
      };
    }
    const maxCandidates = maxCandidatesInput.value;
    await emitLog({
      runLogger: scopedRunLogger,
      runId: "lifecycle-run-once",
      eventType: LOG_EVENT_TYPES.RUN_START,
      message: "[RUN START]",
      context: {
        lifecycleRunId,
        trigger,
        maxCandidates,
      },
    });

    let preview;
    const candidatePrepAbort = typeof AbortController === "function" ? new AbortController() : null;
    const candidatePrepProgress = { phase: "", orgId: "", signal: "", resource: "", cveId: "", packageId: "", versionId: "", automationInstanceId: "", page: 0, url: "" };
    const previewStartedAt = nowFn();
    await emitLog({
      runLogger: scopedRunLogger,
      runId: "lifecycle-run-once",
      eventType: LOG_EVENT_TYPES.DISCOVERY_FETCH,
      message: "[PHASE TIMING]",
      context: {
        phase: "candidate_preparation",
        state: "start",
      },
    });
    try {
      const prepareWork = ({ signal }) =>
        candidatePreparationService.prepareForLifecycleRun({
          runId: candidatePrepRunId,
          runLogger: scopedRunLogger,
          abortSignal: signal,
          progressReporter: (ctx) => {
            Object.assign(candidatePrepProgress, sanitizeTimeoutContext(ctx));
          },
        });
      preview =
        lifecycleManualCandidatePreparationTimeoutMs > 0
          ? await withTimeoutAbort(
              prepareWork,
              lifecycleManualCandidatePreparationTimeoutMs,
              "candidate_preparation_timeout",
              candidatePrepAbort,
              () => sanitizeTimeoutContext(candidatePrepProgress)
            )
          : await prepareWork({ signal: candidatePrepAbort?.signal || null });
    } catch (error) {
      diagnostics.timeoutFlags.candidateGeneration = error?.message === "candidate_preparation_timeout";
      diagnostics.timings.candidateGenerationMs = Math.max(0, nowFn() - previewStartedAt);
      diagnostics.timings.totalMs = Math.max(0, nowFn() - startedAt);
      const timeoutContext = sanitizeTimeoutContext(error?.timeoutContext || candidatePrepProgress);
      const phase = timeoutContext.phase || "candidate_preparation";
      const reason = diagnostics.timeoutFlags.candidateGeneration ? "timeout" : "fetch_failed";
      diagnostics.preparation.phase = phase;
      if (diagnostics.timeoutFlags.candidateGeneration) {
        await emitLog({
          runLogger: scopedRunLogger,
          runId: "lifecycle-run-once",
          level: "WARN",
          eventType: LOG_EVENT_TYPES.PARTIAL_FAILURE,
          message: "[CANDIDATE PREP TIMEOUT]",
          context: {
            runId: candidatePrepRunId,
            timeoutMs: lifecycleManualCandidatePreparationTimeoutMs,
            phase: timeoutContext.phase || "",
            org: timeoutContext.orgId || "",
            signal: timeoutContext.signal || "",
            resource: timeoutContext.resource || "",
            cveId: timeoutContext.cveId || "",
            packageId: timeoutContext.packageId || "",
            versionId: timeoutContext.versionId || "",
            automationInstanceId: timeoutContext.automationInstanceId || "",
            page: timeoutContext.page || 0,
            url: timeoutContext.url || "",
          },
        });
        await emitLog({
          runLogger: scopedRunLogger,
          runId: "lifecycle-run-once",
          level: "WARN",
          eventType: LOG_EVENT_TYPES.PARTIAL_FAILURE,
          message: "[CANDIDATE PREP ABORTED]",
          context: {
            runId: candidatePrepRunId,
          },
        });
      }
      await emitLog({
        runLogger: scopedRunLogger,
        runId: "lifecycle-run-once",
        level: "ERROR",
        eventType: LOG_EVENT_TYPES.PARTIAL_FAILURE,
        message: "[ERROR]",
        context: {
          phase: "candidate_preparation",
          detail: error?.message || "unknown",
          timeoutContext,
        },
      });
      const payload = {
        ok: false,
        error: diagnostics.timeoutFlags.candidateGeneration
          ? "candidate_preparation_timeout"
          : "lifecycle_candidate_generation_failed",
        message: "Failed to prepare lifecycle candidates.",
        phase,
        failedOrgs: diagnostics?.preparation?.failedOrgs || [],
        reason,
        timeoutContext,
        diagnostics,
      };
      await writeLifecycleRunAudit({
        startedAtIso,
        finishedAtIso: new Date(nowFn()).toISOString(),
        ok: false,
        candidateCount: 0,
        skippedCandidateCount: 0,
        maxCandidates,
        summary: {},
        diagnostics: sanitizeDiagnostics(diagnostics),
        error: {
          code: diagnostics.timeoutFlags.candidateGeneration
            ? "candidate_preparation_timeout"
            : "lifecycle_candidate_generation_failed",
          message: "Failed to prepare lifecycle candidates.",
        },
      });
      return {
        statusCode: 502,
        payload,
      };
    }
    diagnostics.timings.candidateGenerationMs = Math.max(0, nowFn() - previewStartedAt);
    await emitLog({
      runLogger: scopedRunLogger,
      runId: "lifecycle-run-once",
      eventType: LOG_EVENT_TYPES.DISCOVERY_FETCH,
      message: "[PHASE TIMING]",
      context: {
        phase: "candidate_preparation",
        state: "end",
        durationMs: diagnostics.timings.candidateGenerationMs,
        orgCount: Number(preview?.summary?.orgsSeen || 0),
        candidatesTotal: Array.isArray(preview?.candidates) ? preview.candidates.length : 0,
        candidateModels:
          preview?.summary?.candidatesBySignalType && typeof preview.summary.candidatesBySignalType === "object"
            ? preview.summary.candidatesBySignalType
            : {},
      },
    });
    diagnostics.partial = Boolean(preview?.diagnostics?.partial);
    diagnostics.warnings.push(...sanitizeWarningRows(preview?.diagnostics?.warnings));
    if (preview?.diagnostics?.preparation && typeof preview.diagnostics.preparation === "object") {
      diagnostics.preparation = {
        phase: String(preview.diagnostics.preparation.phase || ""),
        orgsSeen: Number(preview.diagnostics.preparation.orgsSeen || 0),
        failedOrgs: Array.isArray(preview.diagnostics.preparation.failedOrgs)
          ? preview.diagnostics.preparation.failedOrgs
          : [],
      };
    }
    if (preview?.diagnostics?.signalCollection && typeof preview.diagnostics.signalCollection === "object") {
      diagnostics.signalCollection = preview.diagnostics.signalCollection;
    }

    const lifecycleConfig = preview?.connectorConfig || preview?.normalizedConfig || {};
    diagnostics.ticketModels = extractTicketModelDiagnostics(lifecycleConfig);
    const candidatesRaw = Array.isArray(preview?.candidates) ? preview.candidates : [];
    const candidates = sortCandidatesForDeterministicLimitWindow(candidatesRaw);
    const skippedCandidates = Array.isArray(preview?.skipped) ? preview.skipped : [];
    diagnostics.candidateModels = buildCandidateModelDiagnostics(candidates);
    const candidateCount = candidates.length;
    const skippedCandidateCount = skippedCandidates.length;
    const hasCandidateLimit = Number.isInteger(maxCandidates) && maxCandidates > 0;
    const processedCandidates =
      hasCandidateLimit && candidateCount > maxCandidates ? candidates.slice(0, maxCandidates) : candidates;
    const processedCandidateCount = processedCandidates.length;
    const deferredCandidateCount = Math.max(0, candidateCount - processedCandidateCount);
    diagnostics.candidateLimit = {
      totalCandidates: candidateCount,
      maxCandidates,
      processedCandidates: processedCandidateCount,
      deferredCandidates: deferredCandidateCount,
      limited: deferredCandidateCount > 0,
    };
    await emitLog({
      runLogger: scopedRunLogger,
      runId: "lifecycle-run-once",
      eventType: LOG_EVENT_TYPES.DISCOVERY_FETCH,
      message: "[TICKET MODELS]",
      context: diagnostics.ticketModels,
    });
    await emitLog({
      runLogger: scopedRunLogger,
      runId: "lifecycle-run-once",
      eventType: LOG_EVENT_TYPES.DISCOVERY_FETCH,
      message: "[CANDIDATE MODELS]",
      context: diagnostics.candidateModels,
    });

    if (hasCandidateLimit && deferredCandidateCount > 0) {
      await emitLog({
        runLogger: scopedRunLogger,
        runId: "lifecycle-run-once",
        level: "WARN",
        eventType: LOG_EVENT_TYPES.SKIP,
        message: "[CANDIDATES LIMIT]",
        context: {
          total: candidateCount,
          maxCandidates,
          processed: processedCandidateCount,
          deferred: deferredCandidateCount,
        },
      });
    }

    const categoryLookupStartedAt = nowFn();
    const categoriesResult = await loadCategoriesForLifecycleRun();
    diagnostics.timings.categoryLookupMs = Math.max(0, nowFn() - categoryLookupStartedAt);
    await emitLog({
      runLogger: scopedRunLogger,
      runId: "lifecycle-run-once",
      eventType: LOG_EVENT_TYPES.DISCOVERY_FETCH,
      message: "[PHASE TIMING]",
      context: {
        phase: "category_lookup",
        durationMs: diagnostics.timings.categoryLookupMs,
      },
    });
    diagnostics.partial = diagnostics.partial || categoriesResult.partial;
    diagnostics.warnings.push(...categoriesResult.warnings);
    diagnostics.timeoutFlags.categoryLookup = categoriesResult.timeout;

    if (categoriesResult.failed && requiresCategoryResolution(processedCandidates)) {
      diagnostics.timings.totalMs = Math.max(0, nowFn() - startedAt);
      await emitLog({
        runLogger: scopedRunLogger,
        runId: "lifecycle-run-once",
        level: "ERROR",
        eventType: LOG_EVENT_TYPES.PARTIAL_FAILURE,
        message: "[ERROR]",
        context: {
          phase: "category_lookup",
        },
      });
      const payload = {
        ok: false,
        error: "lifecycle_category_lookup_failed",
        message: "Failed to resolve categories required for lifecycle run.",
        candidateCount,
        skippedCandidateCount,
        maxCandidates,
        diagnostics: sanitizeDiagnostics(diagnostics),
      };
      await writeLifecycleRunAudit({
        startedAtIso,
        finishedAtIso: new Date(nowFn()).toISOString(),
        ok: false,
        candidateCount,
        skippedCandidateCount,
        maxCandidates,
        summary: {},
        diagnostics: sanitizeDiagnostics(diagnostics),
        error: {
          code: "lifecycle_category_lookup_failed",
          message: "Failed to resolve categories required for lifecycle run.",
        },
      });
      return {
        statusCode: 502,
        payload,
      };
    }

    const lifecycleRunStartedAt = nowFn();
    try {
      const service = getLifecycleRunService();
      const runOutput = await service.runOnce({
        candidates: processedCandidates,
        config: lifecycleConfig,
        categories: categoriesResult.categories,
        runLogger: scopedRunLogger,
      });
      diagnostics.timings.lifecycleRunMs = Math.max(0, nowFn() - lifecycleRunStartedAt);
      diagnostics.timings.totalMs = Math.max(0, nowFn() - startedAt);
      const summary = runOutput?.summary || {
        candidatesSeen: 0,
        created: 0,
        updated: 0,
        closed: 0,
        skipped: 0,
        failed: 0,
        bySignalType: {},
        failuresByReason: {},
      };
      const results = Array.isArray(runOutput?.results) ? runOutput.results : [];
      const responseDiagnostics = sanitizeDiagnostics(diagnostics);
      await writeLifecycleRunAudit({
        startedAtIso,
        finishedAtIso: new Date(nowFn()).toISOString(),
        ok: true,
        candidateCount,
        skippedCandidateCount,
        maxCandidates,
        summary,
        diagnostics: responseDiagnostics,
        error: null,
      });
      await emitLog({
        runLogger: scopedRunLogger,
        runId: "lifecycle-run-once",
        eventType: LOG_EVENT_TYPES.RUN_END,
        message: "[RUN END]",
        context: {
          candidateOrdering: "explicit_signal_priority",
          candidateCount: processedCandidateCount,
          totalCandidates: candidateCount,
          deferredCandidates: deferredCandidateCount,
          created: Number(summary.created || 0),
          updated: Number(summary.updated || 0),
          closed: Number(summary.closed || 0),
          skipped: Number(summary.skipped || 0),
          failed: Number(summary.failed || 0),
          ...buildRunEndBreakdown(summary, results),
          totalMs: responseDiagnostics.timings.totalMs,
        },
      });
      await emitLog({
        runLogger: scopedRunLogger,
        runId: "lifecycle-run-once",
        eventType: LOG_EVENT_TYPES.DISCOVERY_FETCH,
        message: "[PHASE TIMING]",
        context: {
          phase: "total_lifecycle_run",
          durationMs: responseDiagnostics.timings.totalMs,
          candidatesTotal: candidateCount,
          processedCandidates: processedCandidateCount,
          deferredCandidates: deferredCandidateCount,
        },
      });
      return {
        statusCode: 200,
        payload: {
        ok: true,
        candidateCount,
        skippedCandidateCount,
        maxCandidates,
        processedCandidateCount,
        deferredCandidateCount,
        summary,
        results,
        diagnostics: responseDiagnostics,
        },
      };
    } catch (error) {
      diagnostics.timeoutFlags.lifecycleRun = error?.message === "lifecycle_run_timeout";
      diagnostics.timings.lifecycleRunMs = Math.max(0, nowFn() - lifecycleRunStartedAt);
      diagnostics.timings.totalMs = Math.max(0, nowFn() - startedAt);
      await emitLog({
        runLogger: scopedRunLogger,
        runId: "lifecycle-run-once",
        level: "ERROR",
        eventType: LOG_EVENT_TYPES.PARTIAL_FAILURE,
        message: "[ERROR]",
        context: {
          phase: "lifecycle_execution",
          detail: error?.message || "unknown",
        },
      });
      const payload = {
        ok: false,
        error: "lifecycle_run_failed",
        message: "Lifecycle run-once failed.",
        candidateCount,
        skippedCandidateCount,
        maxCandidates,
        diagnostics: sanitizeDiagnostics(diagnostics),
      };
      await writeLifecycleRunAudit({
        startedAtIso,
        finishedAtIso: new Date(nowFn()).toISOString(),
        ok: false,
        candidateCount,
        skippedCandidateCount,
        maxCandidates,
        summary: {},
        diagnostics: sanitizeDiagnostics(diagnostics),
        error: {
          code: "lifecycle_run_failed",
          message: "Lifecycle run-once failed.",
        },
      });
      return {
        statusCode: 500,
        payload,
      };
    }
    } finally {
      lifecycleRunMutex.release();
      if (schedulerRuntime && typeof schedulerRuntime.notifyRunCompleted === "function") {
        await schedulerRuntime.notifyRunCompleted();
      }
    }
  }

  async function handleLifecycleRunHistory(res, searchParams) {
    try {
      const limit = resolveHistoryLimit(searchParams?.get("limit"));
      const rows = await lifecycleRunAuditStore.listRuns({ limit });
      writeJson(res, 200, {
        ok: true,
        runs: rows.map((row) => sanitizeAuditRecord(row)),
      });
    } catch (error) {
      await emitLog({
        runLogger: scopedRunLogger,
        runId: "lifecycle-runs-history",
        level: "ERROR",
        eventType: LOG_EVENT_TYPES.PARTIAL_FAILURE,
        message: "Lifecycle run history load failed",
        context: {
          detail: error?.message || "unknown",
        },
      });
      writeJson(res, 500, {
        ok: false,
        error: "lifecycle_run_history_failed",
        message: "Failed to load lifecycle run history.",
      });
    }
  }

  async function handleSchedulerStatus(res) {
    const cfg = normalizeConnectorConfig(await deps.configStore.loadConnectorConfig());
    const runtimeStatus =
      schedulerRuntime && typeof schedulerRuntime.getStatus === "function"
        ? await schedulerRuntime.getStatus()
        : {
            enabled: Boolean(cfg?.syncScheduler?.enabled),
            intervalHours: Number(cfg?.syncScheduler?.intervalHours || 24),
            nextRunAt: "",
            lastScheduledRunAt: "",
            lastSchedulerError: "",
            running: false,
          };
    writeJson(res, 200, {
      ok: true,
      scheduler: {
        enabled: Boolean(runtimeStatus.enabled),
        intervalHours: Number(runtimeStatus.intervalHours || 24),
        nextRunAt: String(runtimeStatus.nextRunAt || ""),
        lastScheduledRunAt: String(runtimeStatus.lastScheduledRunAt || ""),
        lastSchedulerError: String(runtimeStatus.lastSchedulerError || ""),
        running: Boolean(runtimeStatus.running),
        lifecycleRunInProgress: Boolean(lifecycleRunMutex.isRunning()),
        activeRunTrigger: String(lifecycleRunMutex.getActiveRun()?.trigger || ""),
        activeRunStartedAt: String(lifecycleRunMutex.getActiveRun()?.startedAt || ""),
      },
    });
  }

  async function handleSchedulerConfig(res, body) {
    const requested = normalizeSyncSchedulerConfig({
      enabled: body?.enabled,
      intervalHours: body?.intervalHours,
    });
    if (!SUPPORTED_INTERVAL_HOURS.includes(Number(body?.intervalHours)) && body?.enabled === true) {
      writeJson(res, 400, {
        ok: false,
        error: "invalid_scheduler_interval",
        message: `intervalHours must be one of: ${SUPPORTED_INTERVAL_HOURS.join(", ")}`,
      });
      return;
    }
    const cfg = normalizeConnectorConfig(await deps.configStore.loadConnectorConfig());
    cfg.syncScheduler = requested;
    await deps.configStore.saveConnectorConfig(cfg);
    const status =
      schedulerRuntime && typeof schedulerRuntime.updateConfig === "function"
        ? await schedulerRuntime.updateConfig(requested)
        : requested;
    writeJson(res, 200, {
      ok: true,
      scheduler: {
        enabled: Boolean(status.enabled),
        intervalHours: Number(status.intervalHours || 24),
        nextRunAt: String(status.nextRunAt || ""),
        lastScheduledRunAt: String(status.lastScheduledRunAt || ""),
        lastSchedulerError: String(status.lastSchedulerError || ""),
        running: Boolean(status.running),
      },
    });
  }

  function getLifecycleRunService() {
    if (lifecycleRunService) return lifecycleRunService;
    assertLifecycleWriteDependencies(deps);
    lifecycleRunService = createLifecycleRunService({
      haloTicketsClient: deps.haloTicketsClient,
      correlationStore: deps.correlationStore,
      now: deps.now,
      runLogger: deps.runLogger,
    });
    return lifecycleRunService;
  }

  async function loadCategoriesForLifecycleRun() {
    if (!deps.haloDiscoveryClient || typeof deps.haloDiscoveryClient.listCategories !== "function") {
      return {
        categories: [],
        failed: true,
        partial: true,
        timeout: false,
        warnings: [
          {
            code: "lifecycle_category_lookup_unavailable",
            message: "Halo category lookup is unavailable for lifecycle run.",
          },
        ],
      };
    }

    try {
      const rows = await withTimeout(
        deps.haloDiscoveryClient.listCategories(),
        lifecyclePreviewTimeoutMs,
        "lifecycle_category_lookup_timeout"
      );
      return {
        categories: Array.isArray(rows) ? rows : [],
        failed: false,
        partial: false,
        timeout: false,
        warnings: [],
      };
    } catch (error) {
      return {
        categories: [],
        failed: true,
        partial: true,
        timeout: error?.message === "lifecycle_category_lookup_timeout",
        warnings: [
          {
            code: "lifecycle_category_lookup_failed",
            message: "Halo category lookup failed for lifecycle run.",
          },
        ],
      };
    }
  }

  async function writeLifecycleRunAudit(input) {
    if (!lifecycleRunAuditStore || typeof lifecycleRunAuditStore.appendRun !== "function") return;
    try {
      await lifecycleRunAuditStore.appendRun({
        id: createId(),
        startedAt: String(input.startedAtIso || ""),
        finishedAt: String(input.finishedAtIso || ""),
        ok: Boolean(input.ok),
        candidateCount: Number(input.candidateCount || 0),
        skippedCandidateCount: Number(input.skippedCandidateCount || 0),
        maxCandidates: Number(input.maxCandidates || 0),
        summary: sanitizeObject(input.summary),
        diagnostics: sanitizeDiagnostics(input.diagnostics),
        error: input.error ? sanitizeObject(input.error) : null,
      });
    } catch (error) {
      await emitLog({
        runLogger: deps.runLogger,
        runId: "lifecycle-run-audit",
        level: "WARN",
        eventType: LOG_EVENT_TYPES.PARTIAL_FAILURE,
        message: "Failed to persist lifecycle run audit record",
        context: {
          detail: error?.message || "unknown",
        },
      });
    }
  }

  async function runTask(key, fn) {
    try {
      const value = await fn();
      return { key, ok: true, value };
    } catch (error) {
      await emitLog({
        runLogger: deps.runLogger,
        runId: "discovery-load",
        level: "WARN",
        eventType: LOG_EVENT_TYPES.PARTIAL_FAILURE,
        message: `Discovery task failed: ${key}`,
        context: {
          statusCode: error?.statusCode || null,
          code: error?.code || null,
          detail: error?.message || "unknown",
        },
      });
      return { key, ok: false, error };
    }
  }

  async function loadStoredConnections() {
    const config = await deps.configStore.loadConnectorConfig();
    const secrets = await deps.configStore.loadConnectionSecrets();
    return {
      action1: {
        baseUrl: config.connections?.action1?.baseUrl || "",
        clientId: config.connections?.action1?.clientId || "",
        clientSecret: secrets.action1ClientSecret || "",
      },
      halo: {
        resourceServer: config.connections?.halo?.resourceServer || config.connections?.halo?.baseUrl || "",
        authorisationServer:
          config.connections?.halo?.authorisationServer || deriveAuthServerFromTokenUrl(config.connections?.halo?.tokenUrl),
        tenant: config.connections?.halo?.tenant || "",
        clientId: config.connections?.halo?.clientId || "",
        clientSecret: secrets.haloClientSecret || "",
      },
    };
  }
}

function isAction1DiscoveryConfigured(connection) {
  return Boolean(
    String(connection?.baseUrl || "").trim() &&
      String(connection?.clientId || "").trim() &&
      String(connection?.clientSecret || "").trim()
  );
}

function isHaloDiscoveryConfigured(connection) {
  return Boolean(
    String(connection?.resourceServer || "").trim() &&
      String(connection?.authorisationServer || "").trim() &&
      String(connection?.clientId || "").trim() &&
      String(connection?.clientSecret || "").trim()
  );
}

async function writeStaticFile(res, root, fileName, contentType) {
  const fullPath = path.join(root, fileName);
  const body = await fs.readFile(fullPath);
  writeCors(res);
  res.statusCode = 200;
  res.setHeader("Content-Type", contentType);
  res.end(body);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (_) {
    throw new Error("Request body must be valid JSON");
  }
}

function writeCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}

function writeJson(res, statusCode, payload) {
  writeCors(res);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function redactConfig(config, secrets) {
  return {
    ...config,
    connections: {
      ...config.connections,
      action1: {
        ...config.connections.action1,
        hasClientSecret: Boolean(secrets?.action1ClientSecret),
      },
      halo: {
        ...config.connections.halo,
        hasClientSecret: Boolean(secrets?.haloClientSecret),
      },
    },
  };
}

function shouldIncludeSites(value) {
  if (value === null) return true;
  const normalized = String(value).toLowerCase();
  return normalized !== "false" && normalized !== "0" && normalized !== "no";
}

function deriveAuthServerFromTokenUrl(tokenUrlRaw) {
  const tokenUrl = String(tokenUrlRaw || "").trim();
  if (!tokenUrl) return "";
  return tokenUrl.replace(/\/token$/i, "");
}

function extractConnectionPatch(body) {
  const source = body && typeof body === "object" ? body : {};
  const connections = source.connections && typeof source.connections === "object" ? source.connections : {};
  return {
    action1: source.action1 || connections.action1 || null,
    halo: source.halo || connections.halo || null,
  };
}

function valueOrExisting(nextValue, existingValue) {
  return nextValue === undefined ? existingValue : String(nextValue || "");
}

function resolveMaxCandidatesInput(rawValue) {
  if (rawValue === undefined || rawValue === null || String(rawValue).trim() === "") {
    return {
      ok: true,
      value: 0,
    };
  }
  const n = Number(rawValue);
  if (!Number.isInteger(n) || n < 0) {
    return { ok: false, value: null };
  }
  return {
    ok: true,
    value: n,
  };
}

function resolveHistoryLimit(rawValue) {
  if (rawValue === undefined || rawValue === null || String(rawValue).trim() === "") {
    return DEFAULT_LIFECYCLE_RUN_HISTORY_LIMIT;
  }
  const n = Number(rawValue);
  if (!Number.isInteger(n) || n <= 0) return DEFAULT_LIFECYCLE_RUN_HISTORY_LIMIT;
  return Math.min(MAX_LIFECYCLE_RUN_HISTORY_LIMIT, n);
}

function requiresCategoryResolution(candidates) {
  for (const row of Array.isArray(candidates) ? candidates : []) {
    const category1Id = String(row?.routing?.category1Id || "").trim();
    if (category1Id) return true;
  }
  return false;
}

function assertLifecycleWriteDependencies(deps) {
  assertMethod("haloTicketsClient", deps.haloTicketsClient, "createTicket");
  assertMethod("haloTicketsClient", deps.haloTicketsClient, "updateTicket");
  assertMethod("haloTicketsClient", deps.haloTicketsClient, "getTicket");
  assertMethod("haloTicketsClient", deps.haloTicketsClient, "setTicketStatus");
  assertMethod("correlationStore", deps.correlationStore, "getCorrelation");
  assertMethod("correlationStore", deps.correlationStore, "upsertCorrelation");
  assertMethod("correlationStore", deps.correlationStore, "deleteCorrelation");
}

function assertMethod(name, value, method) {
  if (!value || typeof value !== "object" || typeof value[method] !== "function") {
    throw new Error(`lifecycle_dependency_missing_${name}_${method}`);
  }
}

function sanitizeDiagnostics(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const timeoutFlags = src.timeoutFlags && typeof src.timeoutFlags === "object" ? src.timeoutFlags : {};
  const timings = src.timings && typeof src.timings === "object" ? src.timings : {};
  const preparation = src.preparation && typeof src.preparation === "object" ? src.preparation : {};
  const signalCollection = src.signalCollection && typeof src.signalCollection === "object" ? src.signalCollection : {};
  const candidateLimit = src.candidateLimit && typeof src.candidateLimit === "object" ? src.candidateLimit : {};
  return {
    partial: Boolean(src.partial),
    warnings: sanitizeWarningRows(src.warnings),
    ticketModels: extractTicketModelDiagnostics(src.ticketModels),
    candidateModels:
      src.candidateModels && typeof src.candidateModels === "object"
        ? {
            endpoint: Number(src.candidateModels.endpoint || 0),
            grouped: Number(src.candidateModels.grouped || 0),
            bySignalAndModel: sanitizeObject(src.candidateModels.bySignalAndModel || {}),
          }
        : { endpoint: 0, grouped: 0, bySignalAndModel: {} },
    candidateOrdering: String(src.candidateOrdering || ""),
    preparation: {
      phase: String(preparation.phase || ""),
      orgsSeen: Number(preparation.orgsSeen || 0),
      failedOrgs: Array.isArray(preparation.failedOrgs) ? sanitizeObject(preparation.failedOrgs) : [],
    },
    signalCollection: sanitizeObject(signalCollection),
    candidateLimit: {
      totalCandidates: Number(candidateLimit.totalCandidates || 0),
      maxCandidates: Number(candidateLimit.maxCandidates || 0),
      processedCandidates: Number(candidateLimit.processedCandidates || 0),
      deferredCandidates: Number(candidateLimit.deferredCandidates || 0),
      limited: Boolean(candidateLimit.limited),
    },
    timeoutFlags: {
      candidateGeneration: Boolean(timeoutFlags.candidateGeneration),
      categoryLookup: Boolean(timeoutFlags.categoryLookup),
      lifecycleRun: Boolean(timeoutFlags.lifecycleRun),
    },
    timings: {
      candidateGenerationMs: Number(timings.candidateGenerationMs || 0),
      categoryLookupMs: Number(timings.categoryLookupMs || 0),
      lifecycleRunMs: Number(timings.lifecycleRunMs || 0),
      totalMs: Number(timings.totalMs || 0),
    },
  };
}

function sanitizeWarningRows(rows) {
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const code = String(row?.code || "").trim();
    const rawMessage = String(row?.message || "").trim();
    if (!code && !rawMessage) continue;
    const message = containsSecretLikeText(rawMessage) ? "warning redacted" : rawMessage.slice(0, 240);
    out.push({
      code: code || "warning",
      message,
    });
  }
  return out;
}

function extractTicketModelDiagnostics(configValue) {
  const cfg = configValue && typeof configValue === "object" ? configValue : {};
  const vulnerabilitiesRaw =
    typeof cfg.vulnerabilities === "string" ? cfg.vulnerabilities : cfg?.vulnerabilities?.ticketModel;
  const updatesRaw = typeof cfg.updates === "string" ? cfg.updates : cfg?.updates?.ticketModel;
  const automationRaw =
    typeof cfg.automationFailed === "string" ? cfg.automationFailed : cfg?.automationFailed?.ticketModel;
  const groupedLimitRaw =
    cfg.maxImpactedEndpointsInGroupedTicket !== undefined
      ? cfg.maxImpactedEndpointsInGroupedTicket
      : cfg?.ticketModels?.maxImpactedEndpointsInGroupedTicket;
  return {
    vulnerabilities: normalizeTicketModelForDiagnostics(vulnerabilitiesRaw),
    updates: normalizeTicketModelForDiagnostics(updatesRaw),
    automationFailed: normalizeTicketModelForDiagnostics(automationRaw),
    maxImpactedEndpointsInGroupedTicket: normalizeGroupedLimitForDiagnostics(groupedLimitRaw),
  };
}

function buildCandidateModelDiagnostics(candidates) {
  const out = {
    endpoint: 0,
    grouped: 0,
    bySignalAndModel: {},
  };
  for (const row of Array.isArray(candidates) ? candidates : []) {
    const signalType = String(row?.signal?.type || row?.identity?.signalType || "UNKNOWN");
    const ticketModel = normalizeTicketModelForDiagnostics(row?.ticketModel);
    out[ticketModel] += 1;
    if (!out.bySignalAndModel[signalType]) out.bySignalAndModel[signalType] = { endpoint: 0, grouped: 0 };
    out.bySignalAndModel[signalType][ticketModel] += 1;
  }
  return out;
}

function normalizeTicketModelForDiagnostics(value) {
  return String(value || "").trim().toLowerCase() === "grouped" ? "grouped" : "endpoint";
}

function normalizeGroupedLimitForDiagnostics(value) {
  const n = Number.parseInt(String(value === undefined || value === null ? "" : value), 10);
  if (!Number.isFinite(n)) return 25;
  if (n < 1) return 1;
  if (n > 100) return 100;
  return n;
}

function buildRunEndBreakdown(summary, results) {
  const rows = Array.isArray(results) ? results : [];
  const bySignal = {};
  const skippedByReason = {};
  const bySignalAndReason = {};
  const failedByReason = {};
  const failedExamplesByReason = {};

  for (const row of rows) {
    const signalType = String(row?.signalType || "").trim() || "UNKNOWN";
    if (!bySignal[signalType]) {
      bySignal[signalType] = { created: 0, updated: 0, closed: 0, skipped: 0, failed: 0 };
    }

    const action = String(row?.action || "").toUpperCase();
    const status = String(row?.status || "").toLowerCase();
    const reason = String(row?.reason || "").trim();

    if (action === "CREATE") bySignal[signalType].created += 1;
    else if (action === "UPDATE") bySignal[signalType].updated += 1;
    else if (action === "CLOSE") bySignal[signalType].closed += 1;
    else if (action === "SKIP" || status === "skipped") {
      bySignal[signalType].skipped += 1;
      if (reason) skippedByReason[reason] = Number(skippedByReason[reason] || 0) + 1;
    } else {
      bySignal[signalType].failed += 1;
      if (reason) failedByReason[reason] = Number(failedByReason[reason] || 0) + 1;
      const detail = String(row?.detail || "").trim();
      if (reason && detail && !failedExamplesByReason[reason]) {
        failedExamplesByReason[reason] = detail.slice(0, 160);
      }
    }

    if (reason) {
      if (!bySignalAndReason[signalType]) bySignalAndReason[signalType] = {};
      bySignalAndReason[signalType][reason] = Number(bySignalAndReason[signalType][reason] || 0) + 1;
    }
  }

  const created = Number(summary?.created || 0);
  const updated = Number(summary?.updated || 0);
  const closed = Number(summary?.closed || 0);
  const skipped = Number(summary?.skipped || 0);
  const failed = Number(summary?.failed || 0);
  const candidateCount = Number(summary?.candidatesSeen || 0);
  const failedByReasonFromSummary =
    summary?.failuresByReason && typeof summary.failuresByReason === "object" ? summary.failuresByReason : {};
  const failedExamplesByReasonFromSummary =
    summary?.failureExamplesByReason && typeof summary.failureExamplesByReason === "object"
      ? summary.failureExamplesByReason
      : {};

  return {
    bySignal,
    skippedByReason,
    bySignalAndReason,
    failedByReason: Object.keys(failedByReasonFromSummary).length > 0 ? failedByReasonFromSummary : failedByReason,
    failedExamplesByReason:
      Object.keys(failedExamplesByReasonFromSummary).length > 0
        ? failedExamplesByReasonFromSummary
        : failedExamplesByReason,
    totalsConsistent: created + updated + closed + skipped + failed === candidateCount,
  };
}

function sanitizeAuditRecord(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    id: String(src.id || ""),
    startedAt: String(src.startedAt || ""),
    finishedAt: String(src.finishedAt || ""),
    ok: Boolean(src.ok),
    candidateCount: Number(src.candidateCount || 0),
    skippedCandidateCount: Number(src.skippedCandidateCount || 0),
    maxCandidates: Number(src.maxCandidates || 0),
    summary: sanitizeObject(src.summary),
    diagnostics: sanitizeDiagnostics(src.diagnostics),
    error: src.error ? sanitizeObject(src.error) : null,
  };
}

function sanitizeObject(value) {
  if (Array.isArray(value)) return value.map((row) => sanitizeObject(row));
  if (!value || typeof value !== "object") {
    const raw = String(value === undefined || value === null ? "" : value);
    return containsSecretLikeText(raw) ? "redacted" : value;
  }
  const out = {};
  for (const key of Object.keys(value)) {
    out[key] = sanitizeObject(value[key]);
  }
  return out;
}

function containsSecretLikeText(rawMessage) {
  const lower = String(rawMessage || "").toLowerCase();
  return (
    lower.includes("secret") ||
    lower.includes("token") ||
    lower.includes("authorization") ||
    lower.includes("bearer") ||
    lower.includes("password") ||
    lower.includes("x-tenant")
  );
}

function createId() {
  return `run-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toPositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return fallback;
  return n;
}

function toNonNegativeInt(value, fallback) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) return fallback;
  return n;
}

async function withTimeout(promise, timeoutMs, code) {
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(code || "timeout"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function withTimeoutAbort(work, timeoutMs, code, externalController, timeoutContextProducer) {
  const controller = externalController || (typeof AbortController === "function" ? new AbortController() : null);
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try {
        controller?.abort?.();
      } catch (_) {
        // ignore
      }
      const timeoutError = new Error(code || "timeout");
      if (typeof timeoutContextProducer === "function") {
        timeoutError.timeoutContext = timeoutContextProducer();
      }
      reject(timeoutError);
    }, timeoutMs);
  });
  try {
    return await Promise.race([work({ signal: controller?.signal || null }), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function sanitizeTimeoutContext(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    phase: String(src.phase || ""),
    orgId: String(src.orgId || ""),
    signal: String(src.signal || ""),
    resource: String(src.resource || ""),
    cveId: String(src.cveId || ""),
    packageId: String(src.packageId || ""),
    versionId: String(src.versionId || ""),
    automationInstanceId: String(src.automationInstanceId || ""),
    page: Number(src.page || 0),
    url: String(src.url || ""),
  };
}

function sortCandidatesForDeterministicLimitWindow(candidates) {
  return (Array.isArray(candidates) ? candidates : [])
    .map((row, index) => ({ row, index, key: extractCandidateIdentityKeyForLimit(row, index) }))
    .sort((a, b) => {
      if (a.key < b.key) return -1;
      if (a.key > b.key) return 1;
      return a.index - b.index;
    })
    .map((entry) => entry.row);
}

function extractCandidateIdentityKeyForLimit(candidate, index) {
  const key =
    String(candidate?.identity?.key || "").trim() ||
    String(candidate?.identity?.identityKey || "").trim();
  if (key) return key;
  const orgLinkId = String(candidate?.identity?.orgLinkId || "").trim();
  const endpointId = String(candidate?.identity?.endpointId || "").trim();
  const signalType = String(candidate?.identity?.signalType || candidate?.signal?.type || "").trim();
  const issueKey = String(candidate?.issueKey || candidate?.grouped?.issueKey || "").trim();
  if (orgLinkId && signalType && issueKey) return `${orgLinkId}|${signalType}|${issueKey}`;
  if (orgLinkId && endpointId && signalType) return `${orgLinkId}|${endpointId}|${signalType}`;
  return `~invalid~${index}`;
}

function createScopedLifecycleRunLogger(input) {
  const baseRunLogger = input?.baseRunLogger || null;
  if (!baseRunLogger || typeof baseRunLogger.emit !== "function") {
    return baseRunLogger;
  }
  const lifecycleRunId = String(input?.lifecycleRunId || "").trim();
  const candidatePrepRunId = String(input?.candidatePrepRunId || "").trim();
  const timestampPart = toCompactUtcFileStamp(new Date());
  const filePath = path.join(process.cwd(), "logs", "lifecycle-runs", makePerRunLogFileName(timestampPart));
  const readableLogger = createFileRunLogger({
    filePath,
    readable: true,
    readableFormat: "compact_lifecycle_run",
  });
  const boundContext = {
    lifecycleDebugScope: Boolean(input?.lifecycleDebugScope),
    debugLoggingEnabled: Boolean(input?.debugLoggingEnabled),
  };

  let perRunFileFailed = false;
  return createCompositeRunLogger([
    {
      async emit(event) {
        await baseRunLogger.emit({
          ...event,
          context: {
            ...boundContext,
            ...(event?.context || {}),
          },
        });
      },
      child() {
        return this;
      },
    },
    {
      async emit(event) {
        const runId = String(event?.runId || "");
        if (!isRunIdInScope(runId, lifecycleRunId, candidatePrepRunId)) return;
        try {
          await readableLogger.emit(event);
        } catch (error) {
          if (perRunFileFailed) return;
          perRunFileFailed = true;
          await emitLog({
            runLogger: baseRunLogger,
            runId: "lifecycle-run-once",
            level: "WARN",
            eventType: LOG_EVENT_TYPES.PARTIAL_FAILURE,
            message: "[PER-RUN LOG FILE DISABLED]",
            context: {
              detail: String(error?.message || "unknown"),
              filePath,
            },
          });
        }
      },
      child() {
        return this;
      },
    },
  ]);
}

function isRunIdInScope(runId, lifecycleRunId, candidatePrepRunId) {
  const normalized = String(runId || "").trim();
  if (!normalized) return false;
  if (normalized === "lifecycle-run-once") return true;
  if (lifecycleRunId && normalized.startsWith(lifecycleRunId)) return true;
  if (candidatePrepRunId && normalized.startsWith(candidatePrepRunId)) return true;
  return false;
}

function sanitizeFileNameSegment(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 120);
}

const USED_PER_RUN_LOG_FILE_NAMES = new Set();

function makePerRunLogFileName(timestampPart) {
  const base = `${sanitizeFileNameSegment(timestampPart)}.log`;
  if (!USED_PER_RUN_LOG_FILE_NAMES.has(base)) {
    USED_PER_RUN_LOG_FILE_NAMES.add(base);
    return base;
  }
  const suffix = Math.random().toString(16).slice(2, 6);
  const withSuffix = `${sanitizeFileNameSegment(timestampPart)}_${suffix}.log`;
  USED_PER_RUN_LOG_FILE_NAMES.add(withSuffix);
  return withSuffix;
}

function toCompactUtcFileStamp(date) {
  const d = date instanceof Date ? date : new Date(date);
  const pad2 = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}_${pad2(d.getUTCHours())}-${pad2(
    d.getUTCMinutes()
  )}-${pad2(d.getUTCSeconds())}`;
}

module.exports = {
  createApiServer,
};
