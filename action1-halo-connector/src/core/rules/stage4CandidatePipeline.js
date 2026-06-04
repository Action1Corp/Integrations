// stage4CandidatePipeline.js
//
// Action1 Public Repository Material
//
// Use of this file is subject to TERMS_OF_USE.md (https://github.com/Action1Corp/PSAction1/blob/main/TERMS_OF_USE.md) in this repository.
// Provided AS IS, without warranties.
// Use at your own risk.
// Review, test, and validate before production use.
// © Action1 Corporation. All rights reserved.
const { SIGNAL_TYPE_VALUES } = require("../types/signals");
const { buildAction1EndpointEvaluations } = require("./action1SignalInputNormalizer");
const { buildSignalCandidates } = require("./signalCandidateBuilder");
const { aggregateGroupedCandidates } = require("./groupedCandidateAggregator");

/**
 * Stage 4 candidate pipeline:
 * - normalizes Action1 endpoint/signal inputs
 * - runs pure signal qualification + candidate building
 * - returns deterministic candidates/skips/summary
 *
 * @param {{
 *  config: any,
 *  action1Organizations?: Array<any>,
 *  action1EndpointsByOrg?: Record<string, any[]> | Array<{action1OrgId: string, endpoints: any[]}>,
 *  signalDatasets?: {
 *    vulnerabilitiesByEndpoint?: any,
 *    updatesByEndpoint?: any,
 *    automationFailedByEndpoint?: any,
 *  },
 *  normalizedEvaluations?: Array<any>,
 *  now?: Date|string|number
 * }} input
 */
function runStage4CandidatePipeline(input) {
  const normalization = normalizePipelineInput(input);
  const candidateResult = buildSignalCandidates({
    config: input?.config || {},
    evaluations: normalization.evaluations,
    now: input?.now,
  });
  const groupedEnabled = Boolean(input?.enableGroupedAggregation);
  const groupedOut = groupedEnabled
    ? aggregateGroupedCandidates({
        candidates: candidateResult.candidates,
        normalizedConfig: candidateResult.normalizedConfig,
      })
    : {
        candidates: candidateResult.candidates,
        skipped: [],
      };
  const skipped = candidateResult.skipped.concat(groupedOut.skipped);

  return {
    candidates: groupedOut.candidates,
    skipped,
    summary: buildSummary({
      candidates: groupedOut.candidates,
      skipped,
      orgsSeen: normalization.meta.orgsSeen,
      endpointsSeen: normalization.meta.endpointsSeen,
    }),
    normalizedConfig: candidateResult.normalizedConfig,
    diagnostics: groupedOut.diagnostics && typeof groupedOut.diagnostics === "object" ? groupedOut.diagnostics : {},
  };
}

function normalizePipelineInput(input) {
  if (Array.isArray(input?.normalizedEvaluations)) {
    const evaluations = input.normalizedEvaluations.slice();
    const orgIds = new Set(evaluations.map((row) => String(row?.action1OrgId || "")).filter(Boolean));
    return {
      evaluations,
      meta: {
        orgsSeen: orgIds.size,
        endpointsSeen: evaluations.length,
      },
    };
  }

  return buildAction1EndpointEvaluations({
    action1Organizations: input?.action1Organizations,
    action1EndpointsByOrg: input?.action1EndpointsByOrg,
    signalDatasets: input?.signalDatasets,
  });
}

function buildSummary(input) {
  const candidatesBySignalType = {};
  for (const signalType of SIGNAL_TYPE_VALUES) {
    candidatesBySignalType[signalType] = 0;
  }
  for (const candidate of input.candidates || []) {
    const signalType = String(candidate?.signal?.type || "");
    if (!signalType) continue;
    if (!Object.prototype.hasOwnProperty.call(candidatesBySignalType, signalType)) {
      candidatesBySignalType[signalType] = 0;
    }
    candidatesBySignalType[signalType] += 1;
  }

  const skippedByReason = {};
  for (const row of input.skipped || []) {
    const reason = String(row?.reason || "unknown");
    skippedByReason[reason] = Number(skippedByReason[reason] || 0) + 1;
  }

  return {
    orgsSeen: Number(input.orgsSeen || 0),
    endpointsSeen: Number(input.endpointsSeen || 0),
    candidatesBySignalType,
    skippedByReason,
  };
}

module.exports = {
  runStage4CandidatePipeline,
  buildSummary,
};
