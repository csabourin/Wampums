-- Self-scoped permissions, for the rule that someone may grant only what they hold.
--
-- Assigning a role now requires holding every permission the role carries
-- (services/roleAssignment.js). Two permissions only ever let their holder act
-- for their own children when the role is limited to linked children
-- (roles.data_scope = 'linked'):
--
--   participants.create_own   register a child into one's own family
--   permission_slips.sign     sign a permission slip for one's own child
--
-- Granting those through a linked role confers no authority over anyone else,
-- so they do not count against the person assigning it -- otherwise no unit
-- admin could make anyone a parent. In an organization-wide role they do count:
-- there, permission_slips.sign records consent for any child in the unit.
--
-- permission_slips.sign is used by routes/resources.js and the role bundles in
-- config/roles.js, but no earlier migration created it; it is created here if
-- missing. Created here, it goes to the roles config/roles.js gives it --
-- leader and parent -- since without the row nobody could sign at all. Where it
-- already existed, those roles keep whatever an administrator decided. Leaders
-- carry it, so district and unit admins -- above leaders in config/roles.js
-- ROLE_LEVELS -- receive it in either case. Without it they could not assign
-- the leader role under the new rule.

ALTER TABLE public.permissions
  ADD COLUMN IF NOT EXISTS self_scoped BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.permissions WHERE permission_key = 'permission_slips.sign') THEN
    -- The permissions catalog was loaded with explicit ids while its sequence
    -- was left behind; see 007_parent_invitation_onboarding.sql.
    PERFORM setval(
      pg_get_serial_sequence('public.permissions', 'id'),
      COALESCE((SELECT MAX(id) FROM public.permissions), 0) + 1,
      false
    );
    INSERT INTO public.permissions (permission_key, permission_name, category, description)
    VALUES (
      'permission_slips.sign',
      'Sign Permission Slips',
      'resources',
      'Sign or decline permission slips; limited to one''s own children in a linked role'
    );
    -- Only now that the permission is new: the roles that were meant to hold it.
    INSERT INTO public.role_permissions (role_id, permission_id)
    SELECT r.id, p.id
      FROM public.roles r
     CROSS JOIN public.permissions p
     WHERE r.role_name IN ('leader', 'parent')
       AND p.permission_key = 'permission_slips.sign'
    ON CONFLICT (role_id, permission_id) DO NOTHING;
  END IF;
END
$$;

UPDATE public.permissions
   SET self_scoped = TRUE
 WHERE permission_key IN ('participants.create_own', 'permission_slips.sign')
   AND self_scoped = FALSE;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM public.roles r
 CROSS JOIN public.permissions p
 WHERE r.role_name IN ('district', 'unitadmin')
   AND p.permission_key = 'permission_slips.sign'
ON CONFLICT (role_id, permission_id) DO NOTHING;
