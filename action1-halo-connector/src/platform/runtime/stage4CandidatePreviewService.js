// stage4CandidatePreviewService.js
//
// Action1 Public Repository Material
//
// Use of this file is subject to TERMS_OF_USE.md (https://github.com/Action1Corp/PSAction1/blob/main/TERMS_OF_USE.md) in this repository.
// Provided AS IS, without warranties.
// Use at your own risk.
// Review, test, and validate before production use.
// © Action1 Corporation. All rights reserved.
const { normalizeConnectorConfig } = require("../config");
const { runStage4CandidatePipeline } = require("../../core/rules/stage4CandidatePipeline");
const { LOG_EVENT_TYPES, emitLog } = require("../logging");
const { createInMemorySignalWatermarkStore } = require("./signalWatermarkStore.file");
const {
  normalizeSignalRulesConfig,
  validateSignalRulesConfigForCandidates,
} = require("../../core/rules/signalRulesConfig");

/**
 * Read-only Stage 4 runtime assembly service.
 * Loads config + Action1 read datasets and returns dry-run candidate preview.
 *
 * @param {{
 *  configStore: { loadConnectorConfig: Function },
 *  action1Client: {
 *    listOrganizations?: Function,
 *    listEndpoints?: Function,
 *    collectEndpointSignals?: Function,
 *  },
 *  now?: () => number,
 * }} deps
 */
