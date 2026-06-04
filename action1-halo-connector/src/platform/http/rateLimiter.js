// rateLimiter.js
//
// Action1 Public Repository Material
//
// Use of this file is subject to TERMS_OF_USE.md (https://github.com/Action1Corp/PSAction1/blob/main/TERMS_OF_USE.md) in this repository.
// Provided AS IS, without warranties.
// Use at your own risk.
// Review, test, and validate before production use.
// © Action1 Corporation. All rights reserved.
const { parseRetryAfterMs, sleepMs } = require("./safeHttpClient");

/**
 * Basic rolling-window limiter with 429 backoff awareness.
 * It is intentionally simple for Stage 2 and can be replaced later.
 *
 * @param {{limit?: number, windowMs?: number, now?: () => number, sleep?: (ms: number) => Promise<void>}} [opts]
 */
function createRollingWindowRateLimiter(opts = {}) {
  const limit = Number.isFinite(Number(opts.limit)) ? Math.max(1, Math.floor(Number(opts.limit))) : 700;
  const windowMs = Number.isFinite(Number(opts.windowMs)) ? Math.max(1, Math.floor(Number(opts.windowMs))) : 300000;
  const now = typeof opts.now === "function" ? opts.now : Date.now;
  const sleep = typeof opts.sleep === "function" ? opts.sleep : sleepMs;

  let windowStartedAt = now();
  let requestCount = 0;
  let blockedUntil = 0;

  return {
    async waitIfNeeded() {
      const current = now();
      const waitMs = blockedUntil > current ? blockedUntil - current : 0;
      if (waitMs > 0) {
        await sleep(waitMs);
      }

      const afterWait = now();
      if (afterWait - windowStartedAt >= windowMs) {
        windowStartedAt = afterWait;
        requestCount = 0;
      }

      if (requestCount >= limit) {
        const localBlockMs = windowMs - (afterWait - windowStartedAt);
        if (localBlockMs > 0) {
          blockedUntil = afterWait + localBlockMs;
          await sleep(localBlockMs);
          windowStartedAt = now();
          requestCount = 0;
        }
      }
    },
    observeResponse({ statusCode, headers }) {
      requestCount += 1;
      const current = now();
      if (current - windowStartedAt >= windowMs) {
        windowStartedAt = current;
        requestCount = 1;
      }

      if (Number(statusCode) === 429) {
        const retryAfterMs = parseRetryAfterMs(headers?.["retry-after"], current);
        if (retryAfterMs !== null) {
          blockedUntil = Math.max(blockedUntil, current + retryAfterMs);
        } else {
          blockedUntil = Math.max(blockedUntil, current + 1000);
        }
      }
    },
  };
}

module.exports = {
  createRollingWindowRateLimiter,
};
