-- Migration: Scout year management (phases 1-3)
--
-- Introduces the scout year as a first-class dimension so that a year transition
-- never deletes data:
--   * participant_organizations becomes participant_enrollments, scoped per year,
--     and is replaced by a read-only view of the same name filtered on the active
--     year so the ~85 existing read sites keep working unchanged.
--   * points gain a scout_year_id, so "resetting the points" is a side effect of
--     opening a new year rather than a DELETE.
--   * user_organizations gain a status, so a parent with no enrolled child can be
--     deactivated without losing the account, its guardian links or its history.
--
-- Safe to run more than once.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Scout years
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS scout_years (
  id              serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  label           text NOT NULL,
  start_date      date NOT NULL,
  end_date        date NOT NULL,
  status          text NOT NULL DEFAULT 'planning'
                    CHECK (status IN ('planning', 'active', 'closed')),
  closed_at       timestamptz,
  closed_by       uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scout_years_label_unique UNIQUE (organization_id, label),
  CONSTRAINT scout_years_dates_ordered CHECK (end_date > start_date)
);

-- At most one active year per organization.
CREATE UNIQUE INDEX IF NOT EXISTS scout_years_one_active_per_org
  ON scout_years (organization_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS scout_years_org_range_idx
  ON scout_years (organization_id, start_date, end_date);

-- Years of a same organization must never overlap: the "which year does this
-- date belong to" lookup has to be unambiguous. Requires btree_gist; skipped
-- with a warning if the extension cannot be installed.
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS btree_gist;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'btree_gist unavailable (%), skipping the scout_years overlap constraint', SQLERRM;
    RETURN;
  END;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scout_years_no_overlap'
  ) THEN
    ALTER TABLE scout_years
      ADD CONSTRAINT scout_years_no_overlap
      EXCLUDE USING gist (
        organization_id WITH =,
        daterange(start_date, end_date, '[]') WITH &&
      );
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Year boundary helper
--
-- Derives the scout year containing a given date from the organization's
-- existing `fiscal_year` setting (defaults to September 1st).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION scout_year_for_date(
  p_organization_id integer,
  p_on_date date
)
RETURNS TABLE (year_label text, year_start date, year_end date)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_setting    jsonb;
  v_month      integer := 9;
  v_day        integer := 1;
  v_start_year integer;
  v_start      date;
BEGIN
  SELECT setting_value
    INTO v_setting
    FROM organization_settings
   WHERE organization_id = p_organization_id
     AND setting_key = 'fiscal_year'
   LIMIT 1;

  IF v_setting IS NOT NULL THEN
    v_month := COALESCE(NULLIF(v_setting->>'start_month', '')::integer, 9);
    v_day   := COALESCE(NULLIF(v_setting->>'start_day', '')::integer, 1);
  END IF;

  -- Guard against an out-of-range configuration rather than raising.
  IF v_month < 1 OR v_month > 12 THEN
    v_month := 9;
  END IF;
  IF v_day < 1 OR v_day > 28 THEN
    v_day := LEAST(GREATEST(v_day, 1), 28);
  END IF;

  v_start_year := EXTRACT(YEAR FROM p_on_date)::integer;
  v_start := make_date(v_start_year, v_month, v_day);

  IF p_on_date < v_start THEN
    v_start_year := v_start_year - 1;
    v_start := make_date(v_start_year, v_month, v_day);
  END IF;

  year_label := v_start_year::text || '-' || (v_start_year + 1)::text;
  year_start := v_start;
  year_end   := (v_start + INTERVAL '1 year' - INTERVAL '1 day')::date;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION scout_year_for_date(integer, date) IS
  'Scout year label and boundaries containing p_on_date, based on the organization fiscal_year setting.';

-- ---------------------------------------------------------------------------
-- 3. Seed the year history
--
-- Creates every year from the organization's earliest known activity up to the
-- current one, so past data is browsable from day one. Only the current year is
-- marked active; earlier ones are closed.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org           RECORD;
  v_bounds        RECORD;
  v_first_date    date;
  v_cursor_date   date;
  v_current_label text;
