-- Migration: Classify year plan meetings by kind
-- Description:
--   The yearly planner needs to distinguish a regular meeting night from a
--   weekend outing or a multi-day camp, because each renders differently in the
--   year-at-a-glance view and because non-regular blocks auto-create the linked
--   activities row that unlocks carpools, permission slips and the iCal feed.
--
--   A real column rather than a metadata JSONB key: metadata is a blind merge
--   target in the plan-generation upsert
--   (metadata = year_plan_meetings.metadata || EXCLUDED.metadata), so
--   authoritative state must not live there. meeting_kind also drives the render
--   of every chip in the year view, so it belongs in the plain list query.
--
--   Multi-day blocks are ONE year_plan_meetings row (on the start date) plus ONE
--   multi-day activities row. N rows would collide with the
--   uniq_year_plan_meetings_org_date index and would fragment the single
--   preparation sheet, the equipment reservation and the achievements that each
--   point at one meeting id.
-- Idempotent: safe to re-run.

BEGIN;

-- =============================================================================
-- 1. COLUMN
-- =============================================================================
ALTER TABLE year_plan_meetings
  ADD COLUMN IF NOT EXISTS meeting_kind VARCHAR(20) NOT NULL DEFAULT 'regular';

COMMENT ON COLUMN year_plan_meetings.meeting_kind IS
  'regular = weekly meeting night; weekend = single out-of-schedule outing; '
  'camp = multi-day block (span lives on the linked activities row); '
  'special = one-off date that is neither.';

-- The CHECK is added separately so re-running cannot fail on a duplicate name.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'year_plan_meetings'
      AND c.conname = 'year_plan_meetings_kind_check'
  ) THEN
    ALTER TABLE year_plan_meetings
      ADD CONSTRAINT year_plan_meetings_kind_check
      CHECK (meeting_kind IN ('regular', 'weekend', 'camp', 'special'));
  END IF;
END $$;

-- =============================================================================
-- 2. BACKFILL
--    Meetings already linked to a multi-day activities row are camps; meetings
--    linked to a same-day activity are weekend outings. Rows previously flagged
--    through metadata keep their meaning.
-- =============================================================================
UPDATE year_plan_meetings m
   SET meeting_kind = 'camp'
  FROM activities a
 WHERE m.activity_id = a.id
   AND m.meeting_kind = 'regular'
   AND COALESCE(a.activity_end_date, a.activity_start_date, a.activity_date)
       > COALESCE(a.activity_start_date, a.activity_date);

UPDATE year_plan_meetings m
   SET meeting_kind = 'weekend'
  FROM activities a
 WHERE m.activity_id = a.id
   AND m.meeting_kind = 'regular'
   AND EXTRACT(ISODOW FROM m.meeting_date) IN (6, 7);

UPDATE year_plan_meetings
   SET meeting_kind = 'special'
 WHERE meeting_kind = 'regular'
   AND metadata->>'special_date' = 'true';

-- =============================================================================
-- 3. INDEXES
--    Supports the reverse lookup activities -> planned meeting used to show
--    "planned on <date>" on an outing and to enrich the plan detail payload.
--    No index is added for year_plan_meeting_activities.series_id:
--    idx_ypm_activities_series already exists (create_yearly_planner_tables.sql).
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_ypm_activity_id
  ON year_plan_meetings(activity_id)
  WHERE activity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ypm_org_kind
  ON year_plan_meetings(organization_id, meeting_kind)
  WHERE meeting_kind <> 'regular';

COMMIT;
