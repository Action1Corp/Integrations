// syncSchedulerRuntime.js
//
// Action1 Public Repository Material
//
// Use of this file is subject to TERMS_OF_USE.md (https://github.com/Action1Corp/PSAction1/blob/main/TERMS_OF_USE.md) in this repository.
// Provided AS IS, without warranties.
// Use at your own risk.
// Review, test, and validate before production use.
// © Action1 Corporation. All rights reserved.
const fs = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_SYNC_SCHEDULER_STATE_FILE_PATH = path.join(process.cwd(), "data", "sync-scheduler-state.json");
const SUPPORTED_INTERVAL_HOURS = Object.freeze([3, 6, 12, 24]);

function createSyncSchedulerRuntime(input = {}) {
  const nowFn = typeof input.now === "function" ? input.now : Date.now;
  const setTimeoutFn = typeof input.setTimeoutFn === "function" ? input.setTimeoutFn : setTimeout;
  const clearTimeoutFn = typeof input.clearTimeoutFn === "function" ? input.clearTimeoutFn : clearTimeout;
  const stateStore = input.stateStore || createInMemorySyncSchedulerStateStore();
  const configProvider =
    typeof input.configProvider === "function"
      ? input.configProvider
      : async () => ({ syncScheduler: { enabled: false, intervalHours: 24 } });
  const lifecycleRunner = typeof input.lifecycleRunner === "function" ? input.lifecycleRunner : async () => {};

  let timer = null;
  let stopped = true;
  let running = false;
  let deferredUntilCompletion = false;
  let cachedConfig = { enabled: false, intervalHours: 24 };

  return {
    start,
    stop,
    getStatus,
    updateConfig,
    notifyRunCompleted,
  };

  async function start() {
    stopped = false;
    const cfg = await loadSchedulerConfig();
    cachedConfig = cfg;
    if (!cfg.enabled) {
      await stateStore.upsertState({ nextRunAt: "", lastSchedulerError: "" });
      return;
    }
    const state = await stateStore.loadState();
    const nextRunAt = String(state?.nextRunAt || "").trim();
    if (!nextRunAt || Date.parse(nextRunAt) <= nowFn()) {
      arm(0);
      return;
    }
    arm(Math.max(0, Date.parse(nextRunAt) - nowFn()));
  }

  async function stop() {
    stopped = true;
    disarm();
  }

  async function updateConfig(nextInput) {
    cachedConfig = normalizeSyncSchedulerConfig(nextInput);
    if (!cachedConfig.enabled) {
      disarm();
      await stateStore.upsertState({ nextRunAt: "", lastSchedulerError: "" });
      return await getStatus();
    }
    const next = computeNextRunAtFromNow(cachedConfig.intervalHours, nowFn);
    await stateStore.upsertState({ nextRunAt: next, lastSchedulerError: "" });
    arm(Math.max(0, Date.parse(next) - nowFn()));
    return await getStatus();
  }

  async function getStatus() {
    const state = await stateStore.loadState();
    return {
      enabled: Boolean(cachedConfig.enabled),
      intervalHours: Number(cachedConfig.intervalHours || 24),
      nextRunAt: String(state?.nextRunAt || ""),
      lastScheduledRunAt: String(state?.lastScheduledRunAt || ""),
      lastSchedulerError: String(state?.lastSchedulerError || ""),
      running: Boolean(running),
    };
  }

  async function notifyRunCompleted() {
    if (!cachedConfig.enabled) return;
    if (!deferredUntilCompletion) return;
    deferredUntilCompletion = false;
    const nextRunAt = computeNextRunAtFromNow(cachedConfig.intervalHours);
    await stateStore.upsertState({
      nextRunAt,
      lastSchedulerError: "",
    });
    arm(Math.max(0, Date.parse(nextRunAt) - nowFn()));
  }

  function disarm() {
    if (!timer) return;
    clearTimeoutFn(timer);
    timer = null;
  }

  function arm(delayMs) {
    if (stopped) return;
    disarm();
    timer = setTimeoutFn(async () => {
      timer = null;
      await runScheduledTick();
    }, Math.max(0, Number(delayMs || 0)));
  }

  async function runScheduledTick() {
    if (stopped) return;
    if (!cachedConfig.enabled) return;
    if (running) return;
    running = true;
    try {
      await lifecycleRunner({ trigger: "scheduled", maxCandidates: 0 });
      const nextRunAt = computeNextRunAtFromNow(cachedConfig.intervalHours, nowFn);
      await stateStore.upsertState({
        lastScheduledRunAt: new Date(nowFn()).toISOString(),
        nextRunAt,
        lastSchedulerError: "",
      });
      arm(Math.max(0, Date.parse(nextRunAt) - nowFn()));
    } catch (error) {
      if (String(error?.code || "") === "lifecycle_run_in_progress") {
        deferredUntilCompletion = true;
        return;
      }
      const lastSchedulerError = String(error?.message || "scheduled_run_failed").slice(0, 240);
      await stateStore.upsertState({ lastSchedulerError });
      const nextRunAt = computeNextRunAtFromNow(cachedConfig.intervalHours, nowFn);
      await stateStore.upsertState({ nextRunAt });
      arm(Math.max(0, Date.parse(nextRunAt) - nowFn()));
    } finally {
      running = false;
    }
  }

  async function loadSchedulerConfig() {
    const raw = await configProvider();
    const normalized = normalizeSyncSchedulerConfig(raw?.syncScheduler || raw);
    return normalized;
  }
}

