// ticketContentBuilder.js
//
// Action1 Public Repository Material
//
// Use of this file is subject to TERMS_OF_USE.md (https://github.com/Action1Corp/PSAction1/blob/main/TERMS_OF_USE.md) in this repository.
// Provided AS IS, without warranties.
// Use at your own risk.
// Review, test, and validate before production use.
// © Action1 Corporation. All rights reserved.
const SIGNAL_TITLES = Object.freeze({
  OFFLINE: "Endpoint offline",
  REBOOT_REQUIRED: "Reboot required",
  VULNERABILITY: "Vulnerabilities detected",
  UPDATE: "Updates required",
  AUTOMATION_FAILED: "Automation failures detected",
});

const TOP_ITEM_LIMIT = 10;

function buildTicketContentFromCandidate(input = {}) {
  const candidate = input?.candidate && typeof input.candidate === "object" ? input.candidate : {};
  const signalType = asTrimmedString(candidate?.signal?.type).toUpperCase() || "UNKNOWN";
  const endpointName = asTrimmedString(candidate?.endpoint?.name) || asTrimmedString(candidate?.endpoint?.id) || "Unknown Endpoint";
  const signalTitle = SIGNAL_TITLES[signalType] || signalType;
  const action1Url = buildAction1EndpointUrl(
    input.action1BaseUrl,
    candidate?.routing?.action1OrgId,
    candidate?.endpoint?.id,
    candidate?.endpoint?.name
  );
  const detailsLines = [];
  const matches = Array.isArray(candidate?.signal?.matchedItemsPreview) ? candidate.signal.matchedItemsPreview : [];
  const matchedCount = Number(candidate?.signal?.matchedCount || 0);

  detailsLines.push(`Endpoint: ${endpointName}`);
  if (candidate?.endpoint?.os || candidate?.endpoint?.platform) {
    detailsLines.push(`Platform details: OS ${orDash(candidate?.endpoint?.os)} | Platform ${orDash(candidate?.endpoint?.platform)}`);
  }
  detailsLines.push(`Last seen: ${formatDateTimeMinute(candidate?.endpoint?.lastSeenAt) || "-"}`);
  if (action1Url) {
    detailsLines.push("Action1 endpoint:");
    detailsLines.push(action1Url);
    detailsLines.push("");
  }
  detailsLines.push(`Signal: ${signalTitle}`);
  detailsLines.push(`Action1 Organization: ${orDash(candidate?.routing?.action1OrgName)}`);
  detailsLines.push("");
  detailsLines.push("Why this ticket was created:");
  detailsLines.push(buildWhySection(signalType));
  detailsLines.push("");
  appendSignalSpecificSections(detailsLines, signalType, candidate, matches, matchedCount);

  return {
    summary: `[Action1] ${endpointName} - ${signalTitle}`.slice(0, 240),
    details: detailsLines.join("\n"),
    detailsHtml: buildDetailsHtml(detailsLines),
    topItems: Math.min(matches.length, TOP_ITEM_LIMIT),
  };
}

