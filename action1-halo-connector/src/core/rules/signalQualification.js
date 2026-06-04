// signalQualification.js
//
// Action1 Public Repository Material
//
// Use of this file is subject to TERMS_OF_USE.md (https://github.com/Action1Corp/PSAction1/blob/main/TERMS_OF_USE.md) in this repository.
// Provided AS IS, without warranties.
// Use at your own risk.
// Review, test, and validate before production use.
// © Action1 Corporation. All rights reserved.
const { SIGNAL_TYPES, SIGNAL_TYPE_VALUES } = require("../types/signals");
const {
  normalizeSignalRulesConfig,
  REMEDIATION_STATUS_ALIASES,
  UPDATE_SEVERITY_ALIASES,
  VULNERABILITY_SEVERITY_ALIASES,
} = require("./signalRulesConfig");

const DAY_MS = 24 * 60 * 60 * 1000;

const TRUE_LIKE_VALUES = new Set(["1", "TRUE", "YES", "Y", "REQUIRED"]);

const UPDATE_UNSPECIFIED_FALLBACKS = new Set(["", "UNSPECIFIED", "OTHER", "UNKNOWN", "N/A", "NA", "NONE"]);

/**
 * Pure endpoint-level qualification for all v1 signals.
 *
 * @param {{
 *  config: any,
 *  endpoint: any,
 *  signals?: {
 *    vulnerabilities?: any[],
 *    updates?: any[],
 *    automationFailed?: any[],
 *  },
 *  now?: Date|string|number
 * }} input
 * @returns {Array<{
 *  signalType: string,
 *  qualifies: boolean,
 *  reason: string,
 *  matchedCount: number,
 *  matchedItemsPreview: any[],
 *  details: Object
 * }>}
 */
function qualifyEndpointSignals(input) {
  const normalizedConfig = normalizeSignalRulesConfig(input?.config || {});
  const endpoint = input?.endpoint && typeof input.endpoint === "object" ? input.endpoint : {};
  const signals = input?.signals && typeof input.signals === "object" ? input.signals : {};
  const nowDate = normalizeNow(input?.now);

  const results = [];
  results.push(qualifyOffline(endpoint, normalizedConfig.signalFilters.offline, nowDate));
  results.push(qualifyRebootRequired(endpoint, normalizedConfig.signalFilters.rebootRequired));
  results.push(qualifyAutomationFailed(signals.automationFailed, normalizedConfig.signalFilters.automationFailed));
  results.push(qualifyVulnerability(signals.vulnerabilities, normalizedConfig.signalFilters.vulnerability));
  results.push(qualifyUpdate(signals.updates, normalizedConfig.signalFilters.update));

  return SIGNAL_TYPE_VALUES.map((signalType) => results.find((row) => row.signalType === signalType)).filter(Boolean);
}

function qualifyOffline(endpoint, filter, now) {
  if (!filter?.enabled) {
    return baseResult(SIGNAL_TYPES.OFFLINE, false, "signal_disabled");
  }
  const lastSeen = parseAction1DateTime(endpoint?.lastSeenAt || endpoint?.last_seen);
  if (!lastSeen) {
    return {
      ...baseResult(SIGNAL_TYPES.OFFLINE, false, "missing_last_seen"),
      details: {
        thresholdDays: filter.thresholdDays,
      },
    };
  }
  const offlineDays = Math.floor((now.getTime() - lastSeen.getTime()) / DAY_MS);
  const qualifies = Number.isFinite(offlineDays) && offlineDays >= Number(filter.thresholdDays || 0);
  return {
    ...baseResult(
      SIGNAL_TYPES.OFFLINE,
      qualifies,
      qualifies ? "offline_threshold_met" : "offline_threshold_not_met",
      qualifies ? 1 : 0
    ),
    details: {
      thresholdDays: Number(filter.thresholdDays || 0),
      offlineDays,
    },
    matchedItemsPreview: qualifies
      ? [
          {
            offlineDays,
          },
        ]
      : [],
  };
}

