// cli/configCli.js
// Config CLI implementation (init/show/validate/action1/tenant/org + org-select/org-unselect).
// Uses existing modules: loadConfig(), getAccessToken(), listOrganizations().

import { Command } from "commander";
import { checkbox } from "@inquirer/prompts";
import pc from "picocolors";

import { getSecret } from "../secrets/secretStore.js";
import { DEFAULT_MAPPINGS } from "../config/defaultMappings.js";

import {
  readJson,
  writeJsonAtomic,
  createEmptyTemplate,
  ensureTenantsArray,
  findTenant,
  addOrgsToTenant,
  removeOrgFromTenant,
} from "../config/configManager.js";

import { loadConfig } from "../config/config.js";
import { createLogger } from "../logging/logger.js";
import { getAccessToken, listOrganizations } from "../action1/action1Client.js";

// -------------------------
// Helpers: formatting
// -------------------------
function mask(s) {
  if (!s) return "";
  const str = String(s);
  if (str.length <= 18) return "********";
  return `${str.slice(0, 12)}...${str.slice(-8)}`;
}

function buildOrgIndex(cfg) {
  // orgId -> array of { tenantName, tenantId, targetIndex }
  const map = new Map();
  for (const t of cfg.tenants || []) {
    const targets = t.targets || [];
    for (let i = 0; i < targets.length; i++) {
      const ti = i + 1;
      for (const orgId of targets[i].organizationIds || []) {
        if (!map.has(orgId)) map.set(orgId, []);
        map.get(orgId).push({ tenantName: t.name, tenantId: t.tenantId, targetIndex: ti });
      }
    }
  }
  return map;
}

function countTotalScopes(cfg) {
  return (cfg.tenants || []).reduce((acc, t) => acc + ((t.targets || []).length), 0);
}

function countTotalA1Orgs(cfg) {
  let n = 0;
  for (const t of cfg.tenants || []) {
    for (const tg of t.targets || []) n += (tg.organizationIds || []).length;
  }
  return n;
}

function uniqueA1OrgCount(cfg) {
  const s = new Set();
  for (const t of cfg.tenants || []) {
    for (const tg of t.targets || []) {
      for (const id of tg.organizationIds || []) s.add(id);
    }
  }
  return s.size;
}

function summarizeAttributes(mappings) {
  const attrs = (mappings || []).map((m) => m?.action1CustomAttribute).filter(Boolean);
  if (attrs.length === 0) return "-";
  const seen = new Set();
  const out = [];
  for (const a of attrs) {
    if (!seen.has(a)) {
      seen.add(a);
      out.push(a);
    }
  }
  return out.join(", ");
}

function pluralize(count, singular, plural) {
  return count === 1 ? singular : plural;
}

// -------------------------
// New formatting functions (Variant 5 - minimal with color)
// -------------------------
function printAction1Table(cfg) {
  console.log(pc.bold("ACTION1 CONFIG"));
  console.log(`  ${cfg.action1?.apiBaseUrl || ""}`);
  console.log(`  Client: ${mask(cfg.action1?.clientId || "")} (${cfg.action1?.clientSecretRef || ""})`);
  console.log("");
  
  const tenantCount = (cfg.tenants || []).length;
  const scopeCount = countTotalScopes(cfg);
  const totalOrgs = countTotalA1Orgs(cfg);
  const uniqueOrgs = uniqueA1OrgCount(cfg);
  
  const tenantText = pluralize(tenantCount, "tenant", "tenants");
  const scopeText = pluralize(scopeCount, "scope", "scopes");
  const orgText = pluralize(totalOrgs, "Action1 Org", "Action1 Orgs");
  
  console.log(pc.bold(`SUMMARY: ${tenantCount} ${tenantText} • ${scopeCount} ${scopeText} • ${totalOrgs} ${orgText} (${uniqueOrgs} unique)`));
  console.log("");
}