function createStage4CandidatePreviewService(deps) {
  if (!deps || typeof deps !== "object") {
    throw new Error("Stage4CandidatePreviewService requires dependencies");
  }
  if (!deps.configStore || typeof deps.configStore.loadConnectorConfig !== "function") {
    throw new Error("Stage4CandidatePreviewService requires configStore.loadConnectorConfig()");
  }
  if (!deps.action1Client || typeof deps.action1Client !== "object") {
    throw new Error("Stage4CandidatePreviewService requires action1Client");
  }
  const nowFn = typeof deps.now === "function" ? deps.now : Date.now;
  const pipelineRunner = typeof deps.pipelineRunner === "function" ? deps.pipelineRunner : runStage4CandidatePipeline;
  const runLogger = deps.runLogger || null;
  const signalWatermarkStore =
    deps.signalWatermarkStore && typeof deps.signalWatermarkStore.getAutomationFailedWatermark === "function"
      ? deps.signalWatermarkStore
      : createInMemorySignalWatermarkStore();
  const runLock = createCandidatePreparationRunLock();

  return {
    generatePreview,
  };

  /**
   * @param {{config?: Object, now?: Date|string|number}} [opts]
   */
  async function generatePreview(opts = {}) {
    const mode = String(opts?.mode || "preview").trim().toLowerCase() === "manual" ? "manual" : "preview";
    return runLock.withRun(mode, async () => {
      return generatePreviewUnlocked({ ...opts, mode });
    });
  }

  async function generatePreviewUnlocked(opts = {}) {
    const activeRunLogger = opts?.runLogger || runLogger;
    const mode = String(opts?.mode || "preview").trim().toLowerCase() === "manual" ? "manual" : "preview";
    const runId = String(opts?.runId || "stage4-candidate-preparation");
    const abortSignal = opts?.abortSignal || null;
    const progressReporter = typeof opts?.progressReporter === "function" ? opts.progressReporter : null;
    const warnings = [];
    const failedOrgs = [];
    const progress = {
      phase: "init",
      orgId: "",
      signal: "",
      resource: "",
      cveId: "",
      packageId: "",
      versionId: "",
      automationInstanceId: "",
      page: 0,
      url: "",
    };
    reportProgress(progressReporter, progress);
    const rawConfig = opts.config ? normalizeConnectorConfig(opts.config) : await deps.configStore.loadConnectorConfig();
    const normalizedRulesConfig = normalizeSignalRulesConfig(rawConfig);
    const debugLogging = Boolean(normalizedRulesConfig?.operationalSafeguards?.enableDebugLogging);
    const configErrors = validateSignalRulesConfigForCandidates(normalizedRulesConfig);

    if (configErrors.length > 0) {
      addWarning(warnings, {
        code: "config_incomplete",
        message: `Candidate preview config is incomplete: ${configErrors.map((row) => row.code).join(", ")}`,
      });
    }

    if (!Array.isArray(normalizedRulesConfig.orgClientMappings) || normalizedRulesConfig.orgClientMappings.length === 0) {
      addWarning(warnings, {
        code: "no_mappings_configured",
        message: "No Action1 organization to Halo client mappings are configured",
      });
    }

    await emitLog({
      runLogger: activeRunLogger,
      runId,
      eventType: LOG_EVENT_TYPES.RUN_START,
      message: "[RUN START]",
    });
    await emitLog({
      runLogger: activeRunLogger,
      runId,
      eventType: LOG_EVENT_TYPES.DISCOVERY_FETCH,
      message: "[CONFIG]",
      context: {
        mappings: Array.isArray(normalizedRulesConfig.orgClientMappings) ? normalizedRulesConfig.orgClientMappings.length : 0,
      },
    });

    const organizations = await safeListOrganizations(
      deps.action1Client,
      warnings,
      abortSignal,
      `${runId}-orgs`,
      debugLogging
    );
    const mappedOrgIds = buildMappedOrgSet(normalizedRulesConfig.orgClientMappings);
    const action1EndpointsByOrg = {};
    const signalDatasets = {
      vulnerabilitiesByEndpoint: {},
      updatesByEndpoint: {},
      automationFailedByEndpoint: {},
    };
    const signalCollection = {
      vulnerability: { status: normalizedRulesConfig.signalFilters?.vulnerability?.enabled ? "not_implemented" : "disabled" },
      update: { status: normalizedRulesConfig.signalFilters?.update?.enabled ? "not_implemented" : "disabled" },
      automationFailed: { status: normalizedRulesConfig.signalFilters?.automationFailed?.enabled ? "not_implemented" : "disabled" },
    };
    const signalTally = {
      vulnerabilityRecords: 0,
      updateRecords: 0,
      automationFailedRecords: 0,
    };

    for (const org of organizations) {
      throwIfAborted(abortSignal, progress);
      const orgId = String(org?.id || org?.org_id || "").trim();
      if (!orgId) continue;
      progress.phase = "org_loop";
      progress.orgId = orgId;
      progress.signal = "";
      progress.resource = "organization";
      progress.cveId = "";
      progress.packageId = "";
      progress.versionId = "";
      progress.automationInstanceId = "";
      progress.page = 0;
      progress.url = "";
      reportProgress(progressReporter, progress);
      if (!mappedOrgIds.has(orgId)) {
        await emitLog({
          runLogger: activeRunLogger,
          runId,
          eventType: LOG_EVENT_TYPES.SKIP,
          message: "[ORG SKIP] reason=unmapped_org",
          context: { org: orgId },
        });
        continue;
      }
      await emitLog({
        runLogger: activeRunLogger,
        runId,
        eventType: LOG_EVENT_TYPES.DISCOVERY_FETCH,
        message: "[ORG START]",
        context: { org: orgId, haloClient: mappedOrgIds.get(orgId) },
      });

      await emitLog({
        runLogger: activeRunLogger,
        runId,
        eventType: LOG_EVENT_TYPES.DISCOVERY_FETCH,
        message: "[ACTION1 ENDPOINTS FETCH START]",
        context: { org: orgId },
      });
      const endpointResult = await safeListEndpoints(
        deps.action1Client,
        orgId,
        warnings,
        abortSignal,
        `${runId}-endpoints`,
        debugLogging
      );
      throwIfAborted(abortSignal, progress);
      const endpoints = endpointResult.rows;
      if (endpointResult.failed) {
        failedOrgs.push({
          orgId,
          phase: "action1_endpoint_collection",
          reason: endpointResult.reason || "unknown",
          statusCode: endpointResult.statusCode || null,
        });
      }
      action1EndpointsByOrg[orgId] = endpoints;
      await emitLog({
        runLogger: activeRunLogger,
        runId,
        eventType: LOG_EVENT_TYPES.DISCOVERY_FETCH,
        message: "[ACTION1 ENDPOINTS FETCH RESULT]",
        context: { org: orgId, endpoints: endpoints.length },
      });

      await collectDeepSignalForOrg({
        runLogger: activeRunLogger,
        runId,
        action1Client: deps.action1Client,
        orgId,
        signalType: "VULNERABILITY",
        enabled: Boolean(normalizedRulesConfig.signalFilters?.vulnerability?.enabled),
        methodName: "listVulnerabilityFindingsByOrg",
        mapRoot: signalDatasets.vulnerabilitiesByEndpoint,
        normalizeRow: normalizeVulnerabilityRow,
        warnings,
        signalCollectionKey: "vulnerability",
        signalCollection,
        signalTallyKey: "vulnerabilityRecords",
        signalTally,
        abortSignal,
        progress,
        progressReporter,
        debugLogging,
      });
      await collectDeepSignalForOrg({
        runLogger: activeRunLogger,
        runId,
        action1Client: deps.action1Client,
        orgId,
        signalType: "UPDATE",
        enabled: Boolean(normalizedRulesConfig.signalFilters?.update?.enabled),
        methodName: "listMissingUpdatesByOrg",
        mapRoot: signalDatasets.updatesByEndpoint,
        normalizeRow: normalizeUpdateRow,
        warnings,
        signalCollectionKey: "update",
        signalCollection,
        signalTallyKey: "updateRecords",
        signalTally,
        abortSignal,
        progress,
        progressReporter,
        debugLogging,
      });
      const automationOutcome = await collectAutomationFailedWithWatermark({
        runLogger: activeRunLogger,
        runId,
        action1Client: deps.action1Client,
        orgId,
        orgLinkId: resolveOrgLinkId(normalizedRulesConfig.orgClientMappings, orgId),
        enabled: Boolean(normalizedRulesConfig.signalFilters?.automationFailed?.enabled),
        lookbackHours: Number(normalizedRulesConfig.signalFilters?.automationFailed?.lookbackHours || 24),
        mapRoot: signalDatasets.automationFailedByEndpoint,
        normalizeRow: normalizeAutomationFailureRow,
        warnings,
        signalCollection,
        signalTally,
        abortSignal,
        progress,
        progressReporter,
        signalWatermarkStore,
        debugLogging,
      });
      throwIfAborted(abortSignal, progress);
      if (automationOutcome && automationOutcome.shouldAdvanceWatermark) {
        await signalWatermarkStore.upsertAutomationFailedWatermark(automationOutcome.orgWatermarkKey, {
          lastSeenAt: String(automationOutcome.nextWatermark || ""),
          lastInstanceId: String(automationOutcome.lastInstanceId || ""),
          action1OrgId: String(orgId || ""),
          orgLinkId: String(automationOutcome.orgLinkId || ""),
          updatedAt: new Date().toISOString(),
        });
        await emitLog({
          runLogger: activeRunLogger,
          runId,
          eventType: LOG_EVENT_TYPES.DISCOVERY_FETCH,
          message:
            "[AUTOMATION WATERMARK UPDATE] org=" +
            orgId +
            " old=" +
            String(automationOutcome.previousWatermark || "") +
            " new=" +
            String(automationOutcome.nextWatermark || ""),
          context: {
            org: orgId,
            old: String(automationOutcome.previousWatermark || ""),
            new: String(automationOutcome.nextWatermark || ""),
          },
        });
      }

      await logOrgSignalResult(activeRunLogger, runId, orgId, "OFFLINE", endpoints.length);
      await logOrgSignalResult(activeRunLogger, runId, orgId, "REBOOT_REQUIRED", endpoints.length);
      await logOrgSignalResult(
        activeRunLogger,
        runId,
        orgId,
        "VULNERABILITY",
        countEndpointRows(signalDatasets.vulnerabilitiesByEndpoint, orgId)
      );
      await logOrgSignalResult(activeRunLogger, runId, orgId, "UPDATE", countEndpointRows(signalDatasets.updatesByEndpoint, orgId));
      await logOrgSignalResult(
        activeRunLogger,
        runId,
        orgId,
        "AUTOMATION_FAILED",
        countEndpointRows(signalDatasets.automationFailedByEndpoint, orgId)
      );

      await emitLog({
        runLogger: activeRunLogger,
        runId,
        eventType: LOG_EVENT_TYPES.DISCOVERY_FETCH,
        message: "[ORG END]",
        context: {
          org: orgId,
          endpoints: endpoints.length,
          vulnerabilityRecords: countEndpointRows(signalDatasets.vulnerabilitiesByEndpoint, orgId),
          updateRecords: countEndpointRows(signalDatasets.updatesByEndpoint, orgId),
          automationFailedRecords: countEndpointRows(signalDatasets.automationFailedByEndpoint, orgId),
        },
      });
    }
    const hasDeepNotImplemented =
      signalCollection.vulnerability.status === "not_implemented" ||
      signalCollection.update.status === "not_implemented" ||
      signalCollection.automationFailed.status === "not_implemented";
    if (hasDeepNotImplemented) {
      addWarning(warnings, {
        code: "action1_signal_collection_partial",
        message: "Action1 deep signal collection is partially implemented; preview uses available normalized inputs",
      });
    }

    const pipelineResult = pipelineRunner({
      config: rawConfig,
      action1Organizations: organizations,
      action1EndpointsByOrg,
      signalDatasets,
      now: opts.now || new Date(nowFn()),
      enableGroupedAggregation: true,
    });

    const out = {
      candidates: pipelineResult.candidates,
      skipped: pipelineResult.skipped,
      summary: pipelineResult.summary,
      diagnostics: {
        partial: warnings.some((row) => {
          return (
            row.code === "action1_signal_collection_partial" ||
            row.code === "action1_endpoint_collection_unavailable" ||
            row.code === "action1_org_collection_unavailable"
          );
        }),
        warnings,
        preparation: {
          phase: "action1_endpoint_collection",
          orgsSeen: Object.keys(action1EndpointsByOrg).length,
          failedOrgs,
        },
        signalCollection: {
          vulnerability: {
            status: signalCollection.vulnerability.status,
            records: signalTally.vulnerabilityRecords,
          },
          update: {
            status: signalCollection.update.status,
            records: signalTally.updateRecords,
          },
          automationFailed: {
            status: signalCollection.automationFailed.status,
            records: signalTally.automationFailedRecords,
            lookbackHours: Number(normalizedRulesConfig.signalFilters?.automationFailed?.lookbackHours || 24),
            watermarkBefore: signalCollection.automationFailed.watermarkBefore || "",
            watermarkAfter: signalCollection.automationFailed.watermarkAfter || "",
            instancesSeen: Number(signalCollection.automationFailed.instancesSeen || 0),
            instancesSkippedOld: Number(signalCollection.automationFailed.instancesSkippedOld || 0),
            instancesQualified: Number(signalCollection.automationFailed.instancesQualified || 0),
            instancesFailed: Number(signalCollection.automationFailed.instancesFailed || 0),
          },
        },
        groupedAggregation:
          pipelineResult?.diagnostics && typeof pipelineResult.diagnostics === "object"
            ? pipelineResult.diagnostics
            : {},
      },
      normalizedConfig: pipelineResult.normalizedConfig,
      connectorConfig: rawConfig,
    };
    await emitLog({
      runLogger: activeRunLogger,
      runId,
      eventType: LOG_EVENT_TYPES.DISCOVERY_FETCH,
      message: "[CANDIDATES]",
      context: {
        bySignalType: out.summary?.candidatesBySignalType || {},
      },
    });
    await emitLog({
      runLogger: activeRunLogger,
      runId,
      eventType: LOG_EVENT_TYPES.RUN_END,
      message: "[RUN END]",
      context: {
        candidates: out.candidates.length,
        skipped: out.skipped.length,
        failedOrgs: failedOrgs.length,
      },
    });
    return out;
  }
}

