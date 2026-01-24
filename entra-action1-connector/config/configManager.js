// config/configManager.js
// Minimal config read/write utilities + safe mutations.
// We keep the existing config structure (tenants[].targets[].organizationIds + mappings).

import fs from "node:fs";
import path from "node:path";

export function readJson(configPath) {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }
  const raw = fs.readFileSync(configPath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`Invalid JSON in config: ${configPath}. ${e.message}`);
  }
}

/**
 * Writes JSON atomically and optionally creates a backup.
 *
 * Backup modes:
 * - backup=false        : no backup
 * - backup=true         : legacy behavior (timestamped backups)  -> config.json.bak-<stamp>
 * - backup="single"     : single rolling backup                 -> config.json.bak (overwritten)
 *
 * Returns: { configPath, backupPath }
 */
export function writeJsonAtomic(configPath, obj, { backup = "single" } = {}) {
  const dir = path.dirname(configPath);
  const base = path.basename(configPath);

  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const tmpPath = path.join(dir, `${base}.tmp`);

  // Determine backup path(s)
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const bakStampPath = path.join(dir, `${base}.bak-${stamp}`); // legacy
  const bakSinglePath = path.join(dir, `${base}.bak`); // recommended

  const json = JSON.stringify(obj, null, 2) + "\n";

  // 1) Create backup (from current config file) BEFORE overwriting
  let backupPath = null;
  if (backup && fs.existsSync(configPath)) {
    if (backup === "single") {
      fs.copyFileSync(configPath, bakSinglePath);
      backupPath = bakSinglePath;
    } else {
      // legacy timestamped backups
      fs.copyFileSync(configPath, bakStampPath);
      backupPath = bakStampPath;
    }
  }

  // 2) Write temp + atomic replace on same filesystem
  fs.writeFileSync(tmpPath, json, "utf8");
  fs.renameSync(tmpPath, configPath);

  return { configPath, backupPath };
}

export function createEmptyTemplate() {
  return {
    action1: {
      apiBaseUrl: "",
      clientId: "",
      clientSecretRef: "action1:main",
    },
    tenants: [],
    logging: { level: "info" },
  };
}

function looksLikeGuid(s) {
  return /^[0-9a-fA-F-]{36}$/.test(String(s || "").trim());
}

export function ensureTenantsArray(config) {
  if (!Array.isArray(config.tenants)) config.tenants = [];
}

export function ensureTargetsArray(tenant) {
  if (!Array.isArray(tenant.targets)) tenant.targets = [];
}

export function findTenant(config, tenantSelector) {
  const sel = String(tenantSelector || "").trim();
  if (!sel) throw new Error(`--tenant is required`);

  const tenants = Array.isArray(config.tenants) ? config.tenants : [];

  if (looksLikeGuid(sel)) {
    const t = tenants.find((x) => x.tenantId === sel);
    if (!t) throw new Error(`Tenant not found by tenantId: ${sel}`);
    return t;
  }

  const matches = tenants.filter((x) => (x.name || "").toLowerCase() === sel.toLowerCase());
  if (matches.length === 0) throw new Error(`Tenant not found by name: ${sel}`);
  if (matches.length > 1) throw new Error(`Tenant name is not unique: "${sel}". Use tenantId instead.`);
  return matches[0];
}

export function orgBelongsToOtherTenant(config, tenantObj, orgId) {
  for (const t of config.tenants || []) {
    if (t === tenantObj) continue;
    for (const target of t.targets || []) {
      if ((target.organizationIds || []).includes(orgId)) return t;
    }
  }
  return null;
}

export function addOrgsToTenant(
  config,
  tenantObj,
  orgIds,
  { separateTarget = false, targetIndex = null, defaultMappings = [] } = {}
) {
  ensureTargetsArray(tenantObj);

  const normalized = (orgIds || []).map((x) => String(x).trim()).filter(Boolean);
  if (normalized.length === 0) throw new Error(`No orgIds provided`);

  // Enforce cross-tenant uniqueness
  for (const orgId of normalized) {
    const other = orgBelongsToOtherTenant(config, tenantObj, orgId);
    if (other) {
      throw new Error(`orgId ${orgId} already belongs to another tenant: "${other.name}" (${other.tenantId})`);
    }
  }

  // Collect orgs already present in this tenant
  const already = new Set();
  for (const target of tenantObj.targets) {
    for (const id of target.organizationIds || []) already.add(id);
  }

  const toAdd = normalized.filter((id) => !already.has(id));
  const skipped = normalized.filter((id) => already.has(id));

  if (toAdd.length === 0) {
    return { added: [], skipped, targetIndex: null };
  }

  // If user explicitly asked to add to a specific target block
  if (targetIndex != null) {
    const idx = Number(targetIndex);
    if (!Number.isInteger(idx) || idx < 1 || idx > tenantObj.targets.length) {
      throw new Error(`Invalid --target-index ${targetIndex}. Tenant has ${tenantObj.targets.length} target(s).`);
    }

    const target = tenantObj.targets[idx - 1];
    if (!Array.isArray(target.organizationIds)) target.organizationIds = [];
    target.organizationIds.push(...toAdd);

    // Ensure mappings exist
    if (!Array.isArray(target.mappings) || target.mappings.length === 0) {
      target.mappings = Array.isArray(defaultMappings) ? [...defaultMappings] : [];
    }

    return { added: toAdd, skipped, targetIndex: idx };
  }

  // If separate target requested OR no targets yet -> create a new target
  if (separateTarget || tenantObj.targets.length === 0) {
    tenantObj.targets.push({
      organizationIds: toAdd,
      mappings: Array.isArray(defaultMappings) ? [...defaultMappings] : [],
    });
    return { added: toAdd, skipped, targetIndex: tenantObj.targets.length };
  }

  // Default behavior: add into target #1
  const target0 = tenantObj.targets[0];
  if (!Array.isArray(target0.organizationIds)) target0.organizationIds = [];
  target0.organizationIds.push(...toAdd);

  // Ensure mappings exist on default target
  if (!Array.isArray(target0.mappings) || target0.mappings.length === 0) {
    target0.mappings = Array.isArray(defaultMappings) ? [...defaultMappings] : [];
  }

  return { added: toAdd, skipped, targetIndex: 1 };
}

export function removeOrgFromTenant(tenantObj, orgId, { targetIndex = null } = {}) {
  ensureTargetsArray(tenantObj);

  const id = String(orgId || "").trim();
  if (!id) throw new Error(`--org-id is required`);

  const removedFrom = [];

  const removeFromTarget = (target, idx) => {
    const before = target.organizationIds || [];
    const after = before.filter((x) => x !== id);
    if (after.length !== before.length) {
      target.organizationIds = after;
      removedFrom.push(idx);
    }
  };

  if (targetIndex != null) {
    const i = Number(targetIndex);
    if (!Number.isInteger(i) || i < 1 || i > tenantObj.targets.length) {
      throw new Error(`Invalid --target-index ${targetIndex}`);
    }
    removeFromTarget(tenantObj.targets[i - 1], i);
  } else {
    for (let i = 0; i < tenantObj.targets.length; i++) {
      removeFromTarget(tenantObj.targets[i], i + 1);
    }
  }

  // Remove empty targets automatically
  tenantObj.targets = tenantObj.targets.filter((t) => (t.organizationIds || []).length > 0);

  return { removedFrom };
}
