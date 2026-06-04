// index.js
//
// Action1 Public Repository Material
//
// Use of this file is subject to TERMS_OF_USE.md (https://github.com/Action1Corp/PSAction1/blob/main/TERMS_OF_USE.md) in this repository.
// Provided AS IS, without warranties.
// Use at your own risk.
// Review, test, and validate before production use.
// © Action1 Corporation. All rights reserved.
const {
  LOG_LEVELS,
  LOG_EVENT_TYPES,
  LOG_EVENT_TYPE_VALUES,
  LOG_LEVEL_VALUES,
  createRunLogEvent,
} = require("./logEventModel");
const { assertRunLogger, createInMemoryRunLogger } = require("./runLogger.contract");
const { createConsoleRunLogger, createFileRunLogger, createCompositeRunLogger, createNoopRunLogger, emitLog } = require("./logHelpers");

module.exports = {
  LOG_LEVELS,
  LOG_EVENT_TYPES,
  LOG_EVENT_TYPE_VALUES,
  LOG_LEVEL_VALUES,
  createRunLogEvent,
  assertRunLogger,
  createInMemoryRunLogger,
  createConsoleRunLogger,
  createFileRunLogger,
  createCompositeRunLogger,
  createNoopRunLogger,
  emitLog,
};
