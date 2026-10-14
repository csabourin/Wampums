-- Inviting leaders, not only families.
--
-- An invitation used to make its recipient a parent of the unit. A unit's
-- team can now invite a leader the same way: the invitation carries the roles
-- the person will hold once they accept, chosen by someone allowed to grant
-- them (services/roleAssignment.js checks it when the invitation is made).
-- NULL, as for every invitation made before, means a family invitation.
--
-- A leader's invitation creates no guardian contact record and links no
-- children: the person joins the unit's team, and may still be linked to
-- their own children like any other member.

ALTER TABLE public.parent_invitations
  ADD COLUMN IF NOT EXISTS role_ids jsonb;

COMMENT ON COLUMN public.parent_invitations.role_ids IS
  'Roles (ids, a JSON array) the person receives on accepting a leader invitation. NULL for a family invitation, which grants the parent role.';
