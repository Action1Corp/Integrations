// haloAuthClient.contract.js
//
// Action1 Public Repository Material
//
// Use of this file is subject to TERMS_OF_USE.md (https://github.com/Action1Corp/PSAction1/blob/main/TERMS_OF_USE.md) in this repository.
// Provided AS IS, without warranties.
// Use at your own risk.
// Review, test, and validate before production use.
// © Action1 Corporation. All rights reserved.
/**
 * @typedef {Object} HaloConnection
 * @property {string} resourceServer
 * @property {string} authorisationServer
 * @property {string} tenant
 * @property {string} clientId
 * @property {string} clientSecretRef
 * @property {string} [clientSecret]
 * @property {string} [baseUrl]
 * @property {string} [tokenUrl]
 */

/**
 * @typedef {Object} HaloAccessToken
 * @property {string} accessToken
 * @property {number} expiresInSeconds
 * @property {string} tokenType
 */

/**
 * @typedef {Object} HaloAuthClient
 * @property {(connection: HaloConnection) => Promise<{ok: boolean, statusCode?: number, message?: string}>} testConnection
 * @property {(connection: HaloConnection) => Promise<HaloAccessToken>} getAccessToken
 */

const REQUIRED_METHODS = Object.freeze(["testConnection", "getAccessToken"]);

/**
 * @param {HaloAuthClient} client
 * @returns {HaloAuthClient}
 */
function assertHaloAuthClient(client) {
  assertHasMethods("HaloAuthClient", client, REQUIRED_METHODS);
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
  assertHaloAuthClient,
};
