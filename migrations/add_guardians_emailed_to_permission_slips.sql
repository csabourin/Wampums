-- Add guardians_emailed column to permission_slips to track all guardians who received emails
-- This enables sending emails to ALL guardians linked to a participant, not just one

ALTER TABLE permission_slips
ADD COLUMN IF NOT EXISTS guardians_emailed JSONB DEFAULT '[]'::jsonb;

-- Add index for querying which guardians have been emailed
CREATE INDEX IF NOT EXISTS idx_permission_slips_guardians_emailed
ON permission_slips USING gin(guardians_emailed);

COMMENT ON COLUMN permission_slips.guardians_emailed IS
'Array of guardian IDs that have been sent email notifications for this permission slip';
