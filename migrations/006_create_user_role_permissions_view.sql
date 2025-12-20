-- Migration: Create user role and permission summary view
-- Description: Adds a consolidated view of user full names, role names, and permission keys per organization
-- This migration is idempotent and can be run multiple times safely

DROP VIEW IF EXISTS user_role_permissions_summary;

CREATE OR REPLACE VIEW user_role_permissions_summary AS
SELECT
    uo.organization_id,
    u.id AS user_id,
    u.full_name,
    COALESCE(
        ARRAY(
            SELECT DISTINCT role_name
            FROM (
                SELECT r.role_name
                FROM jsonb_array_elements_text(COALESCE(uo.role_ids, '[]'::jsonb)) AS role_id_text(role_id)
                JOIN roles r ON r.id = role_id_text.role_id::integer
                UNION ALL
                SELECT uo.role
            ) AS role_list(role_name)
            WHERE role_name IS NOT NULL
            ORDER BY role_name
        ),
        ARRAY[]::text[]
    ) AS roles,
    COALESCE(
        ARRAY(
            SELECT DISTINCT p.permission_key
            FROM jsonb_array_elements_text(COALESCE(uo.role_ids, '[]'::jsonb)) AS role_id_text(role_id)
            JOIN role_permissions rp ON rp.role_id = role_id_text.role_id::integer
            JOIN permissions p ON p.id = rp.permission_id
            ORDER BY p.permission_key
        ),
        ARRAY[]::text[]
    ) AS permissions
FROM users u
JOIN user_organizations uo ON u.id = uo.user_id;

COMMENT ON VIEW user_role_permissions_summary IS
    'Summarizes each user''s full name, role names, and aggregated permission keys by organization';
