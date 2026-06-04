// action1SignalInputNormalizer.js
//
// Action1 Public Repository Material
//
// Use of this file is subject to TERMS_OF_USE.md (https://github.com/Action1Corp/PSAction1/blob/main/TERMS_OF_USE.md) in this repository.
// Provided AS IS, without warranties.
// Use at your own risk.
// Review, test, and validate before production use.
// © Action1 Corporation. All rights reserved.
const {
  normalizeRemediationStatus,
  normalizeUpdateSeverity,
  normalizeVulnerabilitySeverity,
} = require("./signalQualification");

const TRUE_LIKE_VALUES = new Set(["1", "TRUE", "YES", "Y", "REQUIRED"]);

/**
 * Builds normalized Stage-4 endpoint evaluation rows from Action1-shaped inputs.
 *
 * @param {{
 *  action1Organizations?: Array<{id?: string, org_id?: string, name?: string, org_name?: string}>,
 *  action1EndpointsByOrg?: Record<string, any[]> | Array<{action1OrgId: string, endpoints: any[]}>,
 *  signalDatasets?: {
 *    vulnerabilitiesByEndpoint?: any,
 *    updatesByEndpoint?: any,
 *    automationFailedByEndpoint?: any,
 *  }
 * }} input
 * @returns {{
 *  evaluations: Array<{
 *    action1OrgId: string,
 *    action1OrgName: string,
 *    endpoint: {
 *      id: string,
 *      name?: string,
 *      lastSeenAt?: string,
 *      rebootRequired?: boolean,
 *      os?: string,
 *      platform?: string,
 *    },
 *    signals: {
 *      vulnerabilities: any[],
 *      updates: any[],
 *      automationFailed: any[],
 *    }
 *  }>,
 *  meta: {
 *    orgsSeen: number,
 *    endpointsSeen: number,
 *  }
 * }}
 */
function buildAction1EndpointEvaluations(input) {
  const orgs = normalizeOrganizations(input?.action1Organizations);
  const endpointsByOrg = normalizeEndpointsByOrg(input?.action1EndpointsByOrg);
  const signalDatasets = input?.signalDatasets && typeof input.signalDatasets === "object" ? input.signalDatasets : {};

  const orgIds = new Set([...Object.keys(endpointsByOrg), ...orgs.map((org) => org.id)]);
  const orgNameById = new Map(orgs.map((org) => [org.id, org.name]));

  const evaluations = [];
  for (const action1OrgId of orgIds) {
    const endpointRows = Array.isArray(endpointsByOrg[action1OrgId]) ? endpointsByOrg[action1OrgId] : [];
    for (const endpointRow of endpointRows) {
      const normalized = normalizeAction1EndpointSignalInput({
        action1OrgId,
        action1OrgName: orgNameById.get(action1OrgId) || "",
        endpoint: endpointRow,
        signalDatasets,
      });
      if (!normalized) continue;
      evaluations.push(normalized);
    }
  }

  return {
    evaluations,
    meta: {
      orgsSeen: orgIds.size,
      endpointsSeen: evaluations.length,
    },
  };
}

/**
 * Normalizes one endpoint + signal bundle to the pure rules input shape.
 *
 * @param {{
 *  action1OrgId: string,
 *  action1OrgName?: string,
 *  endpoint: any,
 *  signals?: {
 *    vulnerabilities?: any[],
 *    updates?: any[],
 *    automationFailed?: any[],
 *  },
 *  signalDatasets?: {
 *    vulnerabilitiesByEndpoint?: any,
 *    updatesByEndpoint?: any,
 *    automationFailedByEndpoint?: any,
 *  }
 * }} input
 */
