// action1Client.contract.js
//
// Action1 Public Repository Material
//
// Use of this file is subject to TERMS_OF_USE.md (https://github.com/Action1Corp/PSAction1/blob/main/TERMS_OF_USE.md) in this repository.
// Provided AS IS, without warranties.
// Use at your own risk.
// Review, test, and validate before production use.
// © Action1 Corporation. All rights reserved.
/**
 * @typedef {Object} Action1Connection
 * @property {string} baseUrl
 * @property {string} clientId
 * @property {string} clientSecretRef
 * @property {string} [clientSecret]
 */

/**
 * @typedef {Object} Action1Client
 * @property {(connection: Action1Connection) => Promise<{ok: boolean, statusCode?: number, message?: string}>} testConnection
 * @property {() => Promise<Array<{id: string, name: string}>>} listOrganizations
 * @property {(orgId: string) => Promise<Array<{id: string, name: string, lastSeenAt?: string, rebootRequired?: boolean}>>} listEndpoints
 * @property {(orgId: string, endpointId: string) => Promise<Object>} collectEndpointSignals
 */

const REQUIRED_METHODS = Object.freeze([
  "testConnection",
  "listOrganizations",
  "listEndpoints",
  "collectEndpointSignals",
]);

/**
 * @param {Action1Client} client
 * @returns {Action1Client}
 */
function assertAction1Client(client) {
  assertHasMethods("Action1Client", client, REQUIRED_METHODS);
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
  assertAction1Client,
};
