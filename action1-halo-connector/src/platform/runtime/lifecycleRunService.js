// lifecycleRunService.js
//
// Action1 Public Repository Material
//
// Use of this file is subject to TERMS_OF_USE.md (https://github.com/Action1Corp/PSAction1/blob/main/TERMS_OF_USE.md) in this repository.
// Provided AS IS, without warranties.
// Use at your own risk.
// Review, test, and validate before production use.
// © Action1 Corporation. All rights reserved.
const { createLifecycleWriteOrchestrator } = require("../../core/lifecycle");
const { LOG_EVENT_TYPES, emitLog } = require("../logging");
const DEFAULT_MAX_OPEN_TICKETS_PER_ORG = 30;

/**
 * Controlled/manual run service boundary for Stage 5 lifecycle writes.
 * This is explicit run-once execution only (no scheduler/recurring loop).
 *
 * @param {{
 *  lifecycleWriteOrchestrator?: { processCandidate: Function },
 *  haloTicketsClient?: any,
 *  correlationStore?: any,
 *  now?: () => number,
 * }} deps
 */
function createLifecycleRunService(deps = {}) {
  const orchestrator = resolveOrchestrator(deps);
  const runLogger = deps.runLogger || null;

  return {
    runOnce,
  };

  /**
   * @param {{
   *  candidates?: Array<any>,
   *  lifecycle?: {
   *    existingOpenTicketBehavior?: string,
   *    closeWhenSignalClears?: boolean,
   *    closedStatusIds?: string[],
   *  },
   *  config?: any,
   *  categories?: any[],
   * }} input
   */
async function runOnce(input = {}) {
    const activeRunLogger = input?.runLogger || runLogger;
    const nowFn = typeof deps?.now === "function" ? deps.now : Date.now;
    const serviceStartedAt = nowFn();
    const candidates = Array.isArray(input.candidates) ? input.candidates : [];
    const categories = Array.isArray(input.categories) ? input.categories : [];
    const lifecycle = normalizeLifecyclePolicy(input);
    const safeguards = normalizeOperationalSafeguards(input);

    const normalized = candidates
      .map((row, index) => normalizeWorkItem(row, index))
      .sort(compareWorkItemsForLifecycleProcessing);

    const seen = new Set();
    const haloTicketReadStats = createHaloTicketReadStats();
    const createGuardStartedAt = nowFn();
    const createGuard = await buildCreateGuard({
      deps,
      candidates: normalized,
      closedStatusIds: lifecycle.closedStatusIds,
      maxOpenTicketsPerOrganization: safeguards.maxOpenTicketsPerOrganization,
      readStats: haloTicketReadStats,
    });
    const createGuardDurationMs = Math.max(0, nowFn() - createGuardStartedAt);
    await emitCreateGuardBuildLog(activeRunLogger, createGuard, createGuardDurationMs);
    const orgCapacitySummary = buildOrgCapacitySummarySkeleton(normalized, safeguards.maxOpenTicketsPerOrganization, createGuard);
    const results = [];
    const summary = {
      candidatesSeen: candidates.length,
      created: 0,
      updated: 0,
      closed: 0,
      skipped: 0,
      failed: 0,
      bySignalType: {},
      failuresByReason: {},
      failureExamplesByReason: {},
    };

    let firstWriteLogged = false;
    let firstWriteLatencyMs = null;
    let firstWriteAction = "";
    const lifecycleLoopStartedAt = nowFn();
    for (const item of normalized) {
      const signalType = item.signalType || "UNKNOWN";
      summary.bySignalType[signalType] = Number(summary.bySignalType[signalType] || 0) + 1;

      if (!item.identityKey) {
        const sanitized = sanitizeError(new Error("invalid_candidate_identity"));
        summary.failed += 1;
        summary.failuresByReason[sanitized.code] = Number(summary.failuresByReason[sanitized.code] || 0) + 1;
        results.push({
          identityKey: "",
          signalType,
          action: "ERROR",
          status: "failed",
          reason: sanitized.code,
          error: sanitized.message,
          ...(sanitized.detail ? { detail: sanitized.detail } : {}),
        });
        continue;
      }

      if (seen.has(item.identityKey)) {
        summary.skipped += 1;
        results.push({
          identityKey: item.identityKey,
          signalType,
          action: "SKIP",
          status: "skipped",
          reason: "duplicate_candidate",
        });
        continue;
      }
      seen.add(item.identityKey);

      try {
        const outcome = await orchestrator.processCandidate({
          candidate: item.candidate,
          signalQualifies: item.signalQualifies,
          summary: item.summary,
          details: item.details,
          categories,
          lifecycle,
          createGuard,
          readStats: haloTicketReadStats,
          action1BaseUrl: asTrimmedString(input?.config?.connections?.action1?.baseUrl),
          maxImpactedEndpointsInGroupedTicket: input?.config?.maxImpactedEndpointsInGroupedTicket,
        });
        const action = String(outcome?.action || "SKIP").toUpperCase();
        const reason = asTrimmedString(outcome?.reason) || undefined;
        const ticketId = asTrimmedString(outcome?.ticketId) || undefined;
        const status = action === "SKIP" ? "skipped" : "success";
        await emitLifecycleDecisionLog(activeRunLogger, outcome);
        await emitTicketPayloadBuiltLog(activeRunLogger, signalType, outcome);

        if (action === "CREATE") summary.created += 1;
        else if (action === "UPDATE") summary.updated += 1;
        else if (action === "CLOSE") summary.closed += 1;
        else summary.skipped += 1;
        if (!firstWriteLogged && (action === "CREATE" || action === "UPDATE" || action === "CLOSE")) {
          firstWriteLogged = true;
          firstWriteAction = action;
          firstWriteLatencyMs = Math.max(0, nowFn() - serviceStartedAt);
          await emitLog({
            runLogger: activeRunLogger,
            runId: "lifecycle-run-once",
            eventType: LOG_EVENT_TYPES.DISCOVERY_FETCH,
            message: "[FIRST WRITE LATENCY]",
            context: {
              firstWriteAction,
              firstWriteLatencyMs,
            },
          });
        }
        updateOrgCapacitySummary(orgCapacitySummary, item, action, reason);

        results.push({
          identityKey: item.identityKey,
          signalType,
          action,
          status,
          ticketId,
          reason,
        });
      } catch (error) {
        const sanitized = sanitizeError(error);
        summary.failed += 1;
        summary.failuresByReason[sanitized.code] = Number(summary.failuresByReason[sanitized.code] || 0) + 1;
        if (sanitized.detail && !summary.failureExamplesByReason[sanitized.code]) {
          summary.failureExamplesByReason[sanitized.code] = sanitized.detail;
        }
        results.push({
          identityKey: item.identityKey,
          signalType,
          action: "ERROR",
          status: "failed",
          reason: sanitized.code,
          error: sanitized.message,
          ...(sanitized.detail ? { detail: sanitized.detail } : {}),
        });
      }
    }
    const lifecycleCandidateLoopMs = Math.max(0, nowFn() - lifecycleLoopStartedAt);
    await emitLog({
      runLogger: activeRunLogger,
      runId: "lifecycle-run-once",
      eventType: LOG_EVENT_TYPES.DISCOVERY_FETCH,
      message: "[PHASE TIMING]",
      context: {
        phase: "lifecycle_candidate_loop",
        durationMs: lifecycleCandidateLoopMs,
        candidatesTotal: normalized.length,
        firstWriteAction,
        firstWriteLatencyMs: Number.isFinite(firstWriteLatencyMs) ? firstWriteLatencyMs : null,
      },
    });

    await emitOrgCapacitySummaryLogs(activeRunLogger, orgCapacitySummary);
    await emitHaloTicketReadOverlapLog(activeRunLogger, createGuard, haloTicketReadStats);

    return {
      ok: true,
      summary,
      results,
    };
  }
}

