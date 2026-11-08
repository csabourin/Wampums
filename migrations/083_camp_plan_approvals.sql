-- Attestations bind to the plain submitted document, even if it is later redacted.
ALTER TABLE public.camp_plan_versions
  ADD COLUMN IF NOT EXISTS approved_pdf BYTEA,
  ADD COLUMN IF NOT EXISTS approved_pdf_sha256 CHAR(64) CHECK (approved_pdf_sha256 ~ '^[0-9a-f]{64}$');

CREATE TABLE IF NOT EXISTS public.camp_plan_attestations (
  organization_id INTEGER NOT NULL,
  version_id INTEGER NOT NULL,
  stage VARCHAR(10) NOT NULL CHECK (stage IN ('lead', 'group', 'branch')),
  decision VARCHAR(20) NOT NULL CHECK (decision IN ('approved', 'changes_requested')),
  actor_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  signer_name TEXT NOT NULL,
  signer_function TEXT NOT NULL,
  comment TEXT NOT NULL,
  signed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  signer_ip INET,
  received_on DATE,
  snapshot_sha256 CHAR(64) NOT NULL,
  pdf_sha256 CHAR(64) NOT NULL,
  CHECK ((stage = 'branch') = (received_on IS NOT NULL)),
  PRIMARY KEY (version_id, stage),
  FOREIGN KEY (version_id, organization_id) REFERENCES public.camp_plan_versions(id, organization_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.camp_plan_branch_links (
  organization_id INTEGER NOT NULL,
  version_id INTEGER PRIMARY KEY,
  token_digest CHAR(64) NOT NULL UNIQUE,
  pdf_sha256 CHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (version_id, organization_id) REFERENCES public.camp_plan_versions(id, organization_id) ON DELETE CASCADE
);

SELECT setval(pg_get_serial_sequence('public.permissions', 'id'),
  COALESCE((SELECT MAX(id) FROM public.permissions), 0) + 1, false);
INSERT INTO public.permissions (permission_key, permission_name, category, description)
VALUES
  ('camp_plans.attest_lead', 'Attest as camp lead', 'camp_plan', 'Sign a submitted camp plan as the camp lead'),
  ('camp_plans.approve_group', 'Approve on behalf of the scout group', 'camp_plan', 'Sign a camp plan on behalf of the scout group'),
  ('camp_plans.request_branch_approval', 'Request branch approval', 'camp_plan', 'Email the branch lead a link to review a camp plan')
ON CONFLICT (permission_key) DO NOTHING;
