-- Correcting a medication plan (#1379).
--
-- A family corrects a plan in place instead of creating a second one. Each correction is kept:
-- what changed (before and after, field by field), who changed it and when. The team reads it as
-- "modified by the family", and the plan shows its history.
--
-- A correction to what is given (name, dose, instructions, times, route) by an adult other than the
-- one who signed the administration authorization sets that authorization to `plan_changed`: it is
-- then listed with those to sign again, like an expired one.
CREATE TABLE IF NOT EXISTS public.medication_requirement_revisions (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  medication_requirement_id INTEGER NOT NULL REFERENCES public.medication_requirements(id) ON DELETE CASCADE,
  changes JSONB NOT NULL CHECK (jsonb_typeof(changes) = 'object'),
  changed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  changed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  requires_new_signature BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS medication_requirement_revisions_by_requirement
  ON public.medication_requirement_revisions (organization_id, medication_requirement_id, changed_at DESC);

COMMENT ON TABLE public.medication_requirement_revisions IS
  'One row per correction of a medication plan by a family (#1379), written in the same transaction as the correction.';
COMMENT ON COLUMN public.medication_requirement_revisions.changes IS
  'The fields that changed: { field: { "from": old value, "to": new value } }. Plain values, no markup.';
COMMENT ON COLUMN public.medication_requirement_revisions.changed_by IS
  'The adult who made the correction; NULL once that account is deleted.';
COMMENT ON COLUMN public.medication_requirement_revisions.requires_new_signature IS
  'True when this correction set the signed administration authorization to plan_changed.';

COMMENT ON COLUMN public.medication_admin_authorizations.status IS
  'signed: in force. expired: a scout year ended (services/scoutYear.js). plan_changed: an adult other than the signer changed what is given (#1379). Anything but signed must be signed again.';
