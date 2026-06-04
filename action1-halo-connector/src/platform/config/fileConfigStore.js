// fileConfigStore.js
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
const { defaultConnectorConfig, normalizeConnectorConfig } = require("./configSchema");

const DEFAULT_STATE_FILE_PATH = path.join(process.cwd(), "data", "connector-config.json");

/**
 * @param {{filePath?: string}} [opts]
 */
function createFileConfigStore(opts = {}) {
  const filePath = opts.filePath || DEFAULT_STATE_FILE_PATH;

  return {
    loadConnectorConfig,
    saveConnectorConfig,
    loadConnectionSecrets,
    saveConnectionSecrets,
    // exposed for verification
    filePath,
  };

  async function loadConnectorConfig() {
    const state = await loadState();
    return normalizeConnectorConfig(state.connectorConfig || defaultConnectorConfig());
  }

  /**
   * @param {Object} config
   */
  async function saveConnectorConfig(config) {
    const state = await loadState();
    state.connectorConfig = normalizeConnectorConfig(config);
    state.updatedAt = new Date().toISOString();
    await saveState(state);
  }

  async function loadConnectionSecrets() {
    const state = await loadState();
    return {
      action1ClientSecret: String(state?.secrets?.action1ClientSecret || ""),
      haloClientSecret: String(state?.secrets?.haloClientSecret || ""),
    };
  }

  /**
   * @param {{action1ClientSecret?: string, haloClientSecret?: string}} secrets
   */
  async function saveConnectionSecrets(secrets) {
    const state = await loadState();
    state.secrets = {
      ...(state.secrets || {}),
      ...(secrets || {}),
    };
    if (state.secrets.action1ClientSecret !== undefined) {
      state.secrets.action1ClientSecret = String(state.secrets.action1ClientSecret || "");
    }
    if (state.secrets.haloClientSecret !== undefined) {
      state.secrets.haloClientSecret = String(state.secrets.haloClientSecret || "");
    }
    state.updatedAt = new Date().toISOString();
    await saveState(state);
  }

  async function loadState() {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw);
      return normalizeState(parsed);
    } catch (error) {
      if (error?.code === "ENOENT") {
        return normalizeState({});
      }
      throw error;
    }
  }

  async function saveState(state) {
    const folder = path.dirname(filePath);
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(normalizeState(state), null, 2), "utf8");
  }
}

function normalizeState(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    connectorConfig: normalizeConnectorConfig(src.connectorConfig || defaultConnectorConfig()),
    secrets: {
      action1ClientSecret: String(src?.secrets?.action1ClientSecret || ""),
      haloClientSecret: String(src?.secrets?.haloClientSecret || ""),
    },
    updatedAt: String(src.updatedAt || new Date().toISOString()),
  };
}

module.exports = {
  DEFAULT_STATE_FILE_PATH,
  createFileConfigStore,
};