function qualifyRebootRequired(endpoint, filter) {
  if (!filter?.enabled) {
    return baseResult(SIGNAL_TYPES.REBOOT_REQUIRED, false, "signal_disabled");
  }
  const raw = endpoint?.rebootRequired !== undefined ? endpoint.rebootRequired : endpoint?.reboot_required;
  const qualifies = isTrueLike(raw);
  return {
    ...baseResult(
      SIGNAL_TYPES.REBOOT_REQUIRED,
      qualifies,
      qualifies ? "reboot_required" : "reboot_not_required",
      qualifies ? 1 : 0
    ),
    matchedItemsPreview: qualifies
      ? [
          {
            rebootRequired: true,
          },
        ]
      : [],
  };
}

function qualifyAutomationFailed(items, filter) {
  if (!filter?.enabled) {
    return baseResult(SIGNAL_TYPES.AUTOMATION_FAILED, false, "signal_disabled");
  }
  const rows = Array.isArray(items) ? items : [];
  const matched = rows.filter((item) => isAutomationFailure(item));
  const qualifies = matched.length > 0;
  return {
    ...baseResult(
      SIGNAL_TYPES.AUTOMATION_FAILED,
      qualifies,
      qualifies ? "automation_failure_detected" : "no_automation_failure",
      matched.length
    ),
    matchedItemsPreview: matched.slice(0, 10).map(toMinimalFailurePreview),
  };
}

function qualifyVulnerability(items, filter) {
  if (!filter?.enabled || !Array.isArray(filter.severities) || filter.severities.length === 0) {
    return baseResult(SIGNAL_TYPES.VULNERABILITY, false, "signal_disabled");
  }
  const allowedSeverities = new Set(filter.severities.map((value) => String(value || "").toUpperCase()));
  const allowedRemediation = new Set((filter.remediationStatuses || []).map((value) => String(value || "").toUpperCase()));
  const rows = Array.isArray(items) ? items : [];
  const matched = rows.filter((item) => {
    const severity = normalizeVulnerabilitySeverity(item);
    if (!severity || !allowedSeverities.has(severity)) return false;
    if (allowedRemediation.size === 0) return true;
    const remediation = normalizeRemediationStatus(item);
    return remediation ? allowedRemediation.has(remediation) : false;
  });
  const sortedMatched = sortVulnerabilityMatches(matched);
  const qualifies = sortedMatched.length > 0;
  return {
    ...baseResult(
      SIGNAL_TYPES.VULNERABILITY,
      qualifies,
      qualifies ? "vulnerability_match" : "no_vulnerability_match",
      sortedMatched.length
    ),
    matchedItemsPreview: sortedMatched.slice(0, 10).map(toMinimalVulnerabilityPreview),
    matchedItemsForGrouping: sortedMatched.map(toMinimalVulnerabilityPreview),
    details: {
      severityCounts: summarizeSeverityCounts(sortedMatched, normalizeVulnerabilitySeverity),
      enabledSeverities: Array.from(allowedSeverities),
    },
  };
}

function qualifyUpdate(items, filter) {
  if (!filter?.enabled || !Array.isArray(filter.severities) || filter.severities.length === 0) {
    return baseResult(SIGNAL_TYPES.UPDATE, false, "signal_disabled");
  }
  const allowedSeverities = new Set(filter.severities.map((value) => String(value || "").toUpperCase()));
  const allowedRemediation = new Set((filter.remediationStatuses || []).map((value) => String(value || "").toUpperCase()));
  const rows = Array.isArray(items) ? items : [];
  const matched = rows.filter((item) => {
    const severity = normalizeUpdateSeverity(item);
    if (!severity || !allowedSeverities.has(severity)) return false;
    if (allowedRemediation.size === 0) return true;
    const remediation = normalizeRemediationStatus(item);
    return remediation ? allowedRemediation.has(remediation) : false;
  });
  const sortedMatched = sortUpdateMatches(matched);
  const qualifies = sortedMatched.length > 0;
  return {
    ...baseResult(SIGNAL_TYPES.UPDATE, qualifies, qualifies ? "update_match" : "no_update_match", sortedMatched.length),
    matchedItemsPreview: sortedMatched.slice(0, 10).map(toMinimalUpdatePreview),
    matchedItemsForGrouping: sortedMatched.map(toMinimalUpdatePreview),
    details: {
      severityCounts: summarizeSeverityCounts(sortedMatched, normalizeUpdateSeverity),
      enabledSeverities: Array.from(allowedSeverities),
    },
  };
}

