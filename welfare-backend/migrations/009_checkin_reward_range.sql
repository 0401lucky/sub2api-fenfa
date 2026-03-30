ALTER TABLE welfare_settings
ADD COLUMN IF NOT EXISTS daily_reward_min_balance NUMERIC(20, 6);

ALTER TABLE welfare_settings
ADD COLUMN IF NOT EXISTS daily_reward_max_balance NUMERIC(20, 6);

UPDATE welfare_settings
SET daily_reward_min_balance = COALESCE(daily_reward_min_balance, daily_reward_balance),
    daily_reward_max_balance = COALESCE(daily_reward_max_balance, daily_reward_balance);

ALTER TABLE welfare_settings
ALTER COLUMN daily_reward_min_balance SET DEFAULT 10;

ALTER TABLE welfare_settings
ALTER COLUMN daily_reward_max_balance SET DEFAULT 10;

ALTER TABLE welfare_settings
ALTER COLUMN daily_reward_min_balance SET NOT NULL;

ALTER TABLE welfare_settings
ALTER COLUMN daily_reward_max_balance SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'welfare_settings_reward_min_positive'
  ) THEN
    ALTER TABLE welfare_settings
      ADD CONSTRAINT welfare_settings_reward_min_positive
      CHECK (daily_reward_min_balance > 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'welfare_settings_reward_max_positive'
  ) THEN
    ALTER TABLE welfare_settings
      ADD CONSTRAINT welfare_settings_reward_max_positive
      CHECK (daily_reward_max_balance > 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'welfare_settings_reward_range_valid'
  ) THEN
    ALTER TABLE welfare_settings
      ADD CONSTRAINT welfare_settings_reward_range_valid
      CHECK (daily_reward_max_balance >= daily_reward_min_balance);
  END IF;
END $$;