function createCandidatePreparationRunLock() {
  let activeRunMode = "";
  let activePromise = Promise.resolve();
  let pendingManualRuns = 0;

  return {
    withRun,
  };

  async function withRun(mode, worker) {
    const normalizedMode = mode === "manual" ? "manual" : "preview";
    if (normalizedMode === "preview" && (activeRunMode === "manual" || pendingManualRuns > 0)) {
      const err = new Error("candidate_preparation_blocked_by_manual_run");
      err.code = "candidate_preparation_blocked_by_manual_run";
      throw err;
    }
    if (normalizedMode === "manual") pendingManualRuns += 1;
    const previous = activePromise;
    let release;
    activePromise = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    if (normalizedMode === "manual") pendingManualRuns = Math.max(0, pendingManualRuns - 1);
    activeRunMode = normalizedMode;
    try {
      return await worker();
    } finally {
      activeRunMode = "";
      release();
    }
  }
}

async function safeListOrganizations(action1Client, warnings, abortSignal, runId, debugLogging) {
  if (typeof action1Client.listOrganizations !== "function") {
    addWarning(warnings, {
      code: "action1_org_collection_unavailable",
      message: "Action1 organization collection method is unavailable",
    });
    return [];
  }
  try {
    const rows = await action1Client.listOrganizations({
      runId: String(runId || "stage4-preview-orgs"),
      abortSignal,
      debugLogging: Boolean(debugLogging),
    });
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    if (String(error?.code || "") === "ABORT_ERR" || String(error?.code || "") === "candidate_preparation_aborted") {
      throw error;
    }
    addWarning(warnings, {
      code: "action1_org_collection_unavailable",
      message: `Action1 organization collection failed: ${error?.message || "unknown error"}`,
    });
    return [];
  }
}

