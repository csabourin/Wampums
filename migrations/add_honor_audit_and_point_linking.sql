-- Add audit trail and point linking for honors
-- This enables undo/edit functionality while maintaining data integrity

-- Step 1: Add audit fields to honors table
ALTER TABLE honors
  ADD COLUMN created_at TIMESTAMP DEFAULT NOW(),
  ADD COLUMN created_by UUID REFERENCES users(id),
  ADD COLUMN updated_at TIMESTAMP,
  ADD COLUMN updated_by UUID REFERENCES users(id);

-- Step 2: Migrate existing honors - set created_at to honor date
-- (Best approximation since we don't have actual creation timestamp)
UPDATE honors
SET created_at = date::timestamp
WHERE created_at IS NULL;

-- Step 3: Make created_at NOT NULL now that data is migrated
ALTER TABLE honors
  ALTER COLUMN created_at SET NOT NULL;

-- Step 4: Add honor_id to points table to link points to honors
ALTER TABLE points
  ADD COLUMN honor_id INTEGER REFERENCES honors(id) ON DELETE CASCADE;

-- Step 5: Link existing points to honors
-- Match by participant_id and date (points.created_at date matches honor.date)
UPDATE points p
SET honor_id = h.id
FROM honors h
WHERE p.participant_id = h.participant_id
  AND DATE(p.created_at) = h.date
  AND p.honor_id IS NULL
  AND p.value > 0  -- Only positive points (honor awards)
  AND NOT EXISTS (
    -- Avoid linking if multiple honors on same date (edge case)
    SELECT 1 FROM honors h2
    WHERE h2.participant_id = h.participant_id
      AND h2.date = h.date
      AND h2.id != h.id
  );

-- Step 6: Create indexes for performance
CREATE INDEX idx_honors_created_at ON honors(created_at);
CREATE INDEX idx_honors_created_by ON honors(created_by);
CREATE INDEX idx_points_honor_id ON points(honor_id);

-- Step 7: Add index for organization + date queries (common filter)
CREATE INDEX idx_honors_org_date ON honors(organization_id, date DESC);

-- Step 8: Add comment for documentation
COMMENT ON COLUMN honors.created_at IS 'Timestamp when honor was awarded (for undo time-window)';
COMMENT ON COLUMN honors.created_by IS 'User ID who awarded the honor (audit trail)';
COMMENT ON COLUMN honors.updated_at IS 'Timestamp of last edit';
COMMENT ON COLUMN honors.updated_by IS 'User ID who last edited the honor';
COMMENT ON COLUMN points.honor_id IS 'Links point award to honor (CASCADE delete on honor removal)';
