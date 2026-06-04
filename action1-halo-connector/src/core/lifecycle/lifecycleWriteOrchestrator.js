// lifecycleWriteOrchestrator.js
//
// Action1 Public Repository Material
//
// Use of this file is subject to TERMS_OF_USE.md (https://github.com/Action1Corp/PSAction1/blob/main/TERMS_OF_USE.md) in this repository.
// Provided AS IS, without warranties.
// Use at your own risk.
// Review, test, and validate before production use.
// © Action1 Corporation. All rights reserved.
const {
  decideLifecycleAction,
  LINKED_TICKET_STATES,
  LIFECYCLE_ACTIONS,
} = require("./decisionModel");
const { buildHaloCreateTicketPayload } = require("./ticketPayloadBuilder");
const { buildTicketContentFromCandidate } = require("./ticketContentBuilder");
const { buildGroupedTicketContentFromCandidate, buildGroupedPayloadHashInput } = require("./groupedTicketContentBuilder");

/**
 * Thin Stage 5 orchestration boundary:
 * candidate + correlation state -> lifecycle decision -> Halo write action.
 * No scheduler/runtime loop behavior is included here.
 *
 * @param {{
 *  haloTicketsClient: {
 *    createTicket: Function,
 *    updateTicket: Function,
 *    getTicket: Function,
 *    setTicketStatus: Function,
 *  },
 *  correlationStore: {
 *    getCorrelation: Function,
 *    upsertCorrelation: Function,
 *    deleteCorrelation: Function,
 *  },
 *  now?: () => number,
 * }} deps
 */
