// groupedCandidateAggregator.js
//
// Action1 Public Repository Material
//
// Use of this file is subject to TERMS_OF_USE.md (https://github.com/Action1Corp/PSAction1/blob/main/TERMS_OF_USE.md) in this repository.
// Provided AS IS, without warranties.
// Use at your own risk.
// Review, test, and validate before production use.
// © Action1 Corporation. All rights reserved.
const { buildGroupedCandidateIdentity } = require("./groupedCandidateIdentity");

function aggregateGroupedCandidates(input = {}) {
  const candidates = Array.isArray(input.candidates) ? input.candidates : [];
  const groupedModeBySignal = normalizeGroupedModeBySignal(input.normalizedConfig);
  const groupedBuckets = new Map();
  const keptEndpointCandidates = [];
  const skipped = [];
  const diagnostics = {
    vulnerabilityGroupedPrep: {
      endpointFindingsMatched: 0,
      uniqueIssueKeys: 0,
      groupedCandidates: 0,
      skippedMissingIdentity: 0,
      truncatedByCap: 0,
    },
  };
  const vulnerabilityIssueKeys = new Set();

  for (const candidate of candidates) {
    const signalType = asTrimmedString(candidate?.signal?.type).toUpperCase();
    const groupedModeEnabled = groupedModeBySignal[signalType] === "grouped";

    if (!groupedModeEnabled || signalType === "OFFLINE" || signalType === "REBOOT_REQUIRED") {
      keptEndpointCandidates.push(withEndpointTicketModel(candidate));
      continue;
    }

    const matchedItemsForGrouping = Array.isArray(candidate?.signal?.matchedItemsForGrouping)
      ? candidate.signal.matchedItemsForGrouping
      : [];
    const matchedItemsPreview = Array.isArray(candidate?.signal?.matchedItemsPreview) ? candidate.signal.matchedItemsPreview : [];
    const matchedItems = matchedItemsForGrouping.length > 0 ? matchedItemsForGrouping : matchedItemsPreview;
    if (signalType === "VULNERABILITY") {
      diagnostics.vulnerabilityGroupedPrep.endpointFindingsMatched += matchedItems.length;
    }
    if (matchedItems.length === 0) {
      if (signalType === "VULNERABILITY") diagnostics.vulnerabilityGroupedPrep.skippedMissingIdentity += 1;
      skipped.push({
        action1OrgId: asTrimmedString(candidate?.routing?.action1OrgId),
        endpointId: asTrimmedString(candidate?.endpoint?.id),
        signalType,
        reason: "grouped_identity_missing",
        detail: "no_matched_items_preview",
      });
      continue;
    }

    for (const item of matchedItems) {
      const issue = deriveIssueIdentityFields(signalType, item);
      const groupedIdentity = buildGroupedCandidateIdentity({
        orgLinkId: candidate?.identity?.orgLinkId,
        signalType,
        issue,
      });
      if (!groupedIdentity.ok) {
        if (signalType === "VULNERABILITY") diagnostics.vulnerabilityGroupedPrep.skippedMissingIdentity += 1;
        skipped.push({
          action1OrgId: asTrimmedString(candidate?.routing?.action1OrgId),
          endpointId: asTrimmedString(candidate?.endpoint?.id),
          signalType,
          reason: "grouped_identity_missing",
          detail: groupedIdentity.reason,
        });
        continue;
      }

      const key = groupedIdentity.identityKey;
      if (signalType === "VULNERABILITY") vulnerabilityIssueKeys.add(groupedIdentity.issueKey);
      if (!groupedBuckets.has(key)) {
        groupedBuckets.set(key, createGroupedSeed(candidate, groupedIdentity, issue));
      }
      const bucket = groupedBuckets.get(key);
      addImpactedEndpoint(bucket, candidate);
      bucket.matchedCount += 1;
      if (!bucket.issueMetadata) bucket.issueMetadata = {};
      bucket.issueMetadata = { ...item, ...bucket.issueMetadata };
    }
  }

  const groupedCandidates = Array.from(groupedBuckets.values()).map((bucket) => finalizeBucket(bucket));
  diagnostics.vulnerabilityGroupedPrep.uniqueIssueKeys = vulnerabilityIssueKeys.size;
  diagnostics.vulnerabilityGroupedPrep.groupedCandidates = groupedCandidates.filter(
    (row) => String(row?.signal?.type || "").toUpperCase() === "VULNERABILITY"
  ).length;
  return {
    candidates: keptEndpointCandidates.concat(groupedCandidates),
    skipped,
    diagnostics,
  };
}

