// logHelpers.js
//
// Action1 Public Repository Material
//
// Use of this file is subject to TERMS_OF_USE.md (https://github.com/Action1Corp/PSAction1/blob/main/TERMS_OF_USE.md) in this repository.
// Provided AS IS, without warranties.
// Use at your own risk.
// Review, test, and validate before production use.
// © Action1 Corporation. All rights reserved.
const { LOG_EVENT_TYPES, LOG_LEVELS } = require("./logEventModel");
const fs = require("node:fs/promises");
const path = require("node:path");

/**
 * @param {{
 *  runLogger?: { emit?: Function }|null,
 *  runId?: string,
 *  level?: string,
 *  eventType: string,
 *  message: string,
 *  context?: Object
 * }} event
 */
async function emitLog(event) {
  if (!event?.runLogger || typeof event.runLogger.emit !== "function") return;
  await event.runLogger.emit({
    runId: String(event.runId || "system"),
    level: event.level || LOG_LEVELS.INFO,
    eventType: event.eventType,
    message: event.message,
    context: event.context && typeof event.context === "object" ? event.context : {},
  });
}

function createNoopRunLogger() {
  return {
    async emit() {
      return undefined;
    },
    child() {
      return createNoopRunLogger();
    },
  };
}

function createConsoleRunLogger() {
  return {
    async emit(event) {
      const line = {
        timestamp: event?.timestamp || new Date().toISOString(),
        runId: event?.runId || "system",
        level: event?.level || LOG_LEVELS.INFO,
        eventType: event?.eventType || LOG_EVENT_TYPES.PARTIAL_FAILURE,
        message: event?.message || "",
        context: event?.context || {},
      };
      process.stdout.write(`${JSON.stringify(line)}\n`);
    },
    child(bindings) {
      const base = this;
      return {
        async emit(event) {
          await base.emit({
            ...event,
            context: {
              ...(bindings || {}),
              ...(event?.context || {}),
            },
          });
        },
        child(nextBindings) {
          return base.child({
            ...(bindings || {}),
            ...(nextBindings || {}),
          });
        },
      };
    },
  };
}

function createFileRunLogger(opts = {}) {
  const filePath = String(opts.filePath || path.join(process.cwd(), "logs", "lifecycle.log"));
  const bindings = opts.bindings && typeof opts.bindings === "object" ? opts.bindings : {};
  const readable = Boolean(opts.readable);
  const shouldLog = typeof opts.shouldLog === "function" ? opts.shouldLog : null;
  const readableFormat = String(opts.readableFormat || "").trim().toLowerCase();
  const lifecycleReadableState =
    readable && readableFormat === "compact_lifecycle_run"
      ? {
          startedAt: "",
          mode: "unknown",
          mappedOrgs: 0,
          maxCandidates: 0,
          ticketModels: {},
          candidatesBySignal: {},
          orgRows: [],
          currentOrg: null,
          warnings: [],
          totals: null,
          candidateModels: { endpoint: 0, grouped: 0 },
          runEnd: null,
        }
      : null;
  return {
    async emit(event) {
      const line = {
        timestamp: event?.timestamp || new Date().toISOString(),
        runId: event?.runId || "system",
        level: event?.level || LOG_LEVELS.INFO,
        eventType: event?.eventType || LOG_EVENT_TYPES.PARTIAL_FAILURE,
        message: String(event?.message || ""),
        context: sanitizeValue({
          ...bindings,
          ...(event?.context || {}),
        }),
      };
      if (shouldLog && shouldLog(line) === false) return;
      const text = readable
        ? readableFormat === "compact_lifecycle_run"
          ? toCompactLifecycleRunLogText(line, lifecycleReadableState)
          : toReadableLogText(line)
        : `${line.timestamp} ${line.message} ${JSON.stringify({
            runId: line.runId,
            level: line.level,
            eventType: line.eventType,
            context: line.context,
          })}\n`;
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.appendFile(filePath, text, "utf8");
    },
    child(childBindings) {
      return createFileRunLogger({
        filePath,
        readable,
        shouldLog,
        bindings: {
          ...bindings,
          ...(childBindings || {}),
        },
      });
    },
  };
}

function createCompositeRunLogger(loggers) {
  const targets = Array.isArray(loggers) ? loggers.filter((row) => row && typeof row.emit === "function") : [];
  return {
    async emit(event) {
      for (const logger of targets) {
        await logger.emit(event);
      }
    },
    child(bindings) {
      return createCompositeRunLogger(targets.map((logger) => logger.child(bindings)));
    },
  };
}

function sanitizeValue(value) {
  if (Array.isArray(value)) return value.map((row) => sanitizeValue(row));
  if (!value || typeof value !== "object") {
    const text = String(value === undefined || value === null ? "" : value);
    return containsSecretLikeText(text) ? "redacted" : value;
  }
  const out = {};
  for (const key of Object.keys(value)) {
    out[key] = sanitizeValue(value[key]);
  }
  return out;
}

