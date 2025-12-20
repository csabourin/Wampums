-- Migration: Add Missing Permissions for Organization Features
-- Description: Adds permissions for forms, honors, meetings, medication, announcements, resources, and data import
-- Author: Claude AI
-- Date: 2025-12-20

-- ============================================================================
-- Add Missing Permission Categories
-- ============================================================================

-- Forms Permissions
INSERT INTO permissions (permission_key, permission_name, category, description) VALUES
    ('forms.view', 'View Forms', 'forms', 'View form submissions and structures'),
    ('forms.submit', 'Submit Forms', 'forms', 'Submit forms for participants'),
    ('forms.manage', 'Manage Forms', 'forms', 'Manage form formats and templates'),
    ('forms.create', 'Create Forms', 'forms', 'Create new form templates'),
    ('forms.edit', 'Edit Forms', 'forms', 'Edit form templates and formats'),
    ('forms.delete', 'Delete Forms', 'forms', 'Delete form templates'),

-- Honors Permissions
    ('honors.view', 'View Honors', 'honors', 'View honors and awards history'),
    ('honors.create', 'Award Honors', 'honors', 'Award honors to participants'),
    ('honors.manage', 'Manage Honors', 'honors', 'Manage honor types and settings'),

-- Meetings Permissions
    ('meetings.view', 'View Meetings', 'meetings', 'View meeting preparations and invites'),
    ('meetings.create', 'Create Meetings', 'meetings', 'Create meeting preparations'),
    ('meetings.edit', 'Edit Meetings', 'meetings', 'Edit meeting preparations'),
    ('meetings.delete', 'Delete Meetings', 'meetings', 'Delete meeting preparations'),
    ('meetings.manage', 'Manage Meetings', 'meetings', 'Full meeting management access'),

-- Medication Permissions
    ('medication.view', 'View Medication', 'medication', 'View medication requirements and distributions'),
    ('medication.manage', 'Manage Medication', 'medication', 'Manage medication requirements and distributions'),
    ('medication.distribute', 'Distribute Medication', 'medication', 'Record medication distributions'),

-- Announcements Permissions
    ('announcements.view', 'View Announcements', 'announcements', 'View announcements'),
    ('announcements.create', 'Create Announcements', 'announcements', 'Create new announcements'),
    ('announcements.edit', 'Edit Announcements', 'announcements', 'Edit announcements'),
    ('announcements.delete', 'Delete Announcements', 'announcements', 'Delete announcements'),
    ('announcements.manage', 'Manage Announcements', 'announcements', 'Full announcement management access'),

-- Resources Permissions
    ('resources.view', 'View Resources', 'resources', 'View shared resources and files'),
    ('resources.create', 'Create Resources', 'resources', 'Upload new resources'),
    ('resources.edit', 'Edit Resources', 'resources', 'Edit resource information'),
    ('resources.delete', 'Delete Resources', 'resources', 'Delete resources'),
    ('resources.manage', 'Manage Resources', 'resources', 'Full resource management access'),

-- Data Import/Export Permissions
    ('data.import', 'Import Data', 'data', 'Import external data into the system'),
    ('data.export', 'Export Data', 'data', 'Export system data'),

-- Notifications Permissions
    ('notifications.manage', 'Manage Notifications', 'notifications', 'Manage push notification subscriptions'),
    ('notifications.send', 'Send Notifications', 'notifications', 'Send push notifications to users'),

-- Calendar/Payment Permissions (Financial Calendar Management)
    ('calendar.view', 'View Payment Calendar', 'finance', 'View payment calendars and schedules'),
    ('calendar.manage', 'Manage Payment Calendar', 'finance', 'Manage payment calendars and schedules'),

-- Guardian/Parent Management Permissions
    ('guardians.view', 'View Guardians', 'participants', 'View guardian/parent information'),
    ('guardians.edit', 'Edit Guardians', 'participants', 'Edit guardian/parent information'),
    ('guardians.manage', 'Manage Guardians', 'participants', 'Full guardian management access')