async function safeListEndpoints(action1Client, orgId, warnings, abortSignal, runId, debugLogging) {
  if (typeof action1Client.listEndpoints !== "function") {
    addWarning(warnings, {
      code: "action1_endpoint_collection_unavailable",
      message: `Action1 endpoint collection method is unavailable for org ${orgId}`,
    });
    return {
      rows: [],
      failed: true,
      statusCode: null,
      reason: "unavailable",
    };
  }
  try {
    const rows = await action1Client.listEndpoints(orgId, {
      runId: String(runId || "stage4-preview-endpoints"),
      pageLimit: 200,
      abortSignal,
      debugLogging: Boolean(debugLogging),
    });
    return {
      rows: Array.isArray(rows) ? rows : [],
      failed: false,
      statusCode: null,
      reason: "",
    };
  } catch (error) {
    if (String(error?.code || "") === "ABORT_ERR" || String(error?.code || "") === "candidate_preparation_aborted") {
      throw error;
    }
    const statusCode = Number(error?.statusCode || 0);
    const isRateLimited = statusCode === 429 || String(error?.code || "").toUpperCase() === "RATE_LIMITED";
    addWarning(warnings, {
      code: "action1_endpoint_collection_unavailable",
      message: `Action1 endpoint collection failed for org ${orgId}: ${error?.message || "unknown error"}`,
    });
    return {
      rows: [],
      failed: true,
      statusCode: statusCode || null,
      reason: isRateLimited ? "rate_limited" : "fetch_failed",
    };
  }
}

