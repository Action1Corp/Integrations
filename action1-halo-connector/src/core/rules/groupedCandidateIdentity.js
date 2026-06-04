// groupedCandidateIdentity.js
//
// Action1 Public Repository Material
//
// Use of this file is subject to TERMS_OF_USE.md (https://github.com/Action1Corp/PSAction1/blob/main/TERMS_OF_USE.md) in this repository.
// Provided AS IS, without warranties.
// Use at your own risk.
// Review, test, and validate before production use.
// © Action1 Corporation. All rights reserved.
const GROUPED_SIGNALS = new Set(["VULNERABILITY", "UPDATE", "AUTOMATION_FAILED"]);

function buildGroupedCandidateIdentity(input = {}) {
  const orgLinkId = asTrimmedString(input.orgLinkId);
  const signalType = asTrimmedString(input.signalType).toUpperCase();
  const issue = input.issue && typeof input.issue === "object" ? input.issue : {};

  if (!orgLinkId) {
    return { ok: false, reason: "missing_org_link_id" };
  }
  if (!GROUPED_SIGNALS.has(signalType)) {
    return { ok: false, reason: "unsupported_signal_type" };
  }

  if (signalType === "VULNERABILITY") {
    const cveId = asTrimmedString(issue.cveId || issue.id);
    if (!cveId) return { ok: false, reason: "missing_cve_id" };
    const issueKey = cveId;
    return {
      ok: true,
      issueKey,
      identityKey: `${orgLinkId}|VULNERABILITY|${issueKey}`,
      identity: {
        orgLinkId,
        signalType: "VULNERABILITY",
        issueKey,
        key: `${orgLinkId}|VULNERABILITY|${issueKey}`,
      },
    };
  }

  if (signalType === "UPDATE") {
    const packageId = asTrimmedString(issue.packageId);
    const versionId = asTrimmedString(issue.versionId);
    if (!packageId || !versionId) return { ok: false, reason: "missing_package_or_version_id" };
    const issueKey = `${packageId}:${versionId}`;
    return {
      ok: true,
      issueKey,
      identityKey: `${orgLinkId}|UPDATE|${issueKey}`,
      identity: {
        orgLinkId,
        signalType: "UPDATE",
        issueKey,
        key: `${orgLinkId}|UPDATE|${issueKey}`,
      },
    };
  }

  const automationInstanceId = asTrimmedString(issue.automationInstanceId || issue.instanceId);
  if (!automationInstanceId) return { ok: false, reason: "missing_automation_instance_id" };
  const issueKey = automationInstanceId;
  return {
    ok: true,
    issueKey,
    identityKey: `${orgLinkId}|AUTOMATION_FAILED|${issueKey}`,
    identity: {
      orgLinkId,
      signalType: "AUTOMATION_FAILED",
      issueKey,
      key: `${orgLinkId}|AUTOMATION_FAILED|${issueKey}`,
    },
  };
}

function asTrimmedString(value) {
  return String(value || "").trim();
}

module.exports = {
  GROUPED_SIGNALS,
  buildGroupedCandidateIdentity,
};

