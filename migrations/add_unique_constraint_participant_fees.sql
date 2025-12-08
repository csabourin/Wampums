-- Migration: Add unique constraint to participant_fees
-- Prevents duplicate fees for same participant/fee definition/organization
-- Date: 2025-12-08

-- Add unique constraint to prevent duplicate participant fees for same period
ALTER TABLE participant_fees
ADD CONSTRAINT unique_participant_fee_period
UNIQUE (participant_id, fee_definition_id, organization_id);

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_participant_fees_lookup
ON participant_fees (participant_id, organization_id, fee_definition_id);

-- Add index for status lookups
CREATE INDEX IF NOT EXISTS idx_participant_fees_status
ON participant_fees (organization_id, status);