async function emitTicketPayloadBuiltLog(runLogger, signalType, outcome) {
  const payloadMeta =
    outcome?.decisionContext && typeof outcome.decisionContext.payloadMeta === "object"
      ? outcome.decisionContext.payloadMeta
      : null;
  if (!payloadMeta || !runLogger) return;
  await emitLog({
    runLogger,
    runId: "lifecycle-run-once",
    eventType: LOG_EVENT_TYPES.DISCOVERY_FETCH,
    message: "[TICKET PAYLOAD BUILT]",
    context: {
      signal: String(signalType || ""),
      summaryLength: Number(payloadMeta.summaryLength || 0),
      detailsLength: Number(payloadMeta.detailsLength || 0),
      topItems: Number(payloadMeta.topItems || 0),
    },
  });
}

async function emitCreateGuardBuildLog(runLogger, createGuard, durationMs) {
  if (!runLogger) return;
  const stats = createGuard && typeof createGuard.__stats === "object" ? createGuard.__stats : {};
  await emitLog({
    runLogger,
    runId: "lifecycle-run-once",
    eventType: LOG_EVENT_TYPES.DISCOVERY_FETCH,
    message: "[PHASE TIMING]",
    context: {
      phase: "create_guard_build",
      durationMs: Number(durationMs || 0),
      orgCount: Number(stats.orgCount || 0),
      correlationsScanned: Number(stats.correlationsScanned || 0),
      haloGetTicketCount: Number(stats.haloGetTicketCount || 0),
      uniqueTicketIdsScanned: Number(stats.uniqueTicketIdsScanned || 0),
    },
  });
}

