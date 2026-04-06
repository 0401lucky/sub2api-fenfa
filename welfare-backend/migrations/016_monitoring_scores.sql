ALTER TABLE welfare_monitoring_snapshots
  ADD COLUMN IF NOT EXISTS raw_request_count_24h BIGINT NOT NULL DEFAULT 0;

ALTER TABLE welfare_risk_events
  ADD COLUMN IF NOT EXISTS risk_score INT NOT NULL DEFAULT 0;

ALTER TABLE welfare_risk_events
  ADD COLUMN IF NOT EXISTS risk_band TEXT NOT NULL DEFAULT 'normal';

ALTER TABLE welfare_risk_events
  ADD COLUMN IF NOT EXISTS rule_hits JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE welfare_risk_events
  DROP CONSTRAINT IF EXISTS welfare_risk_events_risk_band_valid;

ALTER TABLE welfare_risk_events
  ADD CONSTRAINT welfare_risk_events_risk_band_valid
    CHECK (risk_band IN ('normal', 'observe', 'block'));
