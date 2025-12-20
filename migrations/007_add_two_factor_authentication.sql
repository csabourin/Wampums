-- Migration: Add Two-Factor Authentication by Email
-- Description: Creates tables for 2FA codes and trusted devices
-- This migration is idempotent and can be run multiple times safely

-- Table for temporary 2FA verification codes
CREATE TABLE IF NOT EXISTS two_factor_codes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    code varchar(6) NOT NULL,
    code_hash varchar(255) NOT NULL,  -- Hashed version of the code
    expires_at timestamp with time zone NOT NULL,
    attempts integer DEFAULT 0,
    verified boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    ip_address varchar(45),  -- Support IPv4 and IPv6
    user_agent text
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_two_factor_codes_user_org
    ON two_factor_codes(user_id, organization_id, verified);
CREATE INDEX IF NOT EXISTS idx_two_factor_codes_expires
    ON two_factor_codes(expires_at);

-- Table for trusted devices (long-lived sessions)
CREATE TABLE IF NOT EXISTS trusted_devices (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    device_token varchar(255) NOT NULL UNIQUE,  -- Unique token for this device
    device_name text,  -- e.g., "Chrome on Windows"
    device_fingerprint varchar(255),  -- Hash of user-agent
    last_used_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    expires_at timestamp with time zone NOT NULL,  -- Trust expires after 90 days
    is_active boolean DEFAULT true
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_trusted_devices_token
    ON trusted_devices(device_token, is_active);
CREATE INDEX IF NOT EXISTS idx_trusted_devices_user_org
    ON trusted_devices(user_id, organization_id, is_active);
CREATE INDEX IF NOT EXISTS idx_trusted_devices_expires
    ON trusted_devices(expires_at);

-- Add comments for documentation
COMMENT ON TABLE two_factor_codes IS
    'Stores temporary 2FA verification codes sent via email. Codes expire after 10 minutes.';
COMMENT ON TABLE trusted_devices IS
    'Stores trusted device tokens for users who have completed 2FA. Devices remain trusted for 90 days.';

COMMENT ON COLUMN two_factor_codes.code_hash IS
    'SHA256 hash of the verification code for secure storage';
COMMENT ON COLUMN two_factor_codes.attempts IS
    'Number of verification attempts (max 5 allowed)';
COMMENT ON COLUMN trusted_devices.device_token IS
    'Unique token stored in client localStorage to identify trusted devices';
COMMENT ON COLUMN trusted_devices.device_fingerprint IS
    'Hash of user-agent string for additional device verification';
COMMENT ON COLUMN trusted_devices.expires_at IS
    'Device trust expires after 90 days of inactivity';
