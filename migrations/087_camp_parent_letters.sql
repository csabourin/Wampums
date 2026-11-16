-- Letter to parents drawn from the camp (#1321).
--
-- A camp keeps one draft of its letter, in French and in English, which the team edits; sending it
-- freezes a numbered version and emails the families of the youth invited to the camp, each in its
-- language. Every address has its own receipt, claimed before the provider is called, so a lost
-- answer is never sent twice (the rule of permission_slip_deliveries).

CREATE TABLE IF NOT EXISTS public.camp_parent_letters (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  meeting_id INTEGER NOT NULL REFERENCES public.year_plan_meetings(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent')),
  version_number INTEGER CHECK (version_number IS NULL OR version_number > 0),
  subject_fr TEXT NOT NULL,
  body_fr_html TEXT NOT NULL,
  body_fr TEXT NOT NULL,
  subject_en TEXT NOT NULL,
  body_en_html TEXT NOT NULL,
  body_en TEXT NOT NULL,
  updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  sent_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  sent_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT camp_parent_letters_sent_numbered CHECK (
    (status = 'draft' AND version_number IS NULL AND sent_at IS NULL)
    OR (status = 'sent' AND version_number IS NOT NULL AND sent_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS camp_parent_letters_one_draft
  ON public.camp_parent_letters (meeting_id) WHERE status = 'draft';
CREATE UNIQUE INDEX IF NOT EXISTS camp_parent_letters_version
  ON public.camp_parent_letters (meeting_id, version_number) WHERE status = 'sent';
CREATE INDEX IF NOT EXISTS camp_parent_letters_unit
  ON public.camp_parent_letters (organization_id, meeting_id);

COMMENT ON TABLE public.camp_parent_letters IS
  'Letter to the families of a camp (#1321): one draft per camp, then one row per sent version. Both languages are kept; each family receives its own.';
COMMENT ON COLUMN public.camp_parent_letters.body_fr_html IS
  'Formatted French text, rebuilt by utils/richText.js before it is stored; body_fr is its plain text.';

CREATE TABLE IF NOT EXISTS public.camp_parent_letter_deliveries (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  letter_id INTEGER NOT NULL REFERENCES public.camp_parent_letters(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  language TEXT NOT NULL CHECK (language IN ('fr', 'en')),
  status TEXT NOT NULL CHECK (status IN ('sending', 'sent', 'failed', 'unknown')),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE (letter_id, email)
);

CREATE INDEX IF NOT EXISTS camp_parent_letter_deliveries_unit
  ON public.camp_parent_letter_deliveries (organization_id, letter_id);

COMMENT ON TABLE public.camp_parent_letter_deliveries IS
  'One receipt per address a sent camp letter went to. Claimed (sending) before the provider is called; only failed is retried, so an uncertain send is never repeated.';
