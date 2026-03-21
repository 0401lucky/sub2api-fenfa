CREATE TABLE IF NOT EXISTS welfare_redeem_codes (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  reward_balance NUMERIC(20, 6) NOT NULL,
  max_claims INTEGER NOT NULL,
  claimed_count INTEGER NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at TIMESTAMPTZ NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT welfare_redeem_codes_reward_positive CHECK (reward_balance > 0),
  CONSTRAINT welfare_redeem_codes_max_claims_positive CHECK (max_claims > 0),
  CONSTRAINT welfare_redeem_codes_claimed_count_valid CHECK (
    claimed_count >= 0 AND claimed_count <= max_claims
  )
);

CREATE TABLE IF NOT EXISTS welfare_redeem_claims (
  id BIGSERIAL PRIMARY KEY,
  redeem_code_id BIGINT NOT NULL REFERENCES welfare_redeem_codes (id),
  sub2api_user_id BIGINT NOT NULL,
  linuxdo_subject TEXT NOT NULL,
  synthetic_email TEXT NOT NULL,
  redeem_code TEXT NOT NULL,
  redeem_title TEXT NOT NULL,
  reward_balance NUMERIC(20, 6) NOT NULL,
  idempotency_key TEXT NOT NULL,
  grant_status TEXT NOT NULL,
  grant_error TEXT NOT NULL DEFAULT '',
  sub2api_request_id TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT welfare_redeem_claims_unique_user_code UNIQUE (redeem_code_id, sub2api_user_id),
  CONSTRAINT welfare_redeem_claims_status_valid CHECK (grant_status IN ('pending', 'success', 'failed')),
  CONSTRAINT welfare_redeem_claims_reward_positive CHECK (reward_balance > 0)
);

CREATE INDEX IF NOT EXISTS idx_welfare_redeem_codes_created
  ON welfare_redeem_codes (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_welfare_redeem_claims_user_created
  ON welfare_redeem_claims (sub2api_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_welfare_redeem_claims_code_created
  ON welfare_redeem_claims (redeem_code_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_welfare_redeem_claims_status_created
  ON welfare_redeem_claims (grant_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_welfare_redeem_claims_subject
  ON welfare_redeem_claims (linuxdo_subject);
CREATE INDEX IF NOT EXISTS idx_welfare_redeem_claims_code
  ON welfare_redeem_claims (redeem_code);
