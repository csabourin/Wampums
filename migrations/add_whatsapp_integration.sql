-- Migration: Add WhatsApp integration support
-- Description: Adds whatsapp_phone_number column to users table to support
-- WhatsApp as a communication channel alongside email and push notifications.

-- Add WhatsApp phone number column to users table
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS whatsapp_phone_number VARCHAR(20);

-- Add comment explaining the field
COMMENT ON COLUMN users.whatsapp_phone_number IS 'User WhatsApp phone number in E.164 format (e.g., +1234567890) for WhatsApp notifications. NULL if user has not opted in to WhatsApp communications.';

-- Create index for efficient filtering when sending bulk WhatsApp messages
CREATE INDEX IF NOT EXISTS idx_users_whatsapp_phone
  ON users (whatsapp_phone_number) WHERE whatsapp_phone_number IS NOT NULL;

-- Add helpful comment about supported channels
COMMENT ON TABLE announcement_logs IS 'Logs for announcement deliveries. Supported channels: email, push, whatsapp. Status can be: sent, failed.';
