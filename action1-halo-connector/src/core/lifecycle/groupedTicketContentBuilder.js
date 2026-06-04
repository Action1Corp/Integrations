// groupedTicketContentBuilder.js
//
// Action1 Public Repository Material
//
// Use of this file is subject to TERMS_OF_USE.md (https://github.com/Action1Corp/PSAction1/blob/main/TERMS_OF_USE.md) in this repository.
// Provided AS IS, without warranties.
// Use at your own risk.
// Review, test, and validate before production use.
// © Action1 Corporation. All rights reserved.
function buildGroupedTicketContentFromCandidate(input = {}) {
  const candidate = input?.candidate && typeof input.candidate === "object" ? input.candidate : {};
  const signalType = asTrimmedString(candidate?.signal?.type).toUpperCase();
  const grouped = candidate?.grouped && typeof candidate.grouped === "object" ? candidate.grouped : {};
  const issueMetadata = grouped.issueMetadata && typeof grouped.issueMetadata === "object" ? grouped.issueMetadata : {};
  const impactedEndpointsRaw = Array.isArray(grouped.impactedEndpoints) ? grouped.impactedEndpoints : [];
  const impactedEndpointsSorted = sortImpactedEndpoints(impactedEndpointsRaw);
  const impactedEndpointCount = toPositiveInt(grouped.impactedEndpointCount, impactedEndpointsSorted.length || 0);
  const limit = normalizeVisibleLimit(input.maxImpactedEndpointsInGroupedTicket);
  const visible = impactedEndpointsSorted.slice(0, limit);
  const problemName = deriveProblemName(signalType, candidate, issueMetadata);
  const signalText = signalTitle(signalType);
  const summary = `[Action1] ${problemName} - ${signalText} on ${impactedEndpointCount} endpoints`.slice(0, 240);
  const problemUrl = buildGroupedProblemUrl({
    signalType,
    action1BaseUrl: input.action1BaseUrl,
    action1OrgId: candidate?.routing?.action1OrgId,
    issueMetadata,
  });

  const details = [];
  details.push("This ticket was created automatically by the Action1 Connector for HaloPSA.");
  details.push("");
  details.push(whyLine(signalType));
  details.push(`Action1 Organization: ${orDash(candidate?.routing?.action1OrgName)}`);
  details.push("");
  appendSignalDetails(details, signalType, issueMetadata);
  if (problemUrl) {
    details.push("");
    details.push(`${groupedProblemLinkLabel(signalType)}:`);
    details.push(problemUrl);
  }
  details.push("");
  details.push(`Showing ${visible.length} of ${impactedEndpointCount} impacted endpoints.`);
  details.push("");
  appendEndpointTable(details, signalType, visible);
  if (impactedEndpointCount > visible.length) {
    details.push("");
    details.push("Additional impacted endpoints are available in Action1.");
  }

  const endpointLinkRows = visible.map((row) => ({
    endpointId: asTrimmedString(row.endpointId || row?.endpoint?.id),
    endpointName: asTrimmedString(row.endpointName || row?.endpoint?.name),
    endpointUrl: buildAction1EndpointUrl(
      input.action1BaseUrl,
      candidate?.routing?.action1OrgId,
      row.endpointId || row?.endpoint?.id,
      row.endpointName || row?.endpoint?.name
    ),
  }));

  return {
    summary,
    details: details.join("\n"),
    detailsHtml: buildGroupedDetailsHtml({
      signalType,
      issueMetadata,
      problemUrl,
      impactedEndpointCount,
      visible,
      action1BaseUrl: input.action1BaseUrl,
      action1OrgId: candidate?.routing?.action1OrgId,
      action1OrgName: candidate?.routing?.action1OrgName,
    }),
    problemUrl,
    impactedEndpointCount,
    visibleImpactedEndpoints: visible.map(toVisibleEndpointForHash),
  };
}

