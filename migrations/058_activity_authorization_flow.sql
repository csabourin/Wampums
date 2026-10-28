-- Durable address-level outcomes; a claimed send is never automatically replayed.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'activities' AND column_name = 'authorization_required') THEN
    ALTER TABLE public.activities ADD COLUMN authorization_required BOOLEAN NOT NULL DEFAULT FALSE;
    UPDATE public.activities SET authorization_required = TRUE WHERE authorization_text IS NOT NULL;
  END IF;
END $$;
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS authorization_deadline_date DATE;
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS transport_required BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS creation_key UUID;
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS creation_fingerprint TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS activities_creation_key_unique ON public.activities (organization_id, creation_key);

CREATE TABLE IF NOT EXISTS public.permission_slip_deliveries (
  id BIGSERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  slip_id INTEGER NOT NULL REFERENCES public.permission_slips(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  access_token UUID NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sending', 'sent', 'failed', 'unknown')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  UNIQUE (slip_id, access_token, email)
);
CREATE INDEX IF NOT EXISTS permission_slip_deliveries_unit ON public.permission_slip_deliveries (organization_id, slip_id);
COMMENT ON TABLE public.permission_slip_deliveries IS 'Initial authorization email outcomes per normalized address. Sending/unknown claims require checking, never an automatic retry.';
