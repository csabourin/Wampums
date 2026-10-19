-- Program leaders need to record, backfill, and approve badge progress.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM public.roles r
  JOIN public.permissions p
    ON p.permission_key IN ('badges.view', 'badges.manage', 'badges.approve')
 WHERE r.role_name IN ('leader', 'animation')
   AND r.is_system_role = TRUE
ON CONFLICT (role_id, permission_id) DO NOTHING;
