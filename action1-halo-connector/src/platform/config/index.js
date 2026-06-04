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
  CATEGORY_FIELDS_OUT_OF_SCOPE_V1,
  CONFIG_SCHEMA_VERSION,
  defaultConnectorConfig,
  normalizeConnectorConfig,
  validateConnectorConfig,
} = require("./configSchema");
const { assertConfigStore } = require("./configStore.contract");
const { DEFAULT_STATE_FILE_PATH, createFileConfigStore } = require("./fileConfigStore");

module.exports = {
  CATEGORY_FIELDS_OUT_OF_SCOPE_V1,
  CONFIG_SCHEMA_VERSION,
  defaultConnectorConfig,
  normalizeConnectorConfig,
  validateConnectorConfig,
  assertConfigStore,
  DEFAULT_STATE_FILE_PATH,
  createFileConfigStore,
};
