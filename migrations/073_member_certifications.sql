-- Adult certifications for the camp lists (#1319, second slice).
--
-- The camp permit lists each adult's certifications (first aid, wilderness first aid, winter
-- camping). They belong to the person, not to a unit: an adult declares each one once, with the
-- day obtained and its expiry, and a manager of volunteers in any unit where the person is an
-- active member verifies it. Once verified, it holds in every unit of that person. Changing the
-- dates of a declaration withdraws its verification. Only the fact and the dates are kept, never
-- the certificate itself. Keys: config/certifications.json.
CREATE TABLE IF NOT EXISTS public.member_certifications (
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  certification_key VARCHAR(40) NOT NULL
    CHECK (certification_key IN ('first_aid_certificate', 'wilderness_first_aid', 'winter_camping')),
  obtained_on DATE NOT NULL,
  valid_until DATE,
  declared_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_at TIMESTAMPTZ,
  verified_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  verified_in_organization_id INTEGER REFERENCES public.organizations(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, certification_key),
  CHECK (valid_until IS NULL OR valid_until >= obtained_on)
);

COMMENT ON TABLE public.member_certifications IS
  'Certifications a person declared for themselves, with the day obtained and the expiry. Counts once verified (verified_at) by a volunteer manager of a unit the person belongs to; the verification holds in every unit. Read by the person, and by a unit only while they are its active member.';

-- A camp that plans swimming asks the team to check who supervises it. Not a blocking gap.
ALTER TABLE public.year_plan_meetings
  ADD COLUMN IF NOT EXISTS swimming_planned BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.year_plan_meetings.swimming_planned IS
  'Whether a camp plans swimming. The camp lists then ask the team to check its supervision.';
