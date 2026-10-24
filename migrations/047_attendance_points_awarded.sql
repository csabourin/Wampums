-- The attendance points each row has granted, so a status change or a deleted
-- day takes back exactly what was given (a carried-forward day granted none).
-- NULL marks rows recorded before this column: they are taken to have granted
-- what the unit's rules give their status, as the adjustments always assumed.
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS points_awarded INTEGER;