async function emitHaloTicketReadOverlapLog(runLogger, createGuard, readStats) {
  if (!runLogger) return;
  const createGuardStats = createGuard && typeof createGuard.__stats === "object" ? createGuard.__stats : {};
  const createGuardSet = new Set(Array.isArray(createGuardStats.ticketIdsRead) ? createGuardStats.ticketIdsRead : []);
  const linkedStateSet = new Set(
    readStats && typeof readStats.getLinkedStateTicketIds === "function" ? readStats.getLinkedStateTicketIds() : []
  );
  let overlapCount = 0;
  for (const id of linkedStateSet) {
    if (createGuardSet.has(id)) overlapCount += 1;
  }
  const createGuardCount = createGuardSet.size;
  const linkedCount = linkedStateSet.size;
  const uniqueEstimate = createGuardCount + linkedCount - overlapCount;
  const totalEstimate = Number(createGuardStats.haloGetTicketCount || 0) + Number(linkedCount || 0);
  const duplicateEstimate = Math.max(0, totalEstimate - uniqueEstimate);

  await emitLog({
    runLogger,
    runId: "lifecycle-run-once",
    eventType: LOG_EVENT_TYPES.DISCOVERY_FETCH,
    message: "[HALO TICKET READS]",
    context: {
      createGuardTicketIdsCount: createGuardCount,
      linkedStateTicketIdsCount: linkedCount,
      overlapTicketIdsCount: overlapCount,
      totalHaloTicketReadCountEstimate: totalEstimate,
      uniqueHaloTicketReadIdsCountEstimate: uniqueEstimate,
      createGuardHaloGetCount: Number(createGuardStats.haloGetTicketCount || 0),
      linkedStateHaloGetCount: linkedCount,
      duplicateHaloGetCount: duplicateEstimate,
    },
  });
}

async function emitLifecycleDecisionLog(runLogger, outcome) {
  const ctx = outcome?.decisionContext && typeof outcome.decisionContext === "object" ? outcome.decisionContext : null;
  if (!ctx) return;
  await emitLog({
    runLogger,
    runId: "lifecycle-run-once",
    eventType: LOG_EVENT_TYPES.LIFECYCLE_DECISION,
    message: "[LIFECYCLE DECISION]",
    context: {
      identityKey: String(ctx.identityKey || ""),
      signalType: String(ctx.signalType || ""),
      correlationFound: Boolean(ctx.correlationFound),
      linkedTicketId: String(ctx.linkedTicketId || ""),
      linkedTicketState: String(ctx.linkedTicketState || ""),
      payloadHashChanged: Boolean(ctx.payloadHashChanged),
      existingOpenBehavior: String(ctx.existingOpenBehavior || ""),
      ticketModel: String(ctx.ticketModel || "endpoint"),
      issueKey: String(ctx.issueKey || ""),
      decision: String(ctx.decision || ""),
      reason: String(ctx.reason || ""),
    },
  });
}

