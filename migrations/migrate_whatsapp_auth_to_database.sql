-- Migration: Store WhatsApp authentication data in database
-- Description: Adds structured JSONB columns to store Baileys auth credentials and keys
-- in the database instead of the file system. This improves scalability and is better
-- suited for cloud deployments with ephemeral file systems.

-- Add JSONB columns for auth credentials and keys
ALTER TABLE whatsapp_baileys_connections
ADD COLUMN IF NOT EXISTS auth_creds JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS auth_keys JSONB DEFAULT '{}';

-- Create GIN indexes for efficient JSONB queries
CREATE INDEX IF NOT EXISTS idx_whatsapp_auth_creds_gin
  ON whatsapp_baileys_connections USING GIN (auth_creds);

CREATE INDEX IF NOT EXISTS idx_whatsapp_auth_keys_gin
  ON whatsapp_baileys_connections USING GIN (auth_keys);

-- Add comments
COMMENT ON COLUMN whatsapp_baileys_connections.auth_creds IS
  'Baileys authentication credentials stored as JSONB. Contains creds.json data including registration ID, identity keys, etc.';

COMMENT ON COLUMN whatsapp_baileys_connections.auth_keys IS
  'Baileys authentication keys stored as JSONB. Contains pre-keys, session keys, sender keys, and app state sync keys.';

-- Note: The old session_data TEXT column is kept for backward compatibility
-- but will no longer be used. It can be dropped in a future migration after
-- confirming all data has been migrated.
