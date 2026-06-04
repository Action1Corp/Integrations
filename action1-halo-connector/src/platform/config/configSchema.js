// configSchema.js
//
// Action1 Public Repository Material
//
// Use of this file is subject to TERMS_OF_USE.md (https://github.com/Action1Corp/PSAction1/blob/main/TERMS_OF_USE.md) in this repository.
// Provided AS IS, without warranties.
// Use at your own risk.
// Review, test, and validate before production use.
// © Action1 Corporation. All rights reserved.
const { EXISTING_OPEN_TICKET_BEHAVIOR } = require("../../core/lifecycle/decisionModel");
const {
  SIGNAL_TYPES,
  SIGNAL_TYPE_VALUES,
  VULNERABILITY_SEVERITIES,
  UPDATE_SEVERITIES,
  REMEDIATION_STATUSES,
} = require("../../core/types/signals");

const CONFIG_SCHEMA_VERSION = 1;
const TICKET_MODEL_VALUES = Object.freeze(["endpoint", "grouped"]);
const SYNC_SCHEDULER_INTERVAL_VALUES = Object.freeze([3, 6, 12, 24]);
const DEFAULT_MAX_IMPACTED_ENDPOINTS_IN_GROUPED_TICKET = 25;
const MIN_MAX_IMPACTED_ENDPOINTS_IN_GROUPED_TICKET = 1;
const MAX_MAX_IMPACTED_ENDPOINTS_IN_GROUPED_TICKET = 100;
const DEFAULT_MAX_OPEN_TICKETS_PER_ORGANIZATION = 30;

const CATEGORY_FIELDS_OUT_OF_SCOPE_V1 = Object.freeze(["category2Id", "category3Id", "category4Id"]);

function defaultConnectorConfig() {
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    connections: {
      action1: {
        baseUrl: "",
        clientId: "",
        clientSecretRef: "",
      },
      halo: {
        resourceServer: "",
        authorisationServer: "",
        tenant: "",
        clientId: "",
        clientSecretRef: "",
      },
    },
    ticketDestination: {
      teamId: "",
      ticketTypeId: "",
      category1Id: "",
      newStatusId: "",
      closedStatusIds: [],
    },
    lifecycle: {
      existingOpenTicketBehavior: EXISTING_OPEN_TICKET_BEHAVIOR.UPDATE_EXISTING_OPEN,
      closeWhenSignalClears: true,
      createNewWhenLinkedClosed: true,
      reopenClosedTickets: false,
    },
    signalFilters: {
      offline: {
        enabled: true,
        thresholdDays: 7,
      },
      rebootRequired: {
        enabled: true,
      },
      automationFailed: {
        enabled: true,
        lookbackHours: 24,
      },
      vulnerability: {
        enabled: true,
        severities: ["CRITICAL", "HIGH"],
        remediationStatuses: ["OVERDUE", "DUE_SOON"],
      },
      update: {
        enabled: true,
        severities: ["CRITICAL", "IMPORTANT"],
        remediationStatuses: ["OVERDUE", "DUE_SOON"],
      },
    },
    priorityMappings: {
      defaultPriorityId: null,
      bySignalType: {
        [SIGNAL_TYPES.OFFLINE]: { DEFAULT: null },
        [SIGNAL_TYPES.REBOOT_REQUIRED]: { DEFAULT: null },
        [SIGNAL_TYPES.AUTOMATION_FAILED]: { DEFAULT: null },
        [SIGNAL_TYPES.VULNERABILITY]: {
          CRITICAL: null,
          HIGH: null,
          MEDIUM: null,
          LOW: null,
        },
        [SIGNAL_TYPES.UPDATE]: {
          CRITICAL: null,
          IMPORTANT: null,
          MODERATE: null,
          LOW: null,
          UNSPECIFIED: null,
        },
      },
    },
    vulnerabilities: {
      ticketModel: "grouped",
    },
    updates: {
      ticketModel: "grouped",
    },
    automationFailed: {
      ticketModel: "grouped",
    },
    maxImpactedEndpointsInGroupedTicket: DEFAULT_MAX_IMPACTED_ENDPOINTS_IN_GROUPED_TICKET,
    orgClientMappings: [],
    provisioning: {
      haloClientOrgProvisioningEnabled: false,
      requireExplicitUserAction: true,
      dryRunPreviewEnabled: true,
    },
    operationalSafeguards: {
      enableDebugLogging: false,
      maxOpenTicketsPerOrganization: DEFAULT_MAX_OPEN_TICKETS_PER_ORGANIZATION,
    },
    syncScheduler: {
      enabled: false,
      intervalHours: 24,
    },
  };
}

