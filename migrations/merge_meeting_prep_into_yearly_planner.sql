-- Migration: Merge meeting preparations into the yearly-planner calendar
-- Description:
--   year_plan_meetings becomes the single calendar source of truth for meetings.
--   - reunion_preparations rows are folded into year_plan_meetings (matched by
--     organization + date; standalone rows are created when no plan meeting exists).
--   - The free-form reunion_preparations.activities JSONB timeline is expanded into
--     structured year_plan_meeting_activities rows (new prep columns added).
--   - rappel_reunion (org-level recurring reminder) is folded into year_plan_reminders
--     (meeting_id becomes nullable; is_recurring/reminder_date added).
--   - equipment_reservations.meeting_id and permission_slips.meeting_id are remapped
--     from reunion_preparations ids to year_plan_meetings ids and their FKs repointed.
--   - guests table is created/hardened here so routes no longer run DDL at request time.
--   The legacy tables (reunion_preparations, rappel_reunion) are kept read-only as a
--   safety net; application code no longer reads or writes them. Drop them in a later
--   migration once the merge has been verified in production.
-- Idempotent: safe to re-run.

BEGIN;

-- =============================================================================
-- 1. YEAR PLAN MEETINGS: allow standalone meetings + add preparation fields
-- =============================================================================
ALTER TABLE year_plan_meetings ALTER COLUMN year_plan_id DROP NOT NULL;

ALTER TABLE year_plan_meetings
  ADD COLUMN IF NOT EXISTS youth_of_honor JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS animateur_responsable UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS duration_override INTEGER
    CHECK (duration_override IS NULL OR duration_override > 0),
  ADD COLUMN IF NOT EXISTS activity_id INTEGER REFERENCES activities(id) ON DELETE SET NULL;

COMMENT ON COLUMN year_plan_meetings.activity_id IS
  'Optional link to an outing/event in the activities table (carpools, permission slips).';

-- =============================================================================
-- 2. DEDUPE (organization_id, meeting_date) so the calendar is unambiguous
--    Overlapping year plans may have produced two meetings on the same date.
--    Keep the row belonging to the most recently created plan (highest year_plan_id,
--    NULLs last) and move child rows to the keeper.
-- =============================================================================
DO $$
DECLARE
  dupe RECORD;
BEGIN
  FOR dupe IN
    SELECT organization_id, meeting_date,
           (ARRAY_AGG(id ORDER BY year_plan_id DESC NULLS LAST, id DESC))[1] AS keeper_id,
           ARRAY_AGG(id) AS all_ids
    FROM year_plan_meetings
    GROUP BY organization_id, meeting_date
    HAVING COUNT(*) > 1
  LOOP
    UPDATE year_plan_meeting_activities
      SET meeting_id = dupe.keeper_id
      WHERE meeting_id = ANY(dupe.all_ids) AND meeting_id <> dupe.keeper_id;
    UPDATE objective_achievements
      SET meeting_id = dupe.keeper_id
      WHERE meeting_id = ANY(dupe.all_ids) AND meeting_id <> dupe.keeper_id;
    UPDATE year_plan_reminders
      SET meeting_id = dupe.keeper_id
      WHERE meeting_id = ANY(dupe.all_ids) AND meeting_id <> dupe.keeper_id;
    DELETE FROM year_plan_meetings
      WHERE id = ANY(dupe.all_ids) AND id <> dupe.keeper_id;
  END LOOP;
END $$;

-- Replace the per-plan uniqueness with a per-organization calendar uniqueness.
-- The old UNIQUE(organization_id, year_plan_id, meeting_date) constraint has an
-- auto-generated name, so find and drop it dynamically.
DO $$
DECLARE
  cname TEXT;
BEGIN
  SELECT c.conname INTO cname
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  WHERE t.relname = 'year_plan_meetings'
    AND c.contype = 'u'
    AND array_length(c.conkey, 1) = 3;
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE year_plan_meetings DROP CONSTRAINT %I', cname);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_year_plan_meetings_org_date
  ON year_plan_meetings(organization_id, meeting_date);

