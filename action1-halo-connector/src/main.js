// main.js
//
// Action1 Public Repository Material
//
// Use of this file is subject to TERMS_OF_USE.md (https://github.com/Action1Corp/PSAction1/blob/main/TERMS_OF_USE.md) in this repository.
// Provided AS IS, without warranties.
// Use at your own risk.
// Review, test, and validate before production use.
// © Action1 Corporation. All rights reserved.
const { createDefaultServiceRuntime } = require("./platform/runtime");

async function main() {
  const host = process.env.CONNECTOR_HOST || "127.0.0.1";
  const port = Number(process.env.CONNECTOR_PORT || "4300");
  const runtime = createDefaultServiceRuntime({
    host,
    port,
    dataFilePath: process.env.CONNECTOR_STATE_FILE,
  });

  await runtime.start();
  process.stdout.write(`Action1-Halo connector runtime listening on http://${host}:${port}\n`);

  const shutdown = async () => {
    await runtime.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  process.stderr.write(`Connector runtime failed to start: ${error?.message || error}\n`);
  process.exit(1);
});