/**
 * @param {any} source
 * @returns {Object}
 */
function normalizeConnectorConfig(source) {
  const defaults = defaultConnectorConfig();
  const src = source && typeof source === "object" ? source : {};
  const haloRaw = src.connections?.halo || {};
  const resourceServer = haloRaw.resourceServer || haloRaw.baseUrl || defaults.connections.halo.resourceServer;
  const authorisationServer =
    haloRaw.authorisationServer ||
    deriveAuthServerFromTokenUrl(haloRaw.tokenUrl) ||
    defaults.connections.halo.authorisationServer;

  return {
    ...defaults,
    ...src,
    schemaVersion: CONFIG_SCHEMA_VERSION,
    connections: {
      ...defaults.connections,
      ...(src.connections || {}),
      action1: {
        ...defaults.connections.action1,
        ...(src.connections?.action1 || {}),
      },
      halo: {
        ...defaults.connections.halo,
        ...haloRaw,
        resourceServer: String(resourceServer || ""),
        authorisationServer: String(authorisationServer || ""),
        tenant: String(haloRaw.tenant || ""),
      },
    },
    ticketDestination: {
      ...defaults.ticketDestination,
      ...(src.ticketDestination || {}),
      closedStatusIds: Array.isArray(src.ticketDestination?.closedStatusIds)
        ? src.ticketDestination.closedStatusIds.slice()
        : defaults.ticketDestination.closedStatusIds.slice(),
    },
    lifecycle: {
      ...defaults.lifecycle,
      ...(src.lifecycle || {}),
      existingOpenTicketBehavior:
        src.lifecycle?.existingOpenTicketBehavior === EXISTING_OPEN_TICKET_BEHAVIOR.SKIP_EXISTING_OPEN
          ? EXISTING_OPEN_TICKET_BEHAVIOR.SKIP_EXISTING_OPEN
          : EXISTING_OPEN_TICKET_BEHAVIOR.UPDATE_EXISTING_OPEN,
      reopenClosedTickets: false,
    },
    signalFilters: {
      ...defaults.signalFilters,
      ...(src.signalFilters || {}),
      offline: {
        ...defaults.signalFilters.offline,
        ...(src.signalFilters?.offline || {}),
      },
      rebootRequired: {
        ...defaults.signalFilters.rebootRequired,
        ...(src.signalFilters?.rebootRequired || {}),
      },
      automationFailed: {
        ...defaults.signalFilters.automationFailed,
        ...(src.signalFilters?.automationFailed || {}),
        lookbackHours: toPositiveInt(src.signalFilters?.automationFailed?.lookbackHours, 24),
      },
      vulnerability: {
        ...defaults.signalFilters.vulnerability,
        ...(src.signalFilters?.vulnerability || {}),
        severities: Array.isArray(src.signalFilters?.vulnerability?.severities)
          ? src.signalFilters.vulnerability.severities.slice()
          : defaults.signalFilters.vulnerability.severities.slice(),
        remediationStatuses: Array.isArray(src.signalFilters?.vulnerability?.remediationStatuses)
          ? src.signalFilters.vulnerability.remediationStatuses.slice()
          : defaults.signalFilters.vulnerability.remediationStatuses.slice(),
      },
      update: {
        ...defaults.signalFilters.update,
        ...(src.signalFilters?.update || {}),
        severities: Array.isArray(src.signalFilters?.update?.severities)
          ? src.signalFilters.update.severities.slice()
          : defaults.signalFilters.update.severities.slice(),
        remediationStatuses: Array.isArray(src.signalFilters?.update?.remediationStatuses)
          ? src.signalFilters.update.remediationStatuses.slice()
          : defaults.signalFilters.update.remediationStatuses.slice(),
      },
    },
    priorityMappings: {
      ...defaults.priorityMappings,
      ...(src.priorityMappings || {}),
      bySignalType: {
        ...defaults.priorityMappings.bySignalType,
        ...(src.priorityMappings?.bySignalType || {}),
      },
    },
    vulnerabilities: {
      ...defaults.vulnerabilities,
      ...(src.vulnerabilities || {}),
      ticketModel: normalizeTicketModel(src.vulnerabilities?.ticketModel),
    },
    updates: {
      ...defaults.updates,
      ...(src.updates || {}),
      ticketModel: normalizeTicketModel(src.updates?.ticketModel),
    },
    automationFailed: {
      ...defaults.automationFailed,
      ...(src.automationFailed || {}),
      ticketModel: normalizeTicketModel(src.automationFailed?.ticketModel),
    },
    maxImpactedEndpointsInGroupedTicket: normalizeMaxImpactedEndpointsInGroupedTicket(
      src.maxImpactedEndpointsInGroupedTicket
    ),
    orgClientMappings: Array.isArray(src.orgClientMappings)
      ? src.orgClientMappings.map((row) => ({
          mappingId: String(row?.mappingId || ""),
          action1OrgId: String(row?.action1OrgId || ""),
          action1OrgName: String(row?.action1OrgName || ""),
          haloClientId: String(row?.haloClientId || ""),
          haloClientName: String(row?.haloClientName || ""),
          allowHaloClientToCreateAction1Org: Boolean(row?.allowHaloClientToCreateAction1Org),
        }))
      : [],
    provisioning: {
      ...defaults.provisioning,
      ...(src.provisioning || {}),
    },
    operationalSafeguards: {
      ...defaults.operationalSafeguards,
      ...(src.operationalSafeguards || {}),
      enableDebugLogging: Boolean(src.operationalSafeguards?.enableDebugLogging),
      maxOpenTicketsPerOrganization: toPositiveInt(
        src.operationalSafeguards?.maxOpenTicketsPerOrganization,
        DEFAULT_MAX_OPEN_TICKETS_PER_ORGANIZATION
      ),
    },
    syncScheduler: {
      ...defaults.syncScheduler,
      ...(src.syncScheduler || {}),
      enabled: Boolean(src.syncScheduler?.enabled),
      intervalHours: normalizeSyncSchedulerIntervalHours(src.syncScheduler?.intervalHours),
    },
  };
}

