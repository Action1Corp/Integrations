// config/config.js
import fs from 'fs';

const ALLOW_DUPLICATE_TENANTS = process.env.ALLOW_DUPLICATE_TENANTS === '1';

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Load and validate config.json
 *
 * Modes:
 *  - strict  (default): config must be runnable (tenants[].targets non-empty, mappings present, etc.)
 *  - relaxed: allow partially configured tenants (e.g., tenants without targets) so `config show` works
 */
export function loadConfig(configPath, options = {}) {
  const { mode = 'strict' } = options;

  // 1) Read file
  let raw;
  try {
    raw = fs.readFileSync(configPath, 'utf8');
  } catch (err) {
    throw new Error(`Failed to read config file at "${configPath}": ${err.message}`);
  }

  // 2) Parse JSON
  let config;
  try {
    config = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse config JSON: ${err.message}`);
  }

  // 3) Validate minimal structure

  // tenants
  if (!Array.isArray(config.tenants) || config.tenants.length === 0) {
    throw new Error('Config error: "tenants" must be a non-empty array');
  }

  const seenTenantIds = new Set();
  const seenOrgIdsGlobal = new Map(); // orgId -> "tenants[i].targets[j]"
  const seenSecretRefs = new Map(); // ref -> "path where first used"

  function registerSecretRef(ref, path) {
    if (!isNonEmptyString(ref)) {
      throw new Error(`Config error: ${path} must be a non-empty string`);
    }
    const prev = seenSecretRefs.get(ref);
    if (prev) {
      throw new Error(
        `Config error: duplicate clientSecretRef "${ref}". ` +
          `First: ${prev}. Second: ${path}. ` +
          `Each secret ref must be unique to avoid accidental reuse.`
      );
    }
    seenSecretRefs.set(ref, path);
  }

  for (const [tIndex, tenant] of config.tenants.entries()) {
    const tPrefix = `tenants[${tIndex}]`;

    if (!isNonEmptyString(tenant.name)) throw new Error(`Config error: ${tPrefix}.name is required`);
    if (!isNonEmptyString(tenant.tenantId)) throw new Error(`Config error: ${tPrefix}.tenantId is required`);
    if (!isNonEmptyString(tenant.clientId)) throw new Error(`Config error: ${tPrefix}.clientId is required`);

    // Entra secret ref (required)
    if (!isNonEmptyString(tenant.clientSecretRef)) {
      throw new Error(`Config error: ${tPrefix}.clientSecretRef is required`);
    }
    // Explicitly reject plaintext secrets
    if (isNonEmptyString(tenant.clientSecret)) {
      throw new Error(
        `Config error: ${tPrefix}.clientSecret is not allowed. Use ${tPrefix}.clientSecretRef (OS vault).`
      );
    }
    registerSecretRef(tenant.clientSecretRef, `${tPrefix}.clientSecretRef`);

    // Enforce: do not duplicate same tenantId in tenants[]
    if (seenTenantIds.has(tenant.tenantId)) {
      if (!ALLOW_DUPLICATE_TENANTS) {
        throw new Error(
          `Config error: duplicate tenantId "${tenant.tenantId}" in tenants[]. ` +
            `One Entra tenant should be declared once; use ${tPrefix}.targets[] for per-org rules.`
        );
      }
    }
    seenTenantIds.add(tenant.tenantId);

    // targets
    if (!Array.isArray(tenant.targets) || tenant.targets.length === 0) {
      if (mode === 'strict') {
        throw new Error(`Config error: ${tPrefix}.targets must be a non-empty array`);
      }
      // relaxed mode: allow partially configured tenant (e.g. added tenant but no orgs selected yet)
      tenant.targets = [];
    }

    const seenOrgIdsInTenant = new Set();

    for (const [rIndex, target] of tenant.targets.entries()) {
      const rPrefix = `${tPrefix}.targets[${rIndex}]`;

      if (!Array.isArray(target.organizationIds) || target.organizationIds.length === 0) {
        throw new Error(`Config error: ${rPrefix}.organizationIds must be a non-empty array`);
      }

      for (const [oIndex, orgId] of target.organizationIds.entries()) {
        if (!isNonEmptyString(orgId)) {
          throw new Error(`Config error: ${rPrefix}.organizationIds[${oIndex}] must be a non-empty string`);
        }

        // prevent same orgId being declared twice within one tenant across targets
        if (seenOrgIdsInTenant.has(orgId)) {
          throw new Error(
            `Config error: duplicate organizationId "${orgId}" within tenant "${tenant.tenantId}". ` +
              `Each organization should belong to exactly one targets[] block for that tenant.`
          );
        }
        seenOrgIdsInTenant.add(orgId);

        // global uniqueness: one org must belong to one Entra tenant
        const prev = seenOrgIdsGlobal.get(orgId);
        if (prev) {
          if (!ALLOW_DUPLICATE_TENANTS) {
            throw new Error(
              `Config error: organizationId "${orgId}" is declared more than once across tenants. ` +
                `First: ${prev}. Second: ${rPrefix}. ` +
                `One Action1 organizationId must belong to exactly one Entra tenant in this config.`
            );
          }
        }
        seenOrgIdsGlobal.set(orgId, rPrefix);
      }

      if (!Array.isArray(target.mappings) || target.mappings.length === 0) {
        throw new Error(`Config error: ${rPrefix}.mappings must be a non-empty array`);
      }

      for (const [mIndex, m] of target.mappings.entries()) {
        const mPrefix = `${rPrefix}.mappings[${mIndex}]`;
        if (!m || typeof m !== 'object') {
          throw new Error(`Config error: ${mPrefix} must be an object`);
        }
        if (!isNonEmptyString(m.entraProperty)) {
          throw new Error(`Config error: ${mPrefix}.entraProperty is required`);
        }
        if (!isNonEmptyString(m.action1CustomAttribute)) {
          throw new Error(`Config error: ${mPrefix}.action1CustomAttribute is required`);
        }
      }
    }
  }

  // action1
  if (!config.action1 || typeof config.action1 !== 'object') {
    throw new Error('Config error: "action1" section is required');
  }
  if (!isNonEmptyString(config.action1.apiBaseUrl)) {
    throw new Error('Config error: "action1.apiBaseUrl" is required');
  }
  if (!isNonEmptyString(config.action1.clientId)) {
    throw new Error('Config error: "action1.clientId" is required');
  }

  // Action1 secret ref (required)
  if (!isNonEmptyString(config.action1.clientSecretRef)) {
    throw new Error('Config error: "action1.clientSecretRef" is required');
  }
  // Explicitly reject plaintext secrets
  if (isNonEmptyString(config.action1.clientSecret)) {
    throw new Error(
      'Config error: "action1.clientSecret" is not allowed. Use "action1.clientSecretRef" (OS vault).'
    );
  }
  registerSecretRef(config.action1.clientSecretRef, 'action1.clientSecretRef');

  // logging defaults
  if (!config.logging) config.logging = { level: 'info' };
  if (!config.logging.level) config.logging.level = 'info';

  return config;
}
