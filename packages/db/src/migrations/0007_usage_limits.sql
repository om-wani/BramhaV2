-- 0007: per-user usage attribution + limits

-- Attribute each model call to the triggering user (null for system/proactive).
ALTER TABLE model_calls ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS model_calls_user_idx ON model_calls(user_id);

-- Per-user cap on total tokens (input+output). NULL = unlimited.
ALTER TABLE users ADD COLUMN IF NOT EXISTS usage_token_limit integer;