/**
 * @param {any} source
 * @returns {Array<{path: string, message: string}>}
 */
function validateConnectorConfig(source) {
  const src = source && typeof source === "object" ? source : {};
  const cfg = normalizeConnectorConfig(source);
  const errors = [];

  ensureString(errors, "connections.action1.baseUrl", cfg.connections.action1.baseUrl);
  ensureString(errors, "connections.action1.clientId", cfg.connections.action1.clientId);
  ensureString(errors, "connections.action1.clientSecretRef", cfg.connections.action1.clientSecretRef);

  ensureString(errors, "connections.halo.resourceServer", cfg.connections.halo.resourceServer);
  ensureString(errors, "connections.halo.authorisationServer", cfg.connections.halo.authorisationServer);
  ensureString(errors, "connections.halo.tenant", cfg.connections.halo.tenant);
  ensureString(errors, "connections.halo.clientId", cfg.connections.halo.clientId);
  ensureString(errors, "connections.halo.clientSecretRef", cfg.connections.halo.clientSecretRef);

  ensureString(errors, "ticketDestination.teamId", cfg.ticketDestination.teamId);
  ensureString(errors, "ticketDestination.ticketTypeId", cfg.ticketDestination.ticketTypeId);
  ensureString(errors, "ticketDestination.category1Id", cfg.ticketDestination.category1Id);
  ensureString(errors, "ticketDestination.newStatusId", cfg.ticketDestination.newStatusId);

  if (!Array.isArray(cfg.ticketDestination.closedStatusIds)) {
    errors.push({ path: "ticketDestination.closedStatusIds", message: "must be an array of status ids" });
  } else {
    if (cfg.ticketDestination.closedStatusIds.length === 0) {
      errors.push({ path: "ticketDestination.closedStatusIds", message: "must include at least one closed status id" });
    }
    for (const value of cfg.ticketDestination.closedStatusIds) {
      if (!isString(value)) {
        errors.push({ path: "ticketDestination.closedStatusIds", message: "values must be strings" });
        break;
      }
    }
  }

  for (const field of CATEGORY_FIELDS_OUT_OF_SCOPE_V1) {
    if (Object.prototype.hasOwnProperty.call(source?.ticketDestination || {}, field)) {
      errors.push({
        path: `ticketDestination.${field}`,
        message: "is out of scope for v1 (Category 1 is the only destination category)",
      });
    }
  }

  const rawBehavior = src.lifecycle?.existingOpenTicketBehavior;
  if (
    rawBehavior !== undefined &&
    rawBehavior !== EXISTING_OPEN_TICKET_BEHAVIOR.UPDATE_EXISTING_OPEN &&
    rawBehavior !== EXISTING_OPEN_TICKET_BEHAVIOR.SKIP_EXISTING_OPEN
  ) {
    errors.push({
      path: "lifecycle.existingOpenTicketBehavior",
      message: "must be update_existing_open or skip_existing_open",
    });
  }
  ensureBoolean(errors, "lifecycle.closeWhenSignalClears", cfg.lifecycle.closeWhenSignalClears);
  ensureBoolean(errors, "lifecycle.createNewWhenLinkedClosed", cfg.lifecycle.createNewWhenLinkedClosed);
  if (src.lifecycle?.reopenClosedTickets !== undefined && src.lifecycle.reopenClosedTickets !== false) {
    errors.push({
      path: "lifecycle.reopenClosedTickets",
      message: "must be false in v1 (closed tickets are not reopened)",
    });
  }

  ensureBoolean(errors, "signalFilters.offline.enabled", cfg.signalFilters.offline.enabled);
  ensurePositiveInteger(errors, "signalFilters.offline.thresholdDays", cfg.signalFilters.offline.thresholdDays);
  ensureBoolean(errors, "signalFilters.rebootRequired.enabled", cfg.signalFilters.rebootRequired.enabled);
  ensureBoolean(errors, "signalFilters.automationFailed.enabled", cfg.signalFilters.automationFailed.enabled);
  ensurePositiveInteger(errors, "signalFilters.automationFailed.lookbackHours", cfg.signalFilters.automationFailed.lookbackHours);
  ensureAllowedStringArray(
    errors,
    "signalFilters.vulnerability.severities",
    cfg.signalFilters.vulnerability.severities,
    VULNERABILITY_SEVERITIES
  );
  ensureAllowedStringArray(
    errors,
    "signalFilters.vulnerability.remediationStatuses",
    cfg.signalFilters.vulnerability.remediationStatuses,
    REMEDIATION_STATUSES
  );
  ensureAllowedStringArray(errors, "signalFilters.update.severities", cfg.signalFilters.update.severities, UPDATE_SEVERITIES);
  ensureAllowedStringArray(
    errors,
    "signalFilters.update.remediationStatuses",
    cfg.signalFilters.update.remediationStatuses,
    REMEDIATION_STATUSES
  );

  validatePriorityMappingShape(errors, cfg.priorityMappings);
  ensureAllowedTicketModel(errors, "vulnerabilities.ticketModel", cfg.vulnerabilities?.ticketModel);
  ensureAllowedTicketModel(errors, "updates.ticketModel", cfg.updates?.ticketModel);
  ensureAllowedTicketModel(errors, "automationFailed.ticketModel", cfg.automationFailed?.ticketModel);
  ensureRangedInteger(
    errors,
    "maxImpactedEndpointsInGroupedTicket",
    cfg.maxImpactedEndpointsInGroupedTicket,
    MIN_MAX_IMPACTED_ENDPOINTS_IN_GROUPED_TICKET,
    MAX_MAX_IMPACTED_ENDPOINTS_IN_GROUPED_TICKET
  );
  validateOrgClientMappings(errors, cfg.orgClientMappings);
  ensureBoolean(
    errors,
    "provisioning.haloClientOrgProvisioningEnabled",
    cfg.provisioning.haloClientOrgProvisioningEnabled
  );
  ensureBoolean(errors, "provisioning.requireExplicitUserAction", cfg.provisioning.requireExplicitUserAction);
  ensureBoolean(errors, "provisioning.dryRunPreviewEnabled", cfg.provisioning.dryRunPreviewEnabled);
  ensureBoolean(errors, "operationalSafeguards.enableDebugLogging", cfg.operationalSafeguards.enableDebugLogging);
  ensurePositiveInteger(
    errors,
    "operationalSafeguards.maxOpenTicketsPerOrganization",
    cfg.operationalSafeguards.maxOpenTicketsPerOrganization
  );
  ensureBoolean(errors, "syncScheduler.enabled", cfg.syncScheduler.enabled);
  ensureAllowedNumber(
    errors,
    "syncScheduler.intervalHours",
    cfg.syncScheduler.intervalHours,
    SYNC_SCHEDULER_INTERVAL_VALUES
  );

  return errors;
}