async function safeCollectEndpointSignals(action1Client, orgId, endpointId, warnings) {
  if (typeof action1Client.collectEndpointSignals !== "function") {
    addWarning(warnings, {
      code: "action1_signal_collection_partial",
      message: `Action1 signal collection method is unavailable for org ${orgId} endpoint ${endpointId}`,
    });
    return {
      signals: { vulnerabilities: [], updates: [], automationFailed: [] },
      notImplemented: false,
    };
  }
  try {
    const payload = await action1Client.collectEndpointSignals(orgId, endpointId, {
      runId: "stage4-preview-signals",
    });
    const signals = payload?.signals && typeof payload.signals === "object" ? payload.signals : {};
    const detail = String(payload?.detail || "");
    const notImplemented = detail.toLowerCase().includes("not implemented");
    return {
      signals: {
        vulnerabilities: Array.isArray(signals.vulnerabilities) ? signals.vulnerabilities : [],
        updates: Array.isArray(signals.updates) ? signals.updates : [],
        automationFailed: Array.isArray(signals.automationFailed) ? signals.automationFailed : [],
      },
      notImplemented,
    };
  } catch (error) {
    addWarning(warnings, {
      code: "action1_signal_collection_partial",
      message: `Action1 signal collection failed for org ${orgId} endpoint ${endpointId}: ${error?.message || "unknown error"}`,
    });
    return {
      signals: { vulnerabilities: [], updates: [], automationFailed: [] },
      notImplemented: false,
    };
  }
}

function addOrgEndpointSignals(signalDatasets, orgId, endpointId, signals) {
  ensureOrgEndpointMap(signalDatasets.vulnerabilitiesByEndpoint, orgId, endpointId, signals?.vulnerabilities);
  ensureOrgEndpointMap(signalDatasets.updatesByEndpoint, orgId, endpointId, signals?.updates);
  ensureOrgEndpointMap(signalDatasets.automationFailedByEndpoint, orgId, endpointId, signals?.automationFailed);
}

function ensureOrgEndpointMap(root, orgId, endpointId, rows) {
  if (!root[orgId] || typeof root[orgId] !== "object") root[orgId] = {};
  root[orgId][endpointId] = Array.isArray(rows) ? rows : [];
}

function addWarning(warnings, warning) {
  const code = String(warning?.code || "").trim();
  const message = String(warning?.message || "").trim();
  if (!code || !message) return;
  const existing = warnings.find((row) => row.code === code && row.message === message);
  if (existing) return;
  warnings.push({ code, message });
}

module.exports = {
  createStage4CandidatePreviewService,
};

function buildMappedOrgSet(rows) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const orgId = String(row?.action1OrgId || "").trim();
    const haloClientId = String(row?.haloClientId || "").trim();
    if (!orgId || !haloClientId) continue;
    if (!map.has(orgId)) map.set(orgId, haloClientId);
  }
  return map;
}

