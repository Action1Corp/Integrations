// index.js
import { loadConfig } from './config/config.js';
import { createLogger } from './logging/logger.js';
import { runSync } from './sync/syncEngine.js';
import { runConfigCli } from "./cli/configCli.js";

import {
  setSecret,
  getSecret,
  deleteSecret,
  listSecretRefs,
  getServiceName,
} from './secrets/secretStore.js';

import readline from 'node:readline';

if (process.argv[2] === "config") {
  const argvForConfigCli = [process.argv[0], process.argv[1], ...process.argv.slice(3)];
  await runConfigCli(argvForConfigCli);
  process.exit(0);
}

// -------------------------
// Usage
// -------------------------
function printUsage() {
  console.log(`
Entra → Action1 Connector

Usage:
  node index.js --config ./config.json --dry-run
  node index.js --config ./config.json --apply

Secrets:
  node index.js secrets set --ref <ref> [--value <secret>]
  node index.js secrets get --ref <ref>
  node index.js secrets delete --ref <ref>
  node index.js secrets list

Options:
  --config <path>            Path to config.json (required)

  --dry-run                  Do not PATCH Action1 (default if neither --dry-run nor --apply specified)
  --apply                    Apply PATCHes to Action1 (default: NO LIMITS unless you set --max-* flags)

  --cache-entra              Cache Entra devices per tenant within one run (default: true)
  --no-cache-entra           Disable Entra cache

  --max-patches-per-job <n>  Limit patches per job (ONLY if explicitly provided)
  --max-total-patches <n>    Limit patches across all jobs (ONLY if explicitly provided)

  --endpoint-page-size <n>   Managed endpoints page size when calling Action1 API
                             Default: 50 (Action1 API maximum)
  
  --stop-on-job-error        Abort after first job failure (default: false)
  --stop-on-patch-error      Abort job after first PATCH failure (default: false)

  --log-level <level>        debug|info|warn|error (overrides config.logging.level)

  -h, --help                 Show help

Examples:
  node index.js --config ./config.json --dry-run
  node index.js --config ./config.json --apply
  node index.js --config ./config.json --apply --max-patches-per-job 50 --max-total-patches 200

  node index.js secrets set --ref entra:tenant-a
  node index.js secrets set --ref action1:main --value "superSecret"
  node index.js secrets list
`.trim());
}