function normalizeGroupedModeBySignal(normalizedConfig) {
  const cfg = normalizedConfig && typeof normalizedConfig === "object" ? normalizedConfig : {};
  return {
    VULNERABILITY: asTicketModel(cfg.vulnerabilities?.ticketModel),
    UPDATE: asTicketModel(cfg.updates?.ticketModel),
    AUTOMATION_FAILED: asTicketModel(cfg.automationFailed?.ticketModel),
    OFFLINE: "endpoint",
    REBOOT_REQUIRED: "endpoint",
  };
}

function asTicketModel(value) {
  return String(value || "").trim().toLowerCase() === "grouped" ? "grouped" : "endpoint";
}

function withEndpointTicketModel(candidate) {
  const next = candidate && typeof candidate === "object" ? { ...candidate } : {};
  if (!next.ticketModel) next.ticketModel = "endpoint";
  return next;
}

function deriveIssueIdentityFields(signalType, item) {
  if (signalType === "VULNERABILITY") {
    return { cveId: asTrimmedString(item?.id || item?.cveId || item?.cve_id) };
  }
  if (signalType === "UPDATE") {
    const packageId = asTrimmedString(item?.packageId);
    const versionId = asTrimmedString(item?.versionId);
    if (packageId && versionId) return { packageId, versionId };
    const id = asTrimmedString(item?.id);
    const parts = id.split(":");
    if (parts.length >= 2 && parts[0] && parts[1]) {
      return { packageId: asTrimmedString(parts[0]), versionId: asTrimmedString(parts[1]) };
    }
    return { packageId: "", versionId: "" };
  }
  return {
    automationInstanceId: asTrimmedString(item?.automationInstanceId || item?.instanceId),
  };
}

function createGroupedSeed(candidate, groupedIdentity, issue) {
  return {
    ticketModel: "grouped",
    identity: groupedIdentity.identity,
    issueKey: groupedIdentity.issueKey,
    routing: { ...(candidate?.routing || {}) },
    signalType: asTrimmedString(candidate?.signal?.type).toUpperCase(),
    signalReason: asTrimmedString(candidate?.signal?.reason),
    issueMetadata: issue || {},
    impactedEndpoints: [],
    matchedCount: 0,
  };
}

function addImpactedEndpoint(bucket, candidate) {
  const endpointId = asTrimmedString(candidate?.endpoint?.id);
  if (!endpointId) return;
  const endpointName = asTrimmedString(candidate?.endpoint?.name);
  const existing = bucket.impactedEndpoints.find((row) => row.endpointId === endpointId);
  if (existing) return;
  bucket.impactedEndpoints.push({
    endpointId,
    endpointName,
    endpoint: {
      id: endpointId,
      name: endpointName,
      lastSeenAt: asTrimmedString(candidate?.endpoint?.lastSeenAt),
      platform: asTrimmedString(candidate?.endpoint?.platform),
      os: asTrimmedString(candidate?.endpoint?.os),
    },
  });
}

function finalizeBucket(bucket) {
  const impactedEndpoints = (bucket.impactedEndpoints || [])
    .slice()
    .sort((a, b) => {
      const nameA = String(a.endpointName || "").toLowerCase();
      const nameB = String(b.endpointName || "").toLowerCase();
      if (nameA < nameB) return -1;
      if (nameA > nameB) return 1;
      return String(a.endpointId || "").localeCompare(String(b.endpointId || ""));
    });

  return {
    ticketModel: "grouped",
    identity: { ...(bucket.identity || {}) },
    issueKey: bucket.issueKey,
    routing: { ...(bucket.routing || {}) },
    signal: {
      type: bucket.signalType,
      reason: bucket.signalReason || "",
      matchedCount: Number(bucket.matchedCount || 0),
      matchedItemsPreview: [],
      details: {
        issueKey: bucket.issueKey,
      },
    },
    grouped: {
      issueKey: bucket.issueKey,
      issueMetadata: bucket.issueMetadata || {},
      impactedEndpointCount: impactedEndpoints.length,
      impactedEndpoints,
    },
  };
}

function asTrimmedString(value) {
  return String(value || "").trim();
}

module.exports = {
  aggregateGroupedCandidates,
};
