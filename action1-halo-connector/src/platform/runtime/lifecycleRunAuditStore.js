// lifecycleRunAuditStore.js
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
const { LOG_EVENT_TYPES, emitLog } = require("../logging");

const DEFAULT_LIFECYCLE_RUN_AUDIT_FILE_PATH = path.join(process.cwd(), "data", "lifecycle-run-audit.json");
const DEFAULT_MAX_AUDIT_RECORDS = 100;

/**
 * @param {{filePath?: string, maxRecords?: number, fsModule?: any, runLogger?: any, now?: ()=>number}} [opts]
 */
function createFileLifecycleRunAuditStore(opts = {}) {
  const filePath = opts.filePath || DEFAULT_LIFECYCLE_RUN_AUDIT_FILE_PATH;
  const maxRecords = toPositiveInt(opts.maxRecords, DEFAULT_MAX_AUDIT_RECORDS);
  const fsModule = opts.fsModule || fs;
  const runLogger = opts.runLogger || null;
  const nowFn = typeof opts.now === "function" ? opts.now : Date.now;

  return {
    appendRun,
    listRuns,
    filePath,
  };

  async function appendRun(record) {
    const state = await loadState();
    const normalized = normalizeAuditRecord(record);
    state.runs.push(normalized);
    state.runs = state.runs
      .sort((a, b) => String(b.startedAt || "").localeCompare(String(a.startedAt || "")))
      .slice(0, maxRecords);
    state.updatedAt = new Date().toISOString();
    await saveState(state);
  }

  /**
   * @param {{limit?: number}} [opts]
   */
  async function listRuns(opts = {}) {
    const state = await loadState();
    const limit = toPositiveInt(opts.limit, 20);
    return state.runs
      .slice()
      .sort((a, b) => String(b.startedAt || "").localeCompare(String(a.startedAt || "")))
      .slice(0, limit)
      .map((row) => ({ ...row }));
  }

  async function loadState() {
    try {
      const raw = await fsModule.readFile(filePath, "utf8");
      return normalizeAuditState(JSON.parse(raw));
    } catch (error) {
      if (error?.code === "ENOENT") {
        return normalizeAuditState({});
      }
      if (isJsonParseError(error)) {
        await quarantineCorruptAuditFile(error);
        return normalizeAuditState({});
      }
      throw error;
    }
  }

  async function saveState(state) {
    const folder = path.dirname(filePath);
    await fsModule.mkdir(folder, { recursive: true });
    const normalized = normalizeAuditState(state);
    const text = JSON.stringify(normalized, null, 2);
    const tempPath = `${filePath}.tmp-${process.pid}-${nowFn()}`;
    let handle = null;
    try {
      handle = await fsModule.open(tempPath, "w");
      await handle.writeFile(text, "utf8");
      await handle.sync();
      await handle.close();
      handle = null;
      await fsModule.rename(tempPath, filePath);
    } catch (error) {
      if (handle) {
        try {
          await handle.close();
        } catch (_) {
          // ignore close errors
        }
      }
      try {
        await fsModule.unlink(tempPath);
      } catch (_) {
        // ignore cleanup failures
      }
      throw error;
    }
  }

  async function quarantineCorruptAuditFile(parseError) {
    const folder = path.dirname(filePath);
    const baseName = path.basename(filePath, path.extname(filePath));
    const ext = path.extname(filePath) || ".json";
    const stamp = new Date(nowFn()).toISOString().replace(/[:.]/g, "-");
    const quarantinePath = path.join(folder, `${baseName}.corrupt.${stamp}${ext}`);
    try {
      await fsModule.rename(filePath, quarantinePath);
      await logAuditStoreIssue("Corrupt lifecycle run audit file quarantined", {
        filePath,
        quarantinePath,
        reason: parseError?.message || "invalid_json",
      });
    } catch (error) {
      await logAuditStoreIssue("Corrupt lifecycle run audit file detected; quarantine failed", {
        filePath,
        reason: parseError?.message || "invalid_json",
        quarantineError: error?.message || "unknown",
      });
    }
  }

  async function logAuditStoreIssue(message, context) {
    if (runLogger && typeof runLogger.emit === "function") {
      await emitLog({
        runLogger,
        runId: "lifecycle-run-audit-store",
        level: "ERROR",
        eventType: LOG_EVENT_TYPES.PARTIAL_FAILURE,
        message,
        context: context && typeof context === "object" ? context : {},
      });
      return;
    }
    try {
      process.stderr.write(`[lifecycle-run-audit-store] ${message} ${JSON.stringify(context || {})}\n`);
    } catch (_) {
      // ignore best-effort fallback logging errors
    }
  }
}

function createInMemoryLifecycleRunAuditStore() {
  const rows = [];
  return {
    async appendRun(record) {
      rows.push(normalizeAuditRecord(record));
      rows.sort((a, b) => String(b.startedAt || "").localeCompare(String(a.startedAt || "")));
      if (rows.length > DEFAULT_MAX_AUDIT_RECORDS) rows.length = DEFAULT_MAX_AUDIT_RECORDS;
    },
    async listRuns(opts = {}) {
      const limit = toPositiveInt(opts.limit, 20);
      return rows.slice(0, limit).map((row) => ({ ...row }));
    },
  };
}

function normalizeAuditState(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    runs: Array.isArray(src.runs) ? src.runs.map(normalizeAuditRecord) : [],
    updatedAt: String(src.updatedAt || new Date().toISOString()),
  };
}

function normalizeAuditRecord(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    id: String(src.id || ""),
    startedAt: String(src.startedAt || ""),
    finishedAt: String(src.finishedAt || ""),
    ok: Boolean(src.ok),
    candidateCount: Number(src.candidateCount || 0),
    skippedCandidateCount: Number(src.skippedCandidateCount || 0),
    maxCandidates: Number(src.maxCandidates || 0),
    summary: src.summary && typeof src.summary === "object" ? src.summary : {},
    diagnostics: src.diagnostics && typeof src.diagnostics === "object" ? src.diagnostics : {},
    error: src.error && typeof src.error === "object" ? src.error : null,
  };
}

function toPositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return fallback;
  return n;
}

function isJsonParseError(error) {
  const name = String(error?.name || "");
  if (name === "SyntaxError") return true;
  const message = String(error?.message || "").toLowerCase();
  return message.includes("json") && message.includes("position");
}

module.exports = {
  DEFAULT_LIFECYCLE_RUN_AUDIT_FILE_PATH,
  createFileLifecycleRunAuditStore,
  createInMemoryLifecycleRunAuditStore,
};
