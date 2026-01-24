// action1/action1Client.js
// Action1 API client using OAuth2 client credentials.
// This module only talks to Action1 API. No mapping or sync logic here.

function joinUrl(baseUrl, path) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const p = String(path || '').replace(/^\/+/, '');
  return `${base}/${p}`;
}

function getOrigin(baseUrl) {
  const u = new URL(baseUrl);
  return `${u.protocol}//${u.host}`;
}

function absolutizeUrl(apiBaseUrl, maybeRelativeUrl) {
  if (!maybeRelativeUrl) return null;

  const s = String(maybeRelativeUrl);
  if (s.startsWith('http://') || s.startsWith('https://')) return s;

  // Action1 may return next_page like "/API/...."
  return joinUrl(getOrigin(apiBaseUrl), s);
}

async function readJson(res) {
  const text = await res.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text };
  }
}

function requireAction1Config(action1) {
  if (!action1) throw new Error('Action1 config is missing');
  if (!action1.apiBaseUrl) throw new Error('Action1 config missing: action1.apiBaseUrl');
  if (!action1.clientId) throw new Error('Action1 config missing: action1.clientId');
  if (!action1.clientSecret) throw new Error('Action1 config missing: action1.clientSecret');
}

/* ------------------------- small debug helpers ------------------------- */
function nowMs() {
  return Date.now();
}
function msSince(t0) {
  return Date.now() - t0;
}
function safeJsonStringify(obj) {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return '[unserializable]';
  }
}
/* ---------------------------------------------------------------------- */

async function httpJson(url, { method = 'GET', headers = {}, body = undefined }, logger) {
  // Debug: show request basics (NO auth header values)
  logger?.debug?.(`[Action1] HTTP ${method} ${url}` + (body !== undefined ? ` | bodyBytes=${Buffer.byteLength(JSON.stringify(body), 'utf8')}` : ''));

  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const data = await readJson(res);

  if (!res.ok) {
    const hint = data?.developer_message || data?.user_message || data?._raw || '';
    const msg = `[Action1] HTTP ${res.status} ${res.statusText} ${method} ${url}` + (hint ? ` | ${hint}` : '');
    if (logger?.error) logger.error(msg);

    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

function bearerHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };
}

/**
 * getAccessToken(action1, logger) -> "JWT"
 * Uses JSON body because it is easy to debug and matches the OpenAPI example you posted.
 */
export async function getAccessToken(action1, logger) {
  requireAction1Config(action1);

  const url = joinUrl(action1.apiBaseUrl, '/oauth2/token');

  if (logger?.info) logger.info(`[Action1] Requesting OAuth token: ${url}`);
  logger?.debug?.(`[Action1] Token request (safe): clientId=${action1.clientId} apiBaseUrl=${action1.apiBaseUrl}`);

  const t0 = nowMs();
  const data = await httpJson(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: {
        client_id: action1.clientId,
        client_secret: action1.clientSecret, // DO NOT LOG THIS
      },
    },
    logger
  );

  logger?.debug?.(`[Action1] Token received in ${msSince(t0)}ms`);

  const token = data?.access_token;
  if (!token) {
    throw new Error('[Action1] OAuth token response missing access_token');
  }

  return token;
}

/**
 * listOrganizations(action1, token, logger) -> ResultPage
 * Not required for our sync (we use orgId from config), but useful for testing connectivity.
 */
export async function listOrganizations(action1, token, logger) {
  requireAction1Config(action1);

  const url = joinUrl(action1.apiBaseUrl, '/organizations');
  if (logger?.info) logger.info(`[Action1] GET organizations: ${url}`);

  const t0 = nowMs();
  const data = await httpJson(url, { headers: bearerHeaders(token) }, logger);
  logger?.debug?.(`[Action1] Organizations fetched in ${msSince(t0)}ms`);

  return data;
}

/**
 * listManagedEndpoints(action1, token, orgId, opts, logger) -> Endpoint[]
 * Supports paging via ResultPage.next_page.
 *
 * opts:
 *  - limit (default 50)
 *  - fields (default "*")
 *  - maxPages (default 200)
 *  - maxItems (default 50000)
 */