ON CONFLICT (permission_key) DO NOTHING;

-- ============================================================================
-- Assign Permissions to Existing Roles
-- ============================================================================

-- Helper functions to assign permissions
CREATE OR REPLACE FUNCTION assign_permissions_by_category_temp(
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

CREATE OR REPLACE FUNCTION assign_permission_temp(
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

-- ============================================================================
-- DISTRICT ROLE: Full access to all new permissions
-- ============================================================================
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'district'
AND p.category IN ('forms', 'honors', 'meetings', 'medication', 'announcements', 'resources', 'data', 'notifications')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- UNITADMIN ROLE: Everything except data.import and org.create
-- ============================================================================
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'unitadmin'
AND p.category IN ('forms', 'honors', 'meetings', 'medication', 'announcements', 'resources', 'notifications')
AND p.permission_key NOT IN ('data.import', 'data.export')
ON CONFLICT DO NOTHING;

-- Add calendar permissions to unitadmin
SELECT assign_permission_temp('unitadmin', 'calendar.view');
SELECT assign_permission_temp('unitadmin', 'calendar.manage');

-- Add guardian permissions to unitadmin
SELECT assign_permission_temp('unitadmin', 'guardians.view');
SELECT assign_permission_temp('unitadmin', 'guardians.edit');
SELECT assign_permission_temp('unitadmin', 'guardians.manage');

-- ============================================================================
-- LEADER ROLE: Most organizational features
-- ============================================================================

-- Forms: view and submit, but not manage templates
SELECT assign_permission_temp('leader', 'forms.view');
SELECT assign_permission_temp('leader', 'forms.submit');

-- Honors: view and create
SELECT assign_permission_temp('leader', 'honors.view');
SELECT assign_permission_temp('leader', 'honors.create');

-- Meetings: full access
SELECT assign_permissions_by_category_temp('leader', 'meetings');

-- Medication: full access
SELECT assign_permissions_by_category_temp('leader', 'medication');

-- Announcements: full access
SELECT assign_permissions_by_category_temp('leader', 'announcements');

-- Resources: view and create
SELECT assign_permission_temp('leader', 'resources.view');
SELECT assign_permission_temp('leader', 'resources.create');
SELECT assign_permission_temp('leader', 'resources.edit');

-- Calendar: view only
SELECT assign_permission_temp('leader', 'calendar.view');

-- Guardians: view and edit
SELECT assign_permission_temp('leader', 'guardians.view');
SELECT assign_permission_temp('leader', 'guardians.edit');

-- ============================================================================
-- PARENT ROLE: Limited access to own information
-- ============================================================================

-- Forms: view and submit own forms
SELECT assign_permission_temp('parent', 'forms.view');
SELECT assign_permission_temp('parent', 'forms.submit');

-- Honors: view only
SELECT assign_permission_temp('parent', 'honors.view');

-- Meetings: view only
SELECT assign_permission_temp('parent', 'meetings.view');

-- Medication: view own children's medication
SELECT assign_permission_temp('parent', 'medication.view');

-- Announcements: view only
SELECT assign_permission_temp('parent', 'announcements.view');

-- Resources: view only
SELECT assign_permission_temp('parent', 'resources.view');

-- Calendar: view own payment schedule
SELECT assign_permission_temp('parent', 'calendar.view');

-- Guardians: view own guardian info
SELECT assign_permission_temp('parent', 'guardians.view');

-- ============================================================================
-- FINANCE ROLE: Financial and related features
-- ============================================================================

-- Forms: view only (to see payment-related forms)
SELECT assign_permission_temp('finance', 'forms.view');

-- Meetings: view only
SELECT assign_permission_temp('finance', 'meetings.view');

-- Resources: view only
SELECT assign_permission_temp('finance', 'resources.view');

-- Calendar: full access (payment calendars)
SELECT assign_permission_temp('finance', 'calendar.view');
SELECT assign_permission_temp('finance', 'calendar.manage');

-- Guardians: view only (to contact for payments)
SELECT assign_permission_temp('finance', 'guardians.view');

-- Data export (for financial reports)
SELECT assign_permission_temp('finance', 'data.export');

-- ============================================================================
-- EQUIPMENT ROLE: Inventory and resources
-- ============================================================================

-- Resources: full access
SELECT assign_permissions_by_category_temp('equipment', 'resources');

-- Forms: view only (to see equipment request forms)
SELECT assign_permission_temp('equipment', 'forms.view');

-- ============================================================================
-- ADMINISTRATION ROLE: Reporting and analytics
-- ============================================================================

-- Forms: view all submissions for reporting
SELECT assign_permission_temp('administration', 'forms.view');

-- Honors: view for reporting
SELECT assign_permission_temp('administration', 'honors.view');

-- Meetings: view for reporting
SELECT assign_permission_temp('administration', 'meetings.view');

-- Medication: view for compliance reporting
SELECT assign_permission_temp('administration', 'medication.view');

-- Announcements: view
SELECT assign_permission_temp('administration', 'announcements.view');

-- Resources: view
SELECT assign_permission_temp('administration', 'resources.view');

-- Calendar: view for financial reporting
SELECT assign_permission_temp('administration', 'calendar.view');

-- Guardians: view for contact reporting
SELECT assign_permission_temp('administration', 'guardians.view');

-- Data export: full access
SELECT assign_permission_temp('administration', 'data.export');

-- ============================================================================
-- DEMOADMIN ROLE: Read-only admin
-- ============================================================================

-- All new view permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'demoadmin'
AND (
    p.permission_key LIKE '%.view' OR
    p.permission_key IN ('forms.view', 'honors.view', 'meetings.view', 'medication.view',
                         'announcements.view', 'resources.view', 'calendar.view', 'guardians.view')
)
AND p.category IN ('forms', 'honors', 'meetings', 'medication', 'announcements', 'resources', 'notifications')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- DEMOPARENT ROLE: Read-only parent (same as parent but read-only)
-- ============================================================================

-- Same view permissions as parent
SELECT assign_permission_temp('demoparent', 'forms.view');
SELECT assign_permission_temp('demoparent', 'honors.view');
SELECT assign_permission_temp('demoparent', 'meetings.view');
SELECT assign_permission_temp('demoparent', 'medication.view');
SELECT assign_permission_temp('demoparent', 'announcements.view');
SELECT assign_permission_temp('demoparent', 'resources.view');
SELECT assign_permission_temp('demoparent', 'calendar.view');
SELECT assign_permission_temp('demoparent', 'guardians.view');

-- ============================================================================
-- Clean up helper functions
-- ============================================================================
DROP FUNCTION IF EXISTS assign_permissions_by_category_temp(VARCHAR, VARCHAR);
DROP FUNCTION IF EXISTS assign_permission_temp(VARCHAR, VARCHAR);

-- ============================================================================
-- Update the user_permissions view to include new categories
-- ============================================================================

-- The existing view should automatically include new permissions
-- No changes needed as it queries all permissions

-- ============================================================================
-- Migration Complete
-- ============================================================================

-- Verification query (run separately to check results)
-- SELECT category, COUNT(*) as permission_count
-- FROM permissions
-- GROUP BY category
-- ORDER BY category;

-- Verify new permissions assigned to roles
-- SELECT r.role_name, r.display_name, COUNT(DISTINCT p.id) as total_permissions
-- FROM roles r
-- LEFT JOIN role_permissions rp ON r.id = rp.role_id
-- LEFT JOIN permissions p ON rp.permission_id = p.id
-- GROUP BY r.id, r.role_name, r.display_name
-- ORDER BY r.role_name;