async function collectDeepSignalForOrg(input) {
  throwIfAborted(input.abortSignal, input.progress);
  if (!input.enabled) {
    await emitLog({
      runLogger: input.runLogger,
      runId: input.runId,
      eventType: LOG_EVENT_TYPES.SKIP,
      message: `[ACTION1 SIGNAL SKIP] signal=${input.signalType} org=${input.orgId} reason=disabled`,
      context: { org: input.orgId },
    });
    return;
  }
  const method = input.action1Client?.[input.methodName];
  if (typeof method !== "function") {
    input.signalCollection[input.signalCollectionKey].status = "not_implemented";
    addWarning(input.warnings, {
      code: "action1_signal_collection_partial",
      message: `${input.signalType} collection is not implemented in Action1 client`,
    });
    await emitLog({
      runLogger: input.runLogger,
      runId: input.runId,
      eventType: LOG_EVENT_TYPES.SKIP,
      message: `[ACTION1 SIGNAL SKIP] signal=${input.signalType} org=${input.orgId} reason=not_implemented`,
      context: { org: input.orgId },
    });
    return;
  }

  await emitLog({
    runLogger: input.runLogger,
    runId: input.runId,
    eventType: LOG_EVENT_TYPES.DISCOVERY_FETCH,
    message: `[ACTION1 SIGNAL FETCH START] signal=${input.signalType} org=${input.orgId}`,
    context: { org: input.orgId, signal: input.signalType },
  });
  try {
    input.progress.phase = "signal_fetch";
    input.progress.orgId = input.orgId;
    input.progress.signal = input.signalType;
    input.progress.resource = input.methodName;
    input.progress.cveId = "";
    input.progress.packageId = "";
    input.progress.versionId = "";
    input.progress.automationInstanceId = "";
    reportProgress(input.progressReporter, input.progress);
    const rows = await method.call(input.action1Client, input.orgId, {
      runId: `${input.runId}-${String(input.signalType || "").toLowerCase()}`,
      abortSignal: input.abortSignal || null,
      progressReporter: input.progressReporter || null,
      debugLogging: Boolean(input.debugLogging),
    });
    throwIfAborted(input.abortSignal, input.progress);
    const normalized = Array.isArray(rows) ? rows.map((row) => input.normalizeRow(row)).filter(Boolean) : [];
    addSignalRowsToOrgMap(input.mapRoot, input.orgId, normalized);
    input.signalCollection[input.signalCollectionKey].status = "implemented";
    input.signalTally[input.signalTallyKey] += normalized.length;
    await emitLog({
      runLogger: input.runLogger,
      runId: input.runId,
      eventType: LOG_EVENT_TYPES.DISCOVERY_FETCH,
      message: `[ACTION1 SIGNAL FETCH RESULT] signal=${input.signalType} records=${normalized.length}`,
      context: { org: input.orgId, signal: input.signalType, records: normalized.length },
    });
  } catch (error) {
    if (String(error?.code || "") === "ABORT_ERR" || String(error?.code || "") === "candidate_preparation_aborted") {
      throw error;
    }
    input.signalCollection[input.signalCollectionKey].status = "implemented";
    addWarning(input.warnings, {
      code: "action1_signal_collection_partial",
      message: `${input.signalType} collection failed for org ${input.orgId}: ${error?.message || "unknown error"}`,
    });
    await emitLog({
      runLogger: input.runLogger,
      runId: input.runId,
      level: "WARN",
      eventType: LOG_EVENT_TYPES.PARTIAL_FAILURE,
      message: `[ACTION1 SIGNAL ERROR] signal=${input.signalType} org=${input.orgId} error=sanitized`,
      context: {
        org: input.orgId,
        error: "sanitized",
      },
    });
  }
}

