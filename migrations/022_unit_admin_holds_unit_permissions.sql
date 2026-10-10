-- The unit administrator holds every permission of the unit, now and later.
--
-- The built-in unitadmin role ("Gestion d'unité") is meant to have every right
-- over its unit, but it held a hand-picked list: each permission added since
-- (medication, announcements, resources, guardians, honors, ...) had to be
-- given to it separately, and many never were. Because someone may grant only
-- the permissions they hold (013), a unit administrator could then neither
-- use nor hand out those rights.
--
-- Like district (016), unitadmin is now given its permissions by a mark rather
-- than a list: roles.grants_unit_permissions. A role so marked holds every
-- permission except those that reach beyond one unit, which are marked
-- permissions.district_only: creating or deleting units and handing out the
-- district role. District keeps every permission, district_only included, so
-- only district can grant all rights.
--
-- The trigger from 016 gives each permission created later to the roles that
-- should hold it, so a new feature reaches unit administrators by itself.
--
-- The built-in staff roles also read the whole unit (data_scope
-- 'organization'): a parent who becomes a leader keeps their parent role for
-- their own children, and the leader role is what opens the unit to them.

ALTER TABLE public.permissions
  ADD COLUMN IF NOT EXISTS district_only BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.permissions.district_only IS
  'The permission reaches beyond one unit (creating units, granting the district role). Roles marked grants_unit_permissions do not receive it.';

UPDATE public.permissions
   SET district_only = TRUE
 WHERE permission_key IN ('org.create', 'org.delete', 'users.assign_district')
   AND district_only = FALSE;

ALTER TABLE public.roles
  ADD COLUMN IF NOT EXISTS grants_unit_permissions BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.roles.grants_unit_permissions IS
  'The role holds every permission that is not district_only: all existing ones, and each new one through trigger permissions_grant_to_all_permission_roles.';

UPDATE public.roles
   SET grants_unit_permissions = TRUE
 WHERE role_name = 'unitadmin'
   AND organization_id IS NULL
   AND grants_unit_permissions = FALSE;

UPDATE public.roles
   SET data_scope = 'organization'
 WHERE role_name IN ('district', 'unitadmin', 'leader')
   AND organization_id IS NULL
   AND data_scope IS DISTINCT FROM 'organization';

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM public.roles r
 CROSS JOIN public.permissions p
 WHERE r.grants_unit_permissions
   AND NOT p.district_only
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
      OR (r.grants_unit_permissions AND NOT NEW.district_only)
  ON CONFLICT (role_id, permission_id) DO NOTHING;
  RETURN NEW;
END;
$$;