function containsSecretLikeText(rawMessage) {
  const lower = String(rawMessage || "").toLowerCase();
  return (
    lower.includes("secret") ||
    lower.includes("token") ||
    lower.includes("authorization") ||
    lower.includes("bearer") ||
    lower.includes("password") ||
    lower.includes("x-tenant")
  );
}

function toReadableLogText(line) {
  const parts = [];
  parts.push(`${line.timestamp} ${String(line.message || "")}`);
  parts.push(`runId=${line.runId} level=${line.level} eventType=${line.eventType}`);
  const context = line?.context && typeof line.context === "object" ? line.context : {};
  const keys = Object.keys(context).sort();
  if (keys.length > 0) {
    for (const key of keys) {
      parts.push(`${key}=${formatReadableValue(context[key])}`);
    }
  }
  return `${parts.join("\n")}\n\n`;
}

function toCompactLifecycleRunLogText(line, state) {
  const msg = String(line?.message || "");
  const ctx = line?.context && typeof line.context === "object" ? line.context : {};
  if (!state) return "";
  if (msg === "[ACTION1 PAGED FETCH]") return "";

  if (msg === "[RUN START]") {
    if (!state.startedAt) state.startedAt = String(line.timestamp || "");
    if (ctx.trigger) state.mode = String(ctx.trigger);
    if (ctx.maxCandidates !== undefined) state.maxCandidates = Number(ctx.maxCandidates || 0);
    return "";
  }
  if (msg === "[TICKET MODELS]") {
    state.ticketModels = {
      vulnerabilities: String(ctx.vulnerabilities || "endpoint"),
      updates: String(ctx.updates || "endpoint"),
      automationFailed: String(ctx.automationFailed || "endpoint"),
      maxImpactedEndpointsInGroupedTicket: Number(ctx.maxImpactedEndpointsInGroupedTicket || 0),
    };
    return "";
  }
  if (msg === "[CANDIDATES]") {
    state.candidatesBySignal = ctx.bySignalType && typeof ctx.bySignalType === "object" ? ctx.bySignalType : {};
    return "";
  }
  if (msg === "[CANDIDATE MODELS]") {
    state.candidateModels = {
      endpoint: Number(ctx.endpoint || 0),
      grouped: Number(ctx.grouped || 0),
    };
    return "";
  }
  if (msg === "[ORG START]") {
    state.currentOrg = {
      org: String(ctx.org || ""),
      haloClient: String(ctx.haloClient || ""),
      endpoints: 0,
      signals: {},
    };
    return "";
  }
  if (msg === "[ACTION1 ENDPOINTS FETCH RESULT]" && state.currentOrg) {
    state.currentOrg.endpoints = Number(ctx.endpoints || 0);
    return "";
  }
  if (msg === "[SIGNAL RESULT]" && state.currentOrg) {
    state.currentOrg.signals[String(ctx.signal || "UNKNOWN")] = Number(ctx.collectedEndpointSignalRows || 0);
    return "";
  }
  if (msg === "[ORG END]" && state.currentOrg) {
    state.orgRows.push(state.currentOrg);
    state.currentOrg = null;
    return "";
  }
  if (msg === "[CANDIDATES LIMIT]" || msg === "[ERROR]" || msg === "[CANDIDATE PREP TIMEOUT]" || msg === "[CANDIDATE PREP ABORTED]") {
    state.warnings.push(msg.replace(/^\[|\]$/g, ""));
    return "";
  }
  if (msg === "[RUN END]") {
    if (String(line.runId || "") !== "lifecycle-run-once") return "";
    state.totals = {
      total: Number(ctx.totalCandidates || ctx.candidateCount || 0),
      endpoint: Number(ctx?.candidateModels?.endpoint || 0),
      grouped: Number(ctx?.candidateModels?.grouped || 0),
      created: Number(ctx.created || 0),
      updated: Number(ctx.updated || 0),
      closed: Number(ctx.closed || 0),
      skipped: Number(ctx.skipped || 0),
      failed: Number(ctx.failed || 0),
      skippedByReason: ctx.skippedByReason && typeof ctx.skippedByReason === "object" ? ctx.skippedByReason : {},
      failedByReason: ctx.failedByReason && typeof ctx.failedByReason === "object" ? ctx.failedByReason : {},
      failedExamplesByReason:
        ctx.failedExamplesByReason && typeof ctx.failedExamplesByReason === "object" ? ctx.failedExamplesByReason : {},
      totalMs: Number(ctx.totalMs || 0),
    };
    state.runEnd = ctx;
    return renderCompactLifecycleRun(state);
  }
  return "";
}