export async function listManagedEndpoints(action1, token, orgId, opts = {}, logger) {
  requireAction1Config(action1);
  if (!orgId) throw new Error('listManagedEndpoints: orgId is required');
  if (!token) throw new Error('listManagedEndpoints: token is required');

  const limit = Number.isFinite(opts.limit) ? opts.limit : 50;
  const fields = opts.fields ?? '*';

  const maxPages = Number.isFinite(opts.maxPages) ? opts.maxPages : 200;
  const maxItems = Number.isFinite(opts.maxItems) ? opts.maxItems : 50000;

  logger?.debug?.(
    `[Action1] listManagedEndpoints opts: orgId=${orgId} limit=${limit} fields=${fields} maxPages=${maxPages} maxItems=${maxItems}`
  );

  const firstUrl = joinUrl(
    action1.apiBaseUrl,
    `/endpoints/managed/${encodeURIComponent(orgId)}?limit=${encodeURIComponent(limit)}&fields=${encodeURIComponent(fields)}`
  );

  const items = [];
  let nextUrl = firstUrl;
  let page = 0;

  const tAll = nowMs();

  while (nextUrl) {
    page += 1;
    if (page > maxPages) {
      if (logger?.warn) logger.warn(`[Action1] Paging stopped: reached maxPages=${maxPages} (org ${orgId})`);
      break;
    }

    const absolute = absolutizeUrl(action1.apiBaseUrl, nextUrl);

    // keep info line (existing), but add debug details
    if (logger?.info) logger.info(`[Action1] GET endpoints page ${page} (org ${orgId}): ${absolute}`);

    const tPage = nowMs();
    const data = await httpJson(absolute, { headers: bearerHeaders(token) }, logger);
    const pageItems = Array.isArray(data?.items) ? data.items : [];

    logger?.debug?.(
      `[Action1] Endpoints page ${page}: got=${pageItems.length} total=${items.length + pageItems.length} next=${data?.next_page ? 'yes' : 'no'} timeMs=${msSince(tPage)}`
    );

    for (const ep of pageItems) {
      items.push(ep);
      if (items.length >= maxItems) {
        if (logger?.warn) logger.warn(`[Action1] Paging stopped: reached maxItems=${maxItems} (org ${orgId})`);
        logger?.info?.(`[Action1] Endpoints fetched (org ${orgId}): ${items.length}`);
        return items;
      }
    }

    nextUrl = data?.next_page || null;
  }

  if (logger?.info) logger.info(`[Action1] Endpoints fetched (org ${orgId}): ${items.length}`);
  logger?.debug?.(`[Action1] listManagedEndpoints done: orgId=${orgId} total=${items.length} timeMs=${msSince(tAll)}`);

  return items;
}

/**
 * getManagedEndpoint(action1, token, orgId, endpointId, logger) -> Endpoint
 */
export async function getManagedEndpoint(action1, token, orgId, endpointId, logger) {
  requireAction1Config(action1);
  if (!orgId) throw new Error('getManagedEndpoint: orgId is required');
  if (!endpointId) throw new Error('getManagedEndpoint: endpointId is required');
  if (!token) throw new Error('getManagedEndpoint: token is required');

  const url = joinUrl(
    action1.apiBaseUrl,
    `/endpoints/managed/${encodeURIComponent(orgId)}/${encodeURIComponent(endpointId)}`
  );

  if (logger?.info) logger.info(`[Action1] GET endpoint ${endpointId} (org ${orgId})`);
  logger?.debug?.(`[Action1] GET endpoint url: ${url}`);

  const t0 = nowMs();
  const data = await httpJson(url, { headers: bearerHeaders(token) }, logger);
  logger?.debug?.(`[Action1] GET endpoint done: endpointId=${endpointId} timeMs=${msSince(t0)}`);

  return data;
}

/**
 * patchManagedEndpoint(action1, token, orgId, endpointId, patch, logger) -> Endpoint
 * Used later by SyncEngine to update custom attributes.
 *
 * Patch example:
 *   { "custom:Entra Groups": "Group A, Group B" }
 */
export async function patchManagedEndpoint(action1, token, orgId, endpointId, patch, logger) {
  requireAction1Config(action1);
  if (!orgId) throw new Error('patchManagedEndpoint: orgId is required');
  if (!endpointId) throw new Error('patchManagedEndpoint: endpointId is required');
  if (!token) throw new Error('patchManagedEndpoint: token is required');
  if (!patch || typeof patch !== 'object') throw new Error('patchManagedEndpoint: patch object is required');

  const url = joinUrl(
    action1.apiBaseUrl,
    `/endpoints/managed/${encodeURIComponent(orgId)}/${encodeURIComponent(endpointId)}`
  );

  if (logger?.info) logger.info(`[Action1] PATCH endpoint ${endpointId} (org ${orgId})`);

  // ✅ This is what you asked for: show payload that will be sent to Action1
  if (logger?.debug) {
    logger.debug(
      `[Action1] PATCH payload for endpoint ${endpointId} (org ${orgId}):\n${safeJsonStringify(patch)}`
    );
  }

  const t0 = nowMs();
  const data = await httpJson(
    url,
    {
      method: 'PATCH',
      headers: { ...bearerHeaders(token), 'Content-Type': 'application/json' },
      body: patch,
    },
    logger
  );
  logger?.debug?.(`[Action1] PATCH done: endpointId=${endpointId} timeMs=${msSince(t0)}`);

  return data;
}
