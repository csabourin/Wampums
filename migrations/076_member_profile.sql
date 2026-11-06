-- Personal information belongs to the account, never to a unit (#1359).
-- No permission is added: a member writes their own profile; camp health reads use camp_allergies.view.
CREATE TABLE IF NOT EXISTS public.member_profiles (
  user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  phone TEXT CHECK (length(phone) <= 30),
  emergency_contact_name TEXT CHECK (length(emergency_contact_name) <= 200),
  emergency_contact_phone TEXT CHECK (length(emergency_contact_phone) <= 30),
  emergency_contact_relationship TEXT CHECK (length(emergency_contact_relationship) <= 200),
  share_camp_contacts BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.member_health_forms (
  user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  health_conditions TEXT CHECK (length(health_conditions) <= 2000),
  medications TEXT CHECK (length(medications) <= 2000),
  support_needs TEXT CHECK (length(support_needs) <= 2000),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.member_profiles IS
  'Self-written account contact information. Peers at the same camp see the consenting adult''s phone only; emergency contacts are limited to authorized camp health readers.';
COMMENT ON TABLE public.member_health_forms IS
  'Voluntary self-written health information. Allergies remain in member_allergy_declarations. A unit reads only its active camp team members, with camp_allergies.view.';
