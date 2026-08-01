-- Migration: yearly den assignments
--
-- A den (tanière, historically sixaine) does not carry over from one scout year
-- to the next: assignments and the sizainier/second roles are made afresh every
-- September. Until now `participant_groups` held a single row per participant
-- per organization, so last year's assignment silently became this year's, and
-- there was no way to answer "which den was this child in during 2024-2025".
--
-- Same shape as the enrollment migration that preceded it:
--   * participant_groups becomes participant_group_assignments, scoped per year;
--   * a view of the old name, filtered on the active year, keeps the ~68
--     existing read sites working unchanged;
--   * the 10 write sites (all in routes/participants.js) target the new table.
--
-- The dens themselves (`groups`) are NOT year-scoped. A den keeps its name and
-- its identity across years; it is who belongs to it that starts over.
--
-- Safe to run more than once.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Rename and extend
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'participant_groups'
       AND table_type = 'BASE TABLE'
  ) THEN
    ALTER TABLE participant_groups RENAME TO participant_group_assignments;
  END IF;
END;
$$;

ALTER TABLE participant_group_assignments
  ADD COLUMN IF NOT EXISTS scout_year_id integer REFERENCES scout_years(id);

-- ---------------------------------------------------------------------------
-- 2. Back-fill
--
-- Existing assignments describe the season in progress, so they belong to the
-- active year. An organization with assignments but no active year is a
-- contradiction the migration refuses to paper over: it raises rather than
-- dropping rows or attaching them to an arbitrary year.
-- ---------------------------------------------------------------------------

UPDATE participant_group_assignments pga
   SET scout_year_id = sy.id
  FROM scout_years sy
 WHERE sy.organization_id = pga.organization_id
   AND sy.status = 'active'
   AND pga.scout_year_id IS NULL;

DO $$
DECLARE
  v_orphans integer;
BEGIN
  SELECT COUNT(*) INTO v_orphans
    FROM participant_group_assignments
   WHERE scout_year_id IS NULL;

  IF v_orphans > 0 THEN
    RAISE EXCEPTION
      '% den assignment(s) could not be attached to a scout year; aborting rather than losing them',
      v_orphans;
  END IF;
END;
$$;

ALTER TABLE participant_group_assignments
  ALTER COLUMN scout_year_id SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Primary key on three columns
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'participant_groups_pkey'
  ) THEN
    ALTER TABLE participant_group_assignments DROP CONSTRAINT participant_groups_pkey;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'participant_group_assignments_pkey'
  ) THEN
    ALTER TABLE participant_group_assignments
      ADD CONSTRAINT participant_group_assignments_pkey
      PRIMARY KEY (participant_id, organization_id, scout_year_id);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS participant_group_assignments_year_idx
  ON participant_group_assignments (organization_id, scout_year_id, group_id);

COMMENT ON TABLE participant_group_assignments IS
  'Which den a participant belonged to in a given scout year, with their den role. One row per participant per year; assignments are not carried over by a year transition.';

-- ---------------------------------------------------------------------------
-- 4. Compatibility view
--
-- Every existing read site keeps working and now means "this year's den".
-- Writes must target participant_group_assignments directly; the INSTEAD OF
-- triggers below only soften the deploy window.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW participant_groups AS
  SELECT pga.participant_id,
         pga.group_id,
         pga.organization_id,
         pga.first_leader,
         pga.second_leader,
         pga.roles
    FROM participant_group_assignments pga
    JOIN scout_years sy ON sy.id = pga.scout_year_id
   WHERE sy.status = 'active';

COMMENT ON VIEW participant_groups IS
  'Compatibility view over participant_group_assignments, restricted to the active scout year. New code should write to participant_group_assignments directly.';

CREATE OR REPLACE FUNCTION participant_groups_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_scout_year_id integer;
BEGIN
  SELECT sy.id INTO v_scout_year_id
    FROM scout_years sy
   WHERE sy.organization_id = NEW.organization_id AND sy.status = 'active'
   LIMIT 1;

  IF v_scout_year_id IS NULL THEN
    RAISE EXCEPTION 'No active scout year for organization %', NEW.organization_id;
  END IF;

  INSERT INTO participant_group_assignments
          (participant_id, group_id, organization_id, scout_year_id,
           first_leader, second_leader, roles)
   VALUES (NEW.participant_id, NEW.group_id, NEW.organization_id, v_scout_year_id,
           COALESCE(NEW.first_leader, FALSE), COALESCE(NEW.second_leader, FALSE), NEW.roles)
   ON CONFLICT (participant_id, organization_id, scout_year_id)
   DO UPDATE SET group_id = EXCLUDED.group_id,
                 first_leader = EXCLUDED.first_leader,
                 second_leader = EXCLUDED.second_leader,
                 roles = EXCLUDED.roles;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION participant_groups_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE participant_group_assignments pga
     SET group_id = NEW.group_id,
         first_leader = COALESCE(NEW.first_leader, FALSE),
         second_leader = COALESCE(NEW.second_leader, FALSE),
         roles = NEW.roles
    FROM scout_years sy
   WHERE sy.id = pga.scout_year_id
     AND sy.status = 'active'
     AND pga.participant_id = OLD.participant_id
     AND pga.organization_id = OLD.organization_id;

  RETURN NEW;
END;
$$;

-- Deleting an assignment is genuinely a deletion: leaving a den is not an event
-- worth keeping, unlike leaving the unit. The year's history is the set of rows
-- that exist when the year closes.
CREATE OR REPLACE FUNCTION participant_groups_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM participant_group_assignments pga
   USING scout_years sy
   WHERE sy.id = pga.scout_year_id
     AND sy.status = 'active'
     AND pga.participant_id = OLD.participant_id
     AND pga.organization_id = OLD.organization_id;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS participant_groups_insert_trigger ON participant_groups;
CREATE TRIGGER participant_groups_insert_trigger
  INSTEAD OF INSERT ON participant_groups
  FOR EACH ROW EXECUTE FUNCTION participant_groups_insert();

DROP TRIGGER IF EXISTS participant_groups_update_trigger ON participant_groups;
CREATE TRIGGER participant_groups_update_trigger
  INSTEAD OF UPDATE ON participant_groups
  FOR EACH ROW EXECUTE FUNCTION participant_groups_update();

DROP TRIGGER IF EXISTS participant_groups_delete_trigger ON participant_groups;
CREATE TRIGGER participant_groups_delete_trigger
  INSTEAD OF DELETE ON participant_groups
  FOR EACH ROW EXECUTE FUNCTION participant_groups_delete();

COMMIT;
