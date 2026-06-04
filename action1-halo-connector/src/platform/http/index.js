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
  DEFAULT_BASE_RETRY_DELAY_MS,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_MAX_RETRY_DELAY_MS,
  DEFAULT_TIMEOUT_MS,
  createSafeHttpClient,
  parseRetryAfterMs,
  sleepMs,
} = require("./safeHttpClient");
const { createRollingWindowRateLimiter } = require("./rateLimiter");
const { appendQuery, ensureUrl, joinUrl, toAbsoluteUrl, trimLeadingSlash, trimTrailingSlash } = require("./url");

module.exports = {
  DEFAULT_BASE_RETRY_DELAY_MS,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_MAX_RETRY_DELAY_MS,
  DEFAULT_TIMEOUT_MS,
  appendQuery,
  createRollingWindowRateLimiter,
  createSafeHttpClient,
  ensureUrl,
  joinUrl,
  parseRetryAfterMs,
  sleepMs,
  toAbsoluteUrl,
  trimLeadingSlash,
  trimTrailingSlash,
};