async function collectAutomationFailedWithWatermark(input) {
  if (!input.enabled) {
    input.signalCollection.automationFailed.status = "disabled";
    await emitLog({
      runLogger: input.runLogger,
      runId: input.runId,
      eventType: LOG_EVENT_TYPES.SKIP,
      message: `[ACTION1 SIGNAL SKIP] signal=AUTOMATION_FAILED org=${input.orgId} reason=disabled`,
      context: { org: input.orgId },
    });
    return { shouldAdvanceWatermark: false };
  }
  const method = input.action1Client?.listAutomationFailuresByOrg;
  if (typeof method !== "function") {
    input.signalCollection.automationFailed.status = "not_implemented";
    addWarning(input.warnings, {
      code: "action1_signal_collection_partial",
      message: "AUTOMATION_FAILED collection is not implemented in Action1 client",
    });
    await emitLog({
      runLogger: input.runLogger,
      runId: input.runId,
      eventType: LOG_EVENT_TYPES.SKIP,
      message: `[ACTION1 SIGNAL SKIP] signal=AUTOMATION_FAILED org=${input.orgId} reason=not_implemented`,
      context: { org: input.orgId },
    });
    return { shouldAdvanceWatermark: false };
  }

  const orgWatermarkKey = String(input.orgLinkId || input.orgId || "").trim();
  const watermarkBeforeRecord = await input.signalWatermarkStore.getAutomationFailedWatermark(orgWatermarkKey);
  const watermarkBefore = String(watermarkBeforeRecord?.lastSeenAt || "").trim();
  const lookbackHours = Number.isFinite(Number(input.lookbackHours)) ? Math.max(1, Number(input.lookbackHours)) : 24;
  const cutoff = toAction1SortableDateTime(new Date(Date.now() - lookbackHours * 60 * 60 * 1000));
  if (!watermarkBefore) {
    await emitLog({
      runLogger: input.runLogger,
      runId: input.runId,
      eventType: LOG_EVENT_TYPES.DISCOVERY_FETCH,
      message: "[AUTOMATION WATERMARK] org=" + input.orgId + " state=missing lookbackHours=" + lookbackHours + " cutoff=" + cutoff,
      context: { org: input.orgId, lookbackHours, cutoff },
    });
  } else {
    await emitLog({
      runLogger: input.runLogger,
      runId: input.runId,
      eventType: LOG_EVENT_TYPES.DISCOVERY_FETCH,
      message: "[AUTOMATION WATERMARK] org=" + input.orgId + " lastSeenAt=" + watermarkBefore,
      context: { org: input.orgId, lastSeenAt: watermarkBefore },
    });
  }

  await emitLog({
    runLogger: input.runLogger,
    runId: input.runId,
    eventType: LOG_EVENT_TYPES.DISCOVERY_FETCH,
    message: `[ACTION1 SIGNAL FETCH START] signal=AUTOMATION_FAILED org=${input.orgId}`,
    context: { org: input.orgId, signal: "AUTOMATION_FAILED" },
  });

  const meta = {};
  try {
    const rows = await method.call(input.action1Client, input.orgId, {
      runId: `${input.runId}-automation_failed`,
      abortSignal: input.abortSignal || null,
      progressReporter: input.progressReporter || null,
      debugLogging: Boolean(input.debugLogging),
      cutoffEndTime: cutoff,
      watermarkEndTime: watermarkBefore || "",
      meta,
    });
    const normalized = Array.isArray(rows) ? rows.map((row) => input.normalizeRow(row)).filter(Boolean) : [];
    addSignalRowsToOrgMap(input.mapRoot, input.orgId, normalized);
    input.signalCollection.automationFailed.status = "implemented";
    input.signalCollection.automationFailed.watermarkBefore = watermarkBefore;
    input.signalCollection.automationFailed.watermarkAfter = String(meta.maxSeenEndTime || watermarkBefore || "");
    input.signalCollection.automationFailed.instancesSeen = Number(meta.instancesSeen || 0);
    input.signalCollection.automationFailed.instancesSkippedOld = Number(meta.instancesSkippedOld || 0);
    input.signalCollection.automationFailed.instancesQualified = Number(meta.instancesQualified || 0);
    input.signalCollection.automationFailed.instancesFailed = Number(meta.instancesFailed || 0);
    input.signalTally.automationFailedRecords += normalized.length;

    await emitLog({
      runLogger: input.runLogger,
      runId: input.runId,
      eventType: LOG_EVENT_TYPES.DISCOVERY_FETCH,
      message: `[ACTION1 SIGNAL FETCH RESULT] signal=AUTOMATION_FAILED records=${normalized.length}`,
      context: { org: input.orgId, signal: "AUTOMATION_FAILED", records: normalized.length },
    });
    return {
      shouldAdvanceWatermark: Boolean(meta.maxSeenEndTime),
      orgWatermarkKey,
      orgLinkId: input.orgLinkId,
      previousWatermark: watermarkBefore,
      nextWatermark: String(meta.maxSeenEndTime || ""),
      lastInstanceId: String(meta.lastInstanceId || ""),
    };
  } catch (error) {
    if (String(error?.code || "") === "ABORT_ERR" || String(error?.code || "") === "candidate_preparation_aborted") {
      throw error;
    }
    input.signalCollection.automationFailed.status = "implemented";
    input.signalCollection.automationFailed.watermarkBefore = watermarkBefore;
    input.signalCollection.automationFailed.watermarkAfter = watermarkBefore;
    input.signalCollection.automationFailed.instancesSeen = Number(meta.instancesSeen || 0);
    input.signalCollection.automationFailed.instancesSkippedOld = Number(meta.instancesSkippedOld || 0);
    input.signalCollection.automationFailed.instancesQualified = Number(meta.instancesQualified || 0);
    input.signalCollection.automationFailed.instancesFailed = Number(meta.instancesFailed || 0);
    addWarning(input.warnings, {
      code: "action1_signal_collection_partial",
      message: `AUTOMATION_FAILED collection failed for org ${input.orgId}: ${error?.message || "unknown error"}`,
    });
    await emitLog({
      runLogger: input.runLogger,
      runId: input.runId,
      level: "WARN",
      eventType: LOG_EVENT_TYPES.PARTIAL_FAILURE,
      message: `[ACTION1 SIGNAL ERROR] signal=AUTOMATION_FAILED org=${input.orgId} error=sanitized`,
      context: {
        org: input.orgId,
        error: "sanitized",
      },
    });
    return { shouldAdvanceWatermark: false };
  }
}

