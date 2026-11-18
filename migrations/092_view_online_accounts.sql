-- Administrators see how many accounts of their unit are online right now.
--
-- The dashboard's top banner shows the count, live, to whoever holds
-- users.view_online. Like every new permission, the trigger from 016/022 gives
-- it to district and to the unit administrator (grants_unit_permissions); a
-- unit may grant it to another role from the permission matrix.

SELECT setval(pg_get_serial_sequence('public.permissions', 'id'),
  COALESCE((SELECT MAX(id) FROM public.permissions), 0) + 1, false);
INSERT INTO public.permissions (permission_key, permission_name, category, description)
VALUES
  ('users.view_online', 'See accounts online', 'users',
   'See, live, how many accounts of the unit are using the app right now')
ON CONFLICT (permission_key) DO NOTHING;
