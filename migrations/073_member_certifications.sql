-- Adult certifications for the camp lists (#1319, second slice).
--
-- The camp permit lists each adult's certifications (first aid, wilderness first aid, winter
-- camping). An adult declares their own from their account; a manager of the unit verifies them,
-- as they verify background checks (volunteer_requirements, #1251). Only a verified certification
-- counts: a camp whose team holds no verified first-aid certificate valid on the camp's dates shows
-- a blocking gap. Only the fact and the dates are kept, never the certificate itself.
-- Keys: config/certifications.json, a subset of config/volunteer_shifts.json requirements.

-- Verified certifications are requirements a manager records: two new keys join the list.
ALTER TABLE public.volunteer_requirements
  DROP CONSTRAINT IF EXISTS volunteer_requirements_requirement_key_check;
ALTER TABLE public.volunteer_requirements
  ADD CONSTRAINT volunteer_requirements_requirement_key_check
  CHECK (requirement_key IN ('background_check', 'safety_training', 'first_aid_certificate', 'driver_licence', 'wilderness_first_aid', 'winter_camping'));

-- What the adult says they hold, before anyone verifies it. It never counts by itself.
CREATE TABLE IF NOT EXISTS public.member_certification_declarations (
  organization_id INTEGER NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  certification_key VARCHAR(40) NOT NULL
    CHECK (certification_key IN ('first_aid_certificate', 'wilderness_first_aid', 'winter_camping')),
  obtained_on DATE NOT NULL,
  valid_until DATE,
  declared_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, user_id, certification_key),
  CHECK (valid_until IS NULL OR valid_until >= obtained_on)
);

COMMENT ON TABLE public.member_certification_declarations IS
  'Certifications an adult declared for themselves in one unit, with the day obtained and the expiry. Unverified: only a manager''s record in volunteer_requirements counts. Visible to the person and to volunteer managers.';

-- A camp that plans swimming asks the team to check who supervises it. Not a blocking gap.
ALTER TABLE public.year_plan_meetings
  ADD COLUMN IF NOT EXISTS swimming_planned BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.year_plan_meetings.swimming_planned IS
  'Whether a camp plans swimming. The camp lists then ask the team to check its supervision.';
