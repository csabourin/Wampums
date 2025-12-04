-- Migration: Change badge_progress structure so each star is one entry
-- Date: 2025-12-04
-- Description: Changes etoiles from quantity to star number, adds unique constraint

-- Step 1: Add unique constraint to prevent duplicate star numbers
-- This ensures each participant can only have one entry per badge per star number
ALTER TABLE badge_progress
ADD CONSTRAINT unique_badge_progress UNIQUE (participant_id, territoire_chasse, etoiles);

-- Step 2: Add comment to clarify the new structure
COMMENT ON COLUMN badge_progress.etoiles IS 'Star number/index (1, 2, 3, etc.) not quantity. Each star is a separate row.';

-- Step 3: Create index for faster lookups when finding the next star number
CREATE INDEX IF NOT EXISTS idx_badge_progress_lookup
ON badge_progress(participant_id, territoire_chasse, etoiles);

-- Note: Existing data may need manual cleanup if you have entries with etoiles > 1
-- Run this query to see which entries need to be split:
-- SELECT * FROM badge_progress WHERE etoiles > 1;
