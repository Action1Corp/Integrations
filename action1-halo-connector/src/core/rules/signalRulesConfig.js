// signalRulesConfig.js
//
// Action1 Public Repository Material
//
// Use of this file is subject to TERMS_OF_USE.md (https://github.com/Action1Corp/PSAction1/blob/main/TERMS_OF_USE.md) in this repository.
// Provided AS IS, without warranties.
// Use at your own risk.
// Review, test, and validate before production use.
// © Action1 Corporation. All rights reserved.
const { EXISTING_OPEN_TICKET_BEHAVIOR } = require("../lifecycle/decisionModel");
const {
  VULNERABILITY_SEVERITIES,
  UPDATE_SEVERITIES,
  REMEDIATION_STATUSES,
} = require("../types/signals");

const VULNERABILITY_SEVERITY_ALIASES = Object.freeze({
  CRITICAL: "CRITICAL",
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  MODERATE: "MEDIUM",
  LOW: "LOW",
});

const UPDATE_SEVERITY_ALIASES = Object.freeze({
  CRITICAL: "CRITICAL",
  IMPORTANT: "IMPORTANT",
  HIGH: "IMPORTANT",
  MODERATE: "MODERATE",
  MEDIUM: "MODERATE",
  LOW: "LOW",
  UNSPECIFIED: "UNSPECIFIED",
  OTHER: "UNSPECIFIED",
});

const REMEDIATION_STATUS_ALIASES = Object.freeze({
  OVERDUE: "OVERDUE",
  DUE_SOON: "DUE_SOON",
  "DUE SOON": "DUE_SOON",
});
const TICKET_MODEL_ENDPOINT = "endpoint";
const TICKET_MODEL_GROUPED = "grouped";

/**
 * @param {any} config
 */
function normalizeSignalRulesConfig(config) {
  const src = config && typeof config === "object" ? config : {};
  const ticketDestination = src.ticketDestination && typeof src.ticketDestination === "object" ? src.ticketDestination : {};
  const lifecycle = src.lifecycle && typeof src.lifecycle === "object" ? src.lifecycle : {};
  const signalFilters = src.signalFilters && typeof src.signalFilters === "object" ? src.signalFilters : {};
  const vuln = signalFilters.vulnerability && typeof signalFilters.vulnerability === "object" ? signalFilters.vulnerability : {};
  const update = signalFilters.update && typeof signalFilters.update === "object" ? signalFilters.update : {};

  const vulnerabilitySeverities = normalizeStringSet(vuln.severities, VULNERABILITY_SEVERITY_ALIASES, VULNERABILITY_SEVERITIES);
  const vulnerabilityRemediationStatuses = normalizeStringSet(
    vuln.remediationStatuses,
    REMEDIATION_STATUS_ALIASES,
    REMEDIATION_STATUSES
  );
  const updateSeverities = normalizeStringSet(update.severities, UPDATE_SEVERITY_ALIASES, UPDATE_SEVERITIES);
  const updateRemediationStatuses = normalizeStringSet(
    update.remediationStatuses,
    REMEDIATION_STATUS_ALIASES,
    REMEDIATION_STATUSES
  );

  const existingOpenTicketBehavior =
    String(lifecycle.existingOpenTicketBehavior || "").trim() === EXISTING_OPEN_TICKET_BEHAVIOR.SKIP_EXISTING_OPEN
      ? EXISTING_OPEN_TICKET_BEHAVIOR.SKIP_EXISTING_OPEN
      : EXISTING_OPEN_TICKET_BEHAVIOR.UPDATE_EXISTING_OPEN;

  return {
    schemaVersion: Number(src.schemaVersion || 1),
    ticketDestination: {
      teamId: asTrimmedString(ticketDestination.teamId),
      ticketTypeId: asTrimmedString(ticketDestination.ticketTypeId),
      category1Id: asTrimmedString(ticketDestination.category1Id),
      newStatusId: asTrimmedString(ticketDestination.newStatusId),
      closedStatusIds: normalizeIdArray(ticketDestination.closedStatusIds),
    },
    lifecycle: {
      existingOpenTicketBehavior,
      closeWhenSignalClears: lifecycle.closeWhenSignalClears === undefined ? true : Boolean(lifecycle.closeWhenSignalClears),
      createNewWhenLinkedClosed:
        lifecycle.createNewWhenLinkedClosed === undefined ? true : Boolean(lifecycle.createNewWhenLinkedClosed),
      reopenClosedTickets: false,
    },
    signalFilters: {
      offline: {
        enabled: signalFilters.offline?.enabled === undefined ? true : Boolean(signalFilters.offline.enabled),
        thresholdDays: toPositiveInt(signalFilters.offline?.thresholdDays, 7),
      },
      rebootRequired: {
        enabled: signalFilters.rebootRequired?.enabled === undefined ? true : Boolean(signalFilters.rebootRequired.enabled),
      },
      automationFailed: {
        enabled:
          signalFilters.automationFailed?.enabled === undefined ? true : Boolean(signalFilters.automationFailed.enabled),
        lookbackHours: toPositiveInt(signalFilters.automationFailed?.lookbackHours, 24),
      },
      vulnerability: {
        enabled: vulnerabilitySeverities.length > 0,
        severities: vulnerabilitySeverities,
        remediationStatuses: vulnerabilityRemediationStatuses,
      },
      update: {
        enabled: updateSeverities.length > 0,
        severities: updateSeverities,
        remediationStatuses: updateRemediationStatuses,
      },
    },
    vulnerabilities: {
      ticketModel: normalizeTicketModel(src.vulnerabilities?.ticketModel),
    },
    updates: {
      ticketModel: normalizeTicketModel(src.updates?.ticketModel),
    },
    automationFailed: {
      ticketModel: normalizeTicketModel(src.automationFailed?.ticketModel),
    },
    maxImpactedEndpointsInGroupedTicket: toPositiveInt(src.maxImpactedEndpointsInGroupedTicket, 25),
    orgClientMappings: normalizeOrgClientMappings(src.orgClientMappings),
  };
}

