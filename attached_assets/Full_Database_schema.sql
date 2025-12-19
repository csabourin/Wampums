-- Migration: Add Google Chat integration support
-- Description: Adds tables to store Google Chat configuration, spaces, and message history
-- for organizations using Google Chat API.
-- This allows organizations to broadcast announcements to Google Chat Spaces.

-- Create google_chat_config table
-- Stores service account credentials and configuration per organization
CREATE TABLE IF NOT EXISTS google_chat_config (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  service_account_email VARCHAR(255) NOT NULL,
  credentials_json JSONB NOT NULL,
  project_id VARCHAR(255),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  -- Ensure only one active configuration per organization
  CONSTRAINT unique_active_google_chat_config
    EXCLUDE (organization_id WITH =) WHERE (is_active = TRUE)
);

-- Create google_chat_spaces table
-- Stores configured Google Chat Spaces for each organization
CREATE TABLE IF NOT EXISTS google_chat_spaces (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  space_id VARCHAR(255) NOT NULL,
  space_name VARCHAR(255),
  space_type VARCHAR(50) DEFAULT 'SPACE',
  is_broadcast_space BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  member_count INTEGER,
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  CONSTRAINT unique_google_chat_space UNIQUE (space_id)
);

-- Create google_chat_messages table
-- Tracks messages sent through Google Chat API
CREATE TABLE IF NOT EXISTS google_chat_messages (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  space_id VARCHAR(255) NOT NULL,
  message_id VARCHAR(500),
  subject VARCHAR(500),
  message_text TEXT NOT NULL,
  sent_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  sent_at TIMESTAMP DEFAULT NOW(),
  delivery_status VARCHAR(50) DEFAULT 'sent',
  error_message TEXT
);

-- Add indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_google_chat_config_org_id
  ON google_chat_config (organization_id);

CREATE INDEX IF NOT EXISTS idx_google_chat_config_active
  ON google_chat_config (organization_id, is_active)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_google_chat_spaces_org_id
  ON google_chat_spaces (organization_id);

CREATE INDEX IF NOT EXISTS idx_google_chat_spaces_broadcast
  ON google_chat_spaces (organization_id, is_broadcast_space)
  WHERE is_broadcast_space = TRUE AND is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_google_chat_messages_org_id
  ON google_chat_messages (organization_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_google_chat_messages_space_id
  ON google_chat_messages (space_id, sent_at DESC);

-- Comments
COMMENT ON TABLE google_chat_config IS
  'Stores Google Chat API configuration including service account credentials for each organization. One active configuration per organization.';

COMMENT ON COLUMN google_chat_config.credentials_json IS
  'Service account key file in JSON format. Contains private key for authenticating with Google Chat API. Should be kept secure.';

COMMENT ON COLUMN google_chat_config.service_account_email IS
  'Email address of the service account (e.g., my-bot@project-id.iam.gserviceaccount.com).';

COMMENT ON TABLE google_chat_spaces IS
  'Stores configured Google Chat Spaces for each organization.';

COMMENT ON COLUMN google_chat_spaces.is_broadcast_space IS
  'Identifies the primary space for broadcasting announcements.';

COMMENT ON COLUMN google_chat_spaces.space_id IS
  'Google Chat Space identifier in the format spaces/AAAAxxxxxxx.';

COMMENT ON TABLE google_chat_messages IS
  'Audit log of all messages sent through Google Chat API.';

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_google_chat_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER google_chat_config_updated_at
  BEFORE UPDATE ON google_chat_config
  FOR EACH ROW
  EXECUTE FUNCTION update_google_chat_updated_at();

CREATE TRIGGER google_chat_spaces_updated_at
  BEFORE UPDATE ON google_chat_spaces
  FOR EACH ROW
  EXECUTE FUNCTION update_google_chat_updated_at();
