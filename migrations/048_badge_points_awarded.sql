-- The earn points a badge level has granted. A level grants them once: approving
-- it again, or after a rejection, awards nothing more.
ALTER TABLE badge_progress ADD COLUMN IF NOT EXISTS points_awarded INTEGER;
