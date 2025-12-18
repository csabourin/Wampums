-- Migration: Add WhatsApp Baileys integration support
-- Description: Adds table to store WhatsApp connection status and session data
-- for organizations using Baileys (unofficial WhatsApp Web API).
-- This allows Scout Leaders to connect their personal WhatsApp accounts via QR code.

-- Create whatsapp_baileys_connections table
CREATE TABLE IF NOT EXISTS whatsapp_baileys_connections (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  is_connected BOOLEAN DEFAULT FALSE,
  connected_phone_number VARCHAR(20), -- E.164 format (e.g., +1234567890)
  session_data TEXT, -- Encrypted Baileys session credentials (base64 encoded)
  last_connected_at TIMESTAMP,
  last_disconnected_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  -- Ensure only one connection per organization
  CONSTRAINT unique_org_whatsapp_connection UNIQUE (organization_id)
);

-- Add index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_whatsapp_baileys_org_id
  ON whatsapp_baileys_connections (organization_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_baileys_connected
  ON whatsapp_baileys_connections (organization_id, is_connected)
  WHERE is_connected = TRUE;

-- Add comments
COMMENT ON TABLE whatsapp_baileys_connections IS
  'Stores WhatsApp connection status and session data for organizations using Baileys (unofficial WhatsApp Web API). One connection per organization.';

COMMENT ON COLUMN whatsapp_baileys_connections.session_data IS
  'Encrypted Baileys session credentials stored as base64 encoded JSON. Contains authentication tokens and keys needed to maintain the WhatsApp connection.';

COMMENT ON COLUMN whatsapp_baileys_connections.connected_phone_number IS
  'The phone number of the WhatsApp account that was connected via QR code scan, in E.164 format.';