function buildGroupedPayloadHashInput(input = {}) {
  const candidate = input?.candidate && typeof input.candidate === "object" ? input.candidate : {};
  const identity = candidate?.identity && typeof candidate.identity === "object" ? candidate.identity : {};
  const content = buildGroupedTicketContentFromCandidate(input);
  return {
    mode: "grouped",
    identityKey: asTrimmedString(identity.identityKey),
    orgLinkId: asTrimmedString(identity.orgLinkId),
    signalType: asTrimmedString(identity.signalType || candidate?.signal?.type),
    issueKey: asTrimmedString(candidate?.issueKey || candidate?.grouped?.issueKey),
    impactedEndpointCount: Number(content.impactedEndpointCount || 0),
    visibleImpactedEndpoints: content.visibleImpactedEndpoints,
    summary: content.summary,
    details: content.details,
    details_html: content.detailsHtml,
  };
}

function appendSignalDetails(lines, signalType, issueMetadata) {
  if (signalType === "VULNERABILITY") {
    const softwareSummary = resolveVulnerabilitySoftwareSummary(issueMetadata);
    pushField(lines, "CVE", issueMetadata.cveId || issueMetadata.id);
    pushField(lines, "CVSS", issueMetadata.cvssScore);
    pushField(lines, "Affected software", softwareSummary.softwareName || issueMetadata.softwareName || issueMetadata.packageName);
    pushField(lines, "Installed version", softwareSummary.installedVersion || issueMetadata.installedVersion || issueMetadata.version || issueMetadata.affectedVersion);
    pushField(lines, "Available update", softwareSummary.availableUpdate || issueMetadata.availableUpdate || issueMetadata.availableVersion);
    if (isKevYes(issueMetadata.cisaKev)) {
      pushField(lines, "CISA KEV", "Yes");
    }
    pushField(lines, "Remediation status", remediationLabel(issueMetadata.remediationStatus));
    pushField(lines, "Deadline", formatDateOnly(issueMetadata.remediationDeadline || issueMetadata.deadline));
    return;
  }
  if (signalType === "UPDATE") {
    pushField(lines, "Update", issueMetadata.packageName || issueMetadata.displayName || issueMetadata.id);
    pushField(lines, "Vendor", issueMetadata.vendor);
    pushField(lines, "Classification", issueMetadata.updateType || issueMetadata.classification);
    pushField(lines, "Version", issueMetadata.version || issueMetadata.versionName);
    pushField(lines, "Security severity", issueMetadata.severityLabel || issueMetadata.severity);
    pushField(lines, "Approval status", issueMetadata.approvalStatus);
    pushField(lines, "SLA status", remediationLabel(issueMetadata.slaStatus || issueMetadata.remediationStatus));
    pushField(lines, "SLA deadline", formatDateOnly(issueMetadata.slaDeadline || issueMetadata.remediationDeadline));
    pushField(lines, "Reboot needed", boolLabel(issueMetadata.rebootNeeded));
    return;
  }
  if (signalType === "AUTOMATION_FAILED") {
    pushField(lines, "Automation", issueMetadata.automationName || issueMetadata.instanceName);
    pushField(lines, "Status", issueMetadata.status);
    pushField(lines, "Started", formatDateTimeMinute(issueMetadata.startedAt || issueMetadata.startTime));
    pushField(lines, "Ended", formatDateTimeMinute(issueMetadata.endedAt || issueMetadata.endTime));
  }
}

