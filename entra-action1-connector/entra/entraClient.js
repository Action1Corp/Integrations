// entra/entraClient.js (ESM)
// client_credentials token + list devices + memberOf groups

const GRAPH_RESOURCE = "https://graph.microsoft.com/";
const GRAPH_DEVICES_URL = "https://graph.microsoft.com/v1.0/devices";

/* ------------------------- small debug helpers ------------------------- */
function nowMs() {
  return Date.now();
}
function msSince(t0) {
  return Date.now() - t0;
}
function previewKeys(obj, limit = 30) {
  if (!obj || typeof obj !== "object") return [];
  const keys = Object.keys(obj);
  return keys.length > limit ? keys.slice(0, limit).concat([`...(+${keys.length - limit})`]) : keys;
}
/* ---------------------------------------------------------------------- */

function assertTenantConfig(tenant) {
  const missing = [];
  if (!tenant?.tenantId) missing.push("tenantId");
  if (!tenant?.clientId) missing.push("clientId");
  if (!tenant?.clientSecret) missing.push("clientSecret");

  if (missing.length) {
    const err = new Error(`Entra tenant config is missing: ${missing.join(", ")}`);
    err.code = "ENTRA_BAD_TENANT_CONFIG";
    throw err;
  }
}

async function postForm(url, formObj) {
  const body = new URLSearchParams(formObj);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    const err = new Error(
      `HTTP ${res.status} ${res.statusText} POST ${url}` +
        (json?.error_description ? `: ${json.error_description}` : "")
    );
    err.code = "ENTRA_HTTP_ERROR";
    err.status = res.status;
    err.url = url;
    err.response = json ?? text;
    throw err;
  }

  return json;
}

async function getJson(url, headers) {
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      ...headers,
    },
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} ${res.statusText} GET ${url}`);
    err.code = "ENTRA_HTTP_ERROR";
    err.status = res.status;
    err.url = url;
    err.response = json ?? text;
    throw err;
  }

  return json;
}

/**
 * Get access token (client credentials)
 * tenant: { tenantId, clientId, clientSecret }
 */
async function getAccessToken(tenant, logger) {
  assertTenantConfig(tenant);

  const tokenUrl = `https://login.microsoftonline.com/${tenant.tenantId}/oauth2/v2.0/token`;

  logger?.info?.(`[entra] Requesting access token for tenant ${tenant.tenantId}`);
  // safe debug (NO secrets)
  logger?.debug?.(
    `[entra] Token request: tenantId=${tenant.tenantId} clientId=${tenant.clientId} scope=${GRAPH_RESOURCE}.default`
  );

  const t0 = nowMs();
  const tokenResponse = await postForm(tokenUrl, {
    client_id: tenant.clientId,
    client_secret: tenant.clientSecret, // DO NOT log this
    grant_type: "client_credentials",
    scope: `${GRAPH_RESOURCE}.default`,
  });
  logger?.debug?.(`[entra] Token received in ${msSince(t0)}ms`);

  if (!tokenResponse?.access_token) {
    const err = new Error("Token response does not contain access_token");
    err.code = "ENTRA_TOKEN_MISSING";
    err.response = tokenResponse;
    throw err;
  }

  return tokenResponse.access_token;
}

/**
 * Get devices (paging @odata.nextLink)
 * NOTE: returns ALL properties returned by Graph unless you use $select.
 */
async function listDevices(tenant, logger) {
  const token = await getAccessToken(tenant, logger);

  let url = `${GRAPH_DEVICES_URL}?$top=999`;
  const all = [];

  logger?.info?.(`[entra] Listing devices...`);

  let page = 0;
  const tAll = nowMs();

  while (url) {
    page += 1;
    logger?.debug?.(`[entra] GET devices page ${page}: ${url}`);

    const tPage = nowMs();
    const data = await getJson(url, {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    });

    const got = Array.isArray(data?.value) ? data.value.length : 0;
    all.push(...(Array.isArray(data?.value) ? data.value : []));
    url = data?.["@odata.nextLink"] || null;

    logger?.debug?.(
      `[entra] Devices page ${page}: got=${got} total=${all.length} next=${url ? "yes" : "no"} timeMs=${msSince(
        tPage
      )}`
    );

    logger?.info?.(`[entra] Devices fetched: total=${all.length}` + (url ? " (next page)" : " (done)"));
  }

  logger?.info?.(`[entra] listDevices total=${all.length} timeMs=${msSince(tAll)}`);

  if (all.length > 0) {
    logger?.debug?.(`[entra] Raw device keys (first device): ${previewKeys(all[0]).join(", ")}`);
  }

  return all;
}

/**
 * List groups (direct memberOf) for a device using an already-issued token
 */
