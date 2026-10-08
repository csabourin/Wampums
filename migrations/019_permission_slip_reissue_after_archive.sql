-- An archived permission slip stays as it was answered.
--
-- One open slip per participant and date was enforced by a unique constraint
-- that also counted archived slips, so issuing a new request after archiving
-- one could only reuse the archived row and erase the guardian's answer.
-- Archived slips now sit outside the uniqueness rule: archiving frees the
-- date, and the next request is a new row beside the archived record.

ALTER TABLE public.permission_slips
  DROP CONSTRAINT IF EXISTS permission_slips_organization_id_participant_id_meeting_dat_key;

CREATE UNIQUE INDEX IF NOT EXISTS permission_slips_one_open_per_date
  ON public.permission_slips (organization_id, participant_id, meeting_date)
  WHERE status <> 'archived';

COMMENT ON INDEX public.permission_slips_one_open_per_date IS
  'At most one non-archived slip per participant and date; archived slips are kept as records';
