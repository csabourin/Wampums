-- The demo unit becomes Saint-Bivouac, and visitors may try what writes no text.
--
-- demo.wampums.app (the unit whose demo_sign_in setting is on) was read-only,
-- so a visitor who pressed "+1" met an error instead of seeing what the app
-- does. Awarding points, taking attendance and awarding an honor without a
-- reason carry no free text, so nothing a visitor writes there can deface the
-- demo; middleware/demoSandbox.js lets exactly those requests through in that
-- unit, and only there. Everything else stays read-only.
--
-- 1. The demo leader account needs the permissions those screens ask for.
--    demoadmin is a built-in role, so a demo account in an ordinary unit gains
--    the buttons too; there the sandbox does not apply and the server still
--    refuses, with the demo explanation.
-- 2. The demo unit's name, "Meute 6Z", said nothing. A proper noun reads the
--    same in English and French: Saint-Bivouac.
-- 3. demo_sandbox_baselines holds the state the night reset returns to
--    (scripts/demo/reset-demo-sandbox.js); migration 042 fills it.

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM public.roles r
  JOIN public.permissions p
    ON p.permission_key IN (
      'points.view', 'points.manage',
      'attendance.view', 'attendance.manage',
      'honors.view', 'honors.create'
    )
 WHERE r.role_name = 'demoadmin'
   AND r.organization_id IS NULL
ON CONFLICT (role_id, permission_id) DO NOTHING;

UPDATE public.organizations o
   SET name = 'Saint-Bivouac', updated_at = NOW()
  FROM public.organization_settings s
 WHERE s.organization_id = o.id
   AND s.setting_key = 'demo_sign_in'
   AND s.setting_value IN ('true'::jsonb, '"true"'::jsonb)
   AND o.name IS DISTINCT FROM 'Saint-Bivouac';

UPDATE public.organization_settings info
   SET setting_value = jsonb_set(info.setting_value, '{name}', '"Saint-Bivouac"'::jsonb),
       updated_at = NOW()
  FROM public.organization_settings demo
 WHERE demo.organization_id = info.organization_id
   AND demo.setting_key = 'demo_sign_in'
   AND demo.setting_value IN ('true'::jsonb, '"true"'::jsonb)
   AND info.setting_key = 'organization_info'
   AND jsonb_typeof(info.setting_value) = 'object'
   AND info.setting_value->>'name' IS DISTINCT FROM 'Saint-Bivouac';

CREATE TABLE IF NOT EXISTS public.demo_sandbox_baselines (
  organization_id integer PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  points jsonb NOT NULL DEFAULT '[]'::jsonb,
  attendance jsonb NOT NULL DEFAULT '[]'::jsonb,
  honors jsonb NOT NULL DEFAULT '[]'::jsonb,
  captured_at timestamp with time zone NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.demo_sandbox_baselines IS
  'The demo unit''s points, attendance and honors as the night reset restores them (services/demoSandbox.js). Only units with demo_sign_in have a row.';
COMMENT ON COLUMN public.demo_sandbox_baselines.points IS 'Rows of points, as to_jsonb, restored with their original ids.';
COMMENT ON COLUMN public.demo_sandbox_baselines.attendance IS 'Rows of attendance, as to_jsonb, restored with their original ids.';
COMMENT ON COLUMN public.demo_sandbox_baselines.honors IS 'Rows of honors, as to_jsonb, restored with their original ids.';
