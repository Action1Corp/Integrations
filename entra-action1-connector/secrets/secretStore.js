// secrets/secretStore.js
import keytar from 'keytar';

const SERVICE_NAME = 'entra-action1-connector';

/**
 * Store secret in OS keychain (Windows Credential Manager / macOS Keychain / Linux Secret Service)
 *
 * ref: unique identifier (e.g., "entra:tenant-a", "action1:main")
 * value: secret string
 */
export async function setSecret(ref, value) {
  if (!ref || typeof ref !== 'string') {
    throw new Error('Secret error: "ref" must be a non-empty string');
  }
  if (value === undefined || value === null || typeof value !== 'string' || value.length === 0) {
    throw new Error('Secret error: "value" must be a non-empty string');
  }

  await keytar.setPassword(SERVICE_NAME, ref, value);
}

/**
 * Get secret from OS keychain
 */
export async function getSecret(ref) {
  if (!ref || typeof ref !== 'string') {
    throw new Error('Secret error: "ref" must be a non-empty string');
  }

  const v = await keytar.getPassword(SERVICE_NAME, ref);
  if (!v) {
    throw new Error(`Secret not found for ref: ${ref}`);
  }
  return v;
}

/**
 * Check if a secret exists (without returning it)
 */
export async function hasSecret(ref) {
  if (!ref || typeof ref !== 'string') {
    throw new Error('Secret error: "ref" must be a non-empty string');
  }

  const v = await keytar.getPassword(SERVICE_NAME, ref);
  return Boolean(v);
}

/**
 * Delete secret from OS keychain (optional utility)
 */
export async function deleteSecret(ref) {
  if (!ref || typeof ref !== 'string') {
    throw new Error('Secret error: "ref" must be a non-empty string');
  }

  return await keytar.deletePassword(SERVICE_NAME, ref);
}

/**
 * List refs stored for this app (returns only identifiers, not values)
 */
export async function listSecretRefs() {
  const creds = await keytar.findCredentials(SERVICE_NAME);
  // creds = [{ account: ref, password: '...' }]
  return creds.map((c) => c.account).sort();
}

/**
 * Expose service name for debugging/docs if needed
 */
export function getServiceName() {
  return SERVICE_NAME;
}
