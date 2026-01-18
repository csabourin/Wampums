-- Fix user_id column type in ai_usage_log
ALTER TABLE ai_usage_log DROP COLUMN IF EXISTS user_id;
ALTER TABLE ai_usage_log ADD COLUMN user_id UUID;

-- Re-create index if needed (dropping column usually drops index on it, but checking just in case)
DROP INDEX IF EXISTS idx_ai_usage_log_user;
CREATE INDEX idx_ai_usage_log_user ON ai_usage_log(user_id);
