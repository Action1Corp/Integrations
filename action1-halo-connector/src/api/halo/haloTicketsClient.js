// haloTicketsClient.js
//
// Action1 Public Repository Material
//
// Use of this file is subject to TERMS_OF_USE.md (https://github.com/Action1Corp/PSAction1/blob/main/TERMS_OF_USE.md) in this repository.
// Provided AS IS, without warranties.
// Use at your own risk.
// Review, test, and validate before production use.
// © Action1 Corporation. All rights reserved.
const { LOG_EVENT_TYPES, emitLog } = require("../../platform/logging");
const { createHaloAuthClient } = require("./haloAuthClient");

const HALO_CREATE_REJECTED_CODE = "halo_create_rejected";
const HALO_CREATE_REJECTED_MESSAGE =
  "Halo rejected ticket creation. Check Ticket Type / Status / Team / Category compatibility.";

/**
 * Stage 5 runtime ticket client.
 *
 * @param {{
 *  runLogger?: any,
 *  haloAuthClient?: { requestResource: Function },
 *  connectionProvider?: () => Promise<Object>|Object,
 * }} [opts]
 */
function createHaloTicketsClient(opts = {}) {
  const runLogger = opts.runLogger || null;
  const authClient =
    opts.haloAuthClient ||
    createHaloAuthClient({
      runLogger,
      connectionProvider: opts.connectionProvider,
    });

  return {
    createTicket,
    updateTicket,
    getTicket,
    setTicketStatus,
  };

  async function createTicket(payload) {
    const requestPayload = normalizeCreatePayload(payload);
    await emitLog({
      runLogger,
      runId: "halo-ticket-create",
      eventType: LOG_EVENT_TYPES.LIFECYCLE_DECISION,
      message: "Halo ticket create request started",
      context: {
        hasStatusId: Object.prototype.hasOwnProperty.call(requestPayload, "status_id"),
        hasTeamId: Object.prototype.hasOwnProperty.call(requestPayload, "team_id"),
        hasCategory1: Object.prototype.hasOwnProperty.call(requestPayload, "category_1"),
      },
    });

    let response;
    try {
      response = await authClient.requestResource({
        method: "POST",
        path: "/Tickets",
        body: [requestPayload],
        runId: "halo-ticket-create",
        maxAttempts: 1,
        timeoutMs: 60000,
      });
    } catch (error) {
      const typedError = toHaloCreateRejectedError(error);
      if (typedError) {
        await emitLog({
          runLogger,
          runId: "halo-ticket-create",
          level: "WARN",
          eventType: LOG_EVENT_TYPES.PARTIAL_FAILURE,
          message: "Halo ticket create request failed",
          context: {
            code: typedError.code,
            statusCode: typedError.statusCode || null,
            detail: typedError.safeDetail || typedError.message,
          },
        });
        throw typedError;
      }
      throw error;
    }
    const created = normalizeCreatedTicket(response?.data);

    await emitLog({
      runLogger,
      runId: "halo-ticket-create",
      eventType: LOG_EVENT_TYPES.LIFECYCLE_DECISION,
      message: "Halo ticket create request completed",
      context: {
        ticketId: created.id,
      },
    });

    return created;
  }

  async function updateTicket(ticketId, payload) {
    const id = asTrimmedString(ticketId);
    if (!id) throw new Error("halo_update_ticket_missing_ticket_id");
    const requestPayload = normalizeUpdatePayload(id, payload);
    await emitLog({
      runLogger,
      runId: "halo-ticket-update",
      eventType: LOG_EVENT_TYPES.LIFECYCLE_DECISION,
      message: "Halo ticket update request started",
      context: {
        ticketId: id,
      },
    });

    const response = await authClient.requestResource({
      method: "POST",
      path: "/Tickets",
      body: [requestPayload],
      runId: "halo-ticket-update",
    });
    const updated = normalizeCreatedTicket(response?.data);

    await emitLog({
      runLogger,
      runId: "halo-ticket-update",
      eventType: LOG_EVENT_TYPES.LIFECYCLE_DECISION,
      message: "Halo ticket update request completed",
      context: {
        ticketId: updated.id,
      },
    });

    return updated;
  }

  async function getTicket(ticketId) {
    const id = asTrimmedString(ticketId);
    if (!id) throw new Error("halo_get_ticket_missing_ticket_id");
    try {
      const response = await authClient.requestResource({
        method: "GET",
        path: `/Tickets/${encodeURIComponent(id)}`,
        runId: "halo-ticket-get",
      });
      return normalizeOptionalTicket(response?.data);
    } catch (error) {
      if (Number(error?.statusCode) === 404) return null;
      throw error;
    }
  }

  async function setTicketStatus(ticketId, statusId) {
    const id = asTrimmedString(ticketId);
    const status = asTrimmedString(statusId);
    if (!id) throw new Error("halo_set_status_missing_ticket_id");
    if (!status) throw new Error("halo_set_status_missing_status_id");
    const response = await authClient.requestResource({
      method: "POST",
      path: "/Tickets",
      body: [
        {
          id: toIdValue(id),
          status_id: toIdValue(status),
        },
      ],
      runId: "halo-ticket-status",
    });
    return normalizeCreatedTicket(response?.data);
  }
}