function baseResult(signalType, qualifies, reason, matchedCount = 0) {
  return {
    signalType,
    qualifies: Boolean(qualifies),
    reason: String(reason || ""),
    matchedCount: Number(matchedCount || 0),
    matchedItemsPreview: [],
    details: {},
  };
}

function normalizeNow(nowRaw) {
  if (nowRaw instanceof Date && Number.isFinite(nowRaw.getTime())) return new Date(nowRaw.getTime());
  if (typeof nowRaw === "string" || typeof nowRaw === "number") {
    const dt = new Date(nowRaw);
    if (Number.isFinite(dt.getTime())) return dt;
  }
  return new Date();
}

function parseAction1DateTime(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const dtDate = new Date(`${s}T00:00:00Z`);
    return Number.isFinite(dtDate.getTime()) ? dtDate : null;
  }

  const action1DateTime = s.match(/^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})$/);
  if (action1DateTime) {
    const [, d, hh, mm, ss] = action1DateTime;
    const dtDate = new Date(`${d}T${hh}:${mm}:${ss}Z`);
    return Number.isFinite(dtDate.getTime()) ? dtDate : null;
  }

  const timestamp = Date.parse(s);
  if (!Number.isNaN(timestamp)) return new Date(timestamp);
  return null;
}

function isTrueLike(value) {
  if (value === true) return true;
  if (value === false || value === null || value === undefined) return false;
  if (typeof value === "number") return value !== 0;
  const normalized = String(value).trim().toUpperCase();
  return TRUE_LIKE_VALUES.has(normalized);
}

function isAutomationFailure(item) {
  if (!item || typeof item !== "object") return false;
  if (item.failed === true || item.isFailed === true) return true;
  const statusRaw =
    item.status !== undefined
      ? item.status
      : item.lastStatus !== undefined
        ? item.lastStatus
        : item.last_status;
  const status = String(statusRaw || "").trim().toUpperCase();
  if (status === "FAILED" || status === "ERROR") return true;
  return false;
}

function normalizeVulnerabilitySeverity(item) {
  const direct =
    item?.severityBucket !== undefined
      ? item.severityBucket
      : item?.severity !== undefined
        ? item.severity
        : item?.security_severity;
  const directValue = String(direct || "").trim().toUpperCase();
  if (directValue && VULNERABILITY_SEVERITY_ALIASES[directValue]) {
    return VULNERABILITY_SEVERITY_ALIASES[directValue];
  }

  const cvssRaw =
    item?.cvssScore !== undefined
      ? item.cvssScore
      : item?.cvss_score !== undefined
        ? item.cvss_score
        : item?.cvss;
  const cvss = Number.parseFloat(String(cvssRaw || ""));
  if (!Number.isFinite(cvss)) return "";
  if (cvss >= 9.0) return "CRITICAL";
  if (cvss >= 7.0) return "HIGH";
  if (cvss >= 4.0) return "MEDIUM";
  return "LOW";
}

function normalizeUpdateSeverity(item) {
  const raw =
    item?.severity !== undefined
      ? item.severity
      : item?.security_severity !== undefined
        ? item.security_severity
        : item?.severityBucket;
  const value = String(raw || "").trim().toUpperCase();
  if (UPDATE_SEVERITY_ALIASES[value]) return UPDATE_SEVERITY_ALIASES[value];
  if (UPDATE_UNSPECIFIED_FALLBACKS.has(value)) return "UNSPECIFIED";
  return "";
}