function resolveOrchestrator(deps) {
  if (deps.lifecycleWriteOrchestrator) {
    if (typeof deps.lifecycleWriteOrchestrator.processCandidate !== "function") {
      throw new Error("LifecycleRunService requires lifecycleWriteOrchestrator.processCandidate()");
    }
    return deps.lifecycleWriteOrchestrator;
  }

  return createLifecycleWriteOrchestrator({
    haloTicketsClient: deps.haloTicketsClient,
    correlationStore: deps.correlationStore,
    now: deps.now,
  });
}

function normalizeWorkItem(row, index) {
  const useEnvelope = row && typeof row === "object" && row.candidate && typeof row.candidate === "object";
  const candidate = useEnvelope ? row.candidate : row;
  const signalQualifies =
    useEnvelope && typeof row.signalQualifies === "boolean"
      ? row.signalQualifies
      : typeof row?.signalQualifies === "boolean"
      ? row.signalQualifies
      : true;
  const summary = useEnvelope ? row.summary : undefined;
  const details = useEnvelope ? row.details : undefined;
  const identityKey = extractIdentityKey(candidate);
  const signalType = extractSignalType(candidate);

  return {
    inputIndex: index,
    candidate,
    signalQualifies,
    summary,
    details,
    identityKey,
    signalType,
  };
}

function extractIdentityKey(candidate) {
  const key = asTrimmedString(candidate?.identity?.key);
  if (key) return key;
  const groupedIdentityKey = asTrimmedString(candidate?.identity?.identityKey);
  if (groupedIdentityKey) return groupedIdentityKey;
  const orgLinkId = asTrimmedString(candidate?.identity?.orgLinkId);
  const endpointId = asTrimmedString(candidate?.identity?.endpointId);
  const signalType = asTrimmedString(candidate?.identity?.signalType);
  if (!orgLinkId || !signalType) return "";
  if (asTicketModel(candidate?.ticketModel) === "grouped") {
    const issueKey = asTrimmedString(candidate?.issueKey || candidate?.grouped?.issueKey);
    if (!issueKey) return "";
    return `${orgLinkId}|${signalType}|${issueKey}`;
  }
  if (!endpointId) return "";
  return `${orgLinkId}|${endpointId}|${signalType}`;
}

function extractSignalType(candidate) {
  return (
    asTrimmedString(candidate?.identity?.signalType) ||
    asTrimmedString(candidate?.signal?.type) ||
    "UNKNOWN"
  );
}

function normalizeLifecyclePolicy(input) {
  const lifecycle = input?.lifecycle && typeof input.lifecycle === "object" ? input.lifecycle : {};
  const cfg = input?.config && typeof input.config === "object" ? input.config : {};
  const cfgLifecycle = cfg.lifecycle && typeof cfg.lifecycle === "object" ? cfg.lifecycle : {};
  const ticketDestination = cfg.ticketDestination && typeof cfg.ticketDestination === "object" ? cfg.ticketDestination : {};

  const closedStatusIds = Array.isArray(lifecycle.closedStatusIds)
    ? lifecycle.closedStatusIds
    : Array.isArray(ticketDestination.closedStatusIds)
    ? ticketDestination.closedStatusIds
    : [];

  return {
    existingOpenTicketBehavior:
      asTrimmedString(lifecycle.existingOpenTicketBehavior) ||
      asTrimmedString(cfgLifecycle.existingOpenTicketBehavior) ||
      "update_existing_open",
    closeWhenSignalClears:
      lifecycle.closeWhenSignalClears !== undefined
        ? Boolean(lifecycle.closeWhenSignalClears)
        : cfgLifecycle.closeWhenSignalClears !== undefined
        ? Boolean(cfgLifecycle.closeWhenSignalClears)
        : true,
    closedStatusIds: closedStatusIds.map((row) => asTrimmedString(row)).filter(Boolean),
  };
}

