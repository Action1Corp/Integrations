// ticketPayloadBuilder.js
//
// Action1 Public Repository Material
//
// Use of this file is subject to TERMS_OF_USE.md (https://github.com/Action1Corp/PSAction1/blob/main/TERMS_OF_USE.md) in this repository.
// Provided AS IS, without warranties.
// Use at your own risk.
// Review, test, and validate before production use.
// © Action1 Corporation. All rights reserved.
/**
 * Build Stage 5 create-ticket payload using Stage 4 candidate routing context.
 *
 * Required fields:
 * - summary
 * - details
 * - client_id
 * - tickettype_id
 *
 * Optional overrides (omit when blank):
 * - status_id
 * - team_id
 * - category_1 (resolved from category1Id -> category string)
 */
function buildHaloCreateTicketPayload(input) {
  const candidate = input?.candidate && typeof input.candidate === "object" ? input.candidate : {};
  const routing = candidate.routing && typeof candidate.routing === "object" ? candidate.routing : {};
  const summary = asTrimmedString(input?.summary);
  const details = asTrimmedString(input?.details);
  const detailsHtml = asTrimmedString(input?.detailsHtml);
  const clientId = asTrimmedString(routing.haloClientId);
  const ticketTypeId = asTrimmedString(routing.ticketTypeId);

  if (!summary) throw new Error("create_ticket_payload_missing_summary");
  if (!details) throw new Error("create_ticket_payload_missing_details");
  if (!clientId) throw new Error("create_ticket_payload_missing_client_id");
  if (!ticketTypeId) throw new Error("create_ticket_payload_missing_tickettype_id");

  const out = {
    summary,
    details,
    client_id: toIdValue(clientId),
    tickettype_id: toIdValue(ticketTypeId),
  };
  if (detailsHtml) out.details_html = detailsHtml;

  const statusId = asTrimmedString(routing.newStatusId);
  if (statusId) out.status_id = toIdValue(statusId);

  const teamId = asTrimmedString(routing.teamId);
  if (teamId) out.team_id = toIdValue(teamId);

  const category1Id = asTrimmedString(routing.category1Id);
  if (category1Id) {
    out.category_1 = resolveCategory1String({
      category1Id,
      categories: input?.categories,
    });
  }

  return out;
}

function resolveCategory1String(input) {
  const category1Id = asTrimmedString(input?.category1Id);
  const categories = Array.isArray(input?.categories) ? input.categories : [];
  const match = categories.find((row) => asTrimmedString(row?.id) === category1Id);
  if (!match) {
    throw new Error("create_ticket_payload_unresolved_category1_id");
  }

  const categoryValue =
    asTrimmedString(match?.value) || asTrimmedString(match?.name) || asTrimmedString(match?.label);
  if (!categoryValue) {
    throw new Error("create_ticket_payload_invalid_category1_value");
  }
  return categoryValue;
}

function toIdValue(value) {
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

function asTrimmedString(value) {
  return String(value || "").trim();
}

module.exports = {
  buildHaloCreateTicketPayload,
  resolveCategory1String,
};
