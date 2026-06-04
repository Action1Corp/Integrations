// runSummary.js
//
// Action1 Public Repository Material
//
// Use of this file is subject to TERMS_OF_USE.md (https://github.com/Action1Corp/PSAction1/blob/main/TERMS_OF_USE.md) in this repository.
// Provided AS IS, without warranties.
// Use at your own risk.
// Review, test, and validate before production use.
// © Action1 Corporation. All rights reserved.
/**
 * @typedef {Object} RunSummaryCounters
 * @property {number} created
 * @property {number} updated
 * @property {number} closed
 * @property {number} skipped
 * @property {number} failed
 */

/**
 * @typedef {Object} RunSummary
 * @property {string} runId
 * @property {string} startedAt
 * @property {string|null} finishedAt
 * @property {"running"|"completed"|"completed_with_errors"|"failed"} outcome
 * @property {RunSummaryCounters} counters
 * @property {Array<{code: string, message: string, context?: Object}>} errors
 * @property {Array<{code: string, message: string, context?: Object}>} partialFailures
 */

/**
 * @param {string} runId
 * @returns {RunSummary}
 */
function createEmptyRunSummary(runId) {
  return {
    runId: String(runId),
    startedAt: new Date().toISOString(),
    finishedAt: null,
    outcome: "running",
    counters: {
      created: 0,
      updated: 0,
      closed: 0,
      skipped: 0,
      failed: 0,
    },
    errors: [],
    partialFailures: [],
  };
}

module.exports = {
  createEmptyRunSummary,
};
