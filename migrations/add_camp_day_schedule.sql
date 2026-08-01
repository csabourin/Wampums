-- Migration: Give multi-day blocks a per-day schedule
-- Description:
--   A camp is one year_plan_meetings row spanning several days (the span lives
--   on the linked activities row). Its programme is a real per-day schedule:
--   each day has a title and a timed list of items with a responsible person and
--   logistics notes.
--
--   year_plan_meeting_activities already carries start_time, duration_minutes,
--   name, description, responsable, material and sort_order, which is exactly
--   the shape of one schedule line. The only thing it cannot express is WHICH
--   DAY a line belongs to: on a single meeting row, 07:00 on day 2 and 07:00 on
--   day 3 are indistinguishable.
--
--   day_offset adds that dimension. 0 = the meeting's own date, which is what
--   every existing row and every regular weekly meeting is, so nothing changes
--   for them. year_plan_meeting_days holds the per-day heading.
-- Idempotent: safe to re-run.

BEGIN;

-- =============================================================================
-- 1. DAY DIMENSION ON THE TIMELINE
-- =============================================================================
ALTER TABLE year_plan_meeting_activities
  ADD COLUMN IF NOT EXISTS day_offset INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'year_plan_meeting_activities'
      AND c.conname = 'ypm_activities_day_offset_check'
  ) THEN
    ALTER TABLE year_plan_meeting_activities
      ADD CONSTRAINT ypm_activities_day_offset_check
      CHECK (day_offset >= 0 AND day_offset < 60);
  END IF;
END $$;

COMMENT ON COLUMN year_plan_meeting_activities.day_offset IS
  'Days after the meeting date this schedule line belongs to. 0 for a regular '
  'meeting night and for the first day of a camp.';

-- The prep timeline and the camp schedule are both read in day then order.
CREATE INDEX IF NOT EXISTS idx_ypm_activities_day
  ON year_plan_meeting_activities(meeting_id, day_offset, sort_order);

-- =============================================================================
-- 2. PER-DAY HEADINGS
--    A camp day carries a title ("L'Appel des cordes brisees") and optional
--    notes. Kept in its own table rather than in metadata so it can be listed,
--    ordered and edited without rewriting the meeting row.
-- =============================================================================
CREATE TABLE IF NOT EXISTS year_plan_meeting_days (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL,
  meeting_id INTEGER NOT NULL REFERENCES year_plan_meetings(id) ON DELETE CASCADE,
  day_offset INTEGER NOT NULL DEFAULT 0 CHECK (day_offset >= 0 AND day_offset < 60),
  title VARCHAR(255),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (meeting_id, day_offset)
);

CREATE INDEX IF NOT EXISTS idx_ypm_days_org
  ON year_plan_meeting_days(organization_id, meeting_id);

COMMENT ON TABLE year_plan_meeting_days IS
  'Per-day heading for a multi-day block (camp). One row per day of the span; '
  'the timed lines themselves live in year_plan_meeting_activities.day_offset.';

COMMIT;
