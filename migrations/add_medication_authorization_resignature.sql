-- Migration: yearly re-signature of medication authorizations
--
-- Health forms are kept and merely flagged for a re-read (see
-- add_form_review_flag.sql). Medication authorizations are the exception: they
-- carry a parent signature and a legal responsibility, so a re-read is not
-- enough — the parent has to sign again for the new year.
--
-- Nothing is destroyed. Both authorization tables are append-only: signing
-- inserts a new row and the application reads the most recent one. The year
-- transition simply marks the standing authorization as expired, so the most
-- recent row stops counting as valid consent while remaining on file as the
-- record of what was authorized last year.
--
-- Safe to run more than once. Depends on create_scout_years_and_enrollments.sql.

BEGIN;

ALTER TABLE medication_treatment_authorizations
  ADD COLUMN IF NOT EXISTS scout_year_id integer REFERENCES scout_years(id),
  ADD COLUMN IF NOT EXISTS expired_at timestamptz;

ALTER TABLE medication_admin_authorizations
  ADD COLUMN IF NOT EXISTS scout_year_id integer REFERENCES scout_years(id),
  ADD COLUMN IF NOT EXISTS expired_at timestamptz;

-- Attach existing signatures to the year they were given in.
UPDATE medication_treatment_authorizations a
   SET scout_year_id = sy.id
  FROM scout_years sy
 WHERE sy.organization_id = a.organization_id
   AND COALESCE(a.date_signature, a.created_at, now())::date BETWEEN sy.start_date AND sy.end_date
   AND a.scout_year_id IS NULL;

UPDATE medication_admin_authorizations a
   SET scout_year_id = sy.id
  FROM scout_years sy
 WHERE sy.organization_id = a.organization_id
   AND COALESCE(a.date_signature, a.created_at, now())::date BETWEEN sy.start_date AND sy.end_date
   AND a.scout_year_id IS NULL;

-- Signatures predating the seeded history land on the earliest known year.
UPDATE medication_treatment_authorizations a
   SET scout_year_id = sy.id
  FROM (
    SELECT DISTINCT ON (organization_id) organization_id, id
      FROM scout_years ORDER BY organization_id, start_date ASC
  ) sy
 WHERE sy.organization_id = a.organization_id AND a.scout_year_id IS NULL;

UPDATE medication_admin_authorizations a
   SET scout_year_id = sy.id
  FROM (
    SELECT DISTINCT ON (organization_id) organization_id, id
      FROM scout_years ORDER BY organization_id, start_date ASC
  ) sy
 WHERE sy.organization_id = a.organization_id AND a.scout_year_id IS NULL;

CREATE INDEX IF NOT EXISTS medication_treatment_auth_year_idx
  ON medication_treatment_authorizations (organization_id, participant_id, scout_year_id);

CREATE INDEX IF NOT EXISTS medication_admin_auth_year_idx
  ON medication_admin_authorizations (organization_id, participant_id, scout_year_id);

-- Stamp the year on every new signature, wherever it is written from.
CREATE OR REPLACE FUNCTION medication_authorization_set_scout_year()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.scout_year_id IS NOT NULL OR NEW.organization_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Every column is qualified: `id`, `status` and `organization_id` all exist
  -- on the authorization row too, and an unqualified reference is ambiguous.
  SELECT sy.id INTO NEW.scout_year_id
    FROM scout_years sy
   WHERE sy.organization_id = NEW.organization_id
     AND COALESCE(NEW.date_signature, NEW.created_at, now())::date BETWEEN sy.start_date AND sy.end_date
   LIMIT 1;

  IF NEW.scout_year_id IS NULL THEN
    SELECT sy.id INTO NEW.scout_year_id
      FROM scout_years sy
     WHERE sy.organization_id = NEW.organization_id AND sy.status = 'active'
     LIMIT 1;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS medication_treatment_auth_year_trigger ON medication_treatment_authorizations;
CREATE TRIGGER medication_treatment_auth_year_trigger
  BEFORE INSERT ON medication_treatment_authorizations
  FOR EACH ROW EXECUTE FUNCTION medication_authorization_set_scout_year();

DROP TRIGGER IF EXISTS medication_admin_auth_year_trigger ON medication_admin_authorizations;
CREATE TRIGGER medication_admin_auth_year_trigger
  BEFORE INSERT ON medication_admin_authorizations
  FOR EACH ROW EXECUTE FUNCTION medication_authorization_set_scout_year();

COMMIT;
