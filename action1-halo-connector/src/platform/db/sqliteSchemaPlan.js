// sqliteSchemaPlan.js
//
// Action1 Public Repository Material
//
// Use of this file is subject to TERMS_OF_USE.md (https://github.com/Action1Corp/PSAction1/blob/main/TERMS_OF_USE.md) in this repository.
// Provided AS IS, without warranties.
// Use at your own risk.
// Review, test, and validate before production use.
// © Action1 Corporation. All rights reserved.
const SQLITE_SCHEMA_VERSION = 1;

const SQLITE_SCHEMA_TABLES = Object.freeze({
  connectorConfig: "connector_config",
  orgClientMappings: "org_client_mappings",
  ticketCorrelationMappings: "ticket_correlation_mappings",
  runSummaries: "run_summaries",
  syncState: "sync_state",
});

const SQLITE_CREATE_TABLE_STATEMENTS = Object.freeze([
  `
CREATE TABLE IF NOT EXISTS connector_config (
  config_key TEXT PRIMARY KEY,
  config_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`,
  `
CREATE TABLE IF NOT EXISTS org_client_mappings (
  mapping_id TEXT PRIMARY KEY,
  action1_org_id TEXT NOT NULL,
  action1_org_name TEXT NOT NULL,
  halo_client_id TEXT NOT NULL,
  halo_client_name TEXT NOT NULL,
  allow_halo_client_to_create_action1_org INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(action1_org_id),
  UNIQUE(halo_client_id)
);`,
  `
CREATE TABLE IF NOT EXISTS ticket_correlation_mappings (
  correlation_id TEXT PRIMARY KEY,
  org_link_id TEXT NOT NULL,
  endpoint_id TEXT NOT NULL,
  signal_type TEXT NOT NULL,
  halo_ticket_id TEXT NOT NULL,
  payload_hash TEXT,
  ticket_status_id TEXT,
  ticket_status_name TEXT,
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(org_link_id, endpoint_id, signal_type)
);`,
  `
CREATE TABLE IF NOT EXISTS run_summaries (
  run_id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  outcome TEXT NOT NULL,
  created_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  closed_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  summary_json TEXT NOT NULL
);`,
  `
CREATE TABLE IF NOT EXISTS sync_state (
  state_key TEXT PRIMARY KEY,
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`,
  `
CREATE INDEX IF NOT EXISTS idx_ticket_correlation_lookup
  ON ticket_correlation_mappings(org_link_id, endpoint_id, signal_type);`,
  `
CREATE INDEX IF NOT EXISTS idx_run_summaries_started_at
  ON run_summaries(started_at);`,
]);

const SQLITE_SCHEMA_NOTES = Object.freeze({
  connectorConfig:
    "Stores normalized connector config and schema versioned payload. Secrets remain outside this table.",
  orgClientMappings:
    "Durable Action1 organization to Halo client routing map. Provisioning flag is explicit per mapping.",
  ticketCorrelationMappings:
    "Primary v1 correlation source of truth. No Halo custom fields required.",
  runSummaries:
    "Per-run counters and support/debug summary blobs.",
  syncState:
    "Optional lightweight cursor/watermark state for resumable sync behavior.",
});

module.exports = {
  SQLITE_SCHEMA_VERSION,
  SQLITE_SCHEMA_TABLES,
  SQLITE_CREATE_TABLE_STATEMENTS,
  SQLITE_SCHEMA_NOTES,
};
