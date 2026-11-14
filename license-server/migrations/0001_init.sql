-- V1 initial schema. Never store plaintext activation codes or raw device IDs.
CREATE TABLE IF NOT EXISTS codes (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  max_devices INTEGER NOT NULL CHECK(max_devices BETWEEN 1 AND 10),
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE TABLE IF NOT EXISTS bindings (
  id TEXT PRIMARY KEY,
  code_id TEXT NOT NULL REFERENCES codes(id),
  device_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  revoked_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_binding ON bindings(code_id,device_hash) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_bindings_code ON bindings(code_id,revoked_at);
CREATE TABLE IF NOT EXISTS attempts (
  ip_hash TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);