function appendEndpointTable(lines, signalType, visible) {
  if (signalType === "AUTOMATION_FAILED") {
    const endpointWidth = Math.max(
      8,
      ...visible.map((row) => asTrimmedString(row.endpointName || row?.endpoint?.name).length)
    );
    const statusWidth = Math.max(6, ...visible.map((row) => asTrimmedString(row.status || row?.lastStatus).length));
    const timeWidth = Math.max(
      4,
      ...visible.map((row) => asTrimmedString(formatDateTimeMinute(row.time || row.failureTime || row?.endpointResultTime)).length)
    );
    lines.push(
      `${"Endpoint".padEnd(endpointWidth)}  ${"Status".padEnd(statusWidth)}  ${"Time".padEnd(timeWidth)}  Description`
    );
    lines.push("-".repeat(Math.max(28, endpointWidth + statusWidth + timeWidth + 8)));
    for (const row of visible) {
      const endpointName = orBlank(row.endpointName || row?.endpoint?.name);
      const status = orBlank(row.status || row?.lastStatus);
      const time = orBlank(formatDateTimeMinute(row.time || row.failureTime || row?.endpointResultTime));
      const description = asTrimmedString(row.description || row?.endpoint?.description);
      lines.push(
        `${endpointName.padEnd(endpointWidth)}  ${status.padEnd(statusWidth)}  ${time.padEnd(timeWidth)}  ${description}`
      );
    }
    return;
  }

  const includePlatform = visible.some((row) => asTrimmedString(row?.endpoint?.platform || row.platform));
  const endpointWidth = Math.max(
    8,
    ...visible.map((row) => asTrimmedString(row.endpointName || row?.endpoint?.name).length)
  );
  const platformWidth = Math.max(
    8,
    ...visible.map((row) => asTrimmedString(row?.endpoint?.platform || row.platform).length)
  );
  const lastSeenWidth = Math.max(
    8,
    ...visible.map((row) => asTrimmedString(formatDateTimeMinute(row?.endpoint?.lastSeenAt || row.lastSeenAt)).length)
  );
  if (includePlatform) {
    lines.push(
      `${"Endpoint".padEnd(endpointWidth)}  ${"Platform".padEnd(platformWidth)}  ${"Last Seen".padEnd(lastSeenWidth)}`
    );
  } else {
    lines.push(`${"Endpoint".padEnd(endpointWidth)}  ${"Last Seen".padEnd(lastSeenWidth)}`);
  }
  lines.push("-".repeat(Math.max(24, includePlatform ? endpointWidth + platformWidth + lastSeenWidth + 4 : endpointWidth + lastSeenWidth + 2)));
  for (const row of visible) {
    const endpointName = orBlank(row.endpointName || row?.endpoint?.name);
    const platform = asTrimmedString(row?.endpoint?.platform || row.platform);
    const lastSeen = orBlank(formatDateTimeMinute(row?.endpoint?.lastSeenAt || row.lastSeenAt));
    if (includePlatform) {
      lines.push(`${endpointName.padEnd(endpointWidth)}  ${platform.padEnd(platformWidth)}  ${lastSeen.padEnd(lastSeenWidth)}`);
    } else {
      lines.push(`${endpointName.padEnd(endpointWidth)}  ${lastSeen.padEnd(lastSeenWidth)}`);
    }
  }
}