function normalizeRemediationStatus(item) {
  const raw =
    item?.remediationStatus !== undefined
      ? item.remediationStatus
      : item?.remediation_status !== undefined
        ? item.remediation_status
        : item?.slaStatus !== undefined
          ? item.slaStatus
          : item?.update_sla_status;
  const value = String(raw || "").trim().toUpperCase();
  return REMEDIATION_STATUS_ALIASES[value] || "";
}

function toMinimalFailurePreview(item) {
  return {
    instanceId: String(item?.instanceId || item?.automationInstanceId || ""),
    status: String(item?.status || item?.lastStatus || item?.last_status || ""),
    description: String(item?.description || ""),
    instanceName: String(item?.instanceName || item?.instance_name || item?.automationName || ""),
    startedAt: String(item?.startedAt || item?.startTime || item?.start_time || ""),
    endedAt: String(item?.endedAt || item?.endTime || item?.end_time || ""),
    failureTime: String(item?.failureTime || item?.instanceEndTime || item?.end_time || ""),
    actionName: String(item?.actionName || item?.action_name || ""),
    percentCompleted:
      Number.isFinite(Number(item?.percentCompleted))
        ? Number(item?.percentCompleted)
        : Number.isFinite(Number(item?.percent_completed))
          ? Number(item?.percent_completed)
          : null,
  };
}

function toMinimalVulnerabilityPreview(item) {
  return {
    id: String(item?.id || item?.cveId || item?.cve_id || ""),
    severity: normalizeVulnerabilitySeverity(item),
    remediationStatus: normalizeRemediationStatus(item),
    cvssScore:
      item?.cvssScore !== undefined
        ? Number(item.cvssScore)
        : item?.cvss_score !== undefined
          ? Number(item.cvss_score)
          : item?.cvss !== undefined
            ? Number(item.cvss)
            : null,
    publishedDate: String(item?.publishedDate || item?.published_date || ""),
    remediationDeadline: String(item?.remediationDeadline || item?.remediation_deadline || ""),
    cisaKev: String(item?.cisaKev || item?.cisa_kev || ""),
    software: Array.isArray(item?.software) ? item.software : [],
  };
}

function toMinimalUpdatePreview(item) {
  return {
    id: String(item?.id || item?.versionId || item?.version_id || ""),
    packageId: String(item?.packageId || ""),
    versionId: String(item?.versionId || ""),
    severity: normalizeUpdateSeverity(item),
    remediationStatus: normalizeRemediationStatus(item),
    packageName: String(item?.packageName || item?.package_name || item?.displayName || ""),
    version: String(item?.version || ""),
    vendor: String(item?.vendor || item?.publisher || ""),
    updateType: String(item?.updateType || item?.update_type || ""),
    classification: String(item?.classification || item?.category || ""),
    securityCve: String(item?.securityCve || item?.security_CVE || ""),
    remediationDeadline: String(item?.remediationDeadline || item?.update_sla_deadline || ""),
    severityLabel: toUpdateSeverityLabel(normalizeUpdateSeverity(item)),
    remediationStatusLabel: toRemediationLabel(normalizeRemediationStatus(item)),
  };
}

function toUpdateSeverityLabel(severity) {
  const s = String(severity || "").toUpperCase();
  if (s === "CRITICAL") return "Critical";
  if (s === "IMPORTANT") return "Important";
  if (s === "MODERATE") return "Moderate";
  if (s === "LOW") return "Low";
  if (s === "UNSPECIFIED") return "Unspecified";
  return "";
}

function toRemediationLabel(value) {
  const v = String(value || "").toUpperCase();
  if (v === "OVERDUE") return "Overdue";
  if (v === "DUE_SOON") return "Due soon";
  return String(value || "");
}

function summarizeSeverityCounts(rows, severityNormalizer) {
  const out = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const sev = String(severityNormalizer(row) || "").toUpperCase();
    if (!sev) continue;
    out[sev] = Number(out[sev] || 0) + 1;
  }
  return out;
}

