CREATE TABLE IF NOT EXISTS welfare_revoked_tokens (
  token_id TEXT PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_welfare_revoked_tokens_expires_at
  ON welfare_revoked_tokens (expires_at DESC);
