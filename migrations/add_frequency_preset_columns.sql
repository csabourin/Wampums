BEGIN;

-- Add frequency preset columns to medication_requirements table
-- These columns store structured frequency data for automated scheduling

ALTER TABLE medication_requirements
  ADD COLUMN IF NOT EXISTS frequency_preset_type VARCHAR(30),
  ADD COLUMN IF NOT EXISTS frequency_times JSONB,
  ADD COLUMN IF NOT EXISTS frequency_slots JSONB,
  ADD COLUMN IF NOT EXISTS frequency_interval_hours INTEGER,
  ADD COLUMN IF NOT EXISTS frequency_interval_start TIME;

-- Add index for faster queries on frequency type
CREATE INDEX IF NOT EXISTS idx_medication_requirements_frequency_type
  ON medication_requirements(frequency_preset_type);

-- Add comment to explain frequency_preset_type values
COMMENT ON COLUMN medication_requirements.frequency_preset_type IS
  'Type of frequency preset: interval, time_of_day, meal, or prn';

COMMENT ON COLUMN medication_requirements.frequency_times IS
  'Array of time strings (HH:MM) for time_of_day preset';

COMMENT ON COLUMN medication_requirements.frequency_slots IS
  'JSON object mapping slot names to times for meal preset (e.g., {"breakfast": "08:00"})';

COMMENT ON COLUMN medication_requirements.frequency_interval_hours IS
  'Number of hours between doses for interval preset';

COMMENT ON COLUMN medication_requirements.frequency_interval_start IS
  'Starting time for interval preset';

COMMIT;
