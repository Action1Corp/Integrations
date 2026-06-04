// serviceBoundary.js
//
// Action1 Public Repository Material
//
// Use of this file is subject to TERMS_OF_USE.md (https://github.com/Action1Corp/PSAction1/blob/main/TERMS_OF_USE.md) in this repository.
// Provided AS IS, without warranties.
// Use at your own risk.
// Review, test, and validate before production use.
// © Action1 Corporation. All rights reserved.
const { assertAction1Client } = require("../../api/action1");
const { assertHaloAuthClient, assertHaloDiscoveryClient, assertHaloTicketsClient } = require("../../api/halo");
const { createAction1Client } = require("../../api/action1");
const { createHaloAuthClient, createHaloDiscoveryClient, createHaloTicketsClient } = require("../../api/halo");
const { assertConfigStore, createFileConfigStore } = require("../config");
const { assertCorrelationStore, createFileCorrelationStore } = require("../db");
const { assertRunLogger, createConsoleRunLogger, createFileRunLogger, createCompositeRunLogger } = require("../logging");
const { createApiServer } = require("./apiServer");
const { createFileLifecycleRunAuditStore } = require("./lifecycleRunAuditStore");
const { createFileSignalWatermarkStore } = require("./signalWatermarkStore.file");
const { createFileSyncSchedulerStateStore } = require("./syncSchedulerRuntime");

/**
 * Runtime dependency contract for the one-process connector service.
 * This is intentionally interface-first for Stage 1.
 *
 * @param {Object} deps
 * @returns {Object}
 */
function assertRuntimeDependencies(deps) {
  if (!deps || typeof deps !== "object") {
    throw new Error("Runtime dependencies are required");
  }

  assertAction1Client(deps.action1Client);
  assertHaloAuthClient(deps.haloAuthClient);
  assertHaloDiscoveryClient(deps.haloDiscoveryClient);
  assertHaloTicketsClient(deps.haloTicketsClient);
  assertConfigStore(deps.configStore);
  assertCorrelationStore(deps.correlationStore);
  assertRunLogger(deps.runLogger);

  if (typeof deps.now !== "function") {
    throw new Error("Runtime dependencies require now() clock function");
  }

  return deps;
}

/**
 * Stage-1 runtime shell. This does not run sync yet.
 *
 * @param {Object} deps
 * @returns {{start: () => Promise<void>, stop: () => Promise<void>, deps: Object}}
 */
function createServiceRuntime(deps) {
  const validatedDeps = assertRuntimeDependencies(deps);

  return {
    deps: validatedDeps,
    async start() {
      if (validatedDeps.apiServer && typeof validatedDeps.apiServer.start === "function") {
        await validatedDeps.apiServer.start();
      }
    },
    async stop() {
      if (validatedDeps.apiServer && typeof validatedDeps.apiServer.stop === "function") {
        await validatedDeps.apiServer.stop();
      }
    },
  };
}

/**
 * Convenience factory for Stage 2 one-process local service runtime.
 *
 * @param {{host?: string, port?: number, dataFilePath?: string, runLogger?: any}} [opts]
 */
function createDefaultServiceRuntime(opts = {}) {
  const aggregateFileLogger = createFileRunLogger({
    shouldLog: shouldWriteAggregateLogLine,
  });
  const runLogger =
    opts.runLogger ||
    createCompositeRunLogger([
      createConsoleRunLogger(),
      aggregateFileLogger,
    ]);
  const configStore = createFileConfigStore({
    filePath: opts.dataFilePath,
  });

  const action1Client = createAction1Client({
    runLogger,
    connectionProvider: async () => {
      const cfg = await configStore.loadConnectorConfig();
      const secrets = await configStore.loadConnectionSecrets();
      return {
        baseUrl: cfg.connections?.action1?.baseUrl || "",
        clientId: cfg.connections?.action1?.clientId || "",
        clientSecret: secrets.action1ClientSecret || "",
      };
    },
  });

  const haloAuthClient = createHaloAuthClient({
    runLogger,
    connectionProvider: async () => {
      const cfg = await configStore.loadConnectorConfig();
      const secrets = await configStore.loadConnectionSecrets();
      return {
        resourceServer: cfg.connections?.halo?.resourceServer || cfg.connections?.halo?.baseUrl || "",
        authorisationServer: cfg.connections?.halo?.authorisationServer || cfg.connections?.halo?.tokenUrl || "",
        tenant: cfg.connections?.halo?.tenant || "",
        clientId: cfg.connections?.halo?.clientId || "",
        clientSecret: secrets.haloClientSecret || "",
      };
    },
  });

  const haloDiscoveryClient = createHaloDiscoveryClient({
    runLogger,
    haloAuthClient,
  });
  const haloTicketsClient = createHaloTicketsClient({
    runLogger,
    haloAuthClient,
  });
  const correlationStore = createFileCorrelationStore();
  const lifecycleRunAuditStore = createFileLifecycleRunAuditStore({ runLogger });
  const signalWatermarkStore = createFileSignalWatermarkStore();
  const syncSchedulerStateStore = createFileSyncSchedulerStateStore();

  const runtime = createServiceRuntime({
    now: () => Date.now(),
    runLogger,
    configStore,
    action1Client,
    haloAuthClient,
    haloDiscoveryClient,
    haloTicketsClient,
    correlationStore,
    apiServer: createApiServer({
      host: opts.host,
      port: opts.port,
      now: () => Date.now(),
      runLogger,
      configStore,
      action1Client,
      haloAuthClient,
      haloDiscoveryClient,
      haloTicketsClient,
      correlationStore,
      lifecycleRunAuditStore,
      signalWatermarkStore,
      syncSchedulerStateStore,
    }),
  });

  return runtime;
}

function shouldWriteAggregateLogLine(line) {
  const level = String(line?.level || "").toUpperCase();
  const message = String(line?.message || "");
  const context = line?.context && typeof line.context === "object" ? line.context : {};
  const lifecycleDebugScope = Boolean(context.lifecycleDebugScope);
  if (!lifecycleDebugScope) return true;
  if (Boolean(context.debugLoggingEnabled)) return true;
  if (level === "WARN" || level === "ERROR") return true;
  return message === "[RUN START]" || message === "[RUN END]";
}

module.exports = {
  assertRuntimeDependencies,
  createServiceRuntime,
  createDefaultServiceRuntime,
  shouldWriteAggregateLogLine,
};
