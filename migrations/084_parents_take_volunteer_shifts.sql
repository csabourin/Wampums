-- Parents take volunteer shifts.
-- The cooks, drivers and night watch at a camp are most often the youth's own parents, yet the
-- parent role could not open /volunteers: a leader had to grant each of them the volunteer role
-- first. The built-in parent role, and every unit role customized from it, now holds
-- volunteers.view (list shifts with places left, take or give up one's own place; other
-- volunteers' names are never returned without volunteers.manage) and volunteer_space.view (the
-- camps one takes part in, and no other). Neither opens a youth, family or health record.
-- The demo parent receives them too, read-only through blockDemoRoles, so the demo shows it.
-- A shift's requirements still keep a place pending until a manager verifies them, and known
-- under-14 accounts still cannot sign up (services/volunteerShifts.js).
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM public.roles r
  LEFT JOIN public.roles original ON original.id = r.customized_from_role_id
 CROSS JOIN public.permissions p
 WHERE p.permission_key IN ('volunteers.view', 'volunteer_space.view')
   AND ((r.organization_id IS NULL AND r.role_name IN ('parent', 'demoparent'))
     OR (r.organization_id IS NOT NULL AND original.organization_id IS NULL AND original.role_name = 'parent'))
ON CONFLICT DO NOTHING;
