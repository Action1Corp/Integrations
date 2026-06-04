// index.js
//
// Action1 Public Repository Material
//
// Use of this file is subject to TERMS_OF_USE.md (https://github.com/Action1Corp/PSAction1/blob/main/TERMS_OF_USE.md) in this repository.
// Provided AS IS, without warranties.
// Use at your own risk.
// Review, test, and validate before production use.
// © Action1 Corporation. All rights reserved.
module.exports = {
  api: {
    action1: require("./api/action1"),
    halo: require("./api/halo"),
  },
  core: {
    lifecycle: require("./core/lifecycle"),
    rules: require("./core/rules/signalQualification.contract"),
    types: {
      signals: require("./core/types/signals"),
      runSummary: require("./core/types/runSummary"),
    },
  },
  platform: {
    config: require("./platform/config"),
    db: require("./platform/db"),
    http: require("./platform/http"),
    logging: require("./platform/logging"),
    runtime: require("./platform/runtime"),
  },
  ui: require("./ui"),
};
