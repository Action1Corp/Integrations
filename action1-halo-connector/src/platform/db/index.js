// index.js
//
// Action1 Public Repository Material
//
// Use of this file is subject to TERMS_OF_USE.md (https://github.com/Action1Corp/PSAction1/blob/main/TERMS_OF_USE.md) in this repository.
// Provided AS IS, without warranties.
// Use at your own risk.
// Review, test, and validate before production use.
// © Action1 Corporation. All rights reserved.
const { assertCorrelationStore } = require("./correlationStore.contract");
const { createInMemoryCorrelationStore } = require("./correlationStore.memory");
const { DEFAULT_CORRELATION_FILE_PATH, createFileCorrelationStore } = require("./correlationStore.file");
const {
  SQLITE_SCHEMA_VERSION,
  SQLITE_SCHEMA_TABLES,
  SQLITE_CREATE_TABLE_STATEMENTS,
  SQLITE_SCHEMA_NOTES,
} = require("./sqliteSchemaPlan");

module.exports = {
  assertCorrelationStore,
  createInMemoryCorrelationStore,
  DEFAULT_CORRELATION_FILE_PATH,
  createFileCorrelationStore,
  SQLITE_SCHEMA_VERSION,
  SQLITE_SCHEMA_TABLES,
  SQLITE_CREATE_TABLE_STATEMENTS,
  SQLITE_SCHEMA_NOTES,
};
