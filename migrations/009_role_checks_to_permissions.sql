-- Access checks that named roles now ask for permissions instead.
--
-- Before this release, a handful of screens and routes let someone through
-- because their role was *called* 'district', 'unitadmin', 'leader', ... A
-- custom role holding the same permissions was refused, and a renamed role
-- lost its access. Those checks now ask for a permission. So that nobody who
-- had access loses it, each permission is granted here to exactly the roles
-- whose names the old checks accepted. Roles that do not exist are skipped.
--
--   forms.manage          form permissions screen and API        district, unitadmin
--   org.create            creating a unit                        district
--   users.assign_district seeing the district role to assign it  district
--   carpools.manage       assigning any child to a carpool       district, unitadmin, leader, admin, animation
--   finance.view          a child's finance statement            district, unitadmin, finance, administration, demoadmin
--
-- Only role_permissions rows are inserted; the permissions already exist.

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM (VALUES
  ('forms.manage', 'district'),
  ('forms.manage', 'unitadmin'),
  ('org.create', 'district'),
  ('users.assign_district', 'district'),
  ('carpools.manage', 'district'),
  ('carpools.manage', 'unitadmin'),
  ('carpools.manage', 'leader'),
  ('carpools.manage', 'admin'),
  ('carpools.manage', 'animation'),
  ('finance.view', 'district'),
  ('finance.view', 'unitadmin'),
  ('finance.view', 'finance'),
  ('finance.view', 'administration'),
  ('finance.view', 'demoadmin')
) AS grants (permission_key, role_name)
JOIN roles r ON r.role_name = grants.role_name
JOIN permissions p ON p.permission_key = grants.permission_key
ON CONFLICT (role_id, permission_id) DO NOTHING;
