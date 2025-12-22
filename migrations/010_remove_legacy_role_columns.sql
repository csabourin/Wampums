-- Migration: Remove legacy single-role columns
-- Description: Removes the deprecated 'role' columns from users and user_organizations tables
--              The system now uses user_organizations.role_ids (JSONB) for multi-role support
-- This migration is idempotent and can be run multiple times safely

-- Step 1: Drop the legacy role column from user_organizations table
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'user_organizations'
        AND column_name = 'role'
    ) THEN
        ALTER TABLE user_organizations DROP COLUMN role;
        RAISE NOTICE 'Dropped user_organizations.role column';
    ELSE
        RAISE NOTICE 'user_organizations.role column does not exist, skipping';
    END IF;
END $$;

-- Step 2: Drop the legacy role column from users table
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'users'
        AND column_name = 'role'
    ) THEN
        ALTER TABLE users DROP COLUMN role;
        RAISE NOTICE 'Dropped users.role column';
    ELSE
        RAISE NOTICE 'users.role column does not exist, skipping';
    END IF;
END $$;

-- Step 3: Drop the legacy role column from user_organizations_backup table if it exists
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'user_organizations_backup'
    ) THEN
        IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
            AND table_name = 'user_organizations_backup'
            AND column_name = 'role'
        ) THEN
            ALTER TABLE user_organizations_backup DROP COLUMN role;
            RAISE NOTICE 'Dropped user_organizations_backup.role column';
        END IF;
    ELSE
        RAISE NOTICE 'user_organizations_backup table does not exist, skipping';
    END IF;
END $$;

-- Step 4: Update the user_role_permissions_summary view to remove references to the old role column
DROP VIEW IF EXISTS user_role_permissions_summary;

CREATE OR REPLACE VIEW user_role_permissions_summary AS
SELECT
    uo.organization_id,
    u.id AS user_id,
    u.full_name,
    COALESCE(
        ARRAY(
            SELECT DISTINCT r.role_name
            FROM jsonb_array_elements_text(COALESCE(uo.role_ids, '[]'::jsonb)) AS role_id_text(role_id)
            JOIN roles r ON r.id = role_id_text.role_id::integer
            WHERE r.role_name IS NOT NULL
            ORDER BY r.role_name
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
    'Summarizes each user''s full name, role names, and aggregated permission keys by organization. Updated to use only role_ids JSONB column.';

-- Verification queries (run these after migration to verify success)
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'role';
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'user_organizations' AND column_name = 'role';
-- Expected: Both should return 0 rows

RAISE NOTICE 'Migration completed successfully. Legacy role columns have been removed.';