function appendSignalSpecificSections(lines, signalType, candidate, matches, matchedCount) {
  if (signalType === "OFFLINE") {
    lines.push(`Offline threshold (days): ${orDash(candidate?.signal?.details?.thresholdDays)}`);
    return;
  }
  if (signalType === "REBOOT_REQUIRED") {
    lines.push(`Reboot status in Action1: ${candidate?.endpoint?.rebootRequired === true ? "Required" : "Unknown"}`);
    return;
  }

  if (signalType === "VULNERABILITY") {
    lines.push("Matching vulnerability groups:");
    const bySev = candidate?.signal?.details?.severityCounts || summarizeBy(matches, (row) => asTrimmedString(row?.severity).toUpperCase());
    const enabled = normalizeEnabledSeverities(candidate?.signal?.details?.enabledSeverities, ["CRITICAL", "HIGH", "MEDIUM", "LOW"]);
    for (const key of enabled) {
      lines.push(`${key}: ${Number(bySev[key] || 0)} matched`);
    }
    lines.push("");
    lines.push("Top vulnerability items:");
    lines.push("");
  } else if (signalType === "UPDATE") {
    lines.push("Matching update groups:");
    const bySev = candidate?.signal?.details?.severityCounts || summarizeBy(matches, (row) => asTrimmedString(row?.severity).toUpperCase());
    const enabled = normalizeEnabledSeverities(candidate?.signal?.details?.enabledSeverities, [
      "CRITICAL",
      "IMPORTANT",
      "MODERATE",
      "LOW",
      "UNSPECIFIED",
    ]);
    for (const pair of [["CRITICAL", "Critical"], ["IMPORTANT", "Important"], ["MODERATE", "Moderate"], ["LOW", "Low"], ["UNSPECIFIED", "Unspecified"]]) {
      if (!enabled.includes(pair[0])) continue;
      lines.push(`${pair[1]}: ${Number(bySev[pair[0]] || 0)} matched`);
    }
    lines.push("");
    lines.push("Top missing update items:");
    lines.push("");
  } else if (signalType === "AUTOMATION_FAILED") {
    lines.push(`Last failure: ${formatAutomationLastLine(matches[0])}`);
    lines.push("");
    lines.push("Recent automation failures:");
  }

  const sorted = sortTopItems(signalType, matches);
  const visible = sorted.slice(0, TOP_ITEM_LIMIT);
  if (signalType === "VULNERABILITY") {
    for (const row of visible) {
      lines.push(
        `- ${orDash(row?.id || row?.cveId)} | CVSS ${orDash(row?.cvssScore)} | status ${orDash(
          toRemediationLabel(row?.remediationStatus)
        )} | published ${formatDateOnly(row?.publishedDate)} | deadline ${formatDateOnly(row?.remediationDeadline)}`
      );
    }
  } else if (signalType === "UPDATE") {
    for (const row of visible) {
      lines.push(
        `- ${orDash(toFriendlyPackageName(row?.packageName || row?.displayName || row?.id))} | version ${orDash(
          row?.version || deriveVersionFromIdentifier(row?.id)
        )} | severity ${orDash(
          row?.severityLabel || row?.severity
        )} | SLA ${orDash(row?.remediationStatusLabel || toRemediationLabel(row?.remediationStatus))} | deadline ${formatDateOnly(
          row?.remediationDeadline
        )}${formatCvePreview(
          row?.securityCve
        )}`
      );
    }
  } else if (signalType === "AUTOMATION_FAILED") {
    for (const row of visible) {
      lines.push(
        `- ${orDash(row?.instanceName || row?.description || "Automation")} | ${formatDateTimeMinute(
          row?.failureTime
        )} | status ${orDash(row?.status)} | action ${orDash(row?.actionName)} | completion ${orDash(row?.percentCompleted)}% | ${orDash(row?.description)}`
      );
    }
  }
  if (matchedCount > visible.length) {
    const label =
      signalType === "VULNERABILITY" ? "vulnerabilities" : signalType === "UPDATE" ? "updates" : "automation failures";
    lines.push(`Only the first ${TOP_ITEM_LIMIT} matching ${label} are shown. See Action1 for full details.`);
  }
}

function buildWhySection(signalType) {
  if (signalType === "OFFLINE") return "This endpoint has not checked in to Action1 within the configured offline threshold.";
  if (signalType === "REBOOT_REQUIRED") return "This endpoint is marked in Action1 as requiring a reboot.";
  if (signalType === "VULNERABILITY")
    return "This endpoint has vulnerabilities that match the configured severity and remediation filters.";
  if (signalType === "UPDATE") return "This endpoint has missing updates that match the configured severity and remediation filters.";
  if (signalType === "AUTOMATION_FAILED")
    return "Action1 detected one or more recent automation failures for this endpoint within the lookback window.";
  return "This endpoint matched the configured Action1 signal conditions.";
}