function normalizeOperationalSafeguards(input) {
  const cfg = input?.config && typeof input.config === "object" ? input.config : {};
  const operational = cfg.operationalSafeguards && typeof cfg.operationalSafeguards === "object"
    ? cfg.operationalSafeguards
    : {};
  const maxOpen = Number(operational.maxOpenTicketsPerOrganization);
  return {
    enableDebugLogging: Boolean(operational.enableDebugLogging),
    maxOpenTicketsPerOrganization:
      Number.isInteger(maxOpen) && maxOpen > 0 ? maxOpen : DEFAULT_MAX_OPEN_TICKETS_PER_ORG,
  };
}

function compareWorkItemsForLifecycleProcessing(a, b) {
  const orgA = asTrimmedString(a?.candidate?.identity?.orgLinkId);
  const orgB = asTrimmedString(b?.candidate?.identity?.orgLinkId);
  if (orgA < orgB) return -1;
  if (orgA > orgB) return 1;

  const signalA = extractSignalType(a?.candidate);
  const signalB = extractSignalType(b?.candidate);
  const signalOrder = signalPriority(signalA) - signalPriority(signalB);
  if (signalOrder !== 0) return signalOrder;

  const signalSpecific = compareSignalSpecific(a?.candidate, b?.candidate, signalA);
  if (signalSpecific !== 0) return signalSpecific;

  const keyA = String(a?.identityKey || `~invalid~${a?.inputIndex || 0}`);
  const keyB = String(b?.identityKey || `~invalid~${b?.inputIndex || 0}`);
  if (keyA < keyB) return -1;
  if (keyA > keyB) return 1;
  return Number(a?.inputIndex || 0) - Number(b?.inputIndex || 0);
}

function signalPriority(signalTypeRaw) {
  const signalType = String(signalTypeRaw || "").toUpperCase();
  if (signalType === "OFFLINE") return 1;
  if (signalType === "REBOOT_REQUIRED") return 2;
  if (signalType === "AUTOMATION_FAILED") return 3;
  if (signalType === "VULNERABILITY") return 4;
  if (signalType === "UPDATE") return 5;
  return 99;
}

function compareSignalSpecific(a, b, signalTypeRaw) {
  const signalType = String(signalTypeRaw || "").toUpperCase();
  if (signalType === "OFFLINE") {
    const offlineA = Number(a?.signal?.details?.offlineDays || 0);
    const offlineB = Number(b?.signal?.details?.offlineDays || 0);
    if (offlineA !== offlineB) return offlineB - offlineA;
    return compareEndpointNameId(a, b);
  }
  if (signalType === "REBOOT_REQUIRED") {
    return compareEndpointNameId(a, b);
  }
  if (signalType === "AUTOMATION_FAILED") {
    const tA = parseDateMs(a?.grouped?.issueMetadata?.instanceEndTime || a?.grouped?.issueMetadata?.time || "");
    const tB = parseDateMs(b?.grouped?.issueMetadata?.instanceEndTime || b?.grouped?.issueMetadata?.time || "");
    if (tA !== tB) return tB - tA;
    const idA = asTrimmedString(a?.issueKey || a?.grouped?.issueKey);
    const idB = asTrimmedString(b?.issueKey || b?.grouped?.issueKey);
    if (idA < idB) return -1;
    if (idA > idB) return 1;
    return 0;
  }
  if (signalType === "VULNERABILITY") {
    const sevA = vulnerabilitySeverityPriority(a);
    const sevB = vulnerabilitySeverityPriority(b);
    if (sevA !== sevB) return sevA - sevB;
    const remA = remediationPriority(a);
    const remB = remediationPriority(b);
    if (remA !== remB) return remA - remB;
    const ddlA = parseDateMs(a?.grouped?.issueMetadata?.remediationDeadline || "");
    const ddlB = parseDateMs(b?.grouped?.issueMetadata?.remediationDeadline || "");
    if (ddlA !== ddlB) return ddlA - ddlB;
    return compareIssueKey(a, b);
  }
  if (signalType === "UPDATE") {
    const sevA = updateSeverityPriority(a);
    const sevB = updateSeverityPriority(b);
    if (sevA !== sevB) return sevA - sevB;
    const remA = remediationPriority(a);
    const remB = remediationPriority(b);
    if (remA !== remB) return remA - remB;
    const ddlA = parseDateMs(a?.grouped?.issueMetadata?.remediationDeadline || a?.grouped?.issueMetadata?.slaDeadline || "");
    const ddlB = parseDateMs(b?.grouped?.issueMetadata?.remediationDeadline || b?.grouped?.issueMetadata?.slaDeadline || "");
    if (ddlA !== ddlB) return ddlA - ddlB;
    return compareIssueKey(a, b);
  }
  return 0;
}

