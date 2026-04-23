// scripts/verifyAction1CustomAttr.js
// Usage:
//   node scripts/verifyAction1CustomAttr.js ./config.json <ORG_ID> <ENDPOINT_ID> "Entra Groups"

import { loadConfig } from '../config/config.js';
import { createLogger } from '../logging/logger.js';
import {
  getAccessToken as getAction1AccessToken,
  listManagedEndpoints,
} from '../action1/action1Client.js';

async function main() {
  const configPath = process.argv[2];
  const orgId = process.argv[3];
  const endpointId = process.argv[4];
  const attrName = process.argv[5] || 'Entra Groups';

  if (!configPath || !orgId || !endpointId) {
    console.error(
      'Usage: node scripts/verifyAction1CustomAttr.js ./config.json <ORG_ID> <ENDPOINT_ID> "Entra Groups"'
    );
    process.exit(1);
  }

  const config = loadConfig(configPath);
  const logger = createLogger({ level: config.logging?.level || 'info' });

  const token = await getAction1AccessToken(config.action1, logger);

  const endpoints = await listManagedEndpoints(
    config.action1,
    token,
    orgId,
    { pageSize: 200 },
    logger
  );

  const ep = endpoints.find((e) => e.id === endpointId || e.endpoint_id === endpointId);
  if (!ep) {
    console.error(`Endpoint not found: ${endpointId} (org ${orgId})`);
    process.exit(2);
  }

  const key = attrName.startsWith('custom:') ? attrName : `custom:${attrName}`;
  const value = ep[key];

  console.log('\n=== ENDPOINT FOUND ===');
  console.log(`id:   ${ep.id || ep.endpoint_id}`);
  console.log(`name: ${ep.device_name || ep.name || ep.endpoint_name || '(unknown)'}`);

  console.log(`\n=== CUSTOM VALUE ===`);
  console.log(`${key}:`, value);

  // Show all custom:* keys found (handy because APIs sometimes differ)
  const customKeys = Object.keys(ep).filter((k) => k.startsWith('custom:')).sort();
  console.log('\n=== ALL custom:* KEYS ON ENDPOINT ===');
  if (customKeys.length === 0) {
    console.log('(none)');
  } else {
    for (const k of customKeys) {
      console.log(`${k}: ${ep[k]}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
