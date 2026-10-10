CREATE TABLE campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  summary TEXT NOT NULL,
  brand_voice TEXT NOT NULL,
  hero_path TEXT NOT NULL,
  subject_x REAL NOT NULL, subject_y REAL NOT NULL, subject_w REAL NOT NULL, subject_h REAL NOT NULL,
  idempotency_key TEXT UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE social_post_entries (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('instagram','x')),
  caption TEXT NOT NULL,
  image_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','publishing','published','failed')),
  idempotency_key TEXT NOT NULL UNIQUE,
  scheduled_at INTEGER,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  external_id TEXT,
  last_error TEXT,
  published_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (campaign_id, platform)
);
-- the worker's "what is due" query
CREATE INDEX idx_entries_due ON social_post_entries (status, scheduled_at, next_attempt_at);
CREATE INDEX idx_entries_campaign ON social_post_entries (campaign_id);
CREATE INDEX idx_entries_external ON social_post_entries (external_id);

CREATE TABLE accounts (
  platform TEXT PRIMARY KEY CHECK (platform IN ('instagram','x')),
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE webhook_events (
  event_id TEXT PRIMARY KEY,
  entry_id TEXT,
  received_at INTEGER NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO settings(key, value) VALUES ('clock_offset_ms', '0');