BEGIN
  FOR v_org IN SELECT id FROM organizations LOOP
    SELECT * INTO v_bounds FROM scout_year_for_date(v_org.id, CURRENT_DATE);
    v_current_label := v_bounds.year_label;

    SELECT LEAST(
             COALESCE((SELECT MIN(inscription_date) FROM participant_organizations
                        WHERE organization_id = v_org.id), CURRENT_DATE),
             COALESCE((SELECT MIN(created_at)::date FROM points
                        WHERE organization_id = v_org.id), CURRENT_DATE),
             COALESCE((SELECT MIN(date) FROM attendance
                        WHERE organization_id = v_org.id), CURRENT_DATE),
             COALESCE((SELECT MIN(date) FROM honors
                        WHERE organization_id = v_org.id), CURRENT_DATE)
           )
      INTO v_first_date;

    v_first_date := LEAST(COALESCE(v_first_date, CURRENT_DATE), CURRENT_DATE);
    v_cursor_date := v_first_date;

    LOOP
      SELECT * INTO v_bounds FROM scout_year_for_date(v_org.id, v_cursor_date);

      INSERT INTO scout_years (organization_id, label, start_date, end_date, status)
      VALUES (
        v_org.id,
        v_bounds.year_label,
        v_bounds.year_start,
        v_bounds.year_end,
        CASE WHEN v_bounds.year_label = v_current_label THEN 'active' ELSE 'closed' END
      )
      ON CONFLICT (organization_id, label) DO NOTHING;

      EXIT WHEN v_bounds.year_label = v_current_label;
      v_cursor_date := v_bounds.year_end + 1;
    END LOOP;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Year-scoped participant enrollments
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'participant_organizations'
       AND table_type = 'BASE TABLE'
  ) THEN
    ALTER TABLE participant_organizations RENAME TO participant_enrollments;
  END IF;
END;
$$;

ALTER TABLE participant_enrollments
  ADD COLUMN IF NOT EXISTS scout_year_id integer REFERENCES scout_years(id),
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS ended_on date,
  ADD COLUMN IF NOT EXISTS exit_reason text,
  ADD COLUMN IF NOT EXISTS exception_note text,
  ADD COLUMN IF NOT EXISTS transferred_to_organization_id integer REFERENCES organizations(id),
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'participant_enrollments_status_check'
  ) THEN
    ALTER TABLE participant_enrollments
      ADD CONSTRAINT participant_enrollments_status_check
      CHECK (status IN ('active', 'graduated', 'left', 'transferred'));
  END IF;
END;
$$;

-- Existing rows are the current roster: attach them to the active year.
UPDATE participant_enrollments pe
   SET scout_year_id = sy.id
  FROM scout_years sy
 WHERE sy.organization_id = pe.organization_id
   AND sy.status = 'active'
   AND pe.scout_year_id IS NULL;

-- Any leftover (organization without an active year) falls back to the most
-- recent known year so the NOT NULL constraint below can be applied safely.
UPDATE participant_enrollments pe
   SET scout_year_id = sy.id
  FROM (
    SELECT DISTINCT ON (organization_id) organization_id, id
      FROM scout_years
     ORDER BY organization_id, start_date DESC
  ) sy
 WHERE sy.organization_id = pe.organization_id
   AND pe.scout_year_id IS NULL;

-- Nothing is ever deleted by this migration: if a row still cannot be attached
-- to a year (an enrollment pointing at a missing organization), abort and let an
-- operator look at it rather than dropping the record.
DO $$
DECLARE
  v_orphans integer;
BEGIN
  SELECT COUNT(*) INTO v_orphans
    FROM participant_enrollments
   WHERE scout_year_id IS NULL;

  IF v_orphans > 0 THEN
    RAISE EXCEPTION
      'Cannot assign a scout year to % participant_enrollments row(s). Check for enrollments referencing a missing organization before re-running.',
      v_orphans;
  END IF;
END;
$$;

ALTER TABLE participant_enrollments ALTER COLUMN scout_year_id SET NOT NULL;

-- Repoint the primary key so a participant can hold one enrollment per year.
DO $$
DECLARE
  v_pkey text;
BEGIN
  SELECT conname INTO v_pkey
    FROM pg_constraint
   WHERE conrelid = 'participant_enrollments'::regclass AND contype = 'p';

  IF v_pkey IS NOT NULL AND v_pkey <> 'participant_enrollments_pkey' THEN
    EXECUTE format('ALTER TABLE participant_enrollments RENAME CONSTRAINT %I TO participant_enrollments_pkey', v_pkey);
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'participant_enrollments'::regclass
       AND contype = 'p'
       AND array_length(conkey, 1) = 2
  ) THEN
    ALTER TABLE participant_enrollments DROP CONSTRAINT participant_enrollments_pkey;
    ALTER TABLE participant_enrollments
      ADD CONSTRAINT participant_enrollments_pkey
      PRIMARY KEY (participant_id, organization_id, scout_year_id);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS participant_enrollments_year_idx
  ON participant_enrollments (organization_id, scout_year_id, status);

CREATE INDEX IF NOT EXISTS participant_enrollments_participant_idx
  ON participant_enrollments (participant_id);

