CREATE TABLE IF NOT EXISTS welfare_user_cleanup_logs (
  id BIGSERIAL PRIMARY KEY,
  operator_sub2api_user_id BIGINT NOT NULL,
  operator_email TEXT NOT NULL,
  operator_username TEXT NOT NULL,
  target_sub2api_user_id BIGINT NOT NULL,
  target_email TEXT NOT NULL,
  target_username TEXT NOT NULL,
  target_balance NUMERIC(20, 6) NULL,
  result_status TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT welfare_user_cleanup_logs_status_valid CHECK (result_status IN ('success', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_welfare_user_cleanup_logs_operator
  ON welfare_user_cleanup_logs (operator_sub2api_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_welfare_user_cleanup_logs_target
  ON welfare_user_cleanup_logs (target_sub2api_user_id, created_at DESC);