function buildGroupedProblemUrl(input) {
  const signalType = asTrimmedString(input?.signalType).toUpperCase();
  const origin = getOrigin(input?.action1BaseUrl);
  const org = asTrimmedString(input?.action1OrgId);
  const issue = input?.issueMetadata && typeof input.issueMetadata === "object" ? input.issueMetadata : {};
  if (!origin || !org) return "";

  if (signalType === "VULNERABILITY") {
    const cveId = asTrimmedString(issue.cveId || issue.id);
    if (!cveId) return "";
    return `${origin}/console/vulnerabilities/${encodeURIComponent(cveId)}/affected_endpoints?org=${encodeURIComponent(org)}`;
  }
  if (signalType === "UPDATE") {
    const packageId = asTrimmedString(issue.packageId);
    const versionSegment = asTrimmedString(issue.version || issue.versionName || issue.versionId);
    if (!packageId || !versionSegment) return "";
    const slaStatus = asTrimmedString(issue.slaStatus || issue.remediationStatus || "All");
    return (
      `${origin}/console/updates/${encodeURIComponent(packageId)}~${encodeURIComponent(versionSegment)}` +
      `/endpoints?limit=50&from=0&only_latest=no` +
      `&update_sla_status=${encodeURIComponent(slaStatus)}&org=${encodeURIComponent(org)}` +
      `&advanced_info-limit=50&advanced_info-from=0`
    );
  }
  if (signalType === "AUTOMATION_FAILED") {
    const automationInstanceId = asTrimmedString(issue.automationInstanceId || issue.instanceId);
    if (!automationInstanceId) return "";
    return (
      `${origin}/console/automations/history/${encodeURIComponent(automationInstanceId)}` +
      `/details?limit=50&from=0&org=${encodeURIComponent(org)}`
    );
  }
  return "";
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

function deriveProblemName(signalType, candidate, issueMetadata) {
  if (signalType === "VULNERABILITY") {
    return asTrimmedString(issueMetadata.cveId || issueMetadata.id || candidate?.issueKey) || "Vulnerability";
  }
  if (signalType === "UPDATE") {
    const name = asTrimmedString(issueMetadata.packageName || issueMetadata.displayName);
    const version = asTrimmedString(issueMetadata.version || issueMetadata.versionName);
    const combined = [name, version].filter(Boolean).join(" ");
    return combined || asTrimmedString(candidate?.issueKey) || "Missing update";
  }
  if (signalType === "AUTOMATION_FAILED") {
    return (
      asTrimmedString(issueMetadata.automationName || issueMetadata.instanceName || candidate?.issueKey) ||
      "Automation run"
    );
  }
  return asTrimmedString(candidate?.issueKey) || "Issue";
}

function signalTitle(signalType) {
  if (signalType === "VULNERABILITY") return "Vulnerability detected";
  if (signalType === "UPDATE") return "Missing update detected";
  if (signalType === "AUTOMATION_FAILED") return "Automation failures detected";
  return "Signal detected";
}

function whyLine(signalType) {
  if (signalType === "VULNERABILITY") return "A vulnerability matched the configured connector filters.";
  if (signalType === "UPDATE") return "A missing update matched the configured connector filters.";
  if (signalType === "AUTOMATION_FAILED")
    return "An Action1 automation run matched the configured connector failure filters.";
  return "An Action1 signal matched the configured filters.";
}

function groupedProblemLinkLabel(signalType) {
  if (signalType === "VULNERABILITY") return "View affected endpoints in Action1";
  if (signalType === "UPDATE") return "View missing update in Action1";
  if (signalType === "AUTOMATION_FAILED") return "View automation run in Action1";
  return "View in Action1";
}

function pushField(lines, label, value) {
  const s = asTrimmedString(value);
  if (!s) return;
  lines.push(`${label}: ${s}`);
}

function boolLabel(value) {
  const s = String(value || "").trim().toLowerCase();
  if (s === "true" || s === "yes") return "Yes";
  if (s === "false" || s === "no") return "No";
  return asTrimmedString(value);
}

function remediationLabel(value) {
  const v = String(value || "").trim().toUpperCase();
  if (v === "OVERDUE") return "Overdue";
  if (v === "DUE_SOON") return "Due soon";
  if (v === "DUE_LATER") return "Due later";
  return asTrimmedString(value);
}

function normalizeVisibleLimit(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 25;
  const i = Math.trunc(n);
  if (i < 1) return 1;
  if (i > 100) return 100;
  return i;
}

function sortImpactedEndpoints(rows) {
  return (Array.isArray(rows) ? rows : []).slice().sort((a, b) => {
    const nameA = asTrimmedString(a.endpointName || a?.endpoint?.name).toLowerCase();
    const nameB = asTrimmedString(b.endpointName || b?.endpoint?.name).toLowerCase();
    if (nameA < nameB) return -1;
    if (nameA > nameB) return 1;
    return asTrimmedString(a.endpointId || a?.endpoint?.id).localeCompare(asTrimmedString(b.endpointId || b?.endpoint?.id));
  });
}

function toVisibleEndpointForHash(row) {
  return {
    endpointId: asTrimmedString(row.endpointId || row?.endpoint?.id),
    endpointName: asTrimmedString(row.endpointName || row?.endpoint?.name),
    platform: asTrimmedString(row?.endpoint?.platform || row.platform),
    lastSeenAt: asTrimmedString(formatDateTimeMinute(row?.endpoint?.lastSeenAt || row.lastSeenAt)),
    status: asTrimmedString(row.status || row.lastStatus),
    time: asTrimmedString(formatDateTimeMinute(row.time || row.failureTime || row.endpointResultTime)),
    description: asTrimmedString(row.description),
  };
}

function buildGroupedDetailsHtml(input = {}) {
  const signalType = asTrimmedString(input?.signalType).toUpperCase();
  const issueMetadata = input?.issueMetadata && typeof input.issueMetadata === "object" ? input.issueMetadata : {};
  const problemUrl = asTrimmedString(input?.problemUrl);
  const impactedEndpointCount = Number(input?.impactedEndpointCount || 0);
  const visible = Array.isArray(input?.visible) ? input.visible : [];
  const action1BaseUrl = input?.action1BaseUrl;
  const action1OrgId = input?.action1OrgId;

  const out = [];
  out.push("This ticket was created automatically by the Action1 Connector for HaloPSA.<br><br>");
  out.push(`${escapeHtml(whyLine(signalType))}<br><br>`);
  out.push(`<strong>Action1 Organization:</strong> ${escapeHtml(orDash(input?.action1OrgName))}<br><br>`);
  appendSignalDetailsHtml(out, signalType, issueMetadata);
  if (problemUrl) {
    out.push(
      `<a href="${escapeHtmlAttr(problemUrl)}">${escapeHtml(groupedProblemLinkLabel(signalType))}</a><br>`
    );
  }
  out.push("<br>");
  out.push(`Showing ${visible.length} of ${impactedEndpointCount} impacted endpoints.<br><br>`);
  out.push(buildImpactedEndpointsTableHtml(signalType, visible, action1BaseUrl, action1OrgId));
  if (impactedEndpointCount > visible.length) {
    out.push("<br>Additional impacted endpoints are available in Action1.");
  }
  return out.join("");
}

function appendSignalDetailsHtml(out, signalType, issueMetadata) {
  const pairs = [];
  if (signalType === "VULNERABILITY") {
    const softwareSummary = resolveVulnerabilitySoftwareSummary(issueMetadata);
    pairs.push(["CVE", issueMetadata.cveId || issueMetadata.id]);
    pairs.push(["CVSS", issueMetadata.cvssScore]);
    pairs.push(["Affected software", softwareSummary.softwareName || issueMetadata.softwareName || issueMetadata.packageName]);
    pairs.push(["Installed version", softwareSummary.installedVersion || issueMetadata.installedVersion || issueMetadata.version || issueMetadata.affectedVersion]);
    pairs.push(["Available update", softwareSummary.availableUpdate || issueMetadata.availableUpdate || issueMetadata.availableVersion]);
    if (isKevYes(issueMetadata.cisaKev)) {
      pairs.push(["CISA KEV", "Yes"]);
    }
    pairs.push(["Remediation status", remediationLabel(issueMetadata.remediationStatus)]);
    pairs.push(["Deadline", formatDateOnly(issueMetadata.remediationDeadline || issueMetadata.deadline)]);
  } else if (signalType === "UPDATE") {
    pairs.push(["Update", issueMetadata.packageName || issueMetadata.displayName || issueMetadata.id]);
    pairs.push(["Vendor", issueMetadata.vendor]);
    pairs.push(["Classification", issueMetadata.updateType || issueMetadata.classification]);
    pairs.push(["Version", issueMetadata.version || issueMetadata.versionName]);
    pairs.push(["Security severity", issueMetadata.severityLabel || issueMetadata.severity]);
    pairs.push(["Approval status", issueMetadata.approvalStatus]);
    pairs.push(["SLA status", remediationLabel(issueMetadata.slaStatus || issueMetadata.remediationStatus)]);
    pairs.push(["SLA deadline", formatDateOnly(issueMetadata.slaDeadline || issueMetadata.remediationDeadline)]);
    pairs.push(["Reboot needed", boolLabel(issueMetadata.rebootNeeded)]);
  } else if (signalType === "AUTOMATION_FAILED") {
    pairs.push(["Automation", issueMetadata.automationName || issueMetadata.instanceName]);
    pairs.push(["Status", issueMetadata.status]);
    pairs.push(["Started", formatDateTimeMinute(issueMetadata.startedAt || issueMetadata.startTime)]);
    pairs.push(["Ended", formatDateTimeMinute(issueMetadata.endedAt || issueMetadata.endTime)]);
  }
  for (const [label, value] of pairs) {
    const v = asTrimmedString(value);
    if (!v) continue;
    out.push(`<strong>${escapeHtml(label)}:</strong> ${escapeHtml(v)}<br>`);
  }
  out.push("<br>");
}

function buildImpactedEndpointsTableHtml(signalType, visible, action1BaseUrl, action1OrgId) {
  if (signalType === "AUTOMATION_FAILED") {
    const lines = ["Endpoint  Status  Time  Description"];
    for (const row of visible) {
      const endpointName = asTrimmedString(row.endpointName || row?.endpoint?.name);
      const endpointUrl = buildAction1EndpointUrl(
        action1BaseUrl,
        action1OrgId,
        row.endpointId || row?.endpoint?.id,
        row.endpointName || row?.endpoint?.name
      );
      const endpointCell = endpointUrl
        ? `<a href="${escapeHtmlAttr(endpointUrl)}">${escapeHtml(endpointName)}</a>`
        : escapeHtml(endpointName);
      const status = escapeHtml(asTrimmedString(row.status || row?.lastStatus));
      const time = escapeHtml(asTrimmedString(formatDateTimeMinute(row.time || row.failureTime || row?.endpointResultTime)));
      const description = escapeHtml(asTrimmedString(row.description || row?.endpoint?.description));
      lines.push(`${endpointCell}  ${status}  ${time}  ${description}`);
    }
    return lines.join("<br>");
  }

  const includePlatform = visible.some((row) => asTrimmedString(row?.endpoint?.platform || row.platform));
  const lines = [includePlatform ? "Endpoint  Platform  Last Seen" : "Endpoint  Last Seen"];
  for (const row of visible) {
    const endpointName = asTrimmedString(row.endpointName || row?.endpoint?.name);
    const endpointUrl = buildAction1EndpointUrl(
      action1BaseUrl,
      action1OrgId,
      row.endpointId || row?.endpoint?.id,
      row.endpointName || row?.endpoint?.name
    );
    const endpointCell = endpointUrl
      ? `<a href="${escapeHtmlAttr(endpointUrl)}">${escapeHtml(endpointName)}</a>`
      : escapeHtml(endpointName);
    const lastSeen = escapeHtml(asTrimmedString(formatDateTimeMinute(row?.endpoint?.lastSeenAt || row.lastSeenAt)));
    if (includePlatform) {
      const platform = escapeHtml(asTrimmedString(row?.endpoint?.platform || row.platform));
      lines.push(`${endpointCell}  ${platform}  ${lastSeen}`);
    } else {
      lines.push(`${endpointCell}  ${lastSeen}`);
    }
  }
  return lines.join("<br>");
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

function toPositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  return i > 0 ? i : fallback;
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

function asTrimmedString(value) {
  return String(value || "").trim();
}

function orBlank(value) {
  const s = asTrimmedString(value);
  return s || "";
}

function orDash(value) {
  const s = asTrimmedString(value);
  return s || "-";
}

function isKevYes(value) {
  return asTrimmedString(value).toUpperCase() === "YES";
}

function resolveVulnerabilitySoftwareSummary(issueMetadata) {
  const softwareRows = Array.isArray(issueMetadata?.software) ? issueMetadata.software : [];
  const tuples = [];
  for (const software of softwareRows) {
    const productName = asTrimmedString(software?.product_name || software?.productName || software?.name);
    const installedCandidates = Array.isArray(software?.versions) ? software.versions : [];
    const availableCandidates = Array.isArray(software?.available_updates || software?.availableUpdates)
      ? software.available_updates || software.availableUpdates
      : [];
    const installedVersion = asTrimmedString(installedCandidates[0]?.version || installedCandidates[0]?.name);
    const availableUpdate = asTrimmedString(availableCandidates[0]?.version || availableCandidates[0]?.name);
    if (!productName && !installedVersion && !availableUpdate) continue;
    tuples.push({
      productName,
      installedVersion,
      availableUpdate,
    });
  }
  tuples.sort((a, b) => {
    const p = a.productName.localeCompare(b.productName, undefined, { sensitivity: "base" });
    if (p !== 0) return p;
    const i = a.installedVersion.localeCompare(b.installedVersion, undefined, { sensitivity: "base" });
    if (i !== 0) return i;
    return a.availableUpdate.localeCompare(b.availableUpdate, undefined, { sensitivity: "base" });
  });
  if (!tuples[0]) return { softwareName: "", installedVersion: "", availableUpdate: "" };
  return {
    softwareName: tuples[0].productName,
    installedVersion: tuples[0].installedVersion,
    availableUpdate: tuples[0].availableUpdate,
  };
}

module.exports = {
  buildGroupedTicketContentFromCandidate,
  buildGroupedPayloadHashInput,
  buildGroupedProblemUrl,
};