function normalizeCreatePayload(payload) {
  const source = payload && typeof payload === "object" ? payload : {};
  const summary = asTrimmedString(source.summary);
  const details = normalizeMultilineDetails(source.details);
  const detailsHtml = normalizeHtmlDetails(source.details_html);
  const clientId = source.client_id;
  const ticketTypeId = source.tickettype_id;
  if (!summary) throw new Error("halo_create_payload_missing_summary");
  if (!details) throw new Error("halo_create_payload_missing_details");
  if (clientId === undefined || clientId === null || String(clientId).trim() === "") {
    throw new Error("halo_create_payload_missing_client_id");
  }
  if (ticketTypeId === undefined || ticketTypeId === null || String(ticketTypeId).trim() === "") {
    throw new Error("halo_create_payload_missing_tickettype_id");
  }

  const out = {
    summary,
    details,
    client_id: clientId,
    tickettype_id: ticketTypeId,
  };
  if (detailsHtml) out.details_html = detailsHtml;

  if (source.status_id !== undefined && source.status_id !== null && String(source.status_id).trim() !== "") {
    out.status_id = source.status_id;
  }
  if (source.team_id !== undefined && source.team_id !== null && String(source.team_id).trim() !== "") {
    out.team_id = source.team_id;
  }
  if (source.category_1 !== undefined && source.category_1 !== null && String(source.category_1).trim() !== "") {
    out.category_1 = String(source.category_1).trim();
  }

  return out;
}

function normalizeUpdatePayload(ticketId, payload) {
  const base = normalizeCreatePayload(payload);
  return {
    id: toIdValue(ticketId),
    ...base,
  };
}

function normalizeCreatedTicket(data) {
  const row = Array.isArray(data) ? data[0] || {} : data && typeof data === "object" ? data : {};
  const id = firstString(row, ["id", "ticket_id"]);
  if (!id) {
    throw new Error("halo_create_ticket_response_missing_id");
  }
  const statusId = firstString(row, ["status_id", "statusid"]);
  const statusName = firstString(row, ["status", "status_name"]);
  const number = firstString(row, ["ticketnumber", "number", "ticket_number"]);
  const isClosedRaw = row?.is_closed ?? row?.isClosed ?? row?.closed;

  return {
    id,
    number,
    statusId,
    statusName,
    isClosed: isClosedRaw === undefined ? false : Boolean(isClosedRaw),
  };
}

function normalizeOptionalTicket(data) {
  if (data === null || data === undefined) return null;
  const row = Array.isArray(data) ? data[0] || {} : data && typeof data === "object" ? data : {};
  const id = firstString(row, ["id", "ticket_id"]);
  if (!id) return null;
  const statusId = firstString(row, ["status_id", "statusid"]);
  const statusName = firstString(row, ["status", "status_name"]);
  const number = firstString(row, ["ticketnumber", "number", "ticket_number"]);
  const isClosedRaw = row?.is_closed ?? row?.isClosed ?? row?.closed;
  return {
    id,
    number,
    statusId,
    statusName,
    isClosed: isClosedRaw === undefined ? false : Boolean(isClosedRaw),
  };
}

function toIdValue(value) {
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

function firstString(row, keys) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value);
    }
  }
  return "";
}

function asTrimmedString(value) {
  return String(value || "").trim();
}

function normalizeMultilineDetails(value) {
  const text = String(value || "");
  const trimmed = text.trim();
  if (!trimmed) return "";
  return trimmed.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n/g, "\r\n");
}

function normalizeHtmlDetails(value) {
  const text = String(value || "").trim();
  return text || "";
}

function toHaloCreateRejectedError(error) {
  const statusCode = Number(error?.statusCode || 0);
  if (!statusCode || statusCode < 400) return null;
  const requestUrl = String(error?.url || "");
  if (!/\/tickets(?:\?|$)/i.test(requestUrl)) return null;
  const typed = new Error(HALO_CREATE_REJECTED_MESSAGE);
  typed.code = HALO_CREATE_REJECTED_CODE;
  typed.statusCode = statusCode;
  typed.safeDetail = extractSafeHaloCreateDetail(error?.responsePayload);
  typed.cause = error;
  return typed;
}

function extractSafeHaloCreateDetail(responsePayload) {
  const candidates = [];
  collectSafeDetailCandidates(responsePayload, candidates);
  for (const candidate of candidates) {
    const detail = sanitizeHaloCreateDetail(candidate);
    if (detail) return detail;
  }
  return "";
}

function collectSafeDetailCandidates(value, out) {
  if (!value) return;
  if (typeof value === "string") {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const row of value) collectSafeDetailCandidates(row, out);
    return;
  }
  if (typeof value !== "object") {
    out.push(String(value));
    return;
  }
  for (const key of ["message", "error", "_warning", "warning", "details", "_raw"]) {
    if (value[key] !== undefined && value[key] !== null) {
      collectSafeDetailCandidates(value[key], out);
    }
  }
}

function sanitizeHaloCreateDetail(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const trailingPunctuationMatch = text.match(/[.!?]\s*$/);
  const segments = text
    .replace(/\r\n/g, "\n")
    .split(/[\n.!?]+/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .filter((segment) => !containsSecretLikeText(segment))
    .map((segment) => segment.replace(/\s+/g, " ").trim());
  const joined = segments.join(". ").trim();
  if (!joined) return "";
  const normalized =
    trailingPunctuationMatch && !/[.!?]$/.test(joined) ? `${joined}${trailingPunctuationMatch[0].trim()}` : joined;
  return normalized.length > 160 ? `${normalized.slice(0, 157).trimEnd()}...` : normalized;
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

module.exports = {
  createHaloTicketsClient,
  normalizeCreatePayload,
  normalizeUpdatePayload,
  normalizeCreatedTicket,
  normalizeOptionalTicket,
};
