// index.js
//
// Action1 Public Repository Material
//
// Use of this file is subject to TERMS_OF_USE.md (https://github.com/Action1Corp/PSAction1/blob/main/TERMS_OF_USE.md) in this repository.
// Provided AS IS, without warranties.
// Use at your own risk.
// Review, test, and validate before production use.
// © Action1 Corporation. All rights reserved.
const { assertRuntimeDependencies, createServiceRuntime, createDefaultServiceRuntime } = require("./serviceBoundary");
const { createStage4CandidatePreviewService } = require("./stage4CandidatePreviewService");
const { createLifecycleRunService } = require("./lifecycleRunService");
const { createFileLifecycleRunAuditStore, createInMemoryLifecycleRunAuditStore } = require("./lifecycleRunAuditStore");
const {
  DEFAULT_SIGNAL_WATERMARK_FILE_PATH,
  createFileSignalWatermarkStore,
  createInMemorySignalWatermarkStore,
} = require("./signalWatermarkStore.file");
const {
  DEFAULT_SYNC_SCHEDULER_STATE_FILE_PATH,
  createFileSyncSchedulerStateStore,
  createInMemorySyncSchedulerStateStore,
  createSyncSchedulerRuntime,
} = require("./syncSchedulerRuntime");
const { createLifecycleRunMutex } = require("./lifecycleRunMutex");

module.exports = {
  assertRuntimeDependencies,
  createServiceRuntime,
  createDefaultServiceRuntime,
  createStage4CandidatePreviewService,
  createLifecycleRunService,
  createFileLifecycleRunAuditStore,
  createInMemoryLifecycleRunAuditStore,
  DEFAULT_SIGNAL_WATERMARK_FILE_PATH,
  createFileSignalWatermarkStore,
  createInMemorySignalWatermarkStore,
  DEFAULT_SYNC_SCHEDULER_STATE_FILE_PATH,
  createFileSyncSchedulerStateStore,
  createInMemorySyncSchedulerStateStore,
  createSyncSchedulerRuntime,
  createLifecycleRunMutex,
};
