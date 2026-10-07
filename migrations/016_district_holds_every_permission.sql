-- The district role holds every permission, now and later.
--
-- Since 013, someone may grant only the permissions they hold. District
-- administrators were refused the leader and finance roles in production:
-- permissions had been added over time -- by migrations and outside the
-- repository -- to particular roles but never to district, so the district
-- role no longer covered what it is meant to cover.
--
-- Rather than list today's missing permissions, a role can now be marked
-- roles.grants_all_permissions. Such a role is given every permission that
-- exists, and a trigger gives it each permission created afterwards, whether
-- by a migration, a script, or by hand. The built-in district role is the only
-- one marked; built-in roles are read-only to units, so the mark cannot be set
-- or its permissions removed through the application.

ALTER TABLE public.roles
  ADD COLUMN IF NOT EXISTS grants_all_permissions BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.roles.grants_all_permissions IS
  'The role holds every permission: all existing ones, and each new one through trigger permissions_grant_to_all_permission_roles.';

UPDATE public.roles
   SET grants_all_permissions = TRUE
 WHERE role_name = 'district'
   AND organization_id IS NULL
   AND grants_all_permissions = FALSE;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM public.roles r
 CROSS JOIN public.permissions p
 WHERE r.grants_all_permissions
ON CONFLICT (role_id, permission_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.grant_permission_to_all_permission_roles()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, NEW.id
    FROM public.roles r
   WHERE r.grants_all_permissions
  ON CONFLICT (role_id, permission_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS permissions_grant_to_all_permission_roles ON public.permissions;

CREATE TRIGGER permissions_grant_to_all_permission_roles
  AFTER INSERT ON public.permissions
  FOR EACH ROW
  EXECUTE FUNCTION public.grant_permission_to_all_permission_roles();
