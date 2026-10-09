-- Parents may see the unit's activities and coordinate carpools.
--
-- The parent dashboard offers "Download activities calendar" and "Carpool
-- coordination", and the carpool routes were written for families: a parent
-- offers a ride, and assigns or removes only their own children (the
-- assignment routes check user_participants unless the caller holds
-- carpools.manage). But the parent role was never given the keys those
-- screens need, so a parent got "Insufficient permissions" on the first
-- request and could not save anything there.
--
--   activities.view   activity list, activity details, calendar (.ics) export
--   carpools.view     see offers, offer a ride, assign/remove one's own children
--
-- Assigning any child stays with carpools.manage. Only the built-in parent
-- roles are changed; the demo parent can look but blockDemoRoles still stops
-- its writes.

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM public.roles r
 CROSS JOIN public.permissions p
 WHERE r.role_name IN ('parent', 'demoparent')
   AND r.organization_id IS NULL
   AND p.permission_key IN ('activities.view', 'carpools.view')
ON CONFLICT (role_id, permission_id) DO NOTHING;
