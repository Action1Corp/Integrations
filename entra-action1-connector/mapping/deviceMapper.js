// mapping/deviceMapper.js (ESM)
// Pure mapping logic: no HTTP, no Action1 writes.

function normalizeName(str) {
  if (str === null || str === undefined) return '';
  return String(str).trim().toLowerCase();
}

function stripFqdn(name) {
  const s = String(name || '').trim();
  const dot = s.indexOf('.');
  return dot > 0 ? s.slice(0, dot) : s;
}

function normalizeShortName(str) {
  return normalizeName(stripFqdn(str));
}

function getAction1EndpointName(endpoint) {
  if (!endpoint || typeof endpoint !== 'object') return '';
  return endpoint.device_name || endpoint.name || '';
}

function toCustomKey(action1CustomAttribute) {
  const raw = String(action1CustomAttribute || '').trim();
  if (!raw) return '';
  return raw.toLowerCase().startsWith('custom:') ? raw : `custom:${raw}`;
}

function buildEndpointIndex(endpoints) {
  // Map<normalizedName, Endpoint[]>
  const index = new Map();

  for (const ep of endpoints || []) {
    const name = getAction1EndpointName(ep);
    const key = normalizeName(name);
    if (!key) continue;

    if (!index.has(key)) index.set(key, []);
    index.get(key).push(ep);
  }

  return index;
}

function buildEndpointShortIndex(endpoints) {
  // Map<normalizedShortName, Endpoint[]>
  const index = new Map();

  for (const ep of endpoints || []) {
    const name = getAction1EndpointName(ep);
    const key = normalizeShortName(name);
    if (!key) continue;

    if (!index.has(key)) index.set(key, []);
    index.get(key).push(ep);
  }

  return index;
}


function matchDevices(entraDevices, action1Endpoints) {
  const fullIndex = buildEndpointIndex(action1Endpoints);
  const shortIndex = buildEndpointShortIndex(action1Endpoints);

  const matched = [];
  const unmatchedEntra = [];
  const ambiguous = [];

  for (const dev of entraDevices || []) {
    const entraName = dev?.displayName || '';
    const fullKey = normalizeName(entraName);

    if (!fullKey) {
      unmatchedEntra.push(dev);
      continue;
    }

    // Phase 1: exact/full name match
    const fullCandidates = fullIndex.get(fullKey);
    if (fullCandidates && fullCandidates.length > 0) {
      if (fullCandidates.length > 1) {
        ambiguous.push({ entraDevice: dev, candidates: fullCandidates, reason: 'duplicate_full' });
      } else {
        matched.push({ entraDevice: dev, endpoint: fullCandidates[0], matchType: 'full' });
      }
      continue;
    }

    // Phase 2: shortname match (FQDN fallback)
    const shortKey = normalizeShortName(entraName);
    const shortCandidates = shortIndex.get(shortKey);

    if (!shortCandidates || shortCandidates.length === 0) {
      unmatchedEntra.push(dev);
      continue;
    }

    if (shortCandidates.length > 1) {
      ambiguous.push({ entraDevice: dev, candidates: shortCandidates, reason: 'duplicate_short' });
      continue;
    }

    matched.push({ entraDevice: dev, endpoint: shortCandidates[0], matchType: 'short' });
  }

  return { matched, unmatchedEntra, ambiguous };
}


function buildEndpointPatch(entraDevice, mappings) {
  // Action1 expects a flat object like:
  // { "custom:Entra Groups": "A, B", "comment": "...", "name": "..." }
  const patch = {};

  for (const m of mappings || []) {
    const entraProp = m?.entraProperty;
    const action1Attr = m?.action1CustomAttribute;

    if (!entraProp || !action1Attr) continue;

    const value = entraDevice?.[entraProp];

    // Skip empty values in MVP to avoid overwriting with blanks.
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' && value.trim() === '') continue;

    const key = toCustomKey(action1Attr);
    if (!key) continue;

    patch[key] = value;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

function mapDevicesToPatches(entraDevices, action1Endpoints, mappings) {
  const { matched, unmatchedEntra, ambiguous } = matchDevices(entraDevices, action1Endpoints);

  // Detect endpoint reuse collisions: multiple Entra devices resolved to the same Action1 endpoint.
  // Safety rule: skip patch planning for collided endpoints to avoid potentially incorrect writes.
  const endpointToPairs = new Map();
  for (const pair of matched) {
    const endpointIdRaw = pair?.endpoint?.id;
    const endpointName = getAction1EndpointName(pair?.endpoint);
    const endpointKey = endpointIdRaw ? `id:${endpointIdRaw}` : `name:${normalizeName(endpointName)}`;
    if (!endpointToPairs.has(endpointKey)) endpointToPairs.set(endpointKey, []);
    endpointToPairs.get(endpointKey).push(pair);
  }

  const ambiguousEndpointReuse = [];
  const endpointKeysToSkip = new Set();
  for (const [endpointKey, pairs] of endpointToPairs.entries()) {
    if ((pairs || []).length <= 1) continue;

    endpointKeysToSkip.add(endpointKey);
    const endpoint = pairs[0]?.endpoint || {};
    const endpointId = endpoint?.id ?? null;
    const endpointName = getAction1EndpointName(endpoint) || null;
    const candidates = pairs.map((p) => ({
      entraId: p?.entraDevice?.id ?? null,
      entraName: p?.entraDevice?.displayName ?? null,
      matchType: p?.matchType ?? null,
    }));

    ambiguousEndpointReuse.push({
      endpointId,
      endpointName,
      candidateCount: candidates.length,
      candidates,
    });
  }

  const patches = [];
  for (const pair of matched) {
    const endpointIdRaw = pair?.endpoint?.id;
    const endpointName = getAction1EndpointName(pair?.endpoint);
    const endpointKey = endpointIdRaw ? `id:${endpointIdRaw}` : `name:${normalizeName(endpointName)}`;
    if (endpointKeysToSkip.has(endpointKey)) continue;

    const patch = buildEndpointPatch(pair.entraDevice, mappings);
    if (!patch) continue;

    patches.push({
      endpointId: pair.endpoint?.id,
      endpointName: getAction1EndpointName(pair.endpoint),
      entraName: pair.entraDevice?.displayName,
      matchType: pair.matchType,
      patch,
    });
  }

  return { matched, patches, unmatchedEntra, ambiguous, ambiguousEndpointReuse };
}

export {
  normalizeName,
  buildEndpointIndex,
  matchDevices,
  buildEndpointPatch,
  mapDevicesToPatches,
};