function createLifecycleWriteOrchestrator(deps) {
  if (!deps || typeof deps !== "object") {
    throw new Error("LifecycleWriteOrchestrator requires dependencies");
  }
  if (!deps.haloTicketsClient || typeof deps.haloTicketsClient !== "object") {
    throw new Error("LifecycleWriteOrchestrator requires haloTicketsClient");
  }
  if (!deps.correlationStore || typeof deps.correlationStore !== "object") {
    throw new Error("LifecycleWriteOrchestrator requires correlationStore");
  }
  assertMethod("haloTicketsClient", deps.haloTicketsClient, "createTicket");
  assertMethod("haloTicketsClient", deps.haloTicketsClient, "updateTicket");
  assertMethod("haloTicketsClient", deps.haloTicketsClient, "getTicket");
  assertMethod("haloTicketsClient", deps.haloTicketsClient, "setTicketStatus");
  assertMethod("correlationStore", deps.correlationStore, "getCorrelation");
  assertMethod("correlationStore", deps.correlationStore, "upsertCorrelation");
  assertMethod("correlationStore", deps.correlationStore, "deleteCorrelation");
  const nowFn = typeof deps.now === "function" ? deps.now : Date.now;

  return {
    processCandidate,
  };

  /**
   * @param {{
   *  candidate: any,
   *  signalQualifies: boolean,
   *  summary?: string,
   *  details?: string,
   *  categories?: any[],
   *  lifecycle?: {
   *    existingOpenTicketBehavior?: string,
   *    closeWhenSignalClears?: boolean,
   *    closedStatusIds?: string[],
   *  },
   * }} input
   */
  async function processCandidate(input) {
    const candidate = input?.candidate && typeof input.candidate === "object" ? input.candidate : {};
    const identity = candidate.identity && typeof candidate.identity === "object" ? candidate.identity : {};
    const ticketModel = normalizeTicketModel(candidate?.ticketModel);
    const orgLinkId = asTrimmedString(identity.orgLinkId);
    const signalType = asTrimmedString(identity.signalType || candidate?.signal?.type);
    const endpointId = asTrimmedString(identity.endpointId);
    const issueKey = asTrimmedString(candidate?.issueKey || candidate?.grouped?.issueKey);
    const identityKey = resolveIdentityKey(candidate, ticketModel, orgLinkId, endpointId, signalType, issueKey);
    if (!orgLinkId || !signalType || !identityKey || (ticketModel === "endpoint" && !endpointId)) {
      throw new Error("lifecycle_orchestrator_invalid_candidate_identity");
    }

    const correlation = await getCorrelationByMode({
      correlationStore: deps.correlationStore,
      ticketModel,
      orgLinkId,
      endpointId,
      signalType,
      issueKey,
    });
    const linkedTicketState = await resolveLinkedTicketState({
      haloTicketsClient: deps.haloTicketsClient,
      correlation,
      closedStatusIds: input?.lifecycle?.closedStatusIds,
      readStats: input?.readStats,
    });

    // Fast-path create capacity guard before payload construction for net-new qualifying signals.
    if (!correlation && Boolean(input?.signalQualifies)) {
      if (input?.createGuard && typeof input.createGuard.canCreate === "function") {
        const allowed = input.createGuard.canCreate(orgLinkId);
        if (!allowed) {
          return {
            action: LIFECYCLE_ACTIONS.SKIP,
            reason: "ORG_OPEN_TICKET_LIMIT_REACHED",
            wroteTicket: false,
            wroteCorrelation: false,
            clearedCorrelation: false,
            correlationKey: identityKey,
            ticketId: null,
            payloadHash: "",
            decisionContext: {
              identityKey,
              signalType,
              ticketModel,
              issueKey: ticketModel === "grouped" ? issueKey : "",
              correlationFound: false,
              linkedTicketId: "",
              linkedTicketState,
              payloadHashChanged: true,
              existingOpenBehavior: String(input?.lifecycle?.existingOpenTicketBehavior || ""),
              decision: LIFECYCLE_ACTIONS.SKIP,
              reason: "ORG_OPEN_TICKET_LIMIT_REACHED",
              payloadMeta: {
                summaryLength: 0,
                detailsLength: 0,
                topItems: 0,
              },
            },
          };
        }
      }
    }

    const builtContent =
      ticketModel === "grouped"
        ? buildGroupedTicketContentFromCandidate({
            candidate,
            action1BaseUrl: input?.action1BaseUrl,
            maxImpactedEndpointsInGroupedTicket: input?.maxImpactedEndpointsInGroupedTicket,
          })
        : buildTicketContentFromCandidate({
            candidate,
            action1BaseUrl: input?.action1BaseUrl,
          });
    const createPayload = buildHaloCreateTicketPayload({
      candidate,
      summary: input?.summary || builtContent.summary || defaultSummaryFromCandidate(candidate),
      details: input?.details || builtContent.details || defaultDetailsFromCandidate(candidate),
      detailsHtml: input?.detailsHtml || builtContent.detailsHtml || "",
      categories: input?.categories || [],
    });
    const payloadHash =
      ticketModel === "grouped"
        ? hashPayload(
            buildGroupedPayloadHashInput({
              candidate,
              action1BaseUrl: input?.action1BaseUrl,
              maxImpactedEndpointsInGroupedTicket: input?.maxImpactedEndpointsInGroupedTicket,
            })
          )
        : hashPayload(createPayload);
    const linkedTicketId = extractCorrelationTicketId(correlation);

    const decision = decideLifecycleAction({
      signalQualifies: Boolean(input?.signalQualifies),
      linkedTicketState,
      existingOpenTicketBehavior: input?.lifecycle?.existingOpenTicketBehavior,
      payloadChanged: correlation ? String(correlation.payloadHash || "") !== payloadHash : true,
      closeWhenSignalClears: input?.lifecycle?.closeWhenSignalClears,
    });

    const result = {
      action: decision.action,
      reason: decision.reason,
      wroteTicket: false,
      wroteCorrelation: false,
      clearedCorrelation: false,
      correlationKey: identityKey,
      ticketId: linkedTicketId || null,
      payloadHash,
      decisionContext: {
        identityKey,
        signalType,
        ticketModel,
        issueKey: ticketModel === "grouped" ? issueKey : "",
        correlationFound: Boolean(correlation),
        linkedTicketId: linkedTicketId || "",
        linkedTicketState,
        payloadHashChanged: correlation ? String(correlation.payloadHash || "") !== payloadHash : true,
        existingOpenBehavior: String(input?.lifecycle?.existingOpenTicketBehavior || ""),
        decision: decision.action,
        reason: decision.reason,
        payloadMeta: {
          summaryLength: String(createPayload.summary || "").length,
          detailsLength: String(createPayload.details || "").length,
          topItems: Number(builtContent?.topItems || 0),
        },
      },
    };

    if (decision.action === LIFECYCLE_ACTIONS.SKIP) {
      return result;
    }

    if (decision.action === LIFECYCLE_ACTIONS.CREATE) {
      if (input?.createGuard && typeof input.createGuard.canCreate === "function") {
        const allowed = input.createGuard.canCreate(orgLinkId);
        if (!allowed) {
          result.action = LIFECYCLE_ACTIONS.SKIP;
          result.reason = "ORG_OPEN_TICKET_LIMIT_REACHED";
          result.decisionContext.decision = LIFECYCLE_ACTIONS.SKIP;
          result.decisionContext.reason = "ORG_OPEN_TICKET_LIMIT_REACHED";
          return result;
        }
      }
      const created = await deps.haloTicketsClient.createTicket(createPayload);
      await upsertCorrelationByMode({
        correlationStore: deps.correlationStore,
        candidate,
        ticketModel,
        issueKey,
        ticketId: created.id,
        payloadHash,
        statusId: created.statusId,
        statusName: created.statusName,
        nowIso: new Date(nowFn()).toISOString(),
        prior: correlation,
      });
      result.wroteTicket = true;
      result.wroteCorrelation = true;
      result.ticketId = String(created.id || "");
      if (input?.createGuard && typeof input.createGuard.onCreate === "function") {
        input.createGuard.onCreate(orgLinkId, result.ticketId);
      }
      return result;
    }

    if (decision.action === LIFECYCLE_ACTIONS.UPDATE) {
      const updated = await deps.haloTicketsClient.updateTicket(linkedTicketId, createPayload);
      await upsertCorrelationByMode({
        correlationStore: deps.correlationStore,
        candidate,
        ticketModel,
        issueKey,
        ticketId: linkedTicketId,
        payloadHash,
        statusId: updated?.statusId || null,
        statusName: updated?.statusName || null,
        nowIso: new Date(nowFn()).toISOString(),
        prior: correlation,
      });
      result.wroteTicket = true;
      result.wroteCorrelation = true;
      result.ticketId = String(linkedTicketId || "");
      return result;
    }

    if (decision.action === LIFECYCLE_ACTIONS.CLOSE) {
      if (ticketModel === "grouped") {
        result.action = LIFECYCLE_ACTIONS.SKIP;
        result.reason = "SIGNAL_CLEARED_NO_ACTION";
        result.decisionContext.decision = LIFECYCLE_ACTIONS.SKIP;
        result.decisionContext.reason = "SIGNAL_CLEARED_NO_ACTION";
        return result;
      }
      const closeStatusId = firstClosedStatusId(input?.lifecycle?.closedStatusIds);
      if (!closeStatusId) {
        throw new Error("lifecycle_orchestrator_missing_closed_status_id");
      }
      await deps.haloTicketsClient.setTicketStatus(linkedTicketId, closeStatusId);
      await deps.correlationStore.deleteCorrelation(orgLinkId, endpointId, signalType);
      result.wroteTicket = true;
      result.clearedCorrelation = true;
      if (input?.createGuard && typeof input.createGuard.onClose === "function") {
        input.createGuard.onClose(orgLinkId, asTrimmedString(linkedTicketId));
      }
      return result;
    }

    return result;
  }
}

