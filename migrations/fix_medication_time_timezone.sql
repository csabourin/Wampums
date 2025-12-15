BEGIN;

-- Fix timezone conversion issue by changing TIME to VARCHAR
-- PostgreSQL's TIME type can convert based on server timezone
-- We just need to store simple time strings like "08:00" without any conversion

ALTER TABLE medication_requirements
  ALTER COLUMN frequency_interval_start TYPE VARCHAR(5);

-- Add comment explaining the field format
COMMENT ON COLUMN medication_requirements.frequency_interval_start IS
  'Start time in HH:MM format (24-hour), stored in local timezone without conversion';

COMMIT;