function normalizeAction1EndpointSignalInput(input) {
  const action1OrgId = asTrimmedString(input?.action1OrgId);
  if (!action1OrgId) return null;

  const endpointRaw = input?.endpoint && typeof input.endpoint === "object" ? input.endpoint : {};
  const endpoint = normalizeEndpointRecord(endpointRaw);
  if (!endpoint.id) return null;

  const inlineSignals = input?.signals && typeof input.signals === "object" ? input.signals : {};
  const datasets = input?.signalDatasets && typeof input.signalDatasets === "object" ? input.signalDatasets : {};

  const vulnerabilities = normalizeVulnerabilities([
    ...asArray(endpointRaw.vulnerabilities),
    ...asArray(endpointRaw.vulnerabilityItems),
    ...asArray(endpointRaw.vulns),
    ...asArray(inlineSignals.vulnerabilities),
    ...resolveSignalRowsForEndpoint(datasets.vulnerabilitiesByEndpoint, action1OrgId, endpoint.id),
  ]);
  const updates = normalizeUpdates([
    ...asArray(endpointRaw.updates),
    ...asArray(endpointRaw.missingUpdates),
    ...asArray(endpointRaw.missing_updates),
    ...asArray(inlineSignals.updates),
    ...resolveSignalRowsForEndpoint(datasets.updatesByEndpoint, action1OrgId, endpoint.id),
  ]);
  const automationFailed = normalizeAutomationFailures([
    ...asArray(endpointRaw.automationFailed),
    ...asArray(endpointRaw.automationFailures),
    ...asArray(endpointRaw.automation_failures),
    ...asArray(inlineSignals.automationFailed),
    ...resolveSignalRowsForEndpoint(datasets.automationFailedByEndpoint, action1OrgId, endpoint.id),
    ...expandAutomationFailureCount(
      inlineSignals.automationFailedCount ??
        inlineSignals.automation_failed_count ??
        endpointRaw.automationFailedCount ??
        endpointRaw.automation_failed_count
    ),
  ]);

  return {
    action1OrgId,
    action1OrgName: asTrimmedString(input?.action1OrgName),
    endpoint,
    signals: {
      vulnerabilities,
      updates,
      automationFailed,
    },
  };
}

/**
 * @param {any} endpoint
 */
function normalizeEndpointRecord(endpoint) {
  const row = endpoint && typeof endpoint === "object" ? endpoint : {};
  const id = asTrimmedString(row.id || row.endpoint_id || row.endpointId);
  const name = asTrimmedString(row.name || row.endpoint_name || row.endpointName);
  const lastSeenAt = asTrimmedString(row.lastSeenAt || row.last_seen || row.lastSeen);
  const rebootRaw =
    row.rebootRequired !== undefined
      ? row.rebootRequired
      : row.reboot_required !== undefined
        ? row.reboot_required
        : row.reboot;
  const rebootRequired = toOptionalBoolean(rebootRaw);
  const os = asTrimmedString(row.os || row.OS || row.operatingSystem || row.operating_system);
  const platform = asTrimmedString(row.platform || row.architecture);

  const out = {
    id,
  };
  if (name) out.name = name;
  if (lastSeenAt) out.lastSeenAt = lastSeenAt;
  if (rebootRequired !== undefined) out.rebootRequired = rebootRequired;
  if (os) out.os = os;
  if (platform) out.platform = platform;
  return out;
}

function normalizeVulnerabilities(rows) {
  return rows
    .map((row) => {
      const id = asTrimmedString(row?.id || row?.cveId || row?.cve_id);
      const severity = normalizeVulnerabilitySeverity(row);
      const remediationStatus = normalizeRemediationStatus(row);
      const cvssScore = row?.cvssScore !== undefined ? row.cvssScore : row?.cvss_score;
      const item = {};
      if (id) item.id = id;
      if (severity) item.severity = severity;
      if (remediationStatus) item.remediationStatus = remediationStatus;
      if (cvssScore !== undefined && cvssScore !== null && String(cvssScore).trim() !== "") {
        item.cvssScore = Number(cvssScore);
      }
      const publishedDate = asTrimmedString(row?.publishedDate || row?.published_date);
      const remediationDeadline = asTrimmedString(row?.remediationDeadline || row?.remediation_deadline);
      const cisaKev = asTrimmedString(row?.cisaKev || row?.cisa_kev);
      const software = Array.isArray(row?.software) ? row.software : [];
      if (publishedDate) item.publishedDate = publishedDate;
      if (remediationDeadline) item.remediationDeadline = remediationDeadline;
      if (cisaKev) item.cisaKev = cisaKev;
      if (software.length > 0) item.software = software;
      return item;
    })
    .filter((item) => Object.keys(item).length > 0);
}