-- =============================================================================
-- 3. MEETING ACTIVITIES: add structured prep-timeline fields
-- =============================================================================
ALTER TABLE year_plan_meeting_activities
  ADD COLUMN IF NOT EXISTS start_time TIME,
  ADD COLUMN IF NOT EXISTS activity_type VARCHAR(100),
  ADD COLUMN IF NOT EXISTS responsable VARCHAR(255),
  ADD COLUMN IF NOT EXISTS material TEXT,
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS badge_template_id INTEGER,
  ADD COLUMN IF NOT EXISTS processed BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_ypm_activities_unprocessed_badges
  ON year_plan_meeting_activities(organization_id, badge_template_id)
  WHERE badge_template_id IS NOT NULL AND processed = FALSE;

-- =============================================================================
-- 4. BACKFILL reunion_preparations -> year_plan_meetings (+ structured activities)
-- =============================================================================
DO $$
DECLARE
  rp RECORD;
  target_id INTEGER;
  honor JSONB;
  act JSONB;
  acts JSONB;
  idx INTEGER;
  act_duration INTEGER;
  act_time TIME;
  act_badge INTEGER;
BEGIN
  FOR rp IN SELECT * FROM reunion_preparations ORDER BY organization_id, date LOOP
    -- Skip preparations already imported (idempotency)
    IF EXISTS (
      SELECT 1 FROM year_plan_meetings
      WHERE reunion_preparation_id = rp.id
    ) THEN
      CONTINUE;
    END IF;

    -- youth_of_honor is TEXT holding either a JSON array or a plain name
    BEGIN
      honor := rp.youth_of_honor::jsonb;
      IF jsonb_typeof(honor) <> 'array' THEN
        honor := jsonb_build_array(rp.youth_of_honor);
      END IF;
    EXCEPTION WHEN others THEN
      honor := CASE
        WHEN rp.youth_of_honor IS NULL OR btrim(rp.youth_of_honor) = '' THEN '[]'::jsonb
        ELSE jsonb_build_array(rp.youth_of_honor)
      END;
    END;

    SELECT id INTO target_id FROM year_plan_meetings
      WHERE organization_id = rp.organization_id AND meeting_date = rp.date;

    IF target_id IS NULL THEN
      INSERT INTO year_plan_meetings
        (organization_id, meeting_date, location, notes, youth_of_honor,
         animateur_responsable, duration_override, reunion_preparation_id, metadata)
      VALUES
        (rp.organization_id, rp.date, rp.endroit, rp.notes, honor,
         rp.animateur_responsable, rp.duration_override, rp.id,
         COALESCE(rp.metadata, '{}'::jsonb) || '{"standalone": true}'::jsonb)
      RETURNING id INTO target_id;
    ELSE
      UPDATE year_plan_meetings SET
        location = CASE WHEN COALESCE(location, '') = '' THEN rp.endroit ELSE location END,
        notes = CASE WHEN COALESCE(notes, '') = '' THEN rp.notes ELSE notes END,
        youth_of_honor = honor,
        animateur_responsable = rp.animateur_responsable,
        duration_override = rp.duration_override,
        reunion_preparation_id = rp.id,
        updated_at = NOW()
      WHERE id = target_id;
    END IF;

    -- Expand the JSONB timeline into structured rows
    acts := CASE WHEN jsonb_typeof(rp.activities) = 'array' THEN rp.activities ELSE '[]'::jsonb END;
    idx := 0;
    FOR act IN SELECT * FROM jsonb_array_elements(acts) LOOP
      -- duration is "HH:MM" in the legacy blob; tolerate plain minutes too
      act_duration := NULL;
      IF act->>'duration' ~ '^\d{1,2}:\d{2}$' THEN
        act_duration := split_part(act->>'duration', ':', 1)::int * 60
                      + split_part(act->>'duration', ':', 2)::int;
      ELSIF act->>'duration' ~ '^\d+$' THEN
        act_duration := (act->>'duration')::int;
      END IF;

      act_time := NULL;
      IF act->>'time' ~ '^\d{1,2}:\d{2}' THEN
        act_time := (act->>'time')::time;
      END IF;

      act_badge := NULL;
      IF act->>'badge_template_id' ~ '^\d+$' THEN
        act_badge := (act->>'badge_template_id')::int;
      END IF;

      INSERT INTO year_plan_meeting_activities
        (organization_id, meeting_id, name, description, start_time, duration_minutes,
         activity_type, responsable, material, is_default, badge_template_id, processed,
         sort_order, metadata)
      VALUES
        (rp.organization_id, target_id,
         COALESCE(NULLIF(act->>'activity', ''), 'Activity'),
         NULLIF(act->>'description', ''),
         act_time, act_duration,
         NULLIF(act->>'type', ''),
         NULLIF(act->>'responsable', ''),
         NULLIF(act->>'materiel', ''),
         COALESCE((act->>'isDefault')::boolean, FALSE),
         act_badge,
         COALESCE((act->>'processed')::boolean, FALSE),
         idx,
         jsonb_build_object('imported_from_reunion', rp.id, 'legacy', act));
      idx := idx + 1;
    END LOOP;
  END LOOP;
