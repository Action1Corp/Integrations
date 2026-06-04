// correlationStore.contract.js
//
// Action1 Public Repository Material
//
// Use of this file is subject to TERMS_OF_USE.md (https://github.com/Action1Corp/PSAction1/blob/main/TERMS_OF_USE.md) in this repository.
// Provided AS IS, without warranties.
// Use at your own risk.
// Review, test, and validate before production use.
// © Action1 Corporation. All rights reserved.
/**
 * Durable correlation key for v1:
 * (orgLinkId, endpointId, signalType) -> Halo ticket identity + payload hash.
 */

/**
 * @typedef {Object} TicketCorrelationRecord
 * @property {string} orgLinkId
 * @property {string} endpointId
 * @property {string} signalType
 * @property {string} haloTicketId
 * @property {string|null} payloadHash
 * @property {string|null} ticketStatusId
 * @property {string|null} ticketStatusName
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @typedef {Object} CorrelationStore
 * @property {(orgLinkId: string, endpointId: string, signalType: string) => Promise<TicketCorrelationRecord|null>} getCorrelation
 * @property {(record: TicketCorrelationRecord) => Promise<void>} upsertCorrelation
 * @property {(orgLinkId: string, endpointId: string, signalType: string) => Promise<void>} deleteCorrelation
 * @property {(orgLinkId: string) => Promise<TicketCorrelationRecord[]>} listCorrelationsByOrgLink
 */

const REQUIRED_METHODS = Object.freeze([
  "getCorrelation",
  "upsertCorrelation",
  "deleteCorrelation",
  "listCorrelationsByOrgLink",
]);

/**
 * @param {CorrelationStore} store
 * @returns {CorrelationStore}
 */
function assertCorrelationStore(store) {
  assertHasMethods("CorrelationStore", store, REQUIRED_METHODS);
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
  assertCorrelationStore,
};