-- Compatibility view: every existing read site keeps working and now means
-- "roster of the active scout year". Writes must target participant_enrollments
-- directly (a view over a join is not auto-updatable, which is intentional).
CREATE OR REPLACE VIEW participant_organizations AS
  SELECT pe.participant_id,
         pe.organization_id,
         pe.inscription_date
    FROM participant_enrollments pe
    JOIN scout_years sy ON sy.id = pe.scout_year_id
   WHERE sy.status = 'active'
     AND pe.status = 'active';

COMMENT ON VIEW participant_organizations IS
  'Compatibility view over participant_enrollments, restricted to the active scout year. New code should write to participant_enrollments directly; INSTEAD OF triggers keep older deployments working.';

-- Writes through the view.
--
-- Application code writes to participant_enrollments directly. These triggers
-- soften the migration for anything still running the previous code: plain
-- INSERTs, `ON CONFLICT DO NOTHING` without a conflict target, and DELETEs all
-- keep working. Deleting through the view closes the enrollment rather than
-- destroying it, which is the whole point of the model.
--
-- LIMIT — this does NOT fully decouple the migration from the code deploy.
-- PostgreSQL cannot match a conflict target against a view, so a statement of
-- the form
--     INSERT INTO participant_organizations (...)
--     ON CONFLICT (participant_id, organization_id) DO NOTHING
-- fails with "there is no unique or exclusion constraint matching the ON
-- CONFLICT specification". Two such statements exist in the release that
-- precedes this change (routes/participants.js, the save-participant and
-- link-organization handlers). Apply this migration together with the deploy
-- that removes them.

CREATE OR REPLACE FUNCTION participant_organizations_insert()
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

  INSERT INTO participant_enrollments
          (participant_id, organization_id, scout_year_id, inscription_date, status)
   VALUES (NEW.participant_id, NEW.organization_id, v_scout_year_id,
           COALESCE(NEW.inscription_date, CURRENT_DATE), 'active')
   ON CONFLICT (participant_id, organization_id, scout_year_id)
   DO UPDATE SET status = 'active', ended_on = NULL, exit_reason = NULL;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION participant_organizations_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE participant_enrollments pe
     SET status = 'left', ended_on = CURRENT_DATE
    FROM scout_years sy
   WHERE sy.id = pe.scout_year_id
     AND sy.status = 'active'
     AND pe.participant_id = OLD.participant_id
     AND pe.organization_id = OLD.organization_id
     AND pe.status = 'active';

  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION participant_organizations_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE participant_enrollments pe
     SET inscription_date = NEW.inscription_date
    FROM scout_years sy
   WHERE sy.id = pe.scout_year_id
     AND sy.status = 'active'
     AND pe.participant_id = OLD.participant_id
     AND pe.organization_id = OLD.organization_id
     AND pe.status = 'active';

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS participant_organizations_insert_trigger ON participant_organizations;
CREATE TRIGGER participant_organizations_insert_trigger
  INSTEAD OF INSERT ON participant_organizations
  FOR EACH ROW EXECUTE FUNCTION participant_organizations_insert();

DROP TRIGGER IF EXISTS participant_organizations_delete_trigger ON participant_organizations;
CREATE TRIGGER participant_organizations_delete_trigger
  INSTEAD OF DELETE ON participant_organizations
  FOR EACH ROW EXECUTE FUNCTION participant_organizations_delete();

DROP TRIGGER IF EXISTS participant_organizations_update_trigger ON participant_organizations;
CREATE TRIGGER participant_organizations_update_trigger
  INSTEAD OF UPDATE ON participant_organizations
  FOR EACH ROW EXECUTE FUNCTION participant_organizations_update();

-- ---------------------------------------------------------------------------
-- 5. Year-scoped points
-- ---------------------------------------------------------------------------

ALTER TABLE points
  ADD COLUMN IF NOT EXISTS scout_year_id integer REFERENCES scout_years(id);

-- Back-fill from the award date.
UPDATE points p
   SET scout_year_id = sy.id
  FROM scout_years sy
 WHERE sy.organization_id = p.organization_id
   AND COALESCE(p.created_at, now())::date BETWEEN sy.start_date AND sy.end_date
   AND p.scout_year_id IS NULL;

-- Anything outside a known range (or predating the seeded history) lands on the
-- organization's earliest year rather than staying invisible.
UPDATE points p
   SET scout_year_id = sy.id
  FROM (
    SELECT DISTINCT ON (organization_id) organization_id, id
      FROM scout_years
     ORDER BY organization_id, start_date ASC
  ) sy
 WHERE sy.organization_id = p.organization_id
   AND p.scout_year_id IS NULL;

CREATE INDEX IF NOT EXISTS points_scout_year_idx
  ON points (organization_id, scout_year_id, participant_id);

