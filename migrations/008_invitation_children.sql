-- Children an invitation is for
--
-- A child can turn up at a meeting before anyone in their family has an
-- account. An administrator enters the child -- name and birth date, enough to
-- take attendance and award points from the first evening -- and invites a
-- parent by email. This table remembers which children that invitation was
-- for, so that when the parent accepts they are linked to those children in the
-- same step, instead of arriving to an empty screen and entering the child a
-- second time.
--
-- An invitation may carry several children (siblings, one parent), and a child
-- is attached to at most one live invitation at a time; correcting a mistyped
-- address moves the child to the new invitation.

CREATE TABLE IF NOT EXISTS public.parent_invitation_participants (
    invitation_id uuid NOT NULL,
    participant_id integer NOT NULL,
    organization_id integer NOT NULL,
    added_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT parent_invitation_participants_pkey PRIMARY KEY (invitation_id, participant_id),
    CONSTRAINT parent_invitation_participants_invitation_id_fkey
        FOREIGN KEY (invitation_id) REFERENCES public.parent_invitations(id) ON DELETE CASCADE,
    CONSTRAINT parent_invitation_participants_participant_id_fkey
        FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON DELETE CASCADE,
    CONSTRAINT parent_invitation_participants_organization_id_fkey
        FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE,
    CONSTRAINT parent_invitation_participants_added_by_fkey
        FOREIGN KEY (added_by) REFERENCES public.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.parent_invitation_participants IS
  'Children an invitation was sent for. Accepting the invitation links the parent to each of them.';

-- "Which invitation is this child waiting on?" is the question the admin's list
-- asks for every row.
CREATE INDEX IF NOT EXISTS idx_parent_invitation_participants_participant
  ON public.parent_invitation_participants (participant_id);

-- ---------------------------------------------------------------------------
-- The permission to add a walk-in child and invite their parent
-- ---------------------------------------------------------------------------

-- Separate from participants.create on purpose. Parents hold participants.create
-- -- the registration form cannot save without it -- so gating walk-ins on it
-- would let any parent enter children and send invitations to any address.
-- Leaders run the meetings where walk-ins arrive, so they need it; they do not
-- hold users.invite, which is why this is its own key.
SELECT setval(
  pg_get_serial_sequence('public.permissions', 'id'),
  COALESCE((SELECT MAX(id) FROM public.permissions), 0) + 1,
  false
);

INSERT INTO public.permissions (permission_key, permission_name, category, description)
VALUES (
  'participants.walk_in',
  'Add Walk-in Children',
  'participants',
  'Enter a child who arrives without a registered family, and invite their parent'
)
ON CONFLICT (permission_key) DO NOTHING;

-- Granted to every role that can already both create and edit participants --
-- staff, whatever a unit named them -- rather than to role names that differ
-- between databases. Parents hold create but not edit, and are left out.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT staff.role_id, walk_in.id
  FROM (
    SELECT rp.role_id
      FROM public.role_permissions rp
      JOIN public.permissions p ON p.id = rp.permission_id
     WHERE p.permission_key IN ('participants.create', 'participants.edit')
     GROUP BY rp.role_id
    HAVING COUNT(DISTINCT p.permission_key) = 2
  ) staff
 CROSS JOIN public.permissions walk_in
 WHERE walk_in.permission_key = 'participants.walk_in'
ON CONFLICT (role_id, permission_id) DO NOTHING;
