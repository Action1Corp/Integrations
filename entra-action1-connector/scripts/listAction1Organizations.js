#!/usr/bin/env node
// scripts/listAction1Organizations.js
// Print Action1 organizations (id + name) using config.json action1 credentials.
//
// Notes:
// - Secrets are materialized in-memory only (clientSecretRef -> clientSecret)
// - No secrets are written back to config.json
// - Supports --quiet and --log-level flags for clean output

import path from 'node:path';
import process from 'node:process';

import { loadConfig } from '../config/config.js';
import { createLogger } from '../logging/logger.js';
import { getAccessToken, listOrganizations } from '../action1/action1Client.js';
import { getSecret } from '../secrets/secretStore.js';

function toAbs(p) {
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
}

function normalizeOrgName(o) {
  return o?.name ?? o?.display_name ?? o?.title ?? '(no name)';
}

function normalizeOrgId(o) {
  return o?.id ?? o?.organization_id ?? o?.org_id ?? '(no id)';
}

async function main() {
  const configPath = toAbs(process.argv[2] || './config.json');

  // ------------------------------------------------------------------
  // Logging level handling
  // ------------------------------------------------------------------
  const quiet = process.argv.includes('--quiet');

  const logLevelArgIndex = process.argv.indexOf('--log-level');
  const logLevel =
    quiet
      ? 'warn'
      : logLevelArgIndex !== -1
        ? process.argv[logLevelArgIndex + 1]
        : (process.env.LOG_LEVEL || 'info');

  const logger = createLogger({ level: logLevel });

  // ------------------------------------------------------------------
  // Load config
  // ------------------------------------------------------------------
  logger.info(`[list-orgs] Loading config: ${configPath}`);
  const config = await loadConfig(configPath);

  // ------------------------------------------------------------------
  // Materialize Action1 clientSecret in-memory
  // ------------------------------------------------------------------
  if (!config?.action1) {
    throw new Error('Config error: "action1" section is missing');
  }

  if (!config.action1.clientSecret) {
    const ref = config.action1.clientSecretRef;
    if (!ref) {
      throw new Error(
        'Config error: action1.clientSecretRef is missing (and action1.clientSecret is not present)'
      );
    }

    logger.debug(`[list-orgs] Materializing Action1 secret from ref: ${ref}`);
    const secret = await getSecret(ref);
    config.action1.clientSecret = secret;
  }

  // ------------------------------------------------------------------
  // Call Action1 API
  // ------------------------------------------------------------------
  const token = await getAccessToken(config.action1, logger);
  const data = await listOrganizations(config.action1, token, logger);

  const rawItems = Array.isArray(data)
    ? data
    : Array.isArray(data?.items)
      ? data.items
      : [];

  if (rawItems.length === 0) {
    logger.warn('[list-orgs] No organizations returned.');
    return;
  }

  const rows = rawItems
    .map((o) => ({
      id: normalizeOrgId(o),
      name: normalizeOrgName(o),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // ------------------------------------------------------------------
  // Output (stdout)
  // ------------------------------------------------------------------
  console.log('\nAction1 organizations:\n');

  const ID_WIDTH = 36; // UUID length
  const NAME_WIDTH = Math.max(12, ...rows.map((r) => r.name.length));

  const header =
    'ID'.padEnd(ID_WIDTH) +
    ' | ' +
    'Name'.padEnd(NAME_WIDTH);

  const separator =
    '-'.repeat(ID_WIDTH) +
    '-+-' +
    '-'.repeat(NAME_WIDTH);

  console.log(header);
  console.log(separator);

  for (const r of rows) {
    console.log(
      r.id.padEnd(ID_WIDTH) +
        ' | ' +
        r.name.padEnd(NAME_WIDTH)
    );
  }

  console.log('\nCopy/paste config snippet (IDs):\n');
  console.log(
    JSON.stringify(
      { organizationIds: rows.map((r) => r.id) },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error('\n[ERROR] Failed to list Action1 organizations');
  console.error(err?.stack || String(err));
  process.exit(1);
});
