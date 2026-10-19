-- A role that can manage a resource must also be able to view it. Repair
-- existing role grants where both catalog entries exist; the role API keeps
-- the pair together for future changes.

INSERT INTO role_permissions (role_id, permission_id)
SELECT manage_grant.role_id, view_permission.id
  FROM role_permissions manage_grant
  JOIN permissions manage_permission ON manage_permission.id = manage_grant.permission_id
  JOIN permissions view_permission
    ON view_permission.permission_key = regexp_replace(manage_permission.permission_key, '\.manage$', '.view')
 WHERE manage_permission.permission_key LIKE '%.manage'
ON CONFLICT DO NOTHING;