async function resolveLinkedTicketState(input) {
  const correlation = input?.correlation || null;
  if (!correlation) return LINKED_TICKET_STATES.NONE;
  const ticketId = extractCorrelationTicketId(correlation);
  if (!ticketId) return LINKED_TICKET_STATES.MISSING;
  if (input?.readStats && typeof input.readStats.recordLinkedStateRead === "function") {
    input.readStats.recordLinkedStateRead(ticketId);
  }
  const ticket = await input.haloTicketsClient.getTicket(ticketId);
  if (!ticket) return LINKED_TICKET_STATES.MISSING;

  const closedStatusIds = new Set((input.closedStatusIds || []).map((x) => asTrimmedString(x)).filter(Boolean));
  const statusId = asTrimmedString(ticket.statusId);
  const isClosed = Boolean(ticket.isClosed) || (statusId && closedStatusIds.has(statusId));
  return isClosed ? LINKED_TICKET_STATES.CLOSED : LINKED_TICKET_STATES.OPEN;
}

async function upsertCorrelationByMode(input) {
  const candidate = input.candidate || {};
  const identity = candidate.identity || {};
  if (input.ticketModel === "grouped") {
    assertMethod("correlationStore", input.correlationStore, "upsertGroupedCorrelation");
    await input.correlationStore.upsertGroupedCorrelation({
      mode: "grouped",
      identityKey: asTrimmedString(identity.identityKey) || `${asTrimmedString(identity.orgLinkId)}|${asTrimmedString(identity.signalType)}|${asTrimmedString(input.issueKey)}`,
      orgLinkId: asTrimmedString(identity.orgLinkId),
      signalType: asTrimmedString(identity.signalType),
      issueKey: asTrimmedString(input.issueKey),
      linkedTicketId: asTrimmedString(input.ticketId),
      payloadHash: asTrimmedString(input.payloadHash),
      ticketStatusId: input.statusId ? asTrimmedString(input.statusId) : null,
      ticketStatusName: input.statusName ? asTrimmedString(input.statusName) : null,
      createdAt: input.prior?.createdAt || input.nowIso,
      updatedAt: input.nowIso,
    });
    return;
  }
  await input.correlationStore.upsertCorrelation({
    orgLinkId: asTrimmedString(identity.orgLinkId),
    endpointId: asTrimmedString(identity.endpointId),
    signalType: asTrimmedString(identity.signalType),
    haloTicketId: asTrimmedString(input.ticketId),
    payloadHash: asTrimmedString(input.payloadHash),
    ticketStatusId: input.statusId ? asTrimmedString(input.statusId) : null,
    ticketStatusName: input.statusName ? asTrimmedString(input.statusName) : null,
    createdAt: input.prior?.createdAt || input.nowIso,
    updatedAt: input.nowIso,
  });
}

