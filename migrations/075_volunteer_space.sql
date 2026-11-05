-- Volunteer space (#1360): one page for what a member needs at the camps they take part in.
-- Access comes from taking part: a place on one of a camp's volunteer shifts, or a seat on the
-- camp's team (camp_team_members), opens that camp and no other. services/volunteerSpace.js does
-- that filtering; the key below only lets a member open the space at all.
-- Every role that may take a volunteer shift receives it: the built-in volunteer role, leaders,
-- the unit's management and the demo admin, with roles a unit customized from them. The district
-- role receives it through its trigger.
SELECT setval(pg_get_serial_sequence('public.permissions', 'id'),
  COALESCE((SELECT MAX(id) FROM public.permissions), 0) + 1, false);
INSERT INTO public.permissions (permission_key, permission_name, category, description)
VALUES ('volunteer_space.view', 'Open the volunteer space', 'volunteers',
        'See one''s own shifts, tasks, and the schedule, site and team instructions of the camps one takes part in; no youth or health record')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT rp.role_id, space.id
  FROM public.role_permissions rp
  JOIN public.permissions held ON held.id = rp.permission_id AND held.permission_key = 'volunteers.view'
 CROSS JOIN public.permissions space
 WHERE space.permission_key = 'volunteer_space.view'
ON CONFLICT DO NOTHING;
