// lifecycleRunMutex.js
//
// Action1 Public Repository Material
//
// Use of this file is subject to TERMS_OF_USE.md (https://github.com/Action1Corp/PSAction1/blob/main/TERMS_OF_USE.md) in this repository.
// Provided AS IS, without warranties.
// Use at your own risk.
// Review, test, and validate before production use.
// © Action1 Corporation. All rights reserved.
function createLifecycleRunMutex() {
  let active = null;

  return {
    acquire,
    release,
    isRunning() {
      return Boolean(active);
    },
    getActiveRun() {
      return active ? { ...active } : null;
    },
    async runExclusive(context, worker) {
      if (active) {
        const error = new Error("lifecycle_run_in_progress");
        error.code = "lifecycle_run_in_progress";
        error.activeRun = { ...active };
        throw error;
      }
      acquire(context);
      try {
        return await worker();
      } finally {
        release();
      }
    },
  };

  function acquire(context) {
    if (active) return false;
    active = {
      trigger: String(context?.trigger || "manual"),
      startedAt: new Date().toISOString(),
    };
    return true;
  }

  function release() {
    active = null;
  }
}

module.exports = {
  createLifecycleRunMutex,
};