function buildAction1EndpointUrl(apiBaseUrl, orgId, endpointId, endpointName) {
  const origin = getOrigin(apiBaseUrl);
  const org = asTrimmedString(orgId);
  const endpoint = asTrimmedString(endpointId);
  const filterValue = asTrimmedString(endpointName) || endpoint;
  if (!origin || !org || !filterValue) return "";
  return `${origin}/console/endpoints?limit=20&from=0&org=${encodeURIComponent(org)}&filter=${encodeURIComponent(filterValue)}`;
}

function getOrigin(baseUrl) {
  try {
    const u = new URL(String(baseUrl || ""));
    return `${u.protocol}//${u.host}`;
  } catch {
    return "";
  }
}

function summarizeBy(rows, keyFn) {
  const out = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = keyFn(row);
    if (!key) continue;
    out[key] = Number(out[key] || 0) + 1;
  }
  return out;
}

function formatDateTimeMinute(raw) {
  const parts = parseDateParts(raw);
  if (!parts) return asTrimmedString(raw);
  if (!parts.hour || !parts.minute) return `${parts.year}-${parts.month}-${parts.day}`;
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function formatDateOnly(raw) {
  const parts = parseDateParts(raw);
  if (!parts) return asTrimmedString(raw);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function parseDateParts(raw) {
  const s = asTrimmedString(raw);
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ _T](\d{2})[-:](\d{2})(?:[-:](\d{2}))?)?/);
  if (m) return { year: m[1], month: m[2], day: m[3], hour: m[4] || null, minute: m[5] || null };
  const dt = new Date(s);
  if (!Number.isFinite(dt.getTime())) return null;
  return {
    year: String(dt.getUTCFullYear()),
    month: String(dt.getUTCMonth() + 1).padStart(2, "0"),
    day: String(dt.getUTCDate()).padStart(2, "0"),
    hour: String(dt.getUTCHours()).padStart(2, "0"),
    minute: String(dt.getUTCMinutes()).padStart(2, "0"),
  };
}

