// haloDiscoveryClient.js
//
// Action1 Public Repository Material
//
// Use of this file is subject to TERMS_OF_USE.md (https://github.com/Action1Corp/PSAction1/blob/main/TERMS_OF_USE.md) in this repository.
// Provided AS IS, without warranties.
// Use at your own risk.
// Review, test, and validate before production use.
// © Action1 Corporation. All rights reserved.
const { LOG_EVENT_TYPES, emitLog } = require("../../platform/logging");
const { createHaloAuthClient } = require("./haloAuthClient");

/**
 * @param {{
 *  runLogger?: any,
 *  haloAuthClient?: {requestResource: Function},
 *  connectionProvider?: () => Promise<Object>|Object,
 * }} [opts]
 */
function createHaloDiscoveryClient(opts = {}) {
  const runLogger = opts.runLogger || null;
  const authClient =
    opts.haloAuthClient ||
    createHaloAuthClient({
      runLogger,
      connectionProvider: opts.connectionProvider,
    });

  return {
    listTeams,
    listTicketTypes,
    getTicketTypeDetails,
    listStatuses,
    listCategories,
    listClients,
    listSites,
  };

  async function listTeams() {
    const payload = await fetchResourceList({
      runId: "halo-discovery",
      path: "/Team",
      resource: "teams",
    });
    return payload.map(normalizeTeam).filter(hasIdName);
  }

  async function listTicketTypes() {
    const payload = await fetchResourceList({
      runId: "halo-discovery",
      path: "/TicketType",
      resource: "ticketTypes",
    });
    return payload.map(normalizeTicketType).filter(hasIdName);
  }

  async function getTicketTypeDetails(ticketTypeId) {
    if (!ticketTypeId) {
      throw new Error("Halo getTicketTypeDetails requires ticketTypeId");
    }

    const runId = "halo-discovery";
    await emitLog({
      runLogger,
      runId,
      eventType: LOG_EVENT_TYPES.DISCOVERY_FETCH,
      message: "Halo discovery fetch ticket type detail started",
      context: { ticketTypeId: String(ticketTypeId) },
    });

    const response = await authClient.requestResource({
      method: "GET",
      path: `/TicketType/${encodeURIComponent(String(ticketTypeId))}`,
      runId,
    });
    const payload = toObject(response.data);
    const base = normalizeTicketType(payload);

    const allowedStatuses = extractAllowedStatuses(payload);
    const allowedCategories = extractAllowedCategories(payload);

    await emitLog({
      runLogger,
      runId,
      eventType: LOG_EVENT_TYPES.DISCOVERY_FETCH,
      message: "Halo discovery fetch ticket type detail completed",
      context: {
        ticketTypeId: String(ticketTypeId),
        allowedStatuses: allowedStatuses.length,
        allowedCategories: allowedCategories.length,
      },
    });

    return {
      id: base.id,
      name: base.name,
      allowedStatuses,
      allowedCategories,
    };
  }

  async function listStatuses() {
    const payload = await fetchResourceList({
      runId: "halo-discovery",
      path: "/Status",
      resource: "statuses",
    });
    return payload.map(normalizeStatus).filter(hasIdName);
  }

  async function listCategories() {
    await emitLog({
      runLogger,
      runId: "halo-discovery",
      eventType: LOG_EVENT_TYPES.DISCOVERY_FETCH,
      message: "[halo-discovery-debug] Halo Category discovery request",
      context: {
        endpoint: "/Category",
      },
    });
    const payload = await fetchResourceList({
      runId: "halo-discovery",
      path: "/Category",
      resource: "categories",
    });
    const rows = payload.map(normalizeCategory).filter(hasIdName);
    await emitLog({
      runLogger,
      runId: "halo-discovery",
      eventType: LOG_EVENT_TYPES.DISCOVERY_FETCH,
      message: "[halo-discovery-debug] Halo Category discovery parsed",
      context: {
        endpoint: "/Category",
        parsedCount: rows.length,
        samples: rows.slice(0, 2).map((row) => ({ id: row.id, label: row.label })),
      },
    });
    return rows;
  }

  async function listClients() {
    await emitLog({
      runLogger,
      runId: "halo-discovery",
      eventType: LOG_EVENT_TYPES.DISCOVERY_FETCH,
      message: "[halo-discovery-debug] Halo Client discovery request",
      context: {
        endpoint: "/Client",
      },
    });
    const payload = await fetchResourceList({
      runId: "halo-discovery",
      path: "/Client",
      resource: "clients",
    });
    const rows = payload.map(normalizeClient).filter(hasIdName);
    await emitLog({
      runLogger,
      runId: "halo-discovery",
      eventType: LOG_EVENT_TYPES.DISCOVERY_FETCH,
      message: "[halo-discovery-debug] Halo Client discovery parsed",
      context: {
        endpoint: "/Client",
        parsedCount: rows.length,
        samples: rows.slice(0, 2).map((row) => ({ id: row.id, label: row.label })),
      },
    });
    return rows;
  }

  async function listSites() {
    try {
      const payload = await fetchResourceList({
        runId: "halo-discovery",
        path: "/Site",
        resource: "sites",
      });
      return payload.map(normalizeSite).filter(hasIdName);
    } catch (error) {
      if (Number(error?.statusCode) === 404) {
        await emitLog({
          runLogger,
          runId: "halo-discovery",
          level: "WARN",
          eventType: LOG_EVENT_TYPES.PARTIAL_FAILURE,
          message: "Halo Site discovery endpoint not available",
          context: {
            statusCode: error.statusCode,
          },
        });
        return [];
      }
      throw error;
    }
  }

  async function fetchResourceList({ runId, path, resource }) {
    await emitLog({
      runLogger,
      runId,
      eventType: LOG_EVENT_TYPES.DISCOVERY_FETCH,
      message: `Halo discovery fetch ${resource} started`,
    });
    const response = await authClient.requestResource({
      method: "GET",
      path,
      runId,
    });
    const rootShape = detectRootShape(response.data);
    const rows = toArray(response.data);
    await emitLog({
      runLogger,
      runId,
      eventType: LOG_EVENT_TYPES.DISCOVERY_FETCH,
      message: `Halo discovery fetch ${resource} completed`,
      context: {
        count: rows.length,
        endpoint: path,
        rootShape,
      },
    });
    return rows;
  }
}