function normalizeUpdates(rows) {
  return rows
    .map((row) => {
      const id = asTrimmedString(row?.id || row?.updateId || row?.versionId || row?.version_id);
      const severity = normalizeUpdateSeverity(row);
      const remediationStatus = normalizeRemediationStatus(row);
      const item = {};
      if (id) item.id = id;
      if (severity) item.severity = severity;
      if (remediationStatus) item.remediationStatus = remediationStatus;
      const packageName = asTrimmedString(
        row?.packageName || row?.package_name || row?.displayName || row?.display_name || row?.name || row?.title
      );
      const packageId = asTrimmedString(row?.packageId || row?.package_id);
      const versionId = asTrimmedString(row?.versionId || row?.version_id);
      const version = asTrimmedString(row?.version || row?.version_name);
      const remediationDeadline = asTrimmedString(row?.remediationDeadline || row?.update_sla_deadline || row?.slaDeadline);
      const securityCve = asTrimmedString(row?.security_CVE || row?.securityCVE || row?.cves);
      const vendor = asTrimmedString(row?.vendor || row?.publisher);
      const updateType = asTrimmedString(row?.updateType || row?.update_type);
      const classification = asTrimmedString(row?.classification || row?.category);
      if (packageName) item.packageName = packageName;
      if (packageId) item.packageId = packageId;
      if (versionId) item.versionId = versionId;
      if (version) item.version = version;
      if (remediationDeadline) item.remediationDeadline = remediationDeadline;
      if (securityCve) item.securityCve = securityCve;
      if (vendor) item.vendor = vendor;
      if (updateType) item.updateType = updateType;
      if (classification) item.classification = classification;
      return item;
    })
    .filter((item) => Object.keys(item).length > 0);
}

function normalizeAutomationFailures(rows) {
  return dedupeRows(
    rows
      .map((row) => {
        const status = asTrimmedString(row?.status || row?.lastStatus || row?.last_status).toUpperCase();
        const failed =
          row?.failed === true ||
          row?.isFailed === true ||
          status === "ERROR" ||
          status === "FAILED" ||
          toOptionalBoolean(row?.failed) === true ||
          toOptionalBoolean(row?.isFailed) === true;
        const item = {
          failed: Boolean(failed),
        };
        if (status) item.status = status;
        const description = asTrimmedString(row?.description);
        if (description) item.description = description;
        const instanceName = asTrimmedString(row?.instanceName || row?.instance_name || row?.automationName || row?.automation_name);
        const instanceId = asTrimmedString(row?.instanceId || row?.automationInstanceId);
        const failureTime = asTrimmedString(row?.instanceEndTime || row?.end_time || row?.failureTime);
        const startedAt = asTrimmedString(row?.instanceStartTime || row?.start_time || row?.startedAt || row?.startTime);
        const endedAt = asTrimmedString(row?.instanceEndTime || row?.end_time || row?.endedAt || row?.endTime || row?.failureTime);
        const actionName = asTrimmedString(row?.actionName || row?.action_name);
        const percentCompleted = Number(row?.percentCompleted ?? row?.percent_completed);
        if (instanceName) item.instanceName = instanceName;
        if (instanceId) item.instanceId = instanceId;
        if (startedAt) item.startedAt = startedAt;
        if (endedAt) item.endedAt = endedAt;
        if (failureTime) item.failureTime = failureTime;
        if (actionName) item.actionName = actionName;
        if (Number.isFinite(percentCompleted)) item.percentCompleted = percentCompleted;
        return item;
      })
      .filter((item) => item.failed || item.status || item.description),
    (item) =>
      `${item.status || ""}|${item.description || ""}|${item.failed ? "1" : "0"}|${item.instanceName || ""}|${item.failureTime || ""}|${
        item.actionName || ""
      }|${String(item.percentCompleted || "")}`
  );
}