async function getCorrelationByMode(input) {
  if (input.ticketModel === "grouped") {
    assertMethod("correlationStore", input.correlationStore, "getGroupedCorrelation");
    return input.correlationStore.getGroupedCorrelation(input.orgLinkId, input.signalType, input.issueKey);
  }
  return input.correlationStore.getCorrelation(input.orgLinkId, input.endpointId, input.signalType);
}

function normalizeTicketModel(value) {
  return String(value || "").trim().toLowerCase() === "grouped" ? "grouped" : "endpoint";
}

function resolveIdentityKey(candidate, ticketModel, orgLinkId, endpointId, signalType, issueKey) {
  const explicitKey = asTrimmedString(candidate?.identity?.key);
  if (explicitKey) return explicitKey;
  const explicitGroupedKey = asTrimmedString(candidate?.identity?.identityKey);
  if (explicitGroupedKey) return explicitGroupedKey;
  if (ticketModel === "grouped") {
    if (!orgLinkId || !signalType || !issueKey) return "";
    return `${orgLinkId}|${signalType}|${issueKey}`;
  }
  if (!orgLinkId || !endpointId || !signalType) return "";
  return `${orgLinkId}|${endpointId}|${signalType}`;
}

function extractCorrelationTicketId(correlation) {
  return asTrimmedString(correlation?.haloTicketId || correlation?.linkedTicketId);
}

function hashPayload(payload) {
  return stableStringify(payload);
}

function stableStringify(value) {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  if (typeof value !== "object") return JSON.stringify(value);
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

function defaultSummaryFromCandidate(candidate) {
  const type = asTrimmedString(candidate?.signal?.type) || "SIGNAL";
  const endpointName = asTrimmedString(candidate?.endpoint?.name);
  const endpointId = asTrimmedString(candidate?.endpoint?.id);
  return endpointName ? `Action1 ${type}: ${endpointName}` : `Action1 ${type}: ${endpointId}`;
}

function defaultDetailsFromCandidate(candidate) {
  const reason = asTrimmedString(candidate?.signal?.reason);
  return reason || "Action1 signal candidate qualified.";
}

function firstClosedStatusId(rows) {
  const first = Array.isArray(rows) ? rows[0] : null;
  return asTrimmedString(first);
}

function asTrimmedString(value) {
  return String(value || "").trim();
}

function assertMethod(name, value, method) {
  if (!value || typeof value !== "object" || typeof value[method] !== "function") {
    throw new Error(`lifecycle_orchestrator_missing_${name}_${method}`);
  }
}

module.exports = {
  createLifecycleWriteOrchestrator,
  hashPayload,
};