function renderCompactLifecycleRun(state) {
  const lines = [];
  lines.push(
    `Run started: ${formatTimestampUtc(state.startedAt)} | mode=${state.mode || "unknown"} | mappedOrgs=${state.orgRows.length} | maxCandidates=${state.maxCandidates}`
  );
  lines.push(
    `Ticket models: vulnerability=${state.ticketModels.vulnerabilities || "endpoint"} | update=${state.ticketModels.updates || "endpoint"} | automationFailed=${state.ticketModels.automationFailed || "endpoint"} | maxImpactedEndpoints=${Number(state.ticketModels.maxImpactedEndpointsInGroupedTicket || 0)}`
  );
  const enabledSignals = collectEnabledSignals(state);
  lines.push(`Enabled signals: ${enabledSignals.join(", ") || "none"}`);
  lines.push("");
  lines.push("--- Candidate preparation ---");
  for (let i = 0; i < state.orgRows.length; i += 1) {
    const org = state.orgRows[i];
    lines.push("");
    lines.push(`Org ${i + 1}/${state.orgRows.length} | action1Org=${org.org} | haloClient=${org.haloClient} | endpoints=${org.endpoints}`);
    const signalKeys = Object.keys(org.signals).sort();
    if (signalKeys.length > 0) {
      lines.push("Signals:");
      for (const signal of signalKeys) lines.push(`${signal} rows=${org.signals[signal]}`);
    }
  }
  if (state.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const warning of state.warnings) lines.push(`* ${warning}`);
  }
  const totals = state.totals || {};
  lines.push("");
  lines.push("--- Candidate totals ---");
  const endpointCount = Number(totals.endpoint || state.candidateModels.endpoint || 0);
  const groupedCount = Number(totals.grouped || state.candidateModels.grouped || 0);
  lines.push(`Candidates: total=${Number(totals.total || 0)} | endpoint=${endpointCount} | grouped=${groupedCount}`);
  const bySignal = Object.keys(state.candidatesBySignal || {})
    .sort()
    .map((signal) => `${signal}=${Number(state.candidatesBySignal[signal] || 0)}`)
    .join(" | ");
  if (bySignal) lines.push(`By signal: ${bySignal}`);
  lines.push("");
  lines.push("--- Lifecycle execution ---");
  lines.push(
    `Created=${Number(totals.created || 0)} | Updated=${Number(totals.updated || 0)} | Closed=${Number(totals.closed || 0)} | Skipped=${Number(totals.skipped || 0)} | Failed=${Number(totals.failed || 0)}`
  );
  const skippedByReason = joinCompactCounts(totals.skippedByReason);
  if (skippedByReason) lines.push(`Skipped by reason: ${skippedByReason}`);
  const failedByReason = joinCompactCounts(totals.failedByReason);
  if (failedByReason) lines.push(`Failed by reason: ${failedByReason}`);
  const failedExample = firstCompactExample(totals.failedExamplesByReason);
  if (failedExample) lines.push(`Example: ${failedExample}`);
  lines.push("");
  lines.push("--- Run finished ---");
  const result = Number(totals.failed || 0) > 0 ? "failed" : state.warnings.length > 0 ? "completed_with_warnings" : "completed";
  lines.push(
    `Result=${result} | duration=${formatDurationHms(Number(totals.totalMs || 0))} | warnings=${state.warnings.length} | failures=${Number(totals.failed || 0)}`
  );
  return `${lines.join("\n")}\n`;
}

function joinCompactCounts(input) {
  const obj = input && typeof input === "object" ? input : {};
  const keys = Object.keys(obj);
  if (keys.length < 1) return "";
  return keys.sort().map((key) => `${key}=${Number(obj[key] || 0)}`).join(" | ");
}

function firstCompactExample(input) {
  const obj = input && typeof input === "object" ? input : {};
  const key = Object.keys(obj).sort()[0];
  if (!key) return "";
  return String(obj[key] || "").trim();
}

function formatDurationHms(durationMs) {
  const totalSeconds = Math.max(0, Math.floor(Number(durationMs || 0) / 1000));
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function formatTimestampUtc(rawIso) {
  const text = String(rawIso || "");
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) return text;
  const d = new Date(ms);
  const pad2 = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(
    d.getUTCMinutes()
  )}:${pad2(d.getUTCSeconds())} UTC`;
}

function collectEnabledSignals(state) {
  const allowed = new Set(["OFFLINE", "REBOOT_REQUIRED", "VULNERABILITY", "UPDATE", "AUTOMATION_FAILED"]);
  const out = new Set();
  for (const signal of Object.keys(state.candidatesBySignal || {})) {
    if (allowed.has(signal)) out.add(signal);
  }
  for (const org of state.orgRows) {
    for (const signal of Object.keys(org.signals || {})) {
      if (allowed.has(signal)) out.add(signal);
    }
  }
  return Array.from(out.values()).sort();
}

function formatReadableValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch (_) {
    return String(value);
  }
}

module.exports = {
  createConsoleRunLogger,
  createFileRunLogger,
  createCompositeRunLogger,
  createNoopRunLogger,
  emitLog,
};