async function listDeviceGroupsByToken(token, deviceId, logger) {
  let url =
    `https://graph.microsoft.com/v1.0/devices/${encodeURIComponent(deviceId)}` +
    `/memberOf/microsoft.graph.group?$top=999&$select=id,displayName`;

  const groups = [];
  let page = 0;

  while (url) {
    page += 1;
    logger?.debug?.(`[entra] GET memberOf page ${page} for device ${deviceId}: ${url}`);

    const data = await getJson(url, {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    });

    const got = Array.isArray(data?.value) ? data.value.length : 0;
    groups.push(...(Array.isArray(data?.value) ? data.value : []));
    url = data?.["@odata.nextLink"] || null;

    logger?.debug?.(
      `[entra] memberOf page ${page} for device ${deviceId}: got=${got} total=${groups.length} next=${
        url ? "yes" : "no"
      }`
    );
  }

  return groups;
}

/**
 * Compatibility wrapper (если тебе удобнее старое имя)
 * NOTE: now token is NOT re-requested per device, it's one per call.
 */
async function listDeviceGroups(tenant, deviceId, logger) {
  const token = await getAccessToken(tenant, logger);
  return listDeviceGroupsByToken(token, deviceId, logger);
}

/**
 * Devices + memberOf groups in the shape you want.
 * Token is requested ONCE for the whole run.
 */
async function listDevicesWithGroups(tenant, logger) {
  const tAll = nowMs();
  const token = await getAccessToken(tenant, logger);

  const select = [
    "id",
    "displayName",
    "deviceOwnership",
    "enrollmentProfileName",
    "enrollmentType",
    "extensionAttributes",
    "isCompliant",
    "isManaged",
    "managementType",
  ].join(",");

  let url = `https://graph.microsoft.com/v1.0/devices?$top=999&$select=${encodeURIComponent(select)}`;
  const devices = [];

  logger?.info?.(`[entra] Listing devices ($select=...)`);
  logger?.debug?.(`[entra] $select fields: ${select}`);

  let page = 0;
  while (url) {
    page += 1;
    logger?.debug?.(`[entra] GET devices($select) page ${page}: ${url}`);

    const tPage = nowMs();
    const data = await getJson(url, {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    });

    const got = Array.isArray(data?.value) ? data.value.length : 0;
    devices.push(...(Array.isArray(data?.value) ? data.value : []));
    url = data?.["@odata.nextLink"] || null;

    logger?.debug?.(
      `[entra] Devices($select) page ${page}: got=${got} total=${devices.length} next=${
        url ? "yes" : "no"
      } timeMs=${msSince(tPage)}`
    );
  }

  logger?.info?.(`[entra] Devices to enrich: ${devices.length}`);

  if (devices.length > 0) {
    logger?.debug?.(`[entra] Raw device keys (first device): ${previewKeys(devices[0]).join(", ")}`);
    logger?.debug?.(
      `[entra] Mapped fields: displayName, deviceOwnership, enrollmentProfileName, enrollmentType, extensionAttributes, isCompliant, isManaged, managementType, memberOf`
    );
  }

  logger?.info?.(`[entra] Enriching devices with memberOf groups...`);

  const result = [];
  for (const d of devices) {
    const label = d.displayName ?? d.id;

    // DEBUG: show raw values we requested from Graph for THIS device
    if (logger?.debug) {
      const snapshot = {
        displayName: d.displayName ?? null,
        deviceOwnership: d.deviceOwnership ?? null,
        enrollmentProfileName: d.enrollmentProfileName ?? null,
        enrollmentType: d.enrollmentType ?? null,
        extensionAttributes: d.extensionAttributes ?? null,
        isCompliant: d.isCompliant ?? null,
        isManaged: d.isManaged ?? null,
        managementType: d.managementType ?? null,
      };

      logger.debug(
        `[entra] Device properties from Graph: ${label}\n${JSON.stringify(snapshot, null, 2)}`
      );
    }

    // per-device details -> debug (can be noisy)
    logger?.debug?.(`[entra] memberOf for device: ${label}`);

    const tGroups = nowMs();
    const groups = await listDeviceGroupsByToken(token, d.id, logger);
    logger?.info?.(`[entra] memberOf done: ${label} groups=${groups.length} timeMs=${msSince(tGroups)}`);
    
    if (logger?.debug) {
      const names = groups.map(g => g.displayName || g.id).filter(Boolean);

          const LIMIT = 50;
          const shown = names.slice(0, LIMIT);
          const more = names.length > LIMIT ? ` ...(+${names.length - LIMIT} more)` : '';

           logger.debug(`[entra] Groups for device: ${label} count=${names.length} => ${shown.join(', ')}${more}`);
}

    const groupNames = groups.map((g) => g.displayName || g.id);

    result.push({
      displayName: d.displayName ?? null,
      deviceOwnership: d.deviceOwnership ?? null,
      enrollmentProfileName: d.enrollmentProfileName ?? null,
      enrollmentType: d.enrollmentType ?? null,
      extensionAttributes: d.extensionAttributes ?? null,
      isCompliant: d.isCompliant ?? null,
      isManaged: d.isManaged ?? null,
      managementType: d.managementType ?? null,

      memberOf: groupNames.join(", "),
    });
  }

  logger?.info?.(`[entra] Devices enriched: ${result.length} timeMs=${msSince(tAll)}`);
  return result;
}

export {
  getAccessToken,
  listDevices,
  listDeviceGroups,
  listDeviceGroupsByToken,
  listDevicesWithGroups,
};