function normalizeVulnerabilityRow(row) {
  const endpointId = String(row?.endpointId || row?.endpoint_id || row?.id || "").trim();
  if (!endpointId) return null;
  return {
    endpointId,
    row,
  };
}

function normalizeUpdateRow(row) {
  const endpointId = String(row?.endpointId || row?.endpoint_id || row?.id || "").trim();
  if (!endpointId) return null;
  return {
    endpointId,
    row,
  };
}

function normalizeAutomationFailureRow(row) {
  const endpointId = String(row?.endpointId || row?.endpoint_id || row?.id || "").trim();
  if (!endpointId) return null;
  return {
    endpointId,
    row,
  };
}

function addSignalRowsToOrgMap(root, orgId, rows) {
  if (!root[orgId] || typeof root[orgId] !== "object") root[orgId] = {};
  for (const item of rows) {
    if (!root[orgId][item.endpointId] || !Array.isArray(root[orgId][item.endpointId])) {
      root[orgId][item.endpointId] = [];
    }
    root[orgId][item.endpointId].push(item.row);
  }
}

function countEndpointRows(root, orgId) {
  const byEndpoint = root?.[orgId];
  if (!byEndpoint || typeof byEndpoint !== "object") return 0;
  let count = 0;
  for (const endpointId of Object.keys(byEndpoint)) {
    count += Array.isArray(byEndpoint[endpointId]) ? byEndpoint[endpointId].length : 0;
  }
  return count;
}

function logOrgSignalResult(runLogger, runId, orgId, signalType, collectedEndpointSignalRows) {
  return emitLog({
    runLogger,
    runId,
    eventType: LOG_EVENT_TYPES.DISCOVERY_FETCH,
    message: "[SIGNAL RESULT]",
    context: {
      org: orgId,
      signal: signalType,
      collectedEndpointSignalRows: Number(collectedEndpointSignalRows || 0),
    },
  });
}

function throwIfAborted(abortSignal, progress) {
  if (!abortSignal || !abortSignal.aborted) return;
  const error = new Error("candidate_preparation_aborted");
  error.code = "candidate_preparation_aborted";
  error.timeoutContext = {
    phase: String(progress?.phase || ""),
    orgId: String(progress?.orgId || ""),
    signal: String(progress?.signal || ""),
    resource: String(progress?.resource || ""),
    cveId: String(progress?.cveId || ""),
    packageId: String(progress?.packageId || ""),
    versionId: String(progress?.versionId || ""),
    automationInstanceId: String(progress?.automationInstanceId || ""),
    page: Number(progress?.page || 0),
    url: String(progress?.url || ""),
  };
  throw error;
}

function reportProgress(progressReporter, progress) {
  if (typeof progressReporter !== "function") return;
  progressReporter({
    phase: String(progress?.phase || ""),
    orgId: String(progress?.orgId || ""),
    signal: String(progress?.signal || ""),
    resource: String(progress?.resource || ""),
    cveId: String(progress?.cveId || ""),
    packageId: String(progress?.packageId || ""),
    versionId: String(progress?.versionId || ""),
    automationInstanceId: String(progress?.automationInstanceId || ""),
    page: Number(progress?.page || 0),
    url: String(progress?.url || ""),
  });
}

function resolveOrgLinkId(rows, orgId) {
  for (const row of Array.isArray(rows) ? rows : []) {
    const action1OrgId = String(row?.action1OrgId || "").trim();
    if (action1OrgId !== String(orgId || "").trim()) continue;
    const mappingId = String(row?.mappingId || "").trim();
    if (mappingId) return mappingId;
  }
  return String(orgId || "").trim();
}

function toAction1SortableDateTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  const pad2 = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}_${pad2(d.getUTCHours())}-${pad2(
    d.getUTCMinutes()
  )}-${pad2(d.getUTCSeconds())}`;
}