END $$;

-- =============================================================================
-- 5. REMINDERS: fold rappel_reunion into year_plan_reminders
-- =============================================================================
ALTER TABLE year_plan_reminders ALTER COLUMN meeting_id DROP NOT NULL;
ALTER TABLE year_plan_reminders
  ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reminder_date DATE;

INSERT INTO year_plan_reminders
  (organization_id, channel, scheduled_at, custom_message, is_recurring, reminder_date,
   status, metadata, created_at)
SELECT r.organization_id, 'email', r.reminder_date::timestamptz, r.reminder_text,
       COALESCE(r.is_recurring, FALSE), r.reminder_date, 'pending',
       jsonb_build_object('migrated_from_rappel_reunion', r.id),
       COALESCE(r.creation_time, NOW())
FROM rappel_reunion r
WHERE NOT EXISTS (
  SELECT 1 FROM year_plan_reminders y
  WHERE y.metadata->>'migrated_from_rappel_reunion' = r.id::text
);

CREATE INDEX IF NOT EXISTS idx_yp_reminders_org
  ON year_plan_reminders(organization_id, created_at DESC);

-- =============================================================================
-- 6. GUESTS: table hardening (was created ad hoc at request time)
-- =============================================================================
CREATE TABLE IF NOT EXISTS guests (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  attendance_date DATE NOT NULL,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE guests ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_guests_org_date ON guests(organization_id, attendance_date);

-- =============================================================================
-- 7. REMAP meeting_id foreign keys from reunion_preparations to year_plan_meetings
--    The reunion_preparations and year_plan_meetings id sequences overlap, so the
--    remap must only ever run once per table. The FK's current target table is the
--    idempotency guard: remap only while the FK still points at reunion_preparations.
-- =============================================================================
DO $$
DECLARE
  tbl TEXT;
  fk_name TEXT;
  still_legacy BOOLEAN;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['equipment_reservations', 'permission_slips'] LOOP
    fk_name := tbl || '_meeting_id_fkey';

    SELECT EXISTS (
      SELECT 1
      FROM pg_constraint c
      JOIN pg_class conrel ON conrel.oid = c.conrelid
      JOIN pg_class confrel ON confrel.oid = c.confrelid
      WHERE c.conname = fk_name
        AND conrel.relname = tbl
        AND confrel.relname = 'reunion_preparations'
    ) INTO still_legacy;

    IF still_legacy THEN
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', tbl, fk_name);
      EXECUTE format(
        'UPDATE %I t SET meeting_id = ypm.id
           FROM year_plan_meetings ypm
          WHERE t.meeting_id IS NOT NULL
            AND ypm.reunion_preparation_id = t.meeting_id', tbl);
      -- Clear any orphans that never matched a preparation
      EXECUTE format(
        'UPDATE %I t SET meeting_id = NULL
          WHERE t.meeting_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM year_plan_meetings y WHERE y.id = t.meeting_id)', tbl);
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I
           FOREIGN KEY (meeting_id) REFERENCES year_plan_meetings(id) ON DELETE SET NULL',
        tbl, fk_name);
    END IF;
  END LOOP;
END $$;

COMMIT;
