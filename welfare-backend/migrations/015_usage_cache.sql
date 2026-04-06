CREATE TABLE IF NOT EXISTS welfare_usage_cache (
  usage_id BIGINT PRIMARY KEY,
  sub2api_user_id BIGINT NULL,
  ip_address TEXT NULL,
  created_at TIMESTAMPTZ NULL,
  sub2api_email TEXT NOT NULL DEFAULT '',
  sub2api_username TEXT NOT NULL DEFAULT '',
  sub2api_role TEXT NOT NULL DEFAULT 'user',
  sub2api_status TEXT NOT NULL DEFAULT 'active',
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_welfare_usage_cache_created_at
  ON welfare_usage_cache (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_welfare_usage_cache_user_created_at
  ON welfare_usage_cache (sub2api_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_welfare_usage_cache_ip_created_at
  ON welfare_usage_cache (ip_address, created_at DESC);

CREATE TABLE IF NOT EXISTS welfare_usage_sync_state (
  id BIGINT PRIMARY KEY DEFAULT 1,
  last_started_at TIMESTAMPTZ NULL,
  last_finished_at TIMESTAMPTZ NULL,
  last_status TEXT NOT NULL DEFAULT 'idle',
  last_error TEXT NOT NULL DEFAULT '',
  fetched_page_count INT NOT NULL DEFAULT 0,
  upserted_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT welfare_usage_sync_state_singleton CHECK (id = 1),
  CONSTRAINT welfare_usage_sync_state_status_valid
    CHECK (last_status IN ('idle', 'running', 'success', 'failed'))
);

INSERT INTO welfare_usage_sync_state (id, last_status)
VALUES (1, 'idle')
ON CONFLICT (id) DO NOTHING;
