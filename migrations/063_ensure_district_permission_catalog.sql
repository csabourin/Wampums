-- Fresh schema loads may contain no built-in roles when 016 runs. Ensure
-- district exists before enabling automatic grants, and repair existing gaps.
SELECT setval(pg_get_serial_sequence('public.roles','id'),COALESCE((SELECT MAX(id) FROM public.roles),0)+1,false);
INSERT INTO public.roles (role_name,display_name,is_system_role,data_scope,grants_all_permissions)
VALUES ('district','District',TRUE,'organization',TRUE)
ON CONFLICT (role_name) DO NOTHING;
UPDATE public.roles SET is_system_role=TRUE,data_scope='organization',grants_all_permissions=TRUE
WHERE role_name='district' AND organization_id IS NULL;
INSERT INTO public.role_permissions (role_id,permission_id)
SELECT r.id,p.id FROM public.roles r CROSS JOIN public.permissions p
WHERE r.organization_id IS NULL AND r.role_name='district'
ON CONFLICT DO NOTHING;
