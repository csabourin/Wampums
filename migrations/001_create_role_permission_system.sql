-- Migration: Create Role-Based Permission System
-- Description: Replaces hardcoded role checks with flexible permission-based system
-- Author: Claude AI
-- Date: 2025-12-19

-- ============================================================================
-- STEP 1: Create Tables
-- ============================================================================

-- Roles table: Defines available roles in the system
CREATE TABLE IF NOT EXISTS roles (
    id SERIAL PRIMARY KEY,
    role_name VARCHAR(50) UNIQUE NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    description TEXT,
    is_system_role BOOLEAN DEFAULT false, -- System roles cannot be deleted
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Permissions table: Defines granular permissions
CREATE TABLE IF NOT EXISTS permissions (
    id SERIAL PRIMARY KEY,
    permission_key VARCHAR(100) UNIQUE NOT NULL, -- e.g., 'finance.view', 'org.create'
    permission_name VARCHAR(100) NOT NULL,
    category VARCHAR(50) NOT NULL, -- e.g., 'finance', 'users', 'org'
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Role-Permission junction table (many-to-many)
CREATE TABLE IF NOT EXISTS role_permissions (
    role_id INTEGER REFERENCES roles(id) ON DELETE CASCADE,
    permission_id INTEGER REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission ON role_permissions(permission_id);
CREATE INDEX IF NOT EXISTS idx_permissions_category ON permissions(category);
CREATE INDEX IF NOT EXISTS idx_permissions_key ON permissions(permission_key);

-- ============================================================================
-- STEP 2: Backup existing user_organizations data
-- ============================================================================

-- Create backup table before modifying structure
CREATE TABLE IF NOT EXISTS user_organizations_backup AS
SELECT * FROM user_organizations;

-- ============================================================================
-- STEP 3: Modify user_organizations table
-- ============================================================================

-- Add new role_ids column (JSONB array of role IDs)
ALTER TABLE user_organizations
ADD COLUMN IF NOT EXISTS role_ids JSONB DEFAULT '[]'::jsonb;

-- Keep the old 'role' column temporarily for migration
-- We'll drop it after migration is complete

-- ============================================================================
-- STEP 4: Seed Roles
-- ============================================================================

INSERT INTO roles (role_name, display_name, description, is_system_role) VALUES
    ('district', 'District Administrator', 'Full system access including organization creation and all administrative functions', true),
    ('unitadmin', 'Unit Administrator', 'Full organizational access except organization creation and district role assignment', true),
    ('leader', 'Leader', 'Group leaders with access to most organizational features', true),
    ('parent', 'Parent/Guardian', 'Parents with limited access to their own children''s information', true),
    ('finance', 'Finance Manager', 'Access to all financial features including budget, fundraisers, and inventory values', true),
    ('equipment', 'Equipment Manager', 'Manages inventory and equipment reservations', true),
    ('administration', 'Administration', 'Access to all reports and administrative analytics', true),
    ('demoadmin', 'Demo Administrator', 'Read-only administrator for demonstration purposes', true),
    ('demoparent', 'Demo Parent', 'Read-only parent for demonstration purposes', true)
ON CONFLICT (role_name) DO NOTHING;

-- ============================================================================
-- STEP 5: Seed Permissions
-- ============================================================================

-- Organization Permissions
INSERT INTO permissions (permission_key, permission_name, category, description) VALUES
    ('org.create', 'Create Organizations', 'organization', 'Create new organizations in the system'),
    ('org.view', 'View Organization', 'organization', 'View organization details'),
    ('org.edit', 'Edit Organization', 'organization', 'Edit organization settings'),
    ('org.delete', 'Delete Organization', 'organization', 'Delete organizations'),

-- User Management Permissions
    ('users.view', 'View Users', 'users', 'View user lists and details'),
    ('users.invite', 'Invite Users', 'users', 'Invite new users to the organization'),
    ('users.edit', 'Edit Users', 'users', 'Edit user information and settings'),
    ('users.delete', 'Delete Users', 'users', 'Remove users from the organization'),
    ('users.assign_roles', 'Assign Roles', 'users', 'Assign roles to users'),
    ('users.assign_district', 'Assign District Role', 'users', 'Assign district administrator role to users'),

-- Participant Management Permissions
    ('participants.view', 'View Participants', 'participants', 'View participant lists and details'),
    ('participants.create', 'Create Participants', 'participants', 'Add new participants'),
    ('participants.edit', 'Edit Participants', 'participants', 'Edit participant information'),
    ('participants.delete', 'Delete Participants', 'participants', 'Remove participants'),
    ('participants.transfer', 'Transfer Participants', 'participants', 'Transfer participants between groups'),

-- Finance Permissions
    ('finance.view', 'View Finances', 'finance', 'View financial information and reports'),
    ('finance.manage', 'Manage Finances', 'finance', 'Manage financial transactions and settings'),
    ('finance.approve', 'Approve Payments', 'finance', 'Approve and process payments'),

-- Budget Permissions
    ('budget.view', 'View Budget', 'budget', 'View budget information'),
    ('budget.manage', 'Manage Budget', 'budget', 'Create and edit budgets'),

-- Fundraiser Permissions
    ('fundraisers.view', 'View Fundraisers', 'fundraisers', 'View fundraiser information'),
    ('fundraisers.create', 'Create Fundraisers', 'fundraisers', 'Create new fundraisers'),
    ('fundraisers.edit', 'Edit Fundraisers', 'fundraisers', 'Edit fundraiser details'),
    ('fundraisers.delete', 'Delete Fundraisers', 'fundraisers', 'Remove fundraisers'),

-- Inventory/Equipment Permissions
    ('inventory.view', 'View Inventory', 'inventory', 'View equipment and inventory'),
    ('inventory.manage', 'Manage Inventory', 'inventory', 'Add, edit, and remove inventory items'),
    ('inventory.reserve', 'Reserve Equipment', 'inventory', 'Reserve equipment for activities'),
    ('inventory.value', 'View Inventory Values', 'inventory', 'View monetary values of inventory'),

-- Badge Permissions
    ('badges.view', 'View Badges', 'badges', 'View badge information and progress'),
    ('badges.approve', 'Approve Badges', 'badges', 'Approve badge completions'),
    ('badges.manage', 'Manage Badges', 'badges', 'Create and configure badges'),

-- Activity Permissions
    ('activities.view', 'View Activities', 'activities', 'View activities and events'),
    ('activities.create', 'Create Activities', 'activities', 'Create new activities'),
    ('activities.edit', 'Edit Activities', 'activities', 'Edit activity details'),
    ('activities.delete', 'Delete Activities', 'activities', 'Remove activities'),

-- Attendance Permissions
    ('attendance.view', 'View Attendance', 'attendance', 'View attendance records'),
    ('attendance.manage', 'Manage Attendance', 'attendance', 'Record and edit attendance'),

-- Points/Honors Permissions
    ('points.view', 'View Points', 'points', 'View points and honors'),
    ('points.manage', 'Manage Points', 'points', 'Award and manage points'),

-- Carpool Permissions
    ('carpools.view', 'View Carpools', 'carpools', 'View carpool information'),
    ('carpools.manage', 'Manage Carpools', 'carpools', 'Create and manage carpool arrangements'),

-- Report Permissions
    ('reports.view', 'View Reports', 'reports', 'Access all system reports'),
    ('reports.export', 'Export Reports', 'reports', 'Export reports to various formats'),

-- Group Management Permissions
    ('groups.view', 'View Groups', 'groups', 'View group information'),
    ('groups.create', 'Create Groups', 'groups', 'Create new groups'),
    ('groups.edit', 'Edit Groups', 'groups', 'Edit group details'),
    ('groups.delete', 'Delete Groups', 'groups', 'Remove groups'),

-- Communication Permissions
    ('communications.send', 'Send Communications', 'communications', 'Send messages to parents and participants'),

-- Role Management Permissions
    ('roles.view', 'View Roles', 'roles', 'View available roles and permissions'),
    ('roles.manage', 'Manage Roles', 'roles', 'Create and edit custom roles')

ON CONFLICT (permission_key) DO NOTHING;

-- ============================================================================
-- STEP 6: Assign Permissions to Roles
-- ============================================================================

-- Helper function to assign all permissions in a category to a role
CREATE OR REPLACE FUNCTION assign_permissions_by_category(
    p_role_name VARCHAR,
    p_category VARCHAR
) RETURNS void AS $$
BEGIN
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT r.id, p.id
    FROM roles r
    CROSS JOIN permissions p
    WHERE r.role_name = p_role_name
    AND p.category = p_category
    ON CONFLICT DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- Helper function to assign specific permission to a role
CREATE OR REPLACE FUNCTION assign_permission(
    p_role_name VARCHAR,
    p_permission_key VARCHAR
) RETURNS void AS $$
BEGIN
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT r.id, p.id
    FROM roles r
    CROSS JOIN permissions p
    WHERE r.role_name = p_role_name
    AND p.permission_key = p_permission_key
    ON CONFLICT DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- DISTRICT: Full access to everything
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'district'
ON CONFLICT DO NOTHING;

-- UNITADMIN: Everything except org.create and users.assign_district
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'unitadmin'
AND p.permission_key NOT IN ('org.create', 'users.assign_district')
ON CONFLICT DO NOTHING;

-- LEADER: Similar to old 'animation' role - most organizational features
SELECT assign_permissions_by_category('leader', 'participants');
SELECT assign_permissions_by_category('leader', 'activities');
SELECT assign_permissions_by_category('leader', 'attendance');
SELECT assign_permissions_by_category('leader', 'points');
SELECT assign_permissions_by_category('leader', 'carpools');
SELECT assign_permissions_by_category('leader', 'groups');
SELECT assign_permissions_by_category('leader', 'communications');
SELECT assign_permission('leader', 'users.view');
SELECT assign_permission('leader', 'badges.view');
SELECT assign_permission('leader', 'badges.approve');
SELECT assign_permission('leader', 'finance.view');
SELECT assign_permission('leader', 'inventory.view');
SELECT assign_permission('leader', 'org.view');

-- PARENT: Limited access to own children's information
SELECT assign_permission('parent', 'participants.view');
SELECT assign_permission('parent', 'activities.view');
SELECT assign_permission('parent', 'badges.view');
SELECT assign_permission('parent', 'finance.view');
SELECT assign_permission('parent', 'carpools.view');
SELECT assign_permission('parent', 'carpools.manage');
SELECT assign_permission('parent', 'attendance.view');
SELECT assign_permission('parent', 'points.view');

-- FINANCE: Finance, fundraisers, budget, inventory values (no badges)
SELECT assign_permissions_by_category('finance', 'finance');
SELECT assign_permissions_by_category('finance', 'budget');
SELECT assign_permissions_by_category('finance', 'fundraisers');
SELECT assign_permission('finance', 'inventory.view');
SELECT assign_permission('finance', 'inventory.value');
SELECT assign_permission('finance', 'inventory.manage');
SELECT assign_permission('finance', 'participants.view');
SELECT assign_permission('finance', 'users.view');
SELECT assign_permission('finance', 'org.view');
SELECT assign_permission('finance', 'reports.view');
SELECT assign_permission('finance', 'reports.export');

-- EQUIPMENT: Inventory management only
SELECT assign_permissions_by_category('equipment', 'inventory');
SELECT assign_permission('equipment', 'activities.view');
SELECT assign_permission('equipment', 'org.view');

-- ADMINISTRATION: All reports
SELECT assign_permissions_by_category('administration', 'reports');
SELECT assign_permission('administration', 'participants.view');
SELECT assign_permission('administration', 'users.view');
SELECT assign_permission('administration', 'activities.view');
SELECT assign_permission('administration', 'attendance.view');
SELECT assign_permission('administration', 'finance.view');
SELECT assign_permission('administration', 'badges.view');
SELECT assign_permission('administration', 'points.view');
SELECT assign_permission('administration', 'groups.view');
SELECT assign_permission('administration', 'org.view');

-- DEMOADMIN: Read-only admin (all view permissions, no manage/create/edit/delete)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'demoadmin'
AND p.permission_key LIKE '%.view'
ON CONFLICT DO NOTHING;

-- DEMOPARENT: Read-only parent (same view permissions as parent)
SELECT assign_permission('demoparent', 'participants.view');
SELECT assign_permission('demoparent', 'activities.view');
SELECT assign_permission('demoparent', 'badges.view');
SELECT assign_permission('demoparent', 'finance.view');
SELECT assign_permission('demoparent', 'carpools.view');
SELECT assign_permission('demoparent', 'attendance.view');
SELECT assign_permission('demoparent', 'points.view');

-- ============================================================================
-- STEP 7: Migrate Existing Users
-- ============================================================================

-- Create temporary function to get role ID by name
CREATE OR REPLACE FUNCTION get_role_id(p_role_name VARCHAR)
RETURNS INTEGER AS $$
    SELECT id FROM roles WHERE role_name = p_role_name LIMIT 1;
$$ LANGUAGE SQL;

-- Migrate: 'admin' -> 'district'
UPDATE user_organizations
SET role_ids = jsonb_build_array(get_role_id('district'))
WHERE role = 'admin';

-- Migrate: 'animation' -> 'leader'
UPDATE user_organizations
SET role_ids = jsonb_build_array(get_role_id('leader'))
WHERE role = 'animation';

-- Migrate: 'parent' -> 'parent' (stays the same)
UPDATE user_organizations
SET role_ids = jsonb_build_array(get_role_id('parent'))
WHERE role = 'parent';

-- Migrate: 'leader' -> 'leader' (if any exist)
UPDATE user_organizations
SET role_ids = jsonb_build_array(get_role_id('leader'))
WHERE role = 'leader';

-- Handle any unmapped roles (set to parent as default)
UPDATE user_organizations
SET role_ids = jsonb_build_array(get_role_id('parent'))
WHERE role_ids = '[]'::jsonb OR role_ids IS NULL;

-- ============================================================================
-- STEP 8: Clean up and finalize
-- ============================================================================

-- Drop the old 'role' column (keep for now, will drop in a future migration after verification)
-- ALTER TABLE user_organizations DROP COLUMN role;

-- Drop helper functions
DROP FUNCTION IF EXISTS assign_permissions_by_category(VARCHAR, VARCHAR);
DROP FUNCTION IF EXISTS assign_permission(VARCHAR, VARCHAR);
DROP FUNCTION IF EXISTS get_role_id(VARCHAR);

-- Create view for easy permission checking
CREATE OR REPLACE VIEW user_permissions AS
SELECT
    uo.user_id,
    uo.organization_id,
    r.role_name,
    r.display_name as role_display_name,
    p.permission_key,
    p.permission_name,
    p.category as permission_category
FROM user_organizations uo
CROSS JOIN LATERAL jsonb_array_elements_text(uo.role_ids) AS role_id_text
JOIN roles r ON r.id = role_id_text::integer
JOIN role_permissions rp ON rp.role_id = r.id
JOIN permissions p ON p.id = rp.permission_id;

-- Create index on role_ids for better query performance
CREATE INDEX IF NOT EXISTS idx_user_organizations_role_ids ON user_organizations USING gin(role_ids);

-- Update timestamp trigger for roles table
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_roles_updated_at
    BEFORE UPDATE ON roles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Migration Complete
-- ============================================================================

-- Verification query (run separately to check results)
-- SELECT
--     uo.user_id,
--     u.email,
--     uo.organization_id,
--     uo.role as old_role,
--     uo.role_ids as new_role_ids,
--     array_agg(r.role_name) as role_names
-- FROM user_organizations uo
-- JOIN users u ON u.id = uo.user_id
-- CROSS JOIN LATERAL jsonb_array_elements_text(uo.role_ids) AS role_id_text
-- LEFT JOIN roles r ON r.id = role_id_text::integer
-- GROUP BY uo.user_id, u.email, uo.organization_id, uo.role, uo.role_ids
-- ORDER BY uo.organization_id, u.email;
