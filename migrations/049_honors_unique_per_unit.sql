-- A youth enrolled in two units may receive an honor from each on the same day:
-- what one unit records never refuses another's. One honor a day per unit stays
-- enforced by unique_honor_per_date_per_org (participant_id, date, organization_id).
ALTER TABLE honors DROP CONSTRAINT IF EXISTS honors_name_id_date_unique;