function compareEndpointNameId(a, b) {
  const nameA = asTrimmedString(a?.endpoint?.name).toLowerCase();
  const nameB = asTrimmedString(b?.endpoint?.name).toLowerCase();
  if (nameA < nameB) return -1;
  if (nameA > nameB) return 1;
  const idA = asTrimmedString(a?.endpoint?.id);
  const idB = asTrimmedString(b?.endpoint?.id);
  if (idA < idB) return -1;
  if (idA > idB) return 1;
  return 0;
}

function compareIssueKey(a, b) {
  const keyA = asTrimmedString(a?.issueKey || a?.grouped?.issueKey);
  const keyB = asTrimmedString(b?.issueKey || b?.grouped?.issueKey);
  if (keyA < keyB) return -1;
  if (keyA > keyB) return 1;
  return 0;
}

function vulnerabilitySeverityPriority(candidate) {
  const value = asTrimmedString(candidate?.grouped?.issueMetadata?.severity || "").toUpperCase();
  if (value === "CRITICAL") return 1;
  if (value === "HIGH") return 2;
  if (value === "MEDIUM") return 3;
  if (value === "LOW") return 4;
  return 9;
}

function updateSeverityPriority(candidate) {
  const value = asTrimmedString(candidate?.grouped?.issueMetadata?.severity || "").toUpperCase();
  if (value === "CRITICAL" || value === "IMPORTANT" || value === "HIGH") return 1;
  if (value === "MODERATE" || value === "MEDIUM") return 2;
  if (value === "LOW") return 3;
  if (value === "UNSPECIFIED") return 4;
  return 9;
}

function remediationPriority(candidate) {
  const value = asTrimmedString(candidate?.grouped?.issueMetadata?.remediationStatus || candidate?.grouped?.issueMetadata?.slaStatus || "").toUpperCase();
  if (value === "OVERDUE") return 1;
  if (value === "DUE_SOON") return 2;
  return 9;
}

