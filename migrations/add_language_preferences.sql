-- Migration: Add language preferences for users and organizations
-- Description: Adds language_preference column to users table and organization-level
-- default email language setting to support multi-language email communications.
-- User preferences override organization defaults.

-- Add language preference column to users table
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS language_preference VARCHAR(10);

-- Set default values based on supported languages (en, fr, uk, it)
-- Leave NULL for users who haven't set a preference (will inherit from org default)
COMMENT ON COLUMN users.language_preference IS 'User preferred language for email communications. Supported: en, fr, uk, it. NULL inherits from organization default.';

-- Create index for efficient filtering by language when sending bulk emails
CREATE INDEX IF NOT EXISTS idx_users_language_preference
  ON users (language_preference) WHERE language_preference IS NOT NULL;

-- Add organization-level default email language setting
-- Using existing organization_settings table (key-value JSONB storage)
-- Insert default language setting for all existing organizations
DO $$
DECLARE
  org_record RECORD;
BEGIN
  FOR org_record IN SELECT id FROM organizations
  LOOP
    -- Set default email language to 'fr' (French) for existing organizations
    -- This can be changed by organization admins
    INSERT INTO organization_settings (organization_id, setting_key, setting_value, created_at, updated_at)
    VALUES (
      org_record.id,
      'default_email_language',
      '"fr"'::jsonb,
      NOW(),
      NOW()
    )
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- Add helpful comment
COMMENT ON TABLE organization_settings IS 'Stores organization-level settings including default_email_language (supported: en, fr, uk, it)';
