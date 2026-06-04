// haloDiscoveryClient.contract.js
//
// Action1 Public Repository Material
//
// Use of this file is subject to TERMS_OF_USE.md (https://github.com/Action1Corp/PSAction1/blob/main/TERMS_OF_USE.md) in this repository.
// Provided AS IS, without warranties.
// Use at your own risk.
// Review, test, and validate before production use.
// © Action1 Corporation. All rights reserved.
/**
 * Halo discovery endpoints needed by the v1 UI:
 * Team, Ticket Type, Status, Client, and optional Site.
 *
 * Ticket type details must support:
 * - allowed_status
 * - allowed_category
 */

/**
 * @typedef {Object} HaloDiscoveryClient
 * @property {() => Promise<Array<{id: string, name: string}>>} listTeams
 * @property {() => Promise<Array<{id: string, name: string}>>} listTicketTypes
 * @property {(ticketTypeId: string) => Promise<{id: string, name: string, allowedStatuses: Array<{id: string, name: string}>, allowedCategories: Array<{id: string, name: string}>}>} getTicketTypeDetails
 * @property {() => Promise<Array<{id: string, name: string, isClosed?: boolean}>>} listStatuses
 * @property {() => Promise<Array<{id: string, name: string}>>} listClients
 * @property {() => Promise<Array<{id: string, name: string, clientId: string}>>} listSites
 */

const REQUIRED_METHODS = Object.freeze([
  "listTeams",
  "listTicketTypes",
  "getTicketTypeDetails",
  "listStatuses",
  "listClients",
  "listSites",
]);

/**
 * @param {HaloDiscoveryClient} client
 * @returns {HaloDiscoveryClient}
 */
function assertHaloDiscoveryClient(client) {
  assertHasMethods("HaloDiscoveryClient", client, REQUIRED_METHODS);
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
  assertHaloDiscoveryClient,
};
