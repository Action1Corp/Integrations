// configStore.contract.js
//
// Action1 Public Repository Material
//
// Use of this file is subject to TERMS_OF_USE.md (https://github.com/Action1Corp/PSAction1/blob/main/TERMS_OF_USE.md) in this repository.
// Provided AS IS, without warranties.
// Use at your own risk.
// Review, test, and validate before production use.
// © Action1 Corporation. All rights reserved.
/**
 * @typedef {Object} ConfigStore
 * @property {() => Promise<Object>} loadConnectorConfig
 * @property {(config: Object) => Promise<void>} saveConnectorConfig
 * @property {() => Promise<{action1ClientSecret?: string, haloClientSecret?: string}>} loadConnectionSecrets
 * @property {(secrets: {action1ClientSecret?: string, haloClientSecret?: string}) => Promise<void>} saveConnectionSecrets
 */

const REQUIRED_METHODS = Object.freeze([
  "loadConnectorConfig",
  "saveConnectorConfig",
  "loadConnectionSecrets",
  "saveConnectionSecrets",
]);

/**
 * @param {ConfigStore} store
 * @returns {ConfigStore}
 */
function assertConfigStore(store) {
  assertHasMethods("ConfigStore", store, REQUIRED_METHODS);
  return store;
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
  assertConfigStore,
};
