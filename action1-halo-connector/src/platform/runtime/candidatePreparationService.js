// candidatePreparationService.js
//
// Action1 Public Repository Material
//
// Use of this file is subject to TERMS_OF_USE.md (https://github.com/Action1Corp/PSAction1/blob/main/TERMS_OF_USE.md) in this repository.
// Provided AS IS, without warranties.
// Use at your own risk.
// Review, test, and validate before production use.
// © Action1 Corporation. All rights reserved.
/**
 * Manual lifecycle candidate-preparation boundary.
 * Keeps preview/debug terminology out of Manual Sync runtime flow.
 *
 * @param {{
 *  stage4CandidatePreviewService: { generatePreview: Function }
 * }} deps
 */
function createCandidatePreparationService(deps) {
  if (!deps || typeof deps !== "object") {
    throw new Error("CandidatePreparationService requires dependencies");
  }
  if (!deps.stage4CandidatePreviewService || typeof deps.stage4CandidatePreviewService.generatePreview !== "function") {
    throw new Error("CandidatePreparationService requires stage4CandidatePreviewService.generatePreview()");
  }

  return {
    prepareForLifecycleRun,
    generateDebugPreview,
  };

  async function prepareForLifecycleRun(opts = {}) {
    return deps.stage4CandidatePreviewService.generatePreview({
      mode: "manual",
      runId: opts.runId,
      runLogger: opts.runLogger || null,
      abortSignal: opts.abortSignal || null,
      progressReporter: opts.progressReporter || null,
      now: opts.now,
      config: opts.config,
    });
  }

  async function generateDebugPreview(opts = {}) {
    return deps.stage4CandidatePreviewService.generatePreview({
      mode: "preview",
      runId: opts.runId,
      runLogger: opts.runLogger || null,
      abortSignal: opts.abortSignal || null,
      progressReporter: opts.progressReporter || null,
      now: opts.now,
      config: opts.config,
    });
  }
}

module.exports = {
  createCandidatePreparationService,
};
