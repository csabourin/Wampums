-- Role matrix district access and transactional definition history.
SELECT setval(pg_get_serial_sequence('public.permissions', 'id'),
              COALESCE((SELECT MAX(id) FROM public.permissions), 0) + 1, false);
INSERT INTO public.permissions (permission_key, permission_name, category, description, district_only)
VALUES ('roles.manage_district', 'Manage district role matrices', 'roles',
        'Manage roles in the active unit from the district space', TRUE)
ON CONFLICT (permission_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.role_permission_audit (
  id BIGSERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  changed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  role_id INTEGER REFERENCES public.roles(id) ON DELETE SET NULL,
  previous_state JSONB,
  new_state JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_role_permission_audit_unit
  ON public.role_permission_audit (organization_id, created_at DESC);
COMMENT ON TABLE public.role_permission_audit IS
  'Role definition snapshots, including permission keys, scope, name and description, before and after each mutation.';