function normalizeTeam(row) {
  return {
    id: firstString(row, ["id", "team_id"]),
    name: firstString(row, ["name", "team_name"]),
  };
}

function normalizeTicketType(row) {
  return {
    id: firstString(row, ["id", "tickettype_id", "ticket_type_id"]),
    name: firstString(row, ["name", "tickettype"]),
  };
}

function normalizeStatus(row) {
  const isClosedRaw = row?.is_closed ?? row?.closed ?? row?.isclosed ?? row?.hasbeenclosed;
  return {
    id: firstString(row, ["id", "status_id"]),
    name: firstString(row, ["name", "status"]),
    isClosed: isClosedRaw === undefined ? undefined : Boolean(isClosedRaw),
  };
}

function normalizeClient(row) {
  return {
    id: firstString(row, ["id", "client_id"]),
    value: firstString(row, ["id", "client_id"]),
    label: firstString(row, ["name", "client_name"]),
    name: firstString(row, ["name", "client_name"]),
    raw: row || {},
  };
}

function normalizeCategory(row) {
  const id = firstString(row, ["id", "category_id"]);
  const value = firstString(row, ["value", "category_name", "name", "label"]);
  const label = value || id;
  return {
    id,
    value,
    label,
    name: label,
    typeId: firstString(row, ["type_id", "typeId"]),
    raw: row || {},
  };
}

function normalizeSite(row) {
  return {
    id: firstString(row, ["id", "site_id"]),
    name: firstString(row, ["name", "site_name"]),
    clientId: firstString(row, ["client_id", "clientid"]),
  };
}

function extractAllowedStatuses(ticketTypePayload) {
  const directList = [
    ...toArray(ticketTypePayload.allowed_status),
    ...toArray(ticketTypePayload.allowed_statuses),
    ...toArray(ticketTypePayload.allowedStatuses),
  ];
  const rows = dedupeByIdName(directList.map(normalizeStatus).filter(hasIdName));
  return rows;
}

function extractAllowedCategories(ticketTypePayload) {
  const direct = [
    ...toArray(ticketTypePayload.allowed_category),
    ...toArray(ticketTypePayload.allowed_categories),
    ...toArray(ticketTypePayload.allowedCategories),
  ];
  const normalized = direct.map((row) => ({
    id: firstString(row, ["id", "category_id", "value"]),
    name: firstString(row, ["name", "category", "label"]),
  }));
  const filtered = normalized.filter(hasIdName);
  return dedupeByIdName(filtered);
}

function dedupeByIdName(rows) {
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    const key = `${row.id}|${row.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function hasIdName(row) {
  return Boolean(row?.id && row?.name);
}

function toObject(value) {
  if (!value || typeof value !== "object") return {};
  if (Array.isArray(value)) {
    return value[0] && typeof value[0] === "object" ? value[0] : {};
  }
  return value;
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    if (Array.isArray(value.items)) return value.items;
    if (Array.isArray(value.value)) return value.value;
    if (Array.isArray(value.clients)) return value.clients;
    if (Array.isArray(value.categories)) return value.categories;
    if (Array.isArray(value.statuses)) return value.statuses;
    if (Array.isArray(value.teams)) return value.teams;
    if (Array.isArray(value.tickettypes)) return value.tickettypes;
    if (Array.isArray(value.ticketTypes)) return value.ticketTypes;
    if (Array.isArray(value.sites)) return value.sites;
  }
  return [];
}

function detectRootShape(value) {
  if (Array.isArray(value)) return "array_root";
  if (!value || typeof value !== "object") return "unknown";
  if (Array.isArray(value.clients)) return "object.clients";
  if (Array.isArray(value.categories)) return "object.categories";
  if (Array.isArray(value.items)) return "object.items";
  if (Array.isArray(value.value)) return "object.value";
  if (Array.isArray(value.statuses)) return "object.statuses";
  if (Array.isArray(value.teams)) return "object.teams";
  if (Array.isArray(value.tickettypes)) return "object.tickettypes";
  if (Array.isArray(value.ticketTypes)) return "object.ticketTypes";
  if (Array.isArray(value.sites)) return "object.sites";
  return "object.unknown";
}

function firstString(row, keys) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value);
    }
  }
  return "";
}

module.exports = {
  createHaloDiscoveryClient,
  extractAllowedCategories,
  extractAllowedStatuses,
};
