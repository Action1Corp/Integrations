// logEventModel.js
//
// Action1 Public Repository Material
//
// Use of this file is subject to TERMS_OF_USE.md (https://github.com/Action1Corp/PSAction1/blob/main/TERMS_OF_USE.md) in this repository.
// Provided AS IS, without warranties.
// Use at your own risk.
// Review, test, and validate before production use.
// © Action1 Corporation. All rights reserved.
const LOG_LEVELS = Object.freeze({
  DEBUG: "DEBUG",
  INFO: "INFO",
  WARN: "WARN",
  ERROR: "ERROR",
});

const LOG_EVENT_TYPES = Object.freeze({
  RUN_START: "RUN_START",
  RUN_END: "RUN_END",
  CONNECTION_TEST: "CONNECTION_TEST",
  DISCOVERY_FETCH: "DISCOVERY_FETCH",
  LIFECYCLE_DECISION: "LIFECYCLE_DECISION",
  TICKET_OPERATION: "TICKET_OPERATION",
  RETRY: "RETRY",
  SKIP: "SKIP",
  PROVISIONING_ACTION: "PROVISIONING_ACTION",
  PARTIAL_FAILURE: "PARTIAL_FAILURE",
});

const LOG_EVENT_TYPE_VALUES = Object.freeze(Object.values(LOG_EVENT_TYPES));
const LOG_LEVEL_VALUES = Object.freeze(Object.values(LOG_LEVELS));

/**
 * @typedef {Object} RunLogEvent
 * @property {string} timestamp
 * @property {string} runId
 * @property {"DEBUG"|"INFO"|"WARN"|"ERROR"} level
 * @property {string} eventType
 * @property {string} message
 * @property {Object} context
 */

/**
 * @param {Partial<RunLogEvent> & {runId: string, eventType: string, message: string}} input
 * @returns {RunLogEvent}
 */
function createRunLogEvent(input) {
  const level = LOG_LEVEL_VALUES.includes(input.level) ? input.level : LOG_LEVELS.INFO;
  const eventType = LOG_EVENT_TYPE_VALUES.includes(input.eventType) ? input.eventType : LOG_EVENT_TYPES.PARTIAL_FAILURE;
  return {
    timestamp: input.timestamp || new Date().toISOString(),
    runId: String(input.runId),
    level,
    eventType,
    message: String(input.message),
    context: input.context && typeof input.context === "object" ? input.context : {},
  };
}

module.exports = {
  LOG_LEVELS,
  LOG_EVENT_TYPES,
  LOG_EVENT_TYPE_VALUES,
  LOG_LEVEL_VALUES,
  createRunLogEvent,
};
