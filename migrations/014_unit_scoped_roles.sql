-- Roles belong to a unit.
--
-- Until now the roles catalog was shared by every unit: a custom role created
-- in one unit appeared, and could be assigned or edited, in all of them, and
-- editing a built-in role changed it everywhere. From here on:
--
--   * Built-in roles (organization_id IS NULL, is_system_role) are shared by all
--     units and read-only to them; they change only through migrations.
--   * A custom role belongs to exactly one unit (roles.organization_id). Other
--     units cannot see, assign, or edit it, and it is deleted with its unit.
--
-- Existing custom roles are given to the unit that uses them -- through its
-- members' role_ids or its forms' permissions. A custom role used by several
-- units stays with the first and is copied for each of the others, permissions
-- included, with that unit's members and form permissions pointed at the copy,
-- so nobody loses access. A custom role no unit uses keeps no owner and is no
-- longer listed anywhere.
--
-- is_system_role defaults to false, so the built-in roles are marked here by
-- name before anything is split; a built-in left unmarked would be copied
-- into every unit.

ALTER TABLE public.roles
  ADD COLUMN IF NOT EXISTS organization_id INTEGER
    REFERENCES public.organizations(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_roles_organization_id ON public.roles (organization_id);

UPDATE public.roles
   SET is_system_role = TRUE
 WHERE role_name IN (
         'district', 'unitadmin', 'leader', 'parent', 'finance', 'equipment',
         'administration', 'demoadmin', 'demoparent', 'admin', 'animation'
       )
   AND is_system_role IS DISTINCT FROM TRUE;

-- Like permissions, roles may have been loaded with explicit ids while the
-- sequence stayed behind; the copies below would then collide.
SELECT setval(
  pg_get_serial_sequence('public.roles', 'id'),
  COALESCE((SELECT MAX(id) FROM public.roles), 0) + 1,
  false
);

DO $$
DECLARE
  custom RECORD;
  unit INTEGER;
  is_first_unit BOOLEAN;
  copy_id INTEGER;
BEGIN
  FOR custom IN
    SELECT id, role_name, display_name, description, data_scope
      FROM public.roles
     WHERE is_system_role IS DISTINCT FROM TRUE
       AND organization_id IS NULL
     ORDER BY id
  LOOP
    is_first_unit := TRUE;

    FOR unit IN
      SELECT uo.organization_id
        FROM public.user_organizations uo
       WHERE jsonb_typeof(uo.role_ids) = 'array'
         AND EXISTS (
               SELECT 1 FROM jsonb_array_elements_text(uo.role_ids) AS held(role_id)
                WHERE held.role_id = custom.id::text
             )
      UNION
      SELECT off.organization_id
        FROM public.form_permissions fp
        JOIN public.organization_form_formats off ON off.id = fp.form_format_id
       WHERE fp.role_id = custom.id
      ORDER BY 1
    LOOP
      IF is_first_unit THEN
        UPDATE public.roles SET organization_id = unit WHERE id = custom.id;
        is_first_unit := FALSE;
        CONTINUE;
      END IF;

      INSERT INTO public.roles (role_name, display_name, description, data_scope, is_system_role, organization_id)
      VALUES (
        left(custom.role_name, 30) || '_u' || unit || '_' || custom.id,
        custom.display_name,
        custom.description,
        custom.data_scope,
        FALSE,
        unit
      )
      RETURNING id INTO copy_id;

      INSERT INTO public.role_permissions (role_id, permission_id)
      SELECT copy_id, rp.permission_id
        FROM public.role_permissions rp
       WHERE rp.role_id = custom.id
      ON CONFLICT (role_id, permission_id) DO NOTHING;

      UPDATE public.user_organizations uo
         SET role_ids = (
               SELECT jsonb_agg(
                        CASE WHEN held.role_id #>> '{}' = custom.id::text THEN to_jsonb(copy_id) ELSE held.role_id END
                        ORDER BY held.position
                      )
                 FROM jsonb_array_elements(uo.role_ids) WITH ORDINALITY AS held(role_id, position)
             )
       WHERE uo.organization_id = unit
         AND jsonb_typeof(uo.role_ids) = 'array'
         AND EXISTS (
               SELECT 1 FROM jsonb_array_elements_text(uo.role_ids) AS held(role_id)
                WHERE held.role_id = custom.id::text
             );

      UPDATE public.form_permissions fp
         SET role_id = copy_id
        FROM public.organization_form_formats off
       WHERE off.id = fp.form_format_id
         AND off.organization_id = unit
         AND fp.role_id = custom.id;
    END LOOP;
  END LOOP;
END
$$;
