// haloConnection.js
//
// Action1 Public Repository Material
//
// Use of this file is subject to TERMS_OF_USE.md (https://github.com/Action1Corp/PSAction1/blob/main/TERMS_OF_USE.md) in this repository.
// Provided AS IS, without warranties.
// Use at your own risk.
// Review, test, and validate before production use.
// © Action1 Corporation. All rights reserved.
const { ensureUrl, joinUrl, trimTrailingSlash } = require("../../platform/http");

function normalizeHaloConnection(raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error("Halo connection is not configured");
  }

  const resourceServerRaw = raw.resourceServer || raw.baseUrl || "";
  const authorisationServerRaw =
    raw.authorisationServer || deriveAuthServerFromTokenUrl(raw.tokenUrl) || deriveAuthServerFromResource(resourceServerRaw) || "";

  const resourceServer = ensureUrl(ensureApiSuffix(resourceServerRaw), "Halo resourceServer");
  const authorisationServer = ensureUrl(authorisationServerRaw, "Halo authorisationServer");
  const tenant = String(raw.tenant || "").trim();
  const clientId = String(raw.clientId || "").trim();
  const clientSecret = String(raw.clientSecret || "").trim();

  if (!clientId) throw new Error("Halo clientId is required");
  if (!clientSecret) throw new Error("Halo clientSecret is required");

  return {
    resourceServer,
    authorisationServer,
    tenant,
    clientId,
    clientSecret,
  };
}

function haloConnectionCacheKey(connection) {
  return [
    trimTrailingSlash(connection.resourceServer),
    trimTrailingSlash(connection.authorisationServer),
    connection.tenant || "",
    connection.clientId,
    connection.clientSecret,
  ].join("|");
}

function tokenUrlFromConnection(connection) {
  return joinUrl(connection.authorisationServer, "/token");
}

function ensureApiSuffix(resourceServerRaw) {
  const trimmed = trimTrailingSlash(String(resourceServerRaw || ""));
  if (!trimmed) return trimmed;
  if (/\/api$/i.test(trimmed)) return trimmed;
  return `${trimmed}/api`;
}

function deriveAuthServerFromResource(resourceServerRaw) {
  const trimmed = trimTrailingSlash(String(resourceServerRaw || ""));
  if (!trimmed) return "";
  if (/\/api$/i.test(trimmed)) {
    return `${trimmed.replace(/\/api$/i, "")}/auth`;
  }
  return `${trimmed}/auth`;
}

function deriveAuthServerFromTokenUrl(tokenUrlRaw) {
  const trimmed = trimTrailingSlash(String(tokenUrlRaw || ""));
  if (!trimmed) return "";
  return trimmed.replace(/\/token$/i, "");
}

module.exports = {
  haloConnectionCacheKey,
  normalizeHaloConnection,
  tokenUrlFromConnection,
};
