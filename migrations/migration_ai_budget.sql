-- Migration: Create AI budget tracking tables
-- Date: 2026-01-18
-- Description: Creates tables to track monthly AI usage and detailed logs for budget enforcement.

-- 1. Table for aggregated monthly usage (for fast budget checking)
CREATE TABLE IF NOT EXISTS ai_usage_monthly (
  month_key TEXT PRIMARY KEY, -- Format 'YYYY-MM'
  cost_usd NUMERIC(10,4) NOT NULL DEFAULT 0,
  request_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Table for detailed audit logs of every AI request
CREATE TABLE IF NOT EXISTS ai_usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  month_key TEXT NOT NULL,
  organization_id INTEGER, -- Nullable if system-level or not authenticated (e.g. public reset?) but API is auth-only
  user_id INTEGER,         -- Nullable
  provider TEXT NOT NULL,  -- 'openai' | 'mindee'
  feature TEXT NOT NULL,   -- 'meeting_plan' | 'rewrite' | 'translate' | 'risk_suggest' | 'receipt'
  model TEXT,              -- e.g. 'gpt-4o-mini'
  input_tokens INTEGER,
  output_tokens INTEGER,
  estimated_cost_usd NUMERIC(10,4) NOT NULL DEFAULT 0,
  success BOOLEAN NOT NULL DEFAULT false,
  error_code TEXT
);

-- Index for faster reporting/lookup
CREATE INDEX IF NOT EXISTS idx_ai_usage_log_month ON ai_usage_log(month_key);
CREATE INDEX IF NOT EXISTS idx_ai_usage_log_org ON ai_usage_log(organization_id);

-- 3. Initial seed for current month (optional, ensures row exists)
INSERT INTO ai_usage_monthly (month_key, cost_usd, request_count)
VALUES (TO_CHAR(CURRENT_DATE, 'YYYY-MM'), 0, 0)
ON CONFLICT (month_key) DO NOTHING;
