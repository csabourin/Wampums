-- Permissions the code checks but that no committed migration created.
--
-- Routes and screens require these keys, yet a database built from the
-- repository (the schema baseline, the permission catalog and every
-- migration) had none of them, so nobody could reach incident reports,
-- scout years, unit settings or erasure there. Where a database already
-- holds a key, nothing changes.
--
-- The district role receives each new permission through its trigger
-- (migration 016). No other role is granted any here: who may read
-- incident reports or erase a child is the unit's decision, made under
-- Role management.

-- The catalog was loaded with explicit ids while its sequence stayed behind.
SELECT setval(
  pg_get_serial_sequence('public.permissions', 'id'),
  COALESCE((SELECT MAX(id) FROM public.permissions), 0) + 1,
  false
);

INSERT INTO public.permissions (permission_key, permission_name, category, description)
VALUES
  ('incidents.view', 'View Incident Reports', 'incidents', 'Read the unit''s incident reports'),
  ('incidents.manage', 'Manage Incident Reports', 'incidents', 'Write, edit, submit and delete incident reports'),
  ('scout_year.view', 'View Scout Years', 'scout_year', 'See the unit''s scout years and past transitions'),
  ('scout_year.manage', 'Manage Scout Years', 'scout_year', 'Start a new scout year, roll back a transition and manage memberships'),
  ('organization.manage', 'Manage Unit Settings', 'organization', 'Change the unit''s settings'),
  ('participants.erase', 'Erase Participants', 'participants', 'Permanently erase a child and the data held about them'),
  ('activities.manage', 'Manage Activities', 'activities', 'Full activity management access')
ON CONFLICT (permission_key) DO NOTHING;
