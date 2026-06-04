// runLogger.contract.js
//
// Action1 Public Repository Material
//
// Use of this file is subject to TERMS_OF_USE.md (https://github.com/Action1Corp/PSAction1/blob/main/TERMS_OF_USE.md) in this repository.
// Provided AS IS, without warranties.
// Use at your own risk.
// Review, test, and validate before production use.
// © Action1 Corporation. All rights reserved.
const { createRunLogEvent } = require("./logEventModel");

/**
 * @typedef {Object} RunLogger
 * @property {(event: import("./logEventModel").RunLogEvent) => Promise<void>} emit
 * @property {(bindings: Object) => RunLogger} child
 */

const REQUIRED_METHODS = Object.freeze(["emit", "child"]);

/**
 * @param {RunLogger} logger
 * @returns {RunLogger}
 */
function assertRunLogger(logger) {
  assertHasMethods("RunLogger", logger, REQUIRED_METHODS);
  return logger;
}

/**
 * @param {Object} [initialBindings]
 * @returns {RunLogger}
 */
function createInMemoryRunLogger(initialBindings = {}) {
  const events = [];
  const bindings = { ...initialBindings };

  return {
    async emit(event) {
      const normalized = createRunLogEvent({
        ...event,
        context: {
          ...bindings,
          ...(event?.context || {}),
        },
      });
      events.push(normalized);
    },
    child(childBindings) {
      return createInMemoryRunLogger({
        ...bindings,
        ...(childBindings || {}),
      });
    },
    // non-contract helper, useful for tests/debug
    __events: events,
  };
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
  assertRunLogger,
  createInMemoryRunLogger,
};