/**
 * @param {Array<{path: string, message: string}>} errors
 * @param {Object} priorityMappings
 */
function validatePriorityMappingShape(errors, priorityMappings) {
  if (!priorityMappings || typeof priorityMappings !== "object") {
    errors.push({ path: "priorityMappings", message: "must be an object" });
    return;
  }

  const bySignalType = priorityMappings.bySignalType;
  if (!bySignalType || typeof bySignalType !== "object") {
    errors.push({ path: "priorityMappings.bySignalType", message: "must be an object" });
    return;
  }

  for (const signalType of SIGNAL_TYPE_VALUES) {
    if (!Object.prototype.hasOwnProperty.call(bySignalType, signalType)) {
      errors.push({ path: `priorityMappings.bySignalType.${signalType}`, message: "is required" });
    }
  }
}

/**
 * @param {Array<{path: string, message: string}>} errors
 * @param {Array<Object>} orgClientMappings
 */
function validateOrgClientMappings(errors, orgClientMappings) {
  if (!Array.isArray(orgClientMappings)) {
    errors.push({ path: "orgClientMappings", message: "must be an array" });
    return;
  }

  for (let i = 0; i < orgClientMappings.length; i += 1) {
    const row = orgClientMappings[i];
    const pathBase = `orgClientMappings[${i}]`;
    if (!row || typeof row !== "object") {
      errors.push({ path: pathBase, message: "must be an object" });
      continue;
    }
    ensureString(errors, `${pathBase}.mappingId`, row.mappingId);
    ensureString(errors, `${pathBase}.action1OrgId`, row.action1OrgId);
    ensureString(errors, `${pathBase}.action1OrgName`, row.action1OrgName);
    ensureString(errors, `${pathBase}.haloClientId`, row.haloClientId);
    ensureString(errors, `${pathBase}.haloClientName`, row.haloClientName);
    ensureBoolean(errors, `${pathBase}.allowHaloClientToCreateAction1Org`, row.allowHaloClientToCreateAction1Org);
  }
}

