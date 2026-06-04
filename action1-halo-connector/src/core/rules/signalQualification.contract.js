// signalQualification.contract.js
//
// Action1 Public Repository Material
//
// Use of this file is subject to TERMS_OF_USE.md (https://github.com/Action1Corp/PSAction1/blob/main/TERMS_OF_USE.md) in this repository.
// Provided AS IS, without warranties.
// Use at your own risk.
// Review, test, and validate before production use.
// © Action1 Corporation. All rights reserved.
const { SIGNAL_TYPE_VALUES } = require("../types/signals");
const { qualifyEndpointSignals } = require("./signalQualification");

/**
 * @typedef {Object} SignalQualificationInput
 * @property {string} action1OrgId
 * @property {Object} endpoint
 * @property {Object} signalFilters
 */

/**
 * @typedef {Object} SignalQualificationResult
 * @property {string} signalType
 * @property {boolean} qualifies
 * @property {string} reason
 * @property {Object} payloadContext
 */

/**
 * @typedef {Object} SignalQualifier
 * @property {(input: SignalQualificationInput) => Promise<SignalQualificationResult[]>} qualifySignals
 */

/**
 * @param {SignalQualifier} qualifier
 * @returns {SignalQualifier}
 */
function assertSignalQualifier(qualifier) {
  if (!qualifier || typeof qualifier !== "object") {
    throw new Error("SignalQualifier contract requires an object");
  }
  if (typeof qualifier.qualifySignals !== "function") {
    throw new Error("SignalQualifier contract missing qualifySignals(input)");
  }
  return qualifier;
}

/**
 * Stage-1 placeholder. Implementation is intentionally deferred.
 *
 * @returns {SignalQualifier}
 */
function createUnimplementedSignalQualifier() {
  return {
    async qualifySignals(input) {
      const results = qualifyEndpointSignals({
        config: {
          signalFilters: input?.signalFilters || {},
        },
        endpoint: input?.endpoint || {},
        signals: input?.signals || {},
        now: input?.now,
      });

      return SIGNAL_TYPE_VALUES.map((signalType) => {
        const result = results.find((row) => row.signalType === signalType);
        if (!result) {
          return {
            signalType,
            qualifies: false,
            reason: "signal_not_present",
            payloadContext: {},
          };
        }
        return {
          signalType: result.signalType,
          qualifies: result.qualifies,
          reason: result.reason,
          payloadContext: {
            matchedCount: result.matchedCount,
            matchedItemsPreview: result.matchedItemsPreview,
            details: result.details,
          },
        };
      });
    },
  };
}

module.exports = {
  assertSignalQualifier,
  createUnimplementedSignalQualifier,
};
