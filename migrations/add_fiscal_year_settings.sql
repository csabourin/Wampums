-- Migration: Add fiscal year configuration to organization_settings
-- Allows each organization to define their fiscal year start date
-- Stored as JSONB setting with key "fiscal_year"
-- Default: September 1 (month 9, day 1) following Canadian Scout fiscal year convention

INSERT INTO organization_settings (organization_id, setting_key, setting_value, created_at, updated_at)
SELECT 
  id,
  'fiscal_year',
  '{"start_month": 9, "start_day": 1}'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM organizations
WHERE NOT EXISTS (
  SELECT 1 FROM organization_settings 
  WHERE organization_id = organizations.id 
  AND setting_key = 'fiscal_year'
)
ON CONFLICT DO NOTHING;
