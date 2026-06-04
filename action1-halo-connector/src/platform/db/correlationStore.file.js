// correlationStore.file.js
//
// Action1 Public Repository Material
//
// Use of this file is subject to TERMS_OF_USE.md (https://github.com/Action1Corp/PSAction1/blob/main/TERMS_OF_USE.md) in this repository.
// Provided AS IS, without warranties.
// Use at your own risk.
// Review, test, and validate before production use.
// © Action1 Corporation. All rights reserved.
const fs = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_CORRELATION_FILE_PATH = path.join(process.cwd(), "data", "ticket-correlations.json");

/**
 * @param {{filePath?: string}} [opts]
 */
function createFileCorrelationStore(opts = {}) {
  const filePath = opts.filePath || DEFAULT_CORRELATION_FILE_PATH;

  return {
    getCorrelation,
    upsertCorrelation,
    deleteCorrelation,
    listCorrelationsByOrgLink,
    getGroupedCorrelation,
    upsertGroupedCorrelation,
    deleteGroupedCorrelation,
    listGroupedCorrelationsByOrgLink,
    filePath,
  };

  async function getCorrelation(orgLinkId, endpointId, signalType) {
    const state = await loadState();
    return (
      state.correlations.find(
        (row) =>
          row.orgLinkId === asTrimmedString(orgLinkId) &&
          row.endpointId === asTrimmedString(endpointId) &&
          row.signalType === asTrimmedString(signalType)
      ) || null
    );
  }

  async function upsertCorrelation(record) {
    const state = await loadState();
    const normalized = normalizeCorrelationRecord(record);
    const idx = state.correlations.findIndex(
      (row) =>
        row.orgLinkId === normalized.orgLinkId &&
        row.endpointId === normalized.endpointId &&
        row.signalType === normalized.signalType
    );
    if (idx >= 0) state.correlations[idx] = normalized;
    else state.correlations.push(normalized);
    state.updatedAt = new Date().toISOString();
    await saveState(state);
  }

  async function deleteCorrelation(orgLinkId, endpointId, signalType) {
    const state = await loadState();
    const next = state.correlations.filter(
      (row) =>
        !(
          row.orgLinkId === asTrimmedString(orgLinkId) &&
          row.endpointId === asTrimmedString(endpointId) &&
          row.signalType === asTrimmedString(signalType)
        )
    );
    if (next.length === state.correlations.length) return;
    state.correlations = next;
    state.updatedAt = new Date().toISOString();
    await saveState(state);
  }

  async function getGroupedCorrelation(orgLinkId, signalType, issueKey) {
    const state = await loadState();
    const normalized = normalizeGroupedCorrelationRecord({
      orgLinkId,
      signalType,
      issueKey,
    });
    return (
      state.correlations.find(
        (row) =>
          row.mode === "grouped" &&
          row.orgLinkId === normalized.orgLinkId &&
          row.signalType === normalized.signalType &&
          row.issueKey === normalized.issueKey
      ) || null
    );
  }

  async function upsertGroupedCorrelation(record) {
    const state = await loadState();
    const normalized = normalizeGroupedCorrelationRecord(record);
    const idx = state.correlations.findIndex(
      (row) =>
        row.mode === "grouped" &&
        row.identityKey === normalized.identityKey &&
        row.orgLinkId === normalized.orgLinkId
    );
    if (idx >= 0) state.correlations[idx] = normalized;
    else state.correlations.push(normalized);
    state.updatedAt = new Date().toISOString();
    await saveState(state);
  }

  async function deleteGroupedCorrelation(orgLinkId, signalType, issueKey) {
    const state = await loadState();
    const normalized = normalizeGroupedCorrelationRecord({
      orgLinkId,
      signalType,
      issueKey,
    });
    const next = state.correlations.filter(
      (row) =>
        !(
          row.mode === "grouped" &&
          row.orgLinkId === normalized.orgLinkId &&
          row.signalType === normalized.signalType &&
          row.issueKey === normalized.issueKey
        )
    );
    if (next.length === state.correlations.length) return;
    state.correlations = next;
    state.updatedAt = new Date().toISOString();
    await saveState(state);
  }

  async function listGroupedCorrelationsByOrgLink(orgLinkId) {
    const state = await loadState();
    const orgKey = asTrimmedString(orgLinkId);
    return state.correlations
      .filter((row) => row.mode === "grouped" && row.orgLinkId === orgKey)
      .map((row) => ({ ...row }));
  }

  async function listCorrelationsByOrgLink(orgLinkId, opts = {}) {
    const includeGrouped = opts && opts.includeGrouped === true;
    const state = await loadState();
    const orgKey = asTrimmedString(orgLinkId);
    return state.correlations
      .filter((row) => {
        if (row.orgLinkId !== orgKey) return false;
        if (includeGrouped) return true;
        return row.mode !== "grouped";
      })
      .map((row) => ({ ...row }));
  }

  async function loadState() {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      return normalizeCorrelationState(JSON.parse(raw));
    } catch (error) {
      if (error?.code === "ENOENT") return normalizeCorrelationState({});
      throw error;
    }
  }

  async function saveState(state) {
    const folder = path.dirname(filePath);
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(normalizeCorrelationState(state), null, 2), "utf8");
  }
}

function normalizeCorrelationState(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    correlations: Array.isArray(src.correlations) ? src.correlations.map(normalizeAnyCorrelationRecord) : [],
    updatedAt: asTrimmedString(src.updatedAt) || new Date().toISOString(),
  };
}

function normalizeAnyCorrelationRecord(raw) {
  const mode = asTrimmedString(raw && raw.mode);
  if (mode === "grouped") return normalizeGroupedCorrelationRecord(raw);
  return normalizeCorrelationRecord(raw);
}

function normalizeCorrelationRecord(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    mode: "endpoint",
    orgLinkId: asTrimmedString(src.orgLinkId),
    endpointId: asTrimmedString(src.endpointId),
    signalType: asTrimmedString(src.signalType),
    haloTicketId: asTrimmedString(src.haloTicketId),
    payloadHash: toOptionalString(src.payloadHash),
    ticketStatusId: toOptionalString(src.ticketStatusId),
    ticketStatusName: toOptionalString(src.ticketStatusName),
    createdAt: asTrimmedString(src.createdAt),
    updatedAt: asTrimmedString(src.updatedAt),
  };
}

function normalizeGroupedCorrelationRecord(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const orgLinkId = asTrimmedString(src.orgLinkId);
  const signalType = asTrimmedString(src.signalType);
  const issueKey = asTrimmedString(src.issueKey);
  const identityKey = asTrimmedString(src.identityKey) || `${orgLinkId}|${signalType}|${issueKey}`;
  return {
    mode: "grouped",
    identityKey,
    orgLinkId,
    signalType,
    issueKey,
    linkedTicketId: asTrimmedString(src.linkedTicketId),
    payloadHash: toOptionalString(src.payloadHash),
    ticketStatusId: toOptionalString(src.ticketStatusId),
    ticketStatusName: toOptionalString(src.ticketStatusName),
    createdAt: asTrimmedString(src.createdAt),
    updatedAt: asTrimmedString(src.updatedAt),
  };
}

function toOptionalString(value) {
  const out = asTrimmedString(value);
  return out ? out : null;
}

function asTrimmedString(value) {
  return String(value || "").trim();
}

module.exports = {
  DEFAULT_CORRELATION_FILE_PATH,
  createFileCorrelationStore,
};