function createInMemorySyncSchedulerStateStore(initialState = {}) {
  let state = normalizeSyncSchedulerState(initialState);
  return {
    async loadState() {
      return { ...state };
    },
    async upsertState(patch) {
      state = normalizeSyncSchedulerState({ ...state, ...(patch || {}) });
    },
  };
}

function createFileSyncSchedulerStateStore(opts = {}) {
  const filePath = opts.filePath || DEFAULT_SYNC_SCHEDULER_STATE_FILE_PATH;
  const fsModule = opts.fsModule || fs;
  const nowFn = typeof opts.now === "function" ? opts.now : Date.now;
  return {
    filePath,
    async loadState() {
      try {
        const raw = await fsModule.readFile(filePath, "utf8");
        return normalizeSyncSchedulerState(JSON.parse(raw));
      } catch (error) {
        if (error?.code === "ENOENT") return normalizeSyncSchedulerState({});
        throw error;
      }
    },
    async upsertState(patch) {
      const current = await this.loadState();
      const next = normalizeSyncSchedulerState({ ...current, ...(patch || {}) });
      const folder = path.dirname(filePath);
      await fsModule.mkdir(folder, { recursive: true });
      const tempPath = `${filePath}.tmp-${process.pid}-${nowFn()}`;
      let handle = null;
      try {
        handle = await fsModule.open(tempPath, "w");
        await handle.writeFile(JSON.stringify(next, null, 2), "utf8");
        await handle.sync();
        await handle.close();
        handle = null;
        await fsModule.rename(tempPath, filePath);
      } finally {
        if (handle) {
          try {
            await handle.close();
          } catch (_) {}
        }
      }
    },
  };
}

function normalizeSyncSchedulerConfig(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const enabled = Boolean(src.enabled);
  const intervalHours = normalizeSyncSchedulerIntervalHours(src.intervalHours);
  return { enabled, intervalHours };
}

function normalizeSyncSchedulerIntervalHours(raw) {
  const n = Number(raw);
  return SUPPORTED_INTERVAL_HOURS.includes(n) ? n : 24;
}

function normalizeSyncSchedulerState(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    nextRunAt: String(src.nextRunAt || ""),
    lastScheduledRunAt: String(src.lastScheduledRunAt || ""),
    lastSchedulerError: String(src.lastSchedulerError || ""),
  };
}

function computeNextRunAtFromNow(intervalHours, nowFn) {
  const now = typeof nowFn === "function" ? nowFn() : Date.now();
  return new Date(now + Number(intervalHours || 24) * 60 * 60 * 1000).toISOString();
}

module.exports = {
  DEFAULT_SYNC_SCHEDULER_STATE_FILE_PATH,
  SUPPORTED_INTERVAL_HOURS,
  createSyncSchedulerRuntime,
  createInMemorySyncSchedulerStateStore,
  createFileSyncSchedulerStateStore,
  normalizeSyncSchedulerConfig,
  normalizeSyncSchedulerIntervalHours,
};