async function materializeSecrets(config, logger) {
  // Make a deep copy so we don't mutate original config object from loadConfig()
  const cfg = structuredClone(config);

  const missing = [];

  // Action1 secret
  if (cfg.action1?.clientSecretRef) {
    cfg.action1.clientSecret = await getSecret(cfg.action1.clientSecretRef);
  } else if (cfg.action1?.clientSecret) {
    // Backward compatible (temporary)
    logger?.warn?.('[secrets] action1.clientSecret is present in config.json (plaintext). Prefer action1.clientSecretRef.');
  } else {
    missing.push('action1.clientSecretRef');
  }

  // Entra tenant secrets
  if (!Array.isArray(cfg.tenants) || cfg.tenants.length === 0) {
    missing.push('tenants[]');
  } else {
    for (const t of cfg.tenants) {
      if (t?.clientSecretRef) {
        t.clientSecret = await getSecret(t.clientSecretRef);
      } else if (t?.clientSecret) {
        logger?.warn?.(`[secrets] tenant "${t?.name || t?.tenantId || 'unknown'}" has plaintext clientSecret. Prefer clientSecretRef.`);
      } else {
        missing.push(`tenants[].clientSecretRef (tenant "${t?.name || t?.tenantId || 'unknown'}")`);
      }
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing secret references in config. Expected: ${missing.join(', ')}`
    );
  }

  // Safety: never log secrets, only refs
  if (logger?.info) {
    const tenantRefs = (cfg.tenants || [])
      .map((t) => t.clientSecretRef)
      .filter(Boolean);
    logger.info(
      `[secrets] Loaded secrets from vault. action1Ref="${cfg.action1?.clientSecretRef || 'plaintext'}" tenantRefs=${JSON.stringify(tenantRefs)}`
    );
  }

  return cfg;
}


// -------------------------
// Secrets command mode
// -------------------------
function isSecretsCommand(argv) {
  return argv.length >= 3 && argv[2] === 'secrets';
}

function parseSecretsArgs(argv) {
  // node index.js secrets <action> [--ref x] [--value y]
  const args = argv.slice(3);

  const out = {
    action: args[0] || null, // set|get|delete|list
    ref: null,
    value: null,
    help: false,
  };

  for (let i = 1; i < args.length; i++) {
    const a = args[i];

    if (a === '-h' || a === '--help') {
      out.help = true;
      continue;
    }

    if (a === '--ref') {
      out.ref = args[i + 1];
      i++;
      continue;
    }

    if (a === '--value') {
      out.value = args[i + 1];
      i++;
      continue;
    }

    throw new Error(`Unknown secrets argument: ${a}`);
  }

  return out;
}

async function promptLine(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return await new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function runSecretsCommand(argv) {
  const s = parseSecretsArgs(argv);

  if (s.help || !s.action) {
    printUsage();
    process.exit(0);
  }

  // list doesn't need --ref
  if (s.action === 'list') {
    const refs = await listSecretRefs();
    console.log(
      JSON.stringify(
        {
          service: getServiceName(),
          refs,
        },
        null,
        2
      )
    );
    return;
  }

  if (!s.ref) {
    console.error('Error: secrets command requires --ref <ref>');
    process.exit(1);
  }

  if (s.action === 'set') {
    const value = s.value ?? (await promptLine('Enter secret value: '));
    await setSecret(s.ref, value);
    console.log(`Saved secret for ref: ${s.ref}`);
    return;
  }

  if (s.action === 'get') {
    const value = await getSecret(s.ref);
    // Never print the secret value itself
    console.log(
      JSON.stringify(
        {
          ref: s.ref,
          exists: true,
          length: value.length,
        },
        null,
        2
      )
    );
    return;
  }

  if (s.action === 'delete') {
    const ok = await deleteSecret(s.ref);
    console.log(
      JSON.stringify(
        {
          ref: s.ref,
          deleted: Boolean(ok),
        },
        null,
        2
      )
    );
    return;
  }

  console.error(`Error: unknown secrets action: ${s.action}`);
  process.exit(1);
}

// -------------------------
// Main run mode
// -------------------------
function parseArgs(argv) {
  const args = argv.slice(2);

  const out = {
    configPath: null,

    // default mode = dry-run unless --apply specified
    dryRun: true,

    cacheEntraDevices: true,

    // undefined means "do not override syncEngine defaults"
    maxPatchesPerJob: undefined,
    maxTotalPatches: undefined,

    endpointPageSize: undefined,

    stopOnJobError: false,
    stopOnPatchError: false,

    logLevel: undefined,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];

    if (a === '-h' || a === '--help') {
      out.help = true;
      continue;
    }

    if (a === '--config') {
      out.configPath = args[i + 1];
      i++;
      continue;
    }

    if (a === '--dry-run') {
      out.dryRun = true;
      continue;
    }

    if (a === '--apply') {
      out.dryRun = false;
      continue;
    }

    if (a === '--cache-entra') {
      out.cacheEntraDevices = true;
      continue;
    }

    if (a === '--no-cache-entra') {
      out.cacheEntraDevices = false;
      continue;
    }

    if (a === '--max-patches-per-job') {
      out.maxPatchesPerJob = Number(args[i + 1]);
      i++;
      continue;
    }

    if (a === '--max-total-patches') {
      out.maxTotalPatches = Number(args[i + 1]);
      i++;
      continue;
    }

    if (a === '--endpoint-page-size') {
      out.endpointPageSize = Number(args[i + 1]);
      i++;
      continue;
    }

    if (a === '--stop-on-job-error') {
      out.stopOnJobError = true;
      continue;
    }

    if (a === '--stop-on-patch-error') {
      out.stopOnPatchError = true;
      continue;
    }

    if (a === '--log-level') {
      out.logLevel = args[i + 1];
      i++;
      continue;
    }

    throw new Error(`Unknown argument: ${a}`);
  }

  return out;
}

function isFinitePositiveInt(n) {
  return Number.isFinite(n) && n > 0 && Number.isInteger(n);
}

async function main() {
  // --- secrets mode ---
  if (isSecretsCommand(process.argv)) {
    try {
      await runSecretsCommand(process.argv);
      process.exit(0);
    } catch (err) {
      console.error(err?.message ? err.message : String(err));
      process.exit(1);
    }
  }

  // --- normal run mode ---
  let parsed;
  try {
    parsed = parseArgs(process.argv);
  } catch (err) {
    console.error(err?.message ? err.message : String(err));
    printUsage();
    process.exit(1);
  }

  if (parsed.help) {
    printUsage();
    process.exit(0);
  }

  if (!parsed.configPath) {
    console.error('Error: --config <path> is required');
    printUsage();
    process.exit(1);
  }

  // Basic validation for numeric args (nice UX)
  if (parsed.maxPatchesPerJob !== undefined && !isFinitePositiveInt(parsed.maxPatchesPerJob)) {
    console.error('Error: --max-patches-per-job must be a positive integer');
    process.exit(1);
  }
  if (parsed.maxTotalPatches !== undefined && !isFinitePositiveInt(parsed.maxTotalPatches)) {
    console.error('Error: --max-total-patches must be a positive integer');
    process.exit(1);
  }
  if (parsed.endpointPageSize !== undefined && !isFinitePositiveInt(parsed.endpointPageSize)) {
    console.error('Error: --endpoint-page-size must be a positive integer');
    process.exit(1);
  }

const configRaw = loadConfig(parsed.configPath);

const level = parsed.logLevel || configRaw.logging?.level || 'info';
const logger = createLogger({ level });
logger.info(`[main] Log file: ${logger.getLogFile()}`);

const config = await materializeSecrets(configRaw, logger);


  const isApply = parsed.dryRun === false;

  // Variant A:
  // - dry-run: keep syncEngine defaults unless user explicitly overrides
  // - apply: NO LIMITS by default (unless user explicitly sets --max-*)
  const options = {
    dryRun: parsed.dryRun,
    cacheEntraDevices: parsed.cacheEntraDevices,

    maxPatchesPerJob:
      parsed.maxPatchesPerJob !== undefined
        ? parsed.maxPatchesPerJob
        : (isApply ? Number.MAX_SAFE_INTEGER : undefined),

    maxTotalPatches:
      parsed.maxTotalPatches !== undefined
        ? parsed.maxTotalPatches
        : (isApply ? Number.MAX_SAFE_INTEGER : undefined),

    endpointPageSize: parsed.endpointPageSize,
    stopOnJobError: parsed.stopOnJobError,
    stopOnPatchError: parsed.stopOnPatchError,
  };

  const summary = await runSync(config, logger, options);

  // Minimal CLI-friendly summary
  const planned = summary.results.reduce((acc, r) => acc + (r.patchesPlanned || 0), 0);
  const applied = summary.results.reduce((acc, r) => acc + (r.patchesApplied || 0), 0);
  const jobsFailed = summary.results.filter((r) => r.error).length;
  const patchErrors = summary.results.reduce((acc, r) => acc + (r.patchErrors?.length || 0), 0);

  console.log('\n=== RUN SUMMARY ===');
  console.log(
    JSON.stringify(
      {
        dryRun: summary.dryRun,
        jobs: summary.jobs,
        jobsFailed,
        patchesPlanned: planned,
        patchesApplied: applied,
        patchErrors,
      },
      null,
      2
    )
  );

  // exit code: non-zero if any job failed or any patch failed (when apply)
  if (jobsFailed > 0) process.exit(2);
  if (!summary.dryRun && patchErrors > 0) process.exit(3);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
