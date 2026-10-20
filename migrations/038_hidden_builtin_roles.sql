-- A unit may hide a built-in role it has replaced with its own.
--
-- Once a unit customizes a built-in role ("Personnaliser" in the role
-- permission matrix), both appear wherever roles are offered: inviting a
-- leader, writing to families, assigning roles. A unit can now hide the
-- built-in one there. Hiding changes no one's rights: members who hold the
-- role keep it and its permissions; it is only no longer offered, and the
-- server refuses to grant it anew (services/roleVisibility.js).
--
-- roles.customized_from_role_id records which built-in role a unit role was
-- customized from. A built-in role may be hidden only while the unit has a
-- role customized from it; deleting that role, or changing what it replaces,
-- shows the built-in role again.

ALTER TABLE public.roles
  ADD COLUMN IF NOT EXISTS customized_from_role_id INTEGER
    REFERENCES public.roles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.roles.customized_from_role_id IS
  'For a unit role, the built-in role it was customized from and replaces in that unit. Lets the unit hide the built-in role (organization_hidden_roles).';

CREATE INDEX IF NOT EXISTS idx_roles_customized_from
  ON public.roles (organization_id, customized_from_role_id)
  WHERE customized_from_role_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.organization_hidden_roles (
  organization_id INTEGER NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  hidden_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  hidden_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, role_id)
);

COMMENT ON TABLE public.organization_hidden_roles IS
  'Built-in roles a unit no longer offers because it customized them. Members holding one keep it; it is left out of role pickers and cannot be granted anew in that unit.';