function expandAutomationFailureCount(rawCount) {
  const count = Number(rawCount);
  if (!Number.isFinite(count) || count <= 0) return [];
  const capped = Math.min(Math.floor(count), 100);
  const out = [];
  for (let i = 0; i < capped; i += 1) {
    out.push({
      status: "ERROR",
      failed: true,
      description: "count_placeholder",
    });
  }
  return out;
}

function normalizeOrganizations(rows) {
  if (!Array.isArray(rows)) return [];
  return dedupeRows(
    rows
      .map((row) => ({
        id: asTrimmedString(row?.id || row?.org_id),
        name: asTrimmedString(row?.name || row?.org_name),
      }))
      .filter((row) => row.id),
    (row) => row.id
  );
}

function normalizeEndpointsByOrg(input) {
  if (!input) return {};
  if (Array.isArray(input)) {
    const out = {};
    for (const row of input) {
      const orgId = asTrimmedString(row?.action1OrgId || row?.orgId || row?.id || row?.org_id);
      if (!orgId) continue;
      out[orgId] = asArray(row?.endpoints);
    }
    return out;
  }
  if (typeof input === "object") {
    const out = {};
    for (const [orgIdRaw, endpointsRaw] of Object.entries(input)) {
      const orgId = asTrimmedString(orgIdRaw);
      if (!orgId) continue;
      out[orgId] = asArray(endpointsRaw);
    }
    return out;
  }
  return {};
}

function resolveSignalRowsForEndpoint(dataset, action1OrgId, endpointId) {
  if (!dataset) return [];

  if (typeof dataset === "function") {
    const rows = dataset({ action1OrgId, endpointId });
    return asArray(rows);
  }

  if (Array.isArray(dataset)) {
    return dataset.filter((row) => endpointMatches(row, endpointId, action1OrgId));
  }

  if (typeof dataset === "object") {
    const endpointRows = dataset[endpointId];
    if (Array.isArray(endpointRows)) return endpointRows;

    const orgRows = dataset[action1OrgId];
    if (Array.isArray(orgRows)) {
      return orgRows.filter((row) => endpointMatches(row, endpointId, action1OrgId));
    }
    if (orgRows && typeof orgRows === "object") {
      const nestedEndpointRows = orgRows[endpointId];
      if (Array.isArray(nestedEndpointRows)) return nestedEndpointRows;
    }
  }

  return [];
}

function endpointMatches(row, endpointId, action1OrgId) {
  const rowEndpointId = asTrimmedString(row?.endpointId || row?.endpoint_id || row?.id);
  const rowOrgId = asTrimmedString(row?.action1OrgId || row?.orgId || row?.org_id);
  if (rowEndpointId && rowEndpointId !== endpointId) return false;
  if (rowOrgId && rowOrgId !== action1OrgId) return false;
  return true;
}

function dedupeRows(rows, keyFn) {
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    const key = keyFn(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function toOptionalBoolean(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = String(value).trim().toUpperCase();
  if (!normalized) return undefined;
  return TRUE_LIKE_VALUES.has(normalized);
}

function asTrimmedString(value) {
  return String(value || "").trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

module.exports = {
  buildAction1EndpointEvaluations,
  normalizeAction1EndpointSignalInput,
  normalizeEndpointRecord,
};
