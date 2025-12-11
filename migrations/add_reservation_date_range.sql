-- Migration: Add date range support to equipment_reservations
-- Description: Replace single meeting_date with date_from and date_to for multi-day activities

-- Add new date range columns
ALTER TABLE equipment_reservations 
ADD COLUMN IF NOT EXISTS date_from DATE,
ADD COLUMN IF NOT EXISTS date_to DATE;

-- Migrate existing data: set date_from and date_to to meeting_date for existing records
UPDATE equipment_reservations 
SET date_from = meeting_date, 
    date_to = meeting_date 
WHERE date_from IS NULL;

-- Update indexes to use date_from instead of meeting_date
DROP INDEX IF EXISTS idx_equipment_reservations_org_date;

CREATE INDEX IF NOT EXISTS idx_equipment_reservations_org_date_range
  ON equipment_reservations(organization_id, date_from, date_to);

-- Note: We're keeping meeting_date column for backward compatibility
-- It will still be used as a reference date for single-day activities