/**
 * @param {Array<{path: string, message: string}>} errors
 * @param {string} path
 * @param {unknown} value
 */
function ensureString(errors, path, value) {
  if (!isString(value)) {
    errors.push({ path, message: "must be a string" });
  }
}

/**
 * @param {Array<{path: string, message: string}>} errors
 * @param {string} path
 * @param {unknown} value
 */
function ensureBoolean(errors, path, value) {
  if (typeof value !== "boolean") {
    errors.push({ path, message: "must be a boolean" });
  }
}

/**
 * @param {Array<{path: string, message: string}>} errors
 * @param {string} path
 * @param {unknown} value
 */
function ensurePositiveInteger(errors, path, value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    errors.push({ path, message: "must be a positive integer" });
  }
}

/**
 * @param {Array<{path: string, message: string}>} errors
 * @param {string} path
 * @param {unknown} value
 * @param {string[]} allowedValues
 */
function ensureAllowedStringArray(errors, path, value, allowedValues) {
  if (!Array.isArray(value)) {
    errors.push({ path, message: "must be an array of strings" });
    return;
  }
  const allowed = new Set(allowedValues);
  for (const item of value) {
    if (!isString(item) || !allowed.has(item)) {
      errors.push({ path, message: `contains invalid value: ${String(item)}` });
      return;
    }
  }
}

