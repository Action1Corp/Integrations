// syncViewModel.js
//
// Action1 Public Repository Material
//
// Use of this file is subject to TERMS_OF_USE.md (https://github.com/Action1Corp/PSAction1/blob/main/TERMS_OF_USE.md) in this repository.
// Provided AS IS, without warranties.
// Use at your own risk.
// Review, test, and validate before production use.
// © Action1 Corporation. All rights reserved.
const DEFAULT_RECENT_RUNS_LIMIT = 10;

function normalizeSyncPreview(rawPreview) {
  const preview = rawPreview && typeof rawPreview === "object" ? rawPreview : {};
  const summary = preview.summary && typeof preview.summary === "object" ? preview.summary : {};
  const diagnostics = preview.diagnostics && typeof preview.diagnostics === "object" ? preview.diagnostics : {};
  return {
    candidates: Array.isArray(preview.candidates) ? preview.candidates : [],
    skipped: Array.isArray(preview.skipped) ? preview.skipped : [],
    summary: {
      orgsSeen: Number(summary.orgsSeen || 0),
      endpointsSeen: Number(summary.endpointsSeen || 0),
      candidatesBySignalType: summary.candidatesBySignalType && typeof summary.candidatesBySignalType === "object"
        ? summary.candidatesBySignalType
        : {},
      skippedByReason: summary.skippedByReason && typeof summary.skippedByReason === "object"
        ? summary.skippedByReason
        : {},
    },
    diagnostics: {
      partial: Boolean(diagnostics.partial),
      warnings: Array.isArray(diagnostics.warnings) ? diagnostics.warnings : [],
    },
  };
}

function normalizeRecentRuns(rawRuns, limit = DEFAULT_RECENT_RUNS_LIMIT) {
  const n = Number.isInteger(Number(limit)) && Number(limit) > 0 ? Number(limit) : DEFAULT_RECENT_RUNS_LIMIT;
  return (Array.isArray(rawRuns) ? rawRuns : []).slice(0, n);
}

function deriveRunResultLabel(rawRun) {
  if (!rawRun || typeof rawRun !== "object") return "Not run";
  const diagnostics = rawRun.diagnostics && typeof rawRun.diagnostics === "object" ? rawRun.diagnostics : {};
  const warnings = Array.isArray(diagnostics.warnings) ? diagnostics.warnings : [];
  if (rawRun.ok === true) {
    return warnings.length > 0 ? "Completed with warnings" : "Completed";
  }
  const code = String(rawRun?.error?.code || rawRun?.error || "").toLowerCase();
  if (code.includes("timeout") || code.includes("retry") || code.includes("candidate_limit_exceeded")) {
    return "Needs retry";
  }
  return "Failed";
}

function deriveSyncStatus(input = {}) {
  if (Boolean(input.running)) return "Running";
  if (String(input.errorMessage || "").trim()) return "Needs retry";
  const latest = input.latestRun && typeof input.latestRun === "object" ? input.latestRun : null;
  if (!latest) return "Not run";
  return deriveRunResultLabel(latest);
}

function normalizeLifecycleRunResponse(rawResult) {
  const result = rawResult && typeof rawResult === "object" ? rawResult : {};
  const summary = result.summary && typeof result.summary === "object" ? result.summary : {};
  const diagnostics = result.diagnostics && typeof result.diagnostics === "object" ? result.diagnostics : {};
  const timings = diagnostics.timings && typeof diagnostics.timings === "object" ? diagnostics.timings : {};
  const timeoutFlags = diagnostics.timeoutFlags && typeof diagnostics.timeoutFlags === "object" ? diagnostics.timeoutFlags : {};

  return {
    ok: result.ok === true,
    candidateCount: Number(result.candidateCount || 0),
    skippedCandidateCount: Number(result.skippedCandidateCount || 0),
    maxCandidates: Number(result.maxCandidates || 0),
    summary: {
      created: Number(summary.created || 0),
      updated: Number(summary.updated || 0),
      closed: Number(summary.closed || 0),
      skipped: Number(summary.skipped || 0),
      failed: Number(summary.failed || 0),
      bySignalType: summary.bySignalType && typeof summary.bySignalType === "object" ? summary.bySignalType : {},
      failuresByReason: summary.failuresByReason && typeof summary.failuresByReason === "object" ? summary.failuresByReason : {},
    },
    diagnostics: {
      warnings: Array.isArray(diagnostics.warnings) ? diagnostics.warnings : [],
      timeoutFlags: {
        candidateGeneration: Boolean(timeoutFlags.candidateGeneration),
        categoryLookup: Boolean(timeoutFlags.categoryLookup),
        lifecycleRun: Boolean(timeoutFlags.lifecycleRun),
      },
      timings: {
        candidateGenerationMs: Number(timings.candidateGenerationMs || 0),
        categoryLookupMs: Number(timings.categoryLookupMs || 0),
        lifecycleRunMs: Number(timings.lifecycleRunMs || 0),
        totalMs: Number(timings.totalMs || 0),
      },
    },
    results: Array.isArray(result.results) ? result.results : [],
  };
}

module.exports = {
  DEFAULT_RECENT_RUNS_LIMIT,
  normalizeSyncPreview,
  normalizeRecentRuns,
  deriveRunResultLabel,
  deriveSyncStatus,
  normalizeLifecycleRunResponse,
};