function printTenantBlock(tenant, { nameById, resolveOrgs, verbose }) {
  const name = tenant?.name || "(no name)";
  const tenantId = tenant?.tenantId || "";
  const clientId = mask(tenant?.clientId || "");
  const secretRef = tenant?.clientSecretRef || "";

  console.log("━".repeat(79));
  console.log("");
  console.log(pc.bold(`▸ ${name}`));
  console.log(`  ${tenantId}`);
  console.log(`  Client: ${clientId} (${secretRef})`);
  console.log("");

  const targets = tenant.targets || [];
  
  if (targets.length === 0) {
    console.log(pc.dim("  (no target scopes)"));
    console.log("");
    return;
  }

  for (let i = 0; i < targets.length; i++) {
    const tg = targets[i];
    const orgIds = tg.organizationIds || [];
    const orgCount = orgIds.length;
    const mappings = tg.mappings || [];
    const mapCount = mappings.length;
    const attrs = summarizeAttributes(mappings);

    const orgText = pluralize(orgCount, "Action1 Org", "Action1 Orgs");
    const mapText = pluralize(mapCount, "mapping", "mappings");
    
    console.log(pc.bold(`  Scope ${i + 1}`) + pc.dim(` → ${orgCount} ${orgText}, ${mapCount} ${mapText}`));
    console.log(pc.dim(`  Attrs: ${attrs}`));

    if (orgIds.length === 0) {
      console.log(pc.dim("    (no organizations)"));
    } else {
      for (const id of orgIds) {
        if (resolveOrgs) {
          const name = nameById.get(id);
          if (name) {
            if (verbose) {
              console.log(`    ${pc.green("✓")} ${name}`);
              console.log(pc.dim(`      ${id}`));
            } else {
              console.log(`    ${pc.green("✓")} ${name}`);
            }
          } else {
            console.log(`    ${pc.yellow("⊗")} ${id} ${pc.dim("(unknown)")}`);
          }
        } else {
          console.log(`    ${id}`);
        }
      }
    }

    console.log("");
  }
}

function printWarnings(cfg) {
  const orgIndex = buildOrgIndex(cfg);

  const crossTenantDuplicates = [];
  for (const [orgId, places] of orgIndex.entries()) {
    const uniqueTenants = new Set(places.map((p) => p.tenantId));
    if (uniqueTenants.size > 1) crossTenantDuplicates.push({ orgId, places });
  }

  const withinTenantDuplicates = [];
  for (const t of cfg.tenants || []) {
    const seen = new Map();
    for (let i = 0; i < (t.targets || []).length; i++) {
      const ti = i + 1;
      for (const orgId of t.targets[i].organizationIds || []) {
        if (seen.has(orgId)) {
          withinTenantDuplicates.push({ tenant: t, orgId, a: seen.get(orgId), b: ti });
        } else {
          seen.set(orgId, ti);
        }
      }
    }
  }

  if (crossTenantDuplicates.length === 0 && withinTenantDuplicates.length === 0) return;

  console.log(pc.bold(pc.yellow("⚠  WARNINGS")));
  console.log("");
  for (const x of crossTenantDuplicates) {
    const where = x.places.map((p) => `${p.tenantName} (scope #${p.targetIndex})`).join(", ");
    console.log(pc.yellow(`  • Action1 Org ${x.orgId} in multiple tenants: ${where}`));
  }
  for (const x of withinTenantDuplicates) {
    console.log(pc.yellow(`  • Tenant "${x.tenant.name}" has Action1 Org ${x.orgId} in multiple scopes: #${x.a}, #${x.b}`));
  }
  console.log("");
}

async function resolveOrgNamesFromAction1(configPath) {
  const cfgValidated = await loadConfig(configPath, { mode: "relaxed" });

  if (!cfgValidated?.action1) throw new Error('Config error: "action1" section is missing');

  if (!cfgValidated.action1?.clientSecret) {
    const ref = cfgValidated.action1?.clientSecretRef;
    if (!ref) throw new Error("Action1 config missing: action1.clientSecretRef");
    cfgValidated.action1.clientSecret = await getSecret(ref);
  }

  const logger = createLogger({ level: process.env.LOG_LEVEL || "info" });
  const token = await getAccessToken(cfgValidated.action1, logger);
  const data = await listOrganizations(cfgValidated.action1, token, logger);

  const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
  const nameById = new Map();

  for (const o of items) {
    const id = o?.id ?? o?.organization_id ?? o?.org_id;
    const name = o?.name ?? o?.display_name ?? o?.title ?? "(no name)";
    if (id) nameById.set(id, name);
  }

  return nameById;
}

