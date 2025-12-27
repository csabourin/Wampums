-- Migration: Add Data Scope to Roles
-- Description: Adds data_scope column to roles table to distinguish organization-wide vs linked-only access
-- Author: Claude Code
-- Date: 2025-12-27
--
-- TECHNICAL DEBT FIX:
-- This migration addresses the critical technical debt where role names are hardcoded
-- throughout the application to determine data access scope.
--
-- Before: Hardcoded role checks like:
--   const staffRoles = ['district', 'unitadmin', 'leader', 'admin', 'animation', 'demoadmin'];
--   const hasStaffRole = userRoles.some(role => staffRoles.includes(role));
--
-- After: Database-driven data scope:
--   const dataScope = await getUserDataScope(req, pool);
--   if (dataScope === 'organization') { /* show all participants */ }
--
-- Data Scopes:
-- - 'organization': User can see ALL data in their organization
-- - 'linked': User can only see data they're explicitly linked to (e.g., parents → children)
--
-- ==========================================
-- UP MIGRATION
-- ==========================================

-- Add data_scope column to roles table
ALTER TABLE roles
ADD COLUMN IF NOT EXISTS data_scope VARCHAR(50) DEFAULT 'organization';

-- Add comment for documentation
COMMENT ON COLUMN roles.data_scope IS 'Data access scope: ''organization'' (all data) or ''linked'' (linked data only)';

-- Update existing roles with appropriate data scopes
-- Organization-wide access (staff roles)
UPDATE roles
SET data_scope = 'organization'
WHERE role_name IN (
  'district',
  'unitadmin',
  'leader',
  'finance',
  'equipment',
  'administration',
  'admin',         -- Legacy role
  'animation',     -- Legacy role
  'demoadmin'
);

-- Linked-only access (parent roles)
UPDATE roles
SET data_scope = 'linked'
WHERE role_name IN (
  'parent',
  'demoparent'
);

-- Create index for faster data scope queries
CREATE INDEX IF NOT EXISTS idx_roles_data_scope ON roles(data_scope);

-- Verify the migration was successful
DO $$
DECLARE
  org_count INTEGER;
  linked_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO org_count FROM roles WHERE data_scope = 'organization';
  SELECT COUNT(*) INTO linked_count FROM roles WHERE data_scope = 'linked';

  RAISE NOTICE 'Data scope migration complete:';
  RAISE NOTICE '  - % roles with organization scope', org_count;
  RAISE NOTICE '  - % roles with linked scope', linked_count;

  -- Ensure no roles have NULL data_scope
  IF EXISTS (SELECT 1 FROM roles WHERE data_scope IS NULL) THEN
    RAISE EXCEPTION 'ERROR: Found roles with NULL data_scope. All roles must have a data scope.';
  END IF;
END $$;

-- ==========================================
-- DOWN MIGRATION (for rollback)
-- ==========================================
-- Note: Uncomment to rollback this migration
--
-- DROP INDEX IF EXISTS idx_roles_data_scope;
-- ALTER TABLE roles DROP COLUMN IF EXISTS data_scope;
