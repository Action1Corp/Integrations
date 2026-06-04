// correlationStore.memory.js
//
// Action1 Public Repository Material
//
// Use of this file is subject to TERMS_OF_USE.md (https://github.com/Action1Corp/PSAction1/blob/main/TERMS_OF_USE.md) in this repository.
// Provided AS IS, without warranties.
// Use at your own risk.
// Review, test, and validate before production use.
// © Action1 Corporation. All rights reserved.
function createInMemoryCorrelationStore() {
  const rows = new Map();

  return {
    async getCorrelation(orgLinkId, endpointId, signalType) {
      return rows.get(keyOf(orgLinkId, endpointId, signalType)) || null;
    },
    async upsertCorrelation(record) {
      rows.set(keyOf(record.orgLinkId, record.endpointId, record.signalType), {
        ...record,
      });
    },
    async deleteCorrelation(orgLinkId, endpointId, signalType) {
      rows.delete(keyOf(orgLinkId, endpointId, signalType));
    },
    async listCorrelationsByOrgLink(orgLinkId, opts = {}) {
      const includeGrouped = opts && opts.includeGrouped === true;
      const out = [];
      for (const row of rows.values()) {
        if (String(row.orgLinkId) === String(orgLinkId)) {
          if (!includeGrouped && row.mode === "grouped") continue;
          out.push({ ...row });
        }
      }
      return out;
    },
    async getGroupedCorrelation(orgLinkId, signalType, issueKey) {
      return rows.get(groupedKeyOf(orgLinkId, signalType, issueKey)) || null;
    },
    async upsertGroupedCorrelation(record) {
      const orgLinkId = String(record?.orgLinkId || "").trim();
      const signalType = String(record?.signalType || "").trim();
      const issueKey = String(record?.issueKey || "").trim();
      const identityKey = String(record?.identityKey || "").trim() || `${orgLinkId}|${signalType}|${issueKey}`;
      rows.set(groupedKeyOf(orgLinkId, signalType, issueKey), {
        mode: "grouped",
        identityKey,
        orgLinkId,
        signalType,
        issueKey,
        linkedTicketId: String(record?.linkedTicketId || "").trim(),
        payloadHash: record?.payloadHash == null ? null : String(record.payloadHash).trim() || null,
        ticketStatusId: record?.ticketStatusId == null ? null : String(record.ticketStatusId).trim() || null,
        ticketStatusName:
          record?.ticketStatusName == null ? null : String(record.ticketStatusName).trim() || null,
        createdAt: String(record?.createdAt || "").trim(),
        updatedAt: String(record?.updatedAt || "").trim(),
      });
    },
    async deleteGroupedCorrelation(orgLinkId, signalType, issueKey) {
      rows.delete(groupedKeyOf(orgLinkId, signalType, issueKey));
    },
    async listGroupedCorrelationsByOrgLink(orgLinkId) {
      const out = [];
      for (const row of rows.values()) {
        if (row.mode === "grouped" && String(row.orgLinkId) === String(orgLinkId)) {
          out.push({ ...row });
        }
      }
      return out;
    },
  };
}

function keyOf(orgLinkId, endpointId, signalType) {
  return `${String(orgLinkId)}|${String(endpointId)}|${String(signalType)}`;
}

function groupedKeyOf(orgLinkId, signalType, issueKey) {
  return `grouped|${String(orgLinkId)}|${String(signalType)}|${String(issueKey)}`;
}

module.exports = {
  createInMemoryCorrelationStore,
};
