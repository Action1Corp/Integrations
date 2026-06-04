// haloTicketsClient.contract.js
//
// Action1 Public Repository Material
//
// Use of this file is subject to TERMS_OF_USE.md (https://github.com/Action1Corp/PSAction1/blob/main/TERMS_OF_USE.md) in this repository.
// Provided AS IS, without warranties.
// Use at your own risk.
// Review, test, and validate before production use.
// © Action1 Corporation. All rights reserved.
/**
 * @typedef {Object} HaloTicketPayload
 * @property {string} summary
 * @property {string} details
 * @property {string} teamId
 * @property {string} ticketTypeId
 * @property {string} category1Id
 * @property {string} statusId
 * @property {string} clientId
 * @property {string|null} siteId
 * @property {Object} metadata
 */

/**
 * @typedef {Object} HaloTicketRecord
 * @property {string} id
 * @property {string} number
 * @property {string} statusId
 * @property {string} statusName
 * @property {boolean} isClosed
 */

/**
 * @typedef {Object} HaloTicketsClient
 * @property {(payload: HaloTicketPayload) => Promise<HaloTicketRecord>} createTicket
 * @property {(ticketId: string, payload: Partial<HaloTicketPayload>) => Promise<HaloTicketRecord>} updateTicket
 * @property {(ticketId: string) => Promise<HaloTicketRecord|null>} getTicket
 * @property {(ticketId: string, statusId: string) => Promise<HaloTicketRecord>} setTicketStatus
 */

const REQUIRED_METHODS = Object.freeze(["createTicket", "updateTicket", "getTicket", "setTicketStatus"]);

/**
 * @param {HaloTicketsClient} client
 * @returns {HaloTicketsClient}
 */
function assertHaloTicketsClient(client) {
  assertHasMethods("HaloTicketsClient", client, REQUIRED_METHODS);
  return client;
}

/**
 * @param {string} name
 * @param {Object} value
 * @param {string[]} methods
 */
function assertHasMethods(name, value, methods) {
  if (!value || typeof value !== "object") {
    throw new Error(`${name} contract requires an object`);
  }
  for (const method of methods) {
    if (typeof value[method] !== "function") {
      throw new Error(`${name} contract missing ${method}()`);
    }
  }
}

module.exports = {
  REQUIRED_METHODS,
  assertHaloTicketsClient,
};
