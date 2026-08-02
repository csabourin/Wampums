-- Migration: Assign every yearly plan to a scout year
-- Plans are historical planning records. They stay with the year whose date
-- range contains their start date and are not copied automatically at rollover.
-- Idempotent: safe to re-run.

BEGIN;

ALTER TABLE year_plans
  ADD COLUMN IF NOT EXISTS scout_year_id INTEGER;

UPDATE year_plans plan
   SET scout_year_id = (
     SELECT year.id
       FROM scout_years year
      WHERE year.organization_id = plan.organization_id
        AND plan.start_date BETWEEN year.start_date AND year.end_date
      ORDER BY CASE year.status WHEN 'active' THEN 0 WHEN 'planning' THEN 1 ELSE 2 END,
               year.start_date DESC
      LIMIT 1
   )
 WHERE plan.scout_year_id IS NULL
   AND EXISTS (
     SELECT 1 FROM scout_years year
      WHERE year.organization_id = plan.organization_id
        AND plan.start_date BETWEEN year.start_date AND year.end_date
   );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'year_plans_scout_year_id_fkey'
  ) THEN
    ALTER TABLE year_plans
      ADD CONSTRAINT year_plans_scout_year_id_fkey
      FOREIGN KEY (scout_year_id) REFERENCES scout_years(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_year_plans_scout_year
  ON year_plans(organization_id, scout_year_id, start_date DESC);

COMMENT ON COLUMN year_plans.scout_year_id IS
  'Scout year that owns this historical plan. Plans are not copied during rollover.';

COMMIT;
