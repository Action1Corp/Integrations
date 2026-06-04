// signalWatermarkStore.file.js
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

const DEFAULT_SIGNAL_WATERMARK_FILE_PATH = path.join(process.cwd(), "data", "signal-watermarks.json");

/**
 * @param {{filePath?: string}} [opts]
 */
function createFileSignalWatermarkStore(opts = {}) {
  const filePath = opts.filePath || DEFAULT_SIGNAL_WATERMARK_FILE_PATH;

  return {
    getAutomationFailedWatermark,
    upsertAutomationFailedWatermark,
    filePath,
  };

  async function getAutomationFailedWatermark(orgKey) {
    const state = await loadState();
    const key = asTrimmedString(orgKey);
    if (!key) return null;
    return state.automationFailed[key] || null;
  }

  async function upsertAutomationFailedWatermark(orgKey, input) {
    const state = await loadState();
    const key = asTrimmedString(orgKey);
    if (!key) throw new Error("signal_watermark_org_key_required");
    const current = state.automationFailed[key] || null;
    state.automationFailed[key] = normalizeAutomationWatermark({
      ...(current || {}),
      ...(input || {}),
    });
    state.updatedAt = new Date().toISOString();
    await saveState(state);
  }

  async function loadState() {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      return normalizeState(JSON.parse(raw));
    } catch (error) {
      if (error?.code === "ENOENT") return normalizeState({});
      throw error;
    }
  }

  async function saveState(state) {
    const folder = path.dirname(filePath);
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(normalizeState(state), null, 2), "utf8");
  }
}

function createInMemorySignalWatermarkStore() {
  const state = normalizeState({});
  return {
    async getAutomationFailedWatermark(orgKey) {
      const key = asTrimmedString(orgKey);
      if (!key) return null;
      return state.automationFailed[key] || null;
    },
    async upsertAutomationFailedWatermark(orgKey, input) {
      const key = asTrimmedString(orgKey);
      if (!key) throw new Error("signal_watermark_org_key_required");
      const current = state.automationFailed[key] || null;
      state.automationFailed[key] = normalizeAutomationWatermark({
        ...(current || {}),
        ...(input || {}),
      });
      state.updatedAt = new Date().toISOString();
    },
  };
}

function normalizeState(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const automationFailedRaw = src.automationFailed && typeof src.automationFailed === "object" ? src.automationFailed : {};
  const automationFailed = {};
  for (const key of Object.keys(automationFailedRaw)) {
    automationFailed[asTrimmedString(key)] = normalizeAutomationWatermark(automationFailedRaw[key]);
  }
  return {
    automationFailed,
    updatedAt: asTrimmedString(src.updatedAt) || new Date().toISOString(),
  };
}

function normalizeAutomationWatermark(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    lastSeenAt: asTrimmedString(src.lastSeenAt),
    lastInstanceId: asTrimmedString(src.lastInstanceId),
    action1OrgId: asTrimmedString(src.action1OrgId),
    orgLinkId: asTrimmedString(src.orgLinkId),
    updatedAt: asTrimmedString(src.updatedAt) || new Date().toISOString(),
  };
}

function asTrimmedString(value) {
  return String(value || "").trim();
}

module.exports = {
  DEFAULT_SIGNAL_WATERMARK_FILE_PATH,
  createFileSignalWatermarkStore,
  createInMemorySignalWatermarkStore,
};

