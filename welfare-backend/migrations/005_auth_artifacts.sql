CREATE TABLE IF NOT EXISTS welfare_auth_artifacts (
  artifact_id TEXT PRIMARY KEY,
  artifact_type TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT welfare_auth_artifacts_type_valid CHECK (
    artifact_type IN ('oauth_state', 'session_handoff')
  )
);

CREATE INDEX IF NOT EXISTS idx_welfare_auth_artifacts_expires_at
  ON welfare_auth_artifacts (expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_welfare_auth_artifacts_type_expires_at
  ON welfare_auth_artifacts (artifact_type, expires_at DESC);