function sortVulnerabilityMatches(rows) {
  const out = Array.isArray(rows) ? rows.slice() : [];
  return out.sort((a, b) => {
    const cvss = numDesc(a?.cvssScore ?? a?.cvss_score ?? a?.cvss, b?.cvssScore ?? b?.cvss_score ?? b?.cvss);
    if (cvss !== 0) return cvss;
    const deadline = dateAsc(a?.remediationDeadline ?? a?.remediation_deadline, b?.remediationDeadline ?? b?.remediation_deadline);
    if (deadline !== 0) return deadline;
    const severity = rankDesc(vulnerabilitySeverityRank(normalizeVulnerabilitySeverity(a)), vulnerabilitySeverityRank(normalizeVulnerabilitySeverity(b)));
    if (severity !== 0) return severity;
    return strAsc(a?.id ?? a?.cveId ?? a?.cve_id, b?.id ?? b?.cveId ?? b?.cve_id);
  });
}

function sortUpdateMatches(rows) {
  const out = Array.isArray(rows) ? rows.slice() : [];
  return out.sort((a, b) => {
    const severity = rankDesc(updateSeverityRank(normalizeUpdateSeverity(a)), updateSeverityRank(normalizeUpdateSeverity(b)));
    if (severity !== 0) return severity;
    const sla = rankDesc(updateSlaRank(normalizeRemediationStatus(a)), updateSlaRank(normalizeRemediationStatus(b)));
    if (sla !== 0) return sla;
    const deadline = dateAsc(a?.remediationDeadline ?? a?.update_sla_deadline, b?.remediationDeadline ?? b?.update_sla_deadline);
    if (deadline !== 0) return deadline;
    const name = strAsc(a?.packageName ?? a?.package_name ?? a?.displayName ?? a?.name, b?.packageName ?? b?.package_name ?? b?.displayName ?? b?.name);
    if (name !== 0) return name;
    return strAsc(a?.version ?? a?.version_name, b?.version ?? b?.version_name);
  });
}

function vulnerabilitySeverityRank(sev) {
  const s = String(sev || "").toUpperCase();
  if (s === "CRITICAL") return 4;
  if (s === "HIGH") return 3;
  if (s === "MEDIUM") return 2;
  if (s === "LOW") return 1;
  return 0;
}

function updateSeverityRank(sev) {
  const s = String(sev || "").toUpperCase();
  if (s === "CRITICAL") return 5;
  if (s === "IMPORTANT") return 4;
  if (s === "MODERATE") return 3;
  if (s === "LOW") return 2;
  if (s === "UNSPECIFIED") return 1;
  return 0;
}

function updateSlaRank(status) {
  const s = String(status || "").toUpperCase();
  if (s === "OVERDUE") return 4;
  if (s === "DUE_SOON") return 3;
  if (s === "DUE_LATER") return 2;
  return 1;
}

function numDesc(a, b) {
  const na = Number(a);
  const nb = Number(b);
  const va = Number.isFinite(na) ? na : -Infinity;
  const vb = Number.isFinite(nb) ? nb : -Infinity;
  return vb - va;
}

function rankDesc(a, b) {
  return b - a;
}

function dateAsc(a, b) {
  const ta = Date.parse(String(a || ""));
  const tb = Date.parse(String(b || ""));
  const va = Number.isFinite(ta) ? ta : Number.MAX_SAFE_INTEGER;
  const vb = Number.isFinite(tb) ? tb : Number.MAX_SAFE_INTEGER;
  return va - vb;
}

function strAsc(a, b) {
  return String(a || "").localeCompare(String(b || ""), undefined, { sensitivity: "base" });
}

module.exports = {
  qualifyEndpointSignals,
  parseAction1DateTime,
  normalizeUpdateSeverity,
  normalizeVulnerabilitySeverity,
  normalizeRemediationStatus,
};
