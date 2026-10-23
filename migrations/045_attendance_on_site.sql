-- Leaving an activity does not erase the day's attendance or its earned points.
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS is_on_site BOOLEAN;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS departed_at TIMESTAMPTZ;
