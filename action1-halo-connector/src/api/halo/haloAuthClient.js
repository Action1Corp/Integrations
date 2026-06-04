// haloAuthClient.js
//
// Action1 Public Repository Material
//
// Use of this file is subject to TERMS_OF_USE.md (https://github.com/Action1Corp/PSAction1/blob/main/TERMS_OF_USE.md) in this repository.
// Provided AS IS, without warranties.
// Use at your own risk.
// Review, test, and validate before production use.
// © Action1 Corporation. All rights reserved.
const { LOG_EVENT_TYPES, emitLog } = require("../../platform/logging");
const { createRollingWindowRateLimiter, createSafeHttpClient, joinUrl } = require("../../platform/http");
const { haloConnectionCacheKey, normalizeHaloConnection, tokenUrlFromConnection } = require("./haloConnection");

const TOKEN_REUSE_SAFETY_MARGIN_MS = 60 * 1000;

/**
 * @param {{
 *  runLogger?: any,
 *  httpClient?: {requestJson: Function},
 *  now?: () => number,
 *  connectionProvider?: () => Promise<Object>|Object,
 }} [opts]
 */
function createHaloAuthClient(opts = {}) {
  const runLogger = opts.runLogger || null;
  const now = typeof opts.now === "function" ? opts.now : Date.now;
  const httpClient =
    opts.httpClient ||
    createSafeHttpClient({
      name: "halo",
      runLogger,
      now,
    });
  const connectionProvider = opts.connectionProvider || null;

  /** @type {Map<string, {accessToken: string, expiresAtMs: number, tokenType: string}>} */
  const tokenCache = new Map();
  /** @type {Map<string, {waitIfNeeded: Function, observeResponse: Function}>} */
  const rateLimiters = new Map();

  return {
    testConnection,
    getAccessToken,
    // used by discovery client and runtime
    requestResource,
  };

  /**
   * @param {Object} connectionInput
   * @returns {Promise<{ok: boolean, statusCode?: number, message?: string}>}
   */
  async function testConnection(connectionInput) {
    const runId = "connection-test-halo";
    await emitLog({
      runLogger,
      runId,
      eventType: LOG_EVENT_TYPES.CONNECTION_TEST,
      message: "Halo connection test started",
    });

    try {
      const connection = await resolveConnection(connectionInput);
      await getAccessToken(connection, runId);
      await requestResource({
        connection,
        method: "GET",
        path: "/Team?$top=1",
        runId,
      });

      await emitLog({
        runLogger,
        runId,
        eventType: LOG_EVENT_TYPES.CONNECTION_TEST,
        message: "Halo connection test succeeded",
      });

      return { ok: true, message: "Halo connection succeeded" };
    } catch (error) {
      await emitLog({
        runLogger,
        runId,
        level: "ERROR",
        eventType: LOG_EVENT_TYPES.PARTIAL_FAILURE,
        message: "Halo connection test failed",
        context: {
          statusCode: error?.statusCode || null,
          code: error?.code || null,
          detail: error?.message || "unknown error",
        },
      });
      return {
        ok: false,
        statusCode: error?.statusCode || null,
        message: error?.message || "Halo connection test failed",
      };
    }
  }

  /**
   * @param {Object} connectionInput
   * @param {string} [runId]
   * @returns {Promise<{accessToken: string, expiresInSeconds: number, tokenType: string}>}
   */
  async function getAccessToken(connectionInput, runId = "halo-auth") {
    const connection = await resolveConnection(connectionInput);
    const cacheKey = haloConnectionCacheKey(connection);
    const cached = tokenCache.get(cacheKey);
    const current = now();
    if (cached && current < cached.expiresAtMs - TOKEN_REUSE_SAFETY_MARGIN_MS) {
      return {
        accessToken: cached.accessToken,
        expiresInSeconds: Math.max(1, Math.floor((cached.expiresAtMs - current) / 1000)),
        tokenType: cached.tokenType || "Bearer",
      };
    }

    await emitLog({
      runLogger,
      runId,
      eventType: LOG_EVENT_TYPES.CONNECTION_TEST,
      message: "Halo token fetch started",
      context: {
        authorisationServer: connection.authorisationServer,
        tenant: connection.tenant || null,
      },
    });

    const response = await httpClient.requestJson({
      method: "POST",
      url: tokenUrlFromConnection(connection),
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: toTokenBody(connection),
      runId,
    });

    const payload = response.data && typeof response.data === "object" ? response.data : {};
    const accessToken = String(payload.access_token || "").trim();
    if (!accessToken) {
      throw new Error("Halo token response did not include access_token");
    }

    const tokenType = String(payload.token_type || "Bearer");
    const expiresInRaw = Number(payload.expires_in);
    const expiresInSeconds = Number.isFinite(expiresInRaw) && expiresInRaw > 0 ? Math.floor(expiresInRaw) : 3600;
    tokenCache.set(cacheKey, {
      accessToken,
      expiresAtMs: now() + expiresInSeconds * 1000,
      tokenType,
    });

    await emitLog({
      runLogger,
      runId,
      eventType: LOG_EVENT_TYPES.CONNECTION_TEST,
      message: "Halo token fetch succeeded",
      context: {
        expiresInSeconds,
      },
    });

    return {
      accessToken,
      expiresInSeconds,
      tokenType,
    };
  }

  /**
   * @param {{
   *  connection?: Object,
   *  method?: string,
   *  path: string,
   *  headers?: Record<string, string>,
   *  body?: unknown,
   *  maxAttempts?: number,
   *  timeoutMs?: number,
   *  runId?: string,
   * }} request
   */
  async function requestResource(request) {
    const connection = await resolveConnection(request.connection);
    const token = await getAccessToken(connection, request.runId || "halo-resource");
    const cacheKey = haloConnectionCacheKey(connection);
    const limiter = getRateLimiter(cacheKey);
    const nextPath = String(request.path || "");
    if (!nextPath) {
      throw new Error("Halo resource path is required");
    }

    const resourceUrl = nextPath.startsWith("http://") || nextPath.startsWith("https://")
      ? nextPath
      : joinUrl(connection.resourceServer, nextPath);

    const headers = {
      Authorization: `${token.tokenType || "Bearer"} ${token.accessToken}`,
      ...(request.headers || {}),
    };
    if (connection.tenant) {
      headers["x-tenant"] = connection.tenant;
    }

    return httpClient.requestJson({
      method: request.method || "GET",
      url: resourceUrl,
      headers,
      body: request.body,
      maxAttempts: request.maxAttempts,
      timeoutMs: request.timeoutMs,
      runId: request.runId || "halo-resource",
      rateLimiter: limiter,
    });
  }

  function getRateLimiter(cacheKey) {
    const existing = rateLimiters.get(cacheKey);
    if (existing) return existing;
    const created = createRollingWindowRateLimiter({
      limit: 700,
      windowMs: 300000,
      now,
    });
    rateLimiters.set(cacheKey, created);
    return created;
  }

  async function resolveConnection(connectionInput) {
    const raw =
      connectionInput ||
      (typeof connectionProvider === "function" ? await connectionProvider() : connectionProvider) ||
      null;
    return normalizeHaloConnection(raw);
  }
}

function toTokenBody(connection) {
  const params = new URLSearchParams();
  params.set("grant_type", "client_credentials");
  params.set("client_id", connection.clientId);
  params.set("client_secret", connection.clientSecret);
  params.set("scope", "all");
  if (connection.tenant) {
    params.set("tenant", connection.tenant);
  }
  return params.toString();
}

module.exports = {
  createHaloAuthClient,
};