function ensureAllowedTicketModel(errors, path, value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!TICKET_MODEL_VALUES.includes(normalized)) {
    errors.push({ path, message: "must be endpoint or grouped" });
  }
}

function ensureRangedInteger(errors, path, value, min, max) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    errors.push({ path, message: `must be an integer between ${min} and ${max}` });
  }
}

/**
 * @param {unknown} value
 * @returns {value is string}
 */
function isString(value) {
  return typeof value === "string";
}

function deriveAuthServerFromTokenUrl(tokenUrlRaw) {
  const tokenUrl = String(tokenUrlRaw || "").trim();
  if (!tokenUrl) return "";
  return tokenUrl.replace(/\/token$/i, "");
}

function toPositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return fallback;
  return n;
}

function normalizeTicketModel(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "grouped") return "grouped";
  if (normalized === "endpoint") return "endpoint";
  return normalized === "" ? "grouped" : "endpoint";
}

function normalizeMaxImpactedEndpointsInGroupedTicket(value) {
  const raw = value === undefined || value === null ? "" : String(value);
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_IMPACTED_ENDPOINTS_IN_GROUPED_TICKET;
  if (parsed < MIN_MAX_IMPACTED_ENDPOINTS_IN_GROUPED_TICKET) return MIN_MAX_IMPACTED_ENDPOINTS_IN_GROUPED_TICKET;
  if (parsed > MAX_MAX_IMPACTED_ENDPOINTS_IN_GROUPED_TICKET) return MAX_MAX_IMPACTED_ENDPOINTS_IN_GROUPED_TICKET;
  return parsed;
}

function normalizeSyncSchedulerIntervalHours(value) {
  const n = Number(value);
  return SYNC_SCHEDULER_INTERVAL_VALUES.includes(n) ? n : 24;
}

function ensureAllowedNumber(errors, path, value, allowedValues) {
  const n = Number(value);
  if (!allowedValues.includes(n)) {
    errors.push({ path, message: `must be one of: ${allowedValues.join(", ")}` });
  }
}

module.exports = {
  CATEGORY_FIELDS_OUT_OF_SCOPE_V1,
  CONFIG_SCHEMA_VERSION,
  defaultConnectorConfig,
  normalizeConnectorConfig,
  validateConnectorConfig,
};
