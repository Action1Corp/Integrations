// configViewModel.js
//
// Action1 Public Repository Material
//
// Use of this file is subject to TERMS_OF_USE.md (https://github.com/Action1Corp/PSAction1/blob/main/TERMS_OF_USE.md) in this repository.
// Provided AS IS, without warranties.
// Use at your own risk.
// Review, test, and validate before production use.
// © Action1 Corporation. All rights reserved.
function deriveTicketDestinationChoices(discoveryPayload, ticketTypeDetail) {
  const discovery = discoveryPayload && typeof discoveryPayload === "object" ? discoveryPayload : {};
  const detail = ticketTypeDetail && typeof ticketTypeDetail === "object" ? ticketTypeDetail : null;

  const teams = asRows(discovery?.halo?.teams);
  const ticketTypes = asRows(discovery?.halo?.ticketTypes);
  const globalStatuses = asStatusRows(discovery?.halo?.statuses);
  const allowedStatuses = detail ? asStatusRows(detail.allowedStatuses) : [];
  const allowedCategories = detail ? asRows(detail.allowedCategories) : [];

  return {
    teams,
    ticketTypes,
    statuses: allowedStatuses.length > 0 ? allowedStatuses : globalStatuses,
    categories: allowedCategories,
  };
}

function asRows(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map((row) => ({
      id: String(row?.id || ""),
      name: String(row?.name || ""),
    }))
    .filter((row) => row.id && row.name);
}

function asStatusRows(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map((row) => ({
      id: String(row?.id || ""),
      name: String(row?.name || ""),
      isClosed: row?.isClosed === undefined ? undefined : Boolean(row.isClosed),
    }))
    .filter((row) => row.id && row.name);
}

module.exports = {
  deriveTicketDestinationChoices,
};
