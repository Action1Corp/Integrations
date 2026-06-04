// candidateIdentity.js
//
// Action1 Public Repository Material
//
// Use of this file is subject to TERMS_OF_USE.md (https://github.com/Action1Corp/PSAction1/blob/main/TERMS_OF_USE.md) in this repository.
// Provided AS IS, without warranties.
// Use at your own risk.
// Review, test, and validate before production use.
// © Action1 Corporation. All rights reserved.
const { SIGNAL_TYPE_VALUES } = require("../types/signals");

/**
 * Builds the locked v1 candidate identity.
 * Identity key contract: (orgLinkId, endpointId, signalType)
 *
 * @param {{orgLinkId: string, endpointId: string, signalType: string}} input
 */
function buildCandidateIdentity(input) {
  const orgLinkId = String(input?.orgLinkId || "").trim();
  const endpointId = String(input?.endpointId || "").trim();
  const signalType = normalizeSignalType(input?.signalType);
  const key = `${orgLinkId}|${endpointId}|${signalType}`;
  return {
    orgLinkId,
    endpointId,
    signalType,
    key,
  };
}

/**
 * @param {string} signalTypeRaw
 * @returns {string}
 */
function normalizeSignalType(signalTypeRaw) {
  const value = String(signalTypeRaw || "").trim().toUpperCase();
  return SIGNAL_TYPE_VALUES.includes(value) ? value : value;
}

module.exports = {
  buildCandidateIdentity,
};