function formatCvePreview(raw) {
  const list = String(raw || "")
    .split(/[,\n;]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  if (list.length === 0) return "";
  const visible = list.slice(0, 3);
  const rem = list.length - visible.length;
  if (rem > 0) return ` | CVEs: ${visible.join(", ")} + ${rem} more`;
  return ` | CVEs: ${visible.join(", ")}`;
}

function formatAutomationLastLine(row) {
  if (!row) return "(none)";
  return `${orDash(row?.instanceName || row?.description)} | ${formatDateTimeMinute(row?.failureTime)} | ${orDash(row?.description)}`;
}

function sortTopItems(signalType, rows) {
  const arr = Array.isArray(rows) ? rows.slice() : [];
  if (signalType === "VULNERABILITY") {
    return arr.sort((a, b) => {
      const cvss = numDesc(a?.cvssScore, b?.cvssScore);
      if (cvss !== 0) return cvss;
      const ddl = dateAsc(a?.remediationDeadline, b?.remediationDeadline);
      if (ddl !== 0) return ddl;
      const sev = rankDesc(vulnSeverityRank(a?.severity), vulnSeverityRank(b?.severity));
      if (sev !== 0) return sev;
      return strAsc(a?.id, b?.id);
    });
  }
  if (signalType === "UPDATE") {
    return arr.sort((a, b) => {
      const sev = rankDesc(updateSeverityRank(a?.severity), updateSeverityRank(b?.severity));
      if (sev !== 0) return sev;
      const rem = rankDesc(updateSlaRank(a?.remediationStatus), updateSlaRank(b?.remediationStatus));
      if (rem !== 0) return rem;
      const ddl = dateAsc(a?.remediationDeadline, b?.remediationDeadline);
      if (ddl !== 0) return ddl;
      const name = strAsc(toFriendlyPackageName(a?.packageName || a?.id), toFriendlyPackageName(b?.packageName || b?.id));
      if (name !== 0) return name;
      return strAsc(a?.version, b?.version);
    });
  }
  return arr;
}

function vulnSeverityRank(sev) {
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

function remediationRank(status) {
  const s = String(status || "").toUpperCase();
  if (s === "OVERDUE") return 3;
  if (s === "DUE_SOON") return 2;
  return 1;
}

function normalizeEnabledSeverities(values, fallback) {
  const allowed = new Set(fallback.map((v) => String(v || "").toUpperCase()));
  if (!Array.isArray(values) || values.length === 0) return fallback.slice();
  const out = [];
  for (const value of values) {
    const normalized = String(value || "").toUpperCase();
    if (!allowed.has(normalized)) continue;
    if (out.includes(normalized)) continue;
    out.push(normalized);
  }
  return out.length > 0 ? out : fallback.slice();
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

function toFriendlyPackageName(name) {
  const raw = asTrimmedString(name);
  if (!raw) return "";
  if (raw.includes(" ") && !raw.includes("_") && !raw.includes(":")) return raw;
  const withoutPrefix = raw.replace(/^[A-Za-z0-9]+_/, "");
  const left = withoutPrefix.split(":")[0];
  const tokenized = left
    .split(/[_-]+/)
    .filter(Boolean)
    .filter((token) => !/^\d+$/.test(token) && !/^builtin$/i.test(token));
  if (tokenized.length === 0) return raw;
  return tokenized
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
    .join(" ");
}

function deriveVersionFromIdentifier(id) {
  const s = asTrimmedString(id);
  if (!s) return "";
  const m = s.match(/:(\d+(?:\.\d+){1,})/);
  return m ? m[1] : "";
}

function toRemediationLabel(value) {
  const v = String(value || "").toUpperCase();
  if (v === "OVERDUE") return "Overdue";
  if (v === "DUE_SOON") return "Due soon";
  return asTrimmedString(value);
}

function asTrimmedString(value) {
  return String(value || "").trim();
}

function orDash(value) {
  const s = asTrimmedString(value);
  return s || "-";
}

module.exports = {
  buildTicketContentFromCandidate,
  buildAction1EndpointUrl,
};

function buildDetailsHtml(lines) {
  const input = Array.isArray(lines) ? lines : [];
  const out = [];
  const simpleLabels = new Set([
    "Endpoint:",
    "Platform details:",
    "Last seen:",
    "Signal:",
    "Action1 Organization:",
    "Offline threshold (days):",
    "Reboot status in Action1:",
  ]);
  const blockHeaders = new Set([
    "Why this ticket was created:",
    "Matching vulnerability groups:",
    "Matching update groups:",
    "Top vulnerability items:",
    "Top missing update items:",
    "Recent automation failures:",
    "Action1 endpoint:",
  ]);

  for (let i = 0; i < input.length; i += 1) {
    const line = String(input[i] || "");
    if (!line) {
      out.push("<br>");
      continue;
    }
    if (blockHeaders.has(line)) {
      out.push(`<strong>${escapeHtml(line)}</strong><br>`);
      continue;
    }
    if (line.startsWith("Action1 endpoint:")) {
      out.push("<strong>Action1 endpoint:</strong><br>");
      continue;
    }
    if (line.startsWith("http://") || line.startsWith("https://")) {
      const href = escapeHtmlAttr(line);
      out.push(`<a href="${href}">Open endpoint in Action1</a><br>`);
      continue;
    }
    const labelMatch = line.match(/^([^:]+:)\s*(.*)$/);
    if (labelMatch && simpleLabels.has(labelMatch[1])) {
      out.push(`<strong>${escapeHtml(labelMatch[1])}</strong> ${escapeHtml(labelMatch[2])}<br>`);
      continue;
    }
    out.push(`${escapeHtml(line)}<br>`);
  }
  return out.join("");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeHtmlAttr(value) {
  return escapeHtml(value);
}
