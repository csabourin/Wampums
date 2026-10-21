-- The demo unit opens without a password.
--
-- demo.wampums.app shows a read-only unit to people discovering Wampums. Its
-- sign-in page now offers a choice between the parent view and the leader
-- view instead of an email and a password (POST /api/v1/auth/demo-login),
-- which signs in to the unit's demo account for that view.
--
-- Only a unit whose demo_sign_in setting is true opens this way. A real unit
-- may also hold demo accounts (demoadmin, demoparent) to show its own data,
-- and those must still take a password.

INSERT INTO public.organization_settings (organization_id, setting_key, setting_value)
SELECT DISTINCT od.organization_id, 'demo_sign_in', 'true'::jsonb
FROM public.organization_domains od
WHERE lower(od.domain) = 'demo.wampums.app'
  AND od.organization_id IS NOT NULL
ON CONFLICT (organization_id, setting_key) DO NOTHING;