// -------------------------
// CLI entry
// -------------------------
export async function runConfigCli(argv) {
  const program = new Command();

  program
    .name("entra-action1 config")
    .description("Config builder for Entra → Action1 Connector")
    .showHelpAfterError();

  program
    .command("init")
    .requiredOption("--config <path>", "Path to config.json")
    .option("--force", "Overwrite existing config file")
    .action((opts) => {
      if (!opts.force) {
        try {
          readJson(opts.config);
          throw new Error(`Config already exists: ${opts.config}. Use --force to overwrite.`);
        } catch (e) {
          if (!String(e.message).includes("not found")) {
            if (String(e.message).includes("Invalid JSON")) {
              throw new Error(`Config exists but invalid JSON: ${opts.config}. Fix it or use --force.`);
            }
          }
        }
      }

      const tpl = createEmptyTemplate();
      writeJsonAtomic(opts.config, tpl, { backup: "single" });
      console.log(`Created config template: ${opts.config}`);
    });

  program
    .command("show")
    .requiredOption("--config <path>", "Path to config.json")
    .option("--resolve-orgs", "Resolve org names from Action1 API (requires Action1 secret)")
    .option("--verbose", "Show detailed org IDs")
    .action(async (opts) => {
      const cfgRaw = readJson(opts.config);

      let nameById = new Map();
      if (opts.resolveOrgs) {
        nameById = await resolveOrgNamesFromAction1(opts.config);
      }

      printAction1Table(cfgRaw);

      for (const tenant of cfgRaw.tenants || []) {
        printTenantBlock(tenant, { 
          nameById, 
          resolveOrgs: !!opts.resolveOrgs, 
          verbose: !!opts.verbose 
        });
      }

      printWarnings(cfgRaw);
    });

  program
    .command("validate")
    .requiredOption("--config <path>", "Path to config.json")
    .action(async (opts) => {
      await loadConfig(opts.config);
      console.log(`✓ Config is valid: ${opts.config}`);
    });

  program
    .command("action1-set")
    .description("Set Action1 API settings (no secret value stored in config)")
    .requiredOption("--config <path>", "Path to config.json")
    .requiredOption("--base-url <url>", "Action1 API base URL")
    .requiredOption("--client-id <id>", "Action1 clientId")
    .requiredOption("--secret-ref <ref>", "Secret ref in OS vault (e.g. action1:main)")
    .action((opts) => {
      const cfg = readJson(opts.config);
      cfg.action1 = {
        apiBaseUrl: opts.baseUrl,
        clientId: opts.clientId,
        clientSecretRef: opts.secretRef,
      };
      writeJsonAtomic(opts.config, cfg, { backup: "single" });
      console.log(`Updated Action1 settings in: ${opts.config}`);
    });

  program
    .command("tenant-add")
    .requiredOption("--config <path>", "Path to config.json")
    .requiredOption("--name <name>", "Tenant display name")
    .requiredOption("--tenant-id <id>", "Entra tenantId (GUID)")
    .requiredOption("--client-id <id>", "Entra app clientId")
    .requiredOption("--secret-ref <ref>", "Secret ref in OS vault (e.g. entra:tenant-a)")
    .action((opts) => {
      const cfg = readJson(opts.config);
      ensureTenantsArray(cfg);

      if (cfg.tenants.some((t) => t.tenantId === opts.tenantId)) {
        throw new Error(`Tenant already exists with tenantId: ${opts.tenantId}`);
      }

      cfg.tenants.push({
        name: opts.name,
        tenantId: opts.tenantId,
        clientId: opts.clientId,
        clientSecretRef: opts.secretRef,
        targets: [],
      });

      writeJsonAtomic(opts.config, cfg, { backup: "single" });
      console.log(`Added tenant "${opts.name}" to: ${opts.config}`);
    });

  program
    .command("tenant-list")
    .requiredOption("--config <path>", "Path to config.json")
    .action((opts) => {
      const cfg = readJson(opts.config);
      const tenants = cfg.tenants || [];
      if (tenants.length === 0) return console.log("(no tenants)");
      for (const t of tenants) {
        console.log(`${t.name}  •  ID: ${t.tenantId}  •  Client: ${mask(t.clientId)}  •  Ref: ${t.clientSecretRef}`);
      }
    });

  program
    .command("tenant-remove")
    .requiredOption("--config <path>", "Path to config.json")
    .requiredOption("--tenant <nameOrId>", "Tenant name or tenantId")
    .action((opts) => {
      const cfg = readJson(opts.config);
      ensureTenantsArray(cfg);
      const t = findTenant(cfg, opts.tenant);

      cfg.tenants = cfg.tenants.filter((x) => x !== t);
      writeJsonAtomic(opts.config, cfg, { backup: "single" });
      console.log(`Removed tenant "${t.name}" from: ${opts.config}`);
    });

  program
    .command("org-add")
    .requiredOption("--config <path>", "Path to config.json")
    .requiredOption("--tenant <nameOrId>", "Tenant name or tenantId")
    .option("--org-id <id>", "Single orgId")
    .option("--org-ids <ids>", "Comma-separated orgIds")
    .option("--separate-target", "Create a new target block for these orgs")
    .option("--target-index <n>", "Add orgs into a specific target block (1-based)")
    .action((opts) => {
      const cfg = readJson(opts.config);
      const tenant = findTenant(cfg, opts.tenant);

      const ids = [];
      if (opts.orgId) ids.push(opts.orgId);
      if (opts.orgIds) ids.push(...opts.orgIds.split(",").map((s) => s.trim()).filter(Boolean));

      const res = addOrgsToTenant(cfg, tenant, ids, {
        separateTarget: !!opts.separateTarget,
        targetIndex: opts.targetIndex != null ? Number(opts.targetIndex) : null,
        defaultMappings: DEFAULT_MAPPINGS,
      });

      writeJsonAtomic(opts.config, cfg, { backup: "single" });
      console.log(`Updated Action1 Orgs for tenant "${tenant.name}" in: ${opts.config}`);
      console.log(`Added: ${res.added.length}  •  Skipped: ${res.skipped.length}`);
      if (res.targetIndex) console.log(`Target used: #${res.targetIndex}`);
    });

  program
    .command("org-remove")
    .requiredOption("--config <path>", "Path to config.json")
    .requiredOption("--tenant <nameOrId>", "Tenant name or tenantId")
    .requiredOption("--org-id <id>", "OrgId to remove")
    .option("--target-index <n>", "Only remove from a specific target block (1-based)")
    .action((opts) => {
      const cfg = readJson(opts.config);
      const tenant = findTenant(cfg, opts.tenant);

      const res = removeOrgFromTenant(tenant, opts.orgId, {
        targetIndex: opts.targetIndex != null ? Number(opts.targetIndex) : null,
      });

      writeJsonAtomic(opts.config, cfg, { backup: "single" });
      console.log(`Removed Action1 Org from tenant "${tenant.name}" in: ${opts.config}`);
      console.log(`Removed from targets: ${res.removedFrom.length ? res.removedFrom.join(", ") : "(not found)"}`);
    });

  program
    .command("org-select")
    .requiredOption("--config <path>", "Path to config.json")
    .requiredOption("--tenant <nameOrId>", "Tenant name or tenantId")
    .option("--separate-target", "Create a new target block for selected orgs")
    .option("--target-index <n>", "Add selected orgs into a specific target block (1-based)")
    .action(async (opts) => {
      const cfgValidated = await loadConfig(opts.config, { mode: "relaxed" });
      const cfgRaw = readJson(opts.config);
      const tenant = findTenant(cfgRaw, opts.tenant);

      if (!cfgValidated?.action1) throw new Error('Config error: "action1" section is missing');

      if (!cfgValidated.action1?.clientSecret) {
        const ref = cfgValidated.action1?.clientSecretRef;
        if (!ref) throw new Error("Action1 config missing: action1.clientSecretRef");
        cfgValidated.action1.clientSecret = await getSecret(ref);
      }

      const logger = createLogger({ level: process.env.LOG_LEVEL || "info" });
      const token = await getAccessToken(cfgValidated.action1, logger);
      const data = await listOrganizations(cfgValidated.action1, token, logger);

      const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
      if (items.length === 0) {
        console.log("No Action1 Organizations returned from Action1.");
        return;
      }

      const rows = items
        .map((o) => ({
          id: o?.id ?? o?.organization_id ?? o?.org_id,
          name: o?.name ?? o?.display_name ?? o?.title ?? "(no name)",
        }))
        .filter((x) => x.id)
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));

      const selected = await checkbox({
        message: "Select Action1 Organizations to include:",
        choices: rows.map((r) => ({ name: `${r.name} (${r.id})`, value: r.id })),
        pageSize: 15,
      });

      if (!selected || selected.length === 0) {
        console.log("Nothing selected. No changes made.");
        return;
      }

      const res = addOrgsToTenant(cfgRaw, tenant, selected, {
        separateTarget: !!opts.separateTarget,
        targetIndex: opts.targetIndex != null ? Number(opts.targetIndex) : null,
        defaultMappings: DEFAULT_MAPPINGS,
      });

      writeJsonAtomic(opts.config, cfgRaw, { backup: "single" });
      console.log(`Saved selected Action1 Orgs for tenant "${tenant.name}" -> ${opts.config}`);
      console.log(`Added: ${res.added.length}  •  Skipped: ${res.skipped.length}`);
      if (res.targetIndex) console.log(`Target used: #${res.targetIndex}`);
    });

  program
    .command("org-unselect")
    .requiredOption("--config <path>", "Path to config.json")
    .requiredOption("--tenant <nameOrId>", "Tenant name or tenantId")
    .option("--target-index <n>", "Show/remove orgs only from a specific target block (1-based)")
    .option("--resolve-orgs", "Resolve org names from Action1 API (requires Action1 secret)")
    .action(async (opts) => {
      const cfgRaw = readJson(opts.config);
      const tenant = findTenant(cfgRaw, opts.tenant);

      const idx = opts.targetIndex != null ? Number(opts.targetIndex) : null;
      const targets = tenant.targets || [];
      if (targets.length === 0) {
        console.log("No targets in this tenant.");
        return;
      }

      const collect = [];
      for (let i = 0; i < targets.length; i++) {
        const ti = i + 1;
        if (idx != null && ti !== idx) continue;

        for (const orgId of targets[i].organizationIds || []) {
          collect.push({ orgId, targetIndex: ti });
        }
      }

      if (collect.length === 0) {
        console.log("No Action1 Organizations found for removal scope.");
        return;
      }

      let nameById = new Map();
      if (opts.resolveOrgs) {
        nameById = await resolveOrgNamesFromAction1(opts.config);
      }

      const choices = collect.map((x) => {
        const name = nameById.get(x.orgId);
        const label = name
          ? `${name} (${x.orgId})  ${pc.dim(`[scope #${x.targetIndex}]`)}`
          : `${x.orgId}  ${pc.dim(`[scope #${x.targetIndex}]`)}`;
        return { name: label, value: x };
      });

      const selected = await checkbox({
        message: "Select Action1 Organizations to remove:",
        choices,
        pageSize: 15,
      });

      if (!selected || selected.length === 0) {
        console.log("Nothing selected. No changes made.");
        return;
      }

      for (const item of selected) {
        removeOrgFromTenant(tenant, item.orgId, { targetIndex: item.targetIndex });
      }

      writeJsonAtomic(opts.config, cfgRaw, { backup: "single" });
      console.log(`Removed ${selected.length} Action1 Organization(s) from tenant "${tenant.name}". Saved: ${opts.config}`);
    });

  await program.parseAsync(argv);
}