/**
 * Candidate-building validation only.
 * Keeps optional routing overrides optional.
 *
 * @param {any} normalizedConfig
 * @returns {Array<{code: string, message: string}>}
 */
function validateSignalRulesConfigForCandidates(normalizedConfig) {
  const cfg = normalizedConfig && typeof normalizedConfig === "object" ? normalizedConfig : normalizeSignalRulesConfig({});
  const errors = [];
  if (!cfg.ticketDestination?.ticketTypeId) {
    errors.push({
      code: "missing_ticket_type",
      message: "Ticket Type is required for candidate routing context",
    });
  }
  if (!Array.isArray(cfg.ticketDestination?.closedStatusIds) || cfg.ticketDestination.closedStatusIds.length === 0) {
    errors.push({
      code: "missing_closed_statuses",
      message: "Complete / Closed statuses are required for lifecycle context",
    });
  }
  const behavior = String(cfg.lifecycle?.existingOpenTicketBehavior || "");
  if (
    behavior !== EXISTING_OPEN_TICKET_BEHAVIOR.UPDATE_EXISTING_OPEN &&
    behavior !== EXISTING_OPEN_TICKET_BEHAVIOR.SKIP_EXISTING_OPEN
  ) {
    errors.push({
      code: "missing_existing_open_behavior",
      message: "Existing Open Ticket Behavior is required for lifecycle context",
    });
  }
  return errors;
}

/**
 * @param {any[]} rows
 */
function normalizeOrgClientMappings(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => ({
    mappingId: asTrimmedString(row?.mappingId),
    action1OrgId: asTrimmedString(row?.action1OrgId),
    action1OrgName: asTrimmedString(row?.action1OrgName),
    haloClientId: asTrimmedString(row?.haloClientId),
    haloClientName: asTrimmedString(row?.haloClientName),
    allowHaloClientToCreateAction1Org: Boolean(row?.allowHaloClientToCreateAction1Org),
  }));
}

/**
 * @param {unknown} value
 * @param {Record<string,string>} aliasMap
 * @param {readonly string[]} allowed
 */
function normalizeStringSet(value, aliasMap, allowed) {
  if (!Array.isArray(value)) return [];
  const allowedSet = new Set(allowed);
  const seen = new Set();
  const out = [];
  for (const item of value) {
    const raw = String(item || "").trim().toUpperCase();
    if (!raw) continue;
    const normalized = aliasMap[raw] || raw;
    if (!allowedSet.has(normalized)) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

/**
 * @param {unknown} value
 */
function normalizeIdArray(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const item of value) {
    const id = asTrimmedString(item);
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function asTrimmedString(value) {
  return String(value || "").trim();
}

function toPositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return fallback;
  return n;
}

function normalizeTicketModel(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === TICKET_MODEL_GROUPED ? TICKET_MODEL_GROUPED : TICKET_MODEL_ENDPOINT;
}

module.exports = {
  normalizeSignalRulesConfig,
  validateSignalRulesConfigForCandidates,
  VULNERABILITY_SEVERITY_ALIASES,
  UPDATE_SEVERITY_ALIASES,
  REMEDIATION_STATUS_ALIASES,
};
