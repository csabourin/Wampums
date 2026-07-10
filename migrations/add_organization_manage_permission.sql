-- Add organization.manage permission for managing organization-wide security settings
-- This permission gates the security section in Unit Settings (e.g., disabling 2FA)

INSERT INTO permissions (permission_key, permission_name, category, description)
VALUES (
  'organization.manage',
  'Manage Organization Settings',
  'organization',
  'Manage organization-wide settings including security policies such as two-factor authentication'
)
ON CONFLICT (permission_key) DO NOTHING;

-- Grant organization.manage to unitadmin and district roles (unit/district administrators)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('unitadmin', 'district')
  AND p.permission_key = 'organization.manage'
ON CONFLICT DO NOTHING;
