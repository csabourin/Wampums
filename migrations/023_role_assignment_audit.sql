-- History of changes to a member's roles.
--
-- The district Units tab shows, for each member, who changed their roles,
-- when, and why. Nothing recorded those changes: the screen asked an endpoint
-- that did not exist and showed "could not load the audit history" for
-- everyone. Each change made through the role assignment endpoints now writes
-- one row here, in the same transaction as the change.
--
-- Roles are stored as they were at the time (id, role_name, display_name), so
-- the history stays readable after a custom role is renamed or deleted.
-- Removing the member or the unit removes their history; removing the person
-- who made the change keeps the row without its author.

CREATE TABLE IF NOT EXISTS public.role_assignment_audit (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  changed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  previous_roles JSONB NOT NULL DEFAULT '[]'::jsonb,
  new_roles JSONB NOT NULL DEFAULT '[]'::jsonb,
  note TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT role_assignment_audit_note_length CHECK (note IS NULL OR char_length(note) <= 500)
);

COMMENT ON TABLE public.role_assignment_audit IS
  'One row per change to a member''s roles in a unit: who made it, when, the roles before and after (as they were then), and an optional note.';

CREATE INDEX IF NOT EXISTS idx_role_assignment_audit_member
  ON public.role_assignment_audit (organization_id, user_id, created_at DESC);
