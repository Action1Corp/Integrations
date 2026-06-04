// index.js
//
// Action1 Public Repository Material
//
// Use of this file is subject to TERMS_OF_USE.md (https://github.com/Action1Corp/PSAction1/blob/main/TERMS_OF_USE.md) in this repository.
// Provided AS IS, without warranties.
// Use at your own risk.
// Review, test, and validate before production use.
// © Action1 Corporation. All rights reserved.
const { assertHaloAuthClient } = require("./haloAuthClient.contract");
const { assertHaloDiscoveryClient } = require("./haloDiscoveryClient.contract");
const { assertHaloTicketsClient } = require("./haloTicketsClient.contract");
const { createHaloAuthClient } = require("./haloAuthClient");
const { createHaloDiscoveryClient } = require("./haloDiscoveryClient");
const { createHaloTicketsClient } = require("./haloTicketsClient");
const { createHaloTicketsClientStub } = require("./haloTicketsClient.stub");

module.exports = {
  assertHaloAuthClient,
  assertHaloDiscoveryClient,
  assertHaloTicketsClient,
  createHaloAuthClient,
  createHaloDiscoveryClient,
  createHaloTicketsClient,
  createHaloTicketsClientStub,
};