function parseDateMs(value) {
  const text = asTrimmedString(value);
  if (!text) return Number.MAX_SAFE_INTEGER;
  const n = Date.parse(text);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

async function buildCreateGuard(input) {
  const maxOpen = Number(input?.maxOpenTicketsPerOrganization || 0);
  if (!Number.isInteger(maxOpen) || maxOpen <= 0) return null;
  const correlationStore = input?.deps?.correlationStore;
  const haloTicketsClient = input?.deps?.haloTicketsClient;
  if (
    !correlationStore ||
    typeof correlationStore.listCorrelationsByOrgLink !== "function" ||
    !haloTicketsClient ||
    typeof haloTicketsClient.getTicket !== "function"
  ) {
    return null;
  }

  const orgLinkIds = Array.from(
    new Set(
      (Array.isArray(input?.candidates) ? input.candidates : [])
        .map((item) => {
          const explicit = asTrimmedString(item?.candidate?.identity?.orgLinkId);
          if (explicit) return explicit;
          const key = asTrimmedString(item?.identityKey) || asTrimmedString(item?.candidate?.identity?.key);
          if (!key) return "";
          const pipeIndex = key.indexOf("|");
          return pipeIndex > 0 ? key.slice(0, pipeIndex) : "";
        })
        .filter(Boolean)
    )
  );
  const closedSet = new Set((Array.isArray(input?.closedStatusIds) ? input.closedStatusIds : []).map((x) => asTrimmedString(x)));
  const stateByOrg = new Map();
  const stats = {
    orgCount: orgLinkIds.length,
    correlationsScanned: 0,
    haloGetTicketCount: 0,
    uniqueTicketIdsScanned: 0,
    ticketIdsRead: [],
  };

  for (const orgLinkId of orgLinkIds) {
    const rows = await correlationStore.listCorrelationsByOrgLink(orgLinkId, { includeGrouped: true });
    stats.correlationsScanned += Array.isArray(rows) ? rows.length : 0;
    const ticketIds = Array.from(
      new Set(
        (Array.isArray(rows) ? rows : [])
          .map((row) => asTrimmedString(row?.haloTicketId || row?.linkedTicketId))
          .filter(Boolean)
      )
    );
    stats.uniqueTicketIdsScanned += ticketIds.length;
    const openTicketIds = new Set();
    for (const ticketId of ticketIds) {
      try {
        stats.haloGetTicketCount += 1;
        stats.ticketIdsRead.push(ticketId);
        const ticket = await haloTicketsClient.getTicket(ticketId);
        if (!ticket || isClosedTicket(ticket, closedSet)) continue;
        openTicketIds.add(ticketId);
      } catch (_) {
        // Treat missing/unreadable ticket as not consuming open capacity.
      }
    }
    stateByOrg.set(orgLinkId, {
      openCount: openTicketIds.size,
      openBefore: openTicketIds.size,
      openTicketIds,
    });
  }

  return {
    canCreate(orgLinkId) {
      const key = asTrimmedString(orgLinkId);
      const existing = stateByOrg.get(key) || { openCount: 0, openBefore: 0, openTicketIds: new Set() };
      if (!stateByOrg.has(key)) stateByOrg.set(key, existing);
      return existing.openCount < maxOpen;
    },
    onCreate(orgLinkId, ticketId) {
      const key = asTrimmedString(orgLinkId);
      if (!key) return;
      const entry = stateByOrg.get(key) || { openCount: 0, openBefore: 0, openTicketIds: new Set() };
      if (!stateByOrg.has(key)) stateByOrg.set(key, entry);
      const normalizedTicketId = asTrimmedString(ticketId);
      if (normalizedTicketId && entry.openTicketIds.has(normalizedTicketId)) return;
      if (normalizedTicketId) entry.openTicketIds.add(normalizedTicketId);
      entry.openCount += 1;
    },
    onClose(orgLinkId, ticketId) {
      const key = asTrimmedString(orgLinkId);
      if (!key) return;
      const entry = stateByOrg.get(key);
      if (!entry) return;
      const normalizedTicketId = asTrimmedString(ticketId);
      if (normalizedTicketId && entry.openTicketIds.has(normalizedTicketId)) {
        entry.openTicketIds.delete(normalizedTicketId);
      }
      entry.openCount = Math.max(0, entry.openCount - 1);
    },
    getOrgSnapshot(orgLinkId) {
      const key = asTrimmedString(orgLinkId);
      const entry = stateByOrg.get(key) || { openCount: 0, openBefore: 0 };
      return {
        openBefore: Number(entry.openBefore || 0),
        openCurrent: Number(entry.openCount || 0),
      };
    },
    __stats: stats,
  };
}

function createHaloTicketReadStats() {
  const linkedStateTicketIds = new Set();
  return {
    recordLinkedStateRead(ticketId) {
      const id = asTrimmedString(ticketId);
      if (!id) return;
      linkedStateTicketIds.add(id);
    },
    getLinkedStateTicketIds() {
      return Array.from(linkedStateTicketIds.values());
    },
  };
}

function isClosedTicket(ticket, closedSet) {
  const statusId = asTrimmedString(ticket?.statusId);
  return Boolean(ticket?.isClosed) || (statusId && closedSet.has(statusId));
}

function buildOrgCapacitySummarySkeleton(normalized, maxOpenTicketsPerOrganization, createGuard) {
  const byOrg = new Map();
  for (const item of Array.isArray(normalized) ? normalized : []) {
    const orgLinkId = asTrimmedString(item?.candidate?.identity?.orgLinkId);
    if (!orgLinkId) continue;
    if (!byOrg.has(orgLinkId)) {
      const snapshot =
        createGuard && typeof createGuard.getOrgSnapshot === "function"
          ? createGuard.getOrgSnapshot(orgLinkId)
          : { openBefore: 0 };
      const openBefore = Number(snapshot?.openBefore || 0);
      const maxOpen = Number(maxOpenTicketsPerOrganization || 0);
      byOrg.set(orgLinkId, {
        orgLinkId,
        maxOpenTicketsPerOrganization: maxOpen,
        openConnectorTicketsBefore: openBefore,
        availableCreateSlots: Math.max(0, maxOpen - openBefore),
        createCandidates: 0,
        created: 0,
        skippedDueToOrgCapacity: 0,
        updated: 0,
        noOp: 0,
      });
    }
    byOrg.get(orgLinkId).createCandidates += 1;
  }
  return byOrg;
}

function updateOrgCapacitySummary(summaryByOrg, item, action, reason) {
  const orgLinkId = asTrimmedString(item?.candidate?.identity?.orgLinkId);
  if (!orgLinkId || !summaryByOrg.has(orgLinkId)) return;
  const row = summaryByOrg.get(orgLinkId);
  if (action === "CREATE") row.created += 1;
  else if (action === "UPDATE") row.updated += 1;
  else if (action === "SKIP") {
    if (String(reason || "") === "ORG_OPEN_TICKET_LIMIT_REACHED") row.skippedDueToOrgCapacity += 1;
    else row.noOp += 1;
  }
}

async function emitOrgCapacitySummaryLogs(runLogger, summaryByOrg) {
  if (!runLogger || typeof runLogger.emit !== "function") return;
  for (const row of summaryByOrg.values()) {
    await emitLog({
      runLogger,
      runId: "lifecycle-run-once",
      eventType: LOG_EVENT_TYPES.DISCOVERY_FETCH,
      message: "[ORG CAPACITY]",
      context: {
        orgLinkId: row.orgLinkId,
        maxOpenTicketsPerOrganization: row.maxOpenTicketsPerOrganization,
        openConnectorTicketsBefore: row.openConnectorTicketsBefore,
        availableCreateSlots: row.availableCreateSlots,
        createCandidates: row.createCandidates,
        created: row.created,
        skippedDueToOrgCapacity: row.skippedDueToOrgCapacity,
        updated: row.updated,
        noOp: row.noOp,
      },
    });
  }
}

function sanitizeError(error) {
  const explicitCode = asTrimmedString(error?.code);
  const safeDetail = sanitizeSafeDetail(error?.safeDetail);
  if (explicitCode === "halo_create_rejected") {
    return {
      code: explicitCode,
      message:
        asTrimmedString(error?.message) ||
        "Halo rejected ticket creation. Check Ticket Type / Status / Team / Category compatibility.",
      ...(safeDetail ? { detail: safeDetail } : {}),
    };
  }

  const rawMessage = asTrimmedString(error?.message) || "candidate processing failed";
  const lower = rawMessage.toLowerCase();
  const hasSecretLikeText =
    lower.includes("secret") ||
    lower.includes("token") ||
    lower.includes("authorization") ||
    lower.includes("bearer") ||
    lower.includes("password") ||
    lower.includes("x-tenant");

  if (hasSecretLikeText) {
    return {
      code: "candidate_processing_failed",
      message: "candidate processing failed",
    };
  }

  const code = /^[a-z0-9_]+$/i.test(rawMessage) ? rawMessage.toLowerCase() : "candidate_processing_failed";
  return {
    code,
    message: rawMessage.slice(0, 240),
  };
}

function sanitizeSafeDetail(value) {
  const text = asTrimmedString(value);
  if (!text) return "";
  const lower = text.toLowerCase();
  if (
    lower.includes("secret") ||
    lower.includes("token") ||
    lower.includes("authorization") ||
    lower.includes("bearer") ||
    lower.includes("password") ||
    lower.includes("x-tenant")
  ) {
    return "";
  }
  return text.slice(0, 160);
}

function asTrimmedString(value) {
  return String(value || "").trim();
}

function asTicketModel(value) {
  return String(value || "").trim().toLowerCase() === "grouped" ? "grouped" : "endpoint";
}

module.exports = {
  createLifecycleRunService,
  normalizeLifecyclePolicy,
  normalizeOperationalSafeguards,
  normalizeWorkItem,
  extractIdentityKey,
  sanitizeError,
};
