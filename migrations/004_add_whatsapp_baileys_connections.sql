-- 004_add_whatsapp_baileys_connections.sql
--
-- Backfills whatsapp_baileys_connections into tracked migrations.
--
-- The table was created out-of-band before migrations/ existed, so
-- environments bootstrapped from attached_assets/Full_Database_schema.sql
-- (db:local:setup) or from a production backup already have it. But any
-- environment relying only on tracked migrations (db:migrate:base /
-- db:migrate:deploy, used by scripts/run-whatsapp-migration.js) was silently
-- missing this table, or missing the later auth_creds/auth_keys columns on
-- an older copy of it -- the WhatsApp helper script would report success
-- without actually fixing the schema. Every statement below is a no-op
-- against a database that already matches the schema dump.

CREATE SEQUENCE IF NOT EXISTS public.whatsapp_baileys_connections_id_seq
  AS integer
  START WITH 1
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1;

CREATE TABLE IF NOT EXISTS public.whatsapp_baileys_connections (
    id integer NOT NULL DEFAULT nextval('public.whatsapp_baileys_connections_id_seq'::regclass),
    organization_id integer NOT NULL,
    is_connected boolean DEFAULT false,
    connected_phone_number character varying(20),
    session_data text,
    last_connected_at timestamp without time zone,
    last_disconnected_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    auth_creds jsonb DEFAULT '{}'::jsonb,
    auth_keys jsonb DEFAULT '{}'::jsonb
);

ALTER SEQUENCE public.whatsapp_baileys_connections_id_seq OWNED BY public.whatsapp_baileys_connections.id;

-- Covers an older copy of the table that predates these two columns.
ALTER TABLE public.whatsapp_baileys_connections
  ADD COLUMN IF NOT EXISTS auth_creds jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS auth_keys jsonb DEFAULT '{}'::jsonb;

COMMENT ON TABLE public.whatsapp_baileys_connections IS
  'Stores WhatsApp connection status and session data for organizations using Baileys (unofficial WhatsApp Web API). One connection per organization.';
COMMENT ON COLUMN public.whatsapp_baileys_connections.connected_phone_number IS
  'The phone number of the WhatsApp account that was connected via QR code scan, in E.164 format.';
COMMENT ON COLUMN public.whatsapp_baileys_connections.session_data IS
  'Encrypted Baileys session credentials stored as base64 encoded JSON. Contains authentication tokens and keys needed to maintain the WhatsApp connection.';
COMMENT ON COLUMN public.whatsapp_baileys_connections.auth_creds IS
  'Baileys authentication credentials stored as JSONB. Contains creds.json data including registration ID, identity keys, etc.';
COMMENT ON COLUMN public.whatsapp_baileys_connections.auth_keys IS
  'Baileys authentication keys stored as JSONB. Contains pre-keys, session keys, sender keys, and app state sync keys.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_baileys_connections_pkey'
  ) THEN
    ALTER TABLE ONLY public.whatsapp_baileys_connections
      ADD CONSTRAINT whatsapp_baileys_connections_pkey PRIMARY KEY (id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'unique_org_whatsapp_connection'
  ) THEN
    ALTER TABLE ONLY public.whatsapp_baileys_connections
      ADD CONSTRAINT unique_org_whatsapp_connection UNIQUE (organization_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_baileys_connections_organization_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.whatsapp_baileys_connections
      ADD CONSTRAINT whatsapp_baileys_connections_organization_id_fkey
      FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_whatsapp_auth_creds_gin ON public.whatsapp_baileys_connections USING gin (auth_creds);
CREATE INDEX IF NOT EXISTS idx_whatsapp_auth_keys_gin ON public.whatsapp_baileys_connections USING gin (auth_keys);
CREATE INDEX IF NOT EXISTS idx_whatsapp_baileys_connected ON public.whatsapp_baileys_connections USING btree (organization_id, is_connected) WHERE (is_connected = true);
CREATE INDEX IF NOT EXISTS idx_whatsapp_baileys_org_id ON public.whatsapp_baileys_connections USING btree (organization_id);
