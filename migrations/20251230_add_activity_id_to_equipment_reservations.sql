-- Migration: Add activity_id to equipment_reservations table
-- Purpose: Link equipment reservations to activities (similar to carpool_offers)
-- Date: 2025-12-30

-- Add activity_id column to equipment_reservations
ALTER TABLE equipment_reservations
ADD COLUMN IF NOT EXISTS activity_id INTEGER;

-- Add foreign key constraint to activities table
ALTER TABLE equipment_reservations
ADD CONSTRAINT equipment_reservations_activity_id_fkey
FOREIGN KEY (activity_id) REFERENCES activities(id)
ON DELETE CASCADE;

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_equipment_reservations_activity_id
ON equipment_reservations(activity_id);

-- Add index for combined activity_id + organization_id queries
CREATE INDEX IF NOT EXISTS idx_equipment_reservations_activity_org
ON equipment_reservations(activity_id, organization_id)
WHERE activity_id IS NOT NULL;

-- Update date_from and date_to from activity_date for existing reservations
-- that have meeting_id but no activity_id (optional cleanup)
-- This helps establish the date range from single-date reservations
UPDATE equipment_reservations er
SET
  date_from = COALESCE(date_from, meeting_date),
  date_to = COALESCE(date_to, meeting_date)
WHERE date_from IS NULL OR date_to IS NULL;

COMMENT ON COLUMN equipment_reservations.activity_id IS
'Links reservation to an activity. When set, date_from and date_to are automatically populated from the activity date. Nullable for standalone reservations.';
