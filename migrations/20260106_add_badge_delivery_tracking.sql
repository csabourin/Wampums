-- Migration: Add badge delivery tracking and star type
-- Created: 2026-01-06
-- Purpose: Add delivered_at timestamp and star_type for badge tracker approval workflow

-- Add delivered_at column to track when physical badge was given to participant
ALTER TABLE badge_progress ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP;

-- Add star_type column to categorize achievements as 'proie' (individual) or 'battue' (group)
-- Default to 'proie' for backwards compatibility
ALTER TABLE badge_progress ADD COLUMN IF NOT EXISTS star_type VARCHAR(20) DEFAULT 'proie';

-- Add CHECK constraint for star_type values
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'badge_progress_star_type_check'
    ) THEN
        ALTER TABLE badge_progress ADD CONSTRAINT badge_progress_star_type_check
            CHECK (star_type IN ('proie', 'battue'));
    END IF;
END $$;

-- Create index for efficient querying of pending approvals and delivery queue
CREATE INDEX IF NOT EXISTS idx_badge_progress_status_approval ON badge_progress(status, approval_date)
    WHERE status = 'pending' OR (status = 'approved' AND delivered_at IS NULL);

-- Create index for organization-scoped delivery queries
CREATE INDEX IF NOT EXISTS idx_badge_progress_org_delivery ON badge_progress(organization_id, status, delivered_at)
    WHERE status = 'approved';

-- Add comment for documentation
COMMENT ON COLUMN badge_progress.delivered_at IS 'Timestamp when the physical badge/star was given to the participant';
COMMENT ON COLUMN badge_progress.star_type IS 'Achievement type: proie (individual accomplishment) or battue (group activity)';
