// url.js
//
// Action1 Public Repository Material
//
// Use of this file is subject to TERMS_OF_USE.md (https://github.com/Action1Corp/PSAction1/blob/main/TERMS_OF_USE.md) in this repository.
// Provided AS IS, without warranties.
// Use at your own risk.
// Review, test, and validate before production use.
// © Action1 Corporation. All rights reserved.
function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function trimLeadingSlash(value) {
  return String(value || "").replace(/^\/+/, "");
}

function joinUrl(baseUrl, path) {
  const base = trimTrailingSlash(baseUrl);
  const nextPath = trimLeadingSlash(path);
  return `${base}/${nextPath}`;
}

function appendQuery(url, query) {
  const u = new URL(String(url));
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === "") continue;
    u.searchParams.set(String(key), String(value));
  }
  return u.toString();
}

function toAbsoluteUrl(baseUrl, maybeAbsoluteOrRelative) {
  const value = String(maybeAbsoluteOrRelative || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  const base = new URL(String(baseUrl || ""));
  return new URL(value, `${base.protocol}//${base.host}`).toString();
}

function ensureUrl(value, name) {
  try {
    const next = String(value || "").trim();
    if (!next) throw new Error();
    return new URL(next).toString();
  } catch (_) {
    throw new Error(`${name} must be a valid absolute URL`);
  }
}

module.exports = {
  appendQuery,
  ensureUrl,
  joinUrl,
  toAbsoluteUrl,
  trimLeadingSlash,
  trimTrailingSlash,
};
