-- Migration: "needs review" flag on form submissions
--
-- A health form or an emergency contact rarely changes from one year to the
-- next, and asking parents to retype twelve identical fields is the surest way
-- to get half-filled forms. So the content is kept; what the year transition
-- adds is a flag asking the parent to re-read it and correct it if needed.
--
-- Confirming without changing anything is a valid action and is recorded as
-- such: `last_reviewed_at` answers "has this been re-read?", which `updated_at`
-- never can, since confirming modifies nothing.
--
-- Scope is limited to required forms (organization_form_formats.is_required):
-- there is no point asking anyone to review last year's one-off outing form.
--
-- Safe to run more than once. Depends on create_scout_years_and_enrollments.sql.

BEGIN;

ALTER TABLE form_submissions
  ADD COLUMN IF NOT EXISTS scout_year_id integer REFERENCES scout_years(id),
  ADD COLUMN IF NOT EXISTS review_state text NOT NULL DEFAULT 'current',
  ADD COLUMN IF NOT EXISTS flagged_for_review_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_reviewed_by uuid REFERENCES users(id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'form_submissions_review_state_check'
  ) THEN
    ALTER TABLE form_submissions
      ADD CONSTRAINT form_submissions_review_state_check
      CHECK (review_state IN ('current', 'needs_review'));
  END IF;
END;
$$;

-- Attach existing submissions to the year they were filled in.
UPDATE form_submissions fs
   SET scout_year_id = sy.id
  FROM scout_years sy
 WHERE sy.organization_id = fs.organization_id
   AND COALESCE(fs.created_at, now())::date BETWEEN sy.start_date AND sy.end_date
   AND fs.scout_year_id IS NULL;

-- Anything predating the seeded history lands on the earliest known year.
UPDATE form_submissions fs
   SET scout_year_id = sy.id
  FROM (
    SELECT DISTINCT ON (organization_id) organization_id, id
      FROM scout_years
     ORDER BY organization_id, start_date ASC
  ) sy
 WHERE sy.organization_id = fs.organization_id
   AND fs.scout_year_id IS NULL;

CREATE INDEX IF NOT EXISTS form_submissions_review_idx
  ON form_submissions (organization_id, review_state)
  WHERE review_state = 'needs_review';

CREATE INDEX IF NOT EXISTS form_submissions_scout_year_idx
  ON form_submissions (organization_id, scout_year_id, participant_id);

-- Stamp the year on every future submission, wherever it is written from.
CREATE OR REPLACE FUNCTION form_submissions_set_scout_year()
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

DROP TRIGGER IF EXISTS form_submissions_set_scout_year_trigger ON form_submissions;
CREATE TRIGGER form_submissions_set_scout_year_trigger
  BEFORE INSERT ON form_submissions
  FOR EACH ROW
  EXECUTE FUNCTION form_submissions_set_scout_year();

COMMIT;