CREATE INDEX IF NOT EXISTS points_scout_year_group_idx
  ON points (organization_id, scout_year_id, group_id);

-- Stamp every future insert. Points are written from eight call sites across
-- five route files (attendance, honors, badges, points); a trigger keeps the
-- rule in one place and also covers imports and manual SQL. Back-dated rows
-- (an honor recorded for a past date) land in the year containing that date.
--
-- This relies on the invariant that the active year always contains today:
-- services/scoutYear.js clamps the boundaries when a year is activated ahead of
-- its nominal start, so points awarded between an early transition and
-- September 1st land in the newly opened year, not the closed one.
CREATE OR REPLACE FUNCTION points_set_scout_year()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.scout_year_id IS NOT NULL OR NEW.organization_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Every column is qualified: `id`, `status` and `organization_id` all exist
  -- on the row being inserted too, and an unqualified reference is ambiguous.
  SELECT sy.id INTO NEW.scout_year_id
    FROM scout_years sy
   WHERE sy.organization_id = NEW.organization_id
     AND COALESCE(NEW.created_at, now())::date BETWEEN sy.start_date AND sy.end_date
   LIMIT 1;

  IF NEW.scout_year_id IS NULL THEN
    SELECT sy.id INTO NEW.scout_year_id
      FROM scout_years sy
     WHERE sy.organization_id = NEW.organization_id
       AND sy.status = 'active'
     LIMIT 1;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS points_set_scout_year_trigger ON points;
CREATE TRIGGER points_set_scout_year_trigger
  BEFORE INSERT ON points
  FOR EACH ROW
  EXECUTE FUNCTION points_set_scout_year();

-- Companion view for the many aggregate queries that mean "this season's
-- score". Endpoints that let the user consult an archived year query `points`
-- directly with an explicit scout_year_id instead.
CREATE OR REPLACE VIEW active_year_points AS
  SELECT p.id,
         p.participant_id,
         p.group_id,
         p.value,
         p.created_at,
         p.organization_id,
         p.honor_id,
         p.scout_year_id
    FROM points p
    JOIN scout_years sy ON sy.id = p.scout_year_id
   WHERE sy.status = 'active';

COMMENT ON VIEW active_year_points IS
  'Read-only view over points, restricted to each organization active scout year.';

-- ---------------------------------------------------------------------------
-- 6. Membership status (parents kept, not deleted)
-- ---------------------------------------------------------------------------

ALTER TABLE user_organizations
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz,
  ADD COLUMN IF NOT EXISTS deactivated_reason text,
  ADD COLUMN IF NOT EXISTS last_active_scout_year_id integer REFERENCES scout_years(id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_organizations_status_check'
  ) THEN
    ALTER TABLE user_organizations
      ADD CONSTRAINT user_organizations_status_check
      CHECK (status IN ('active', 'inactive', 'alumni'));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS user_organizations_status_idx
  ON user_organizations (organization_id, status);

-- ---------------------------------------------------------------------------
-- 7. Transition log
--
-- Records what each transition changed. Used for traceability today, and it is
-- what a future rollback will replay in reverse.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS scout_year_transitions (
  id                 serial PRIMARY KEY,
  organization_id    integer NOT NULL REFERENCES organizations(id),
  from_scout_year_id integer REFERENCES scout_years(id),
  to_scout_year_id   integer NOT NULL REFERENCES scout_years(id),
  executed_at        timestamptz NOT NULL DEFAULT now(),
  executed_by        uuid REFERENCES users(id),
  summary            jsonb NOT NULL DEFAULT '{}'::jsonb,
  changeset          jsonb NOT NULL DEFAULT '{}'::jsonb,
  rolled_back_at     timestamptz,
  rolled_back_by     uuid REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS scout_year_transitions_org_idx
  ON scout_year_transitions (organization_id, executed_at DESC);

-- ---------------------------------------------------------------------------
-- 8. Permissions
-- ---------------------------------------------------------------------------

INSERT INTO permissions (permission_key, permission_name, category, description)
VALUES
  ('scout_year.view',   'View Scout Years',   'organization',
   'View the scout year history and consult archived years'),
  ('scout_year.manage', 'Manage Scout Years', 'organization',
   'Open, close and configure scout years, and activate or deactivate memberships')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
 CROSS JOIN permissions p
 WHERE p.permission_key = 'scout_year.manage'
   AND r.role_name IN ('unitadmin', 'district')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
 CROSS JOIN permissions p
 WHERE p.permission_key = 'scout_year.view'
   AND r.role_name IN ('unitadmin', 'district', 'animation', 'demoadmin')
ON CONFLICT DO NOTHING;

COMMIT;
