-- Migration: Setup Form Permissions System
-- Description: Populates the form_permissions table with default permissions for all roles
-- Author: Claude
-- Date: 2025-12-27
--
-- This migration establishes role-based access control for forms:
-- - organization_info: District admins only
-- - Core participant forms: Parents and staff
-- - Other forms: Based on logical permissions
-- - Badge-related: Everyone who can view badges

-- ==========================================
-- UP MIGRATION
-- ==========================================

-- First, clear any existing form permissions to start fresh
TRUNCATE TABLE form_permissions;

-- ==========================================
-- HELPER: Function to add permissions for a form type
-- ==========================================
CREATE OR REPLACE FUNCTION add_form_permission(
  p_form_type VARCHAR,
  p_role_name VARCHAR,
  p_can_view BOOLEAN DEFAULT false,
  p_can_submit BOOLEAN DEFAULT false,
  p_can_edit BOOLEAN DEFAULT false,
  p_can_approve BOOLEAN DEFAULT false
) RETURNS void AS $$
DECLARE
  v_form_format_id INTEGER;
  v_role_id INTEGER;
BEGIN
  -- Get form_format_id
  SELECT id INTO v_form_format_id
  FROM organization_form_formats
  WHERE form_type = p_form_type
  LIMIT 1;

  -- Get role_id
  SELECT id INTO v_role_id
  FROM roles
  WHERE role_name = p_role_name;

  -- Only insert if both IDs are found
  IF v_form_format_id IS NOT NULL AND v_role_id IS NOT NULL THEN
    INSERT INTO form_permissions (
      form_format_id,
      role_id,
      can_view,
      can_submit,
      can_edit,
      can_approve
    ) VALUES (
      v_form_format_id,
      v_role_id,
      p_can_view,
      p_can_submit,
      p_can_edit,
      p_can_approve
    )
    ON CONFLICT (form_format_id, role_id) DO UPDATE SET
      can_view = EXCLUDED.can_view,
      can_submit = EXCLUDED.can_submit,
      can_edit = EXCLUDED.can_edit,
      can_approve = EXCLUDED.can_approve;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ==========================================
-- Add unique constraint if it doesn't exist
-- ==========================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'form_permissions_form_format_id_role_id_key'
  ) THEN
    ALTER TABLE form_permissions
    ADD CONSTRAINT form_permissions_form_format_id_role_id_key
    UNIQUE (form_format_id, role_id);
  END IF;
END $$;

-- ==========================================
-- ORGANIZATION_INFO: District admins only
-- ==========================================
SELECT add_form_permission('organization_info', 'district', true, true, true, true);

-- ==========================================
-- CORE PARTICIPANT FORMS: Parents and all staff
-- Forms: risk_acceptance, fiche_sante, participant_registration, parent_guardian
-- ==========================================

-- Parents: Can view, submit, and edit their own children's forms
SELECT add_form_permission('risk_acceptance', 'parent', true, true, true, false);
SELECT add_form_permission('fiche_sante', 'parent', true, true, true, false);
SELECT add_form_permission('participant_registration', 'parent', true, true, true, false);
SELECT add_form_permission('parent_guardian', 'parent', true, true, true, false);

-- Demo Parents: Same as regular parents
SELECT add_form_permission('risk_acceptance', 'demoparent', true, true, true, false);
SELECT add_form_permission('fiche_sante', 'demoparent', true, true, true, false);
SELECT add_form_permission('participant_registration', 'demoparent', true, true, true, false);
SELECT add_form_permission('parent_guardian', 'demoparent', true, true, true, false);

-- District: Full access to all core forms
SELECT add_form_permission('risk_acceptance', 'district', true, true, true, true);
SELECT add_form_permission('fiche_sante', 'district', true, true, true, true);
SELECT add_form_permission('participant_registration', 'district', true, true, true, true);
SELECT add_form_permission('parent_guardian', 'district', true, true, true, true);

-- Unit Admin: Full access to all core forms
SELECT add_form_permission('risk_acceptance', 'unitadmin', true, true, true, true);
SELECT add_form_permission('fiche_sante', 'unitadmin', true, true, true, true);
SELECT add_form_permission('participant_registration', 'unitadmin', true, true, true, true);
SELECT add_form_permission('parent_guardian', 'unitadmin', true, true, true, true);

-- Leaders: Can view and edit, but cannot approve
SELECT add_form_permission('risk_acceptance', 'leader', true, true, true, false);
SELECT add_form_permission('fiche_sante', 'leader', true, true, true, false);
SELECT add_form_permission('participant_registration', 'leader', true, true, true, false);
SELECT add_form_permission('parent_guardian', 'leader', true, true, true, false);

-- Demo Admin: Same as district
SELECT add_form_permission('risk_acceptance', 'demoadmin', true, true, true, true);
SELECT add_form_permission('fiche_sante', 'demoadmin', true, true, true, true);
SELECT add_form_permission('participant_registration', 'demoadmin', true, true, true, true);
SELECT add_form_permission('parent_guardian', 'demoadmin', true, true, true, true);

-- ==========================================
-- BADGE-RELATED FORMS: Everyone who can view badges
-- ==========================================

-- Parents: Can view and submit badge requests for their children
SELECT add_form_permission('badge_request', 'parent', true, true, false, false);
SELECT add_form_permission('demoparent', 'parent', true, true, false, false);

-- Staff: Can view, submit, and approve badge requests
SELECT add_form_permission('badge_request', 'district', true, true, true, true);
SELECT add_form_permission('badge_request', 'unitadmin', true, true, true, true);
SELECT add_form_permission('badge_request', 'leader', true, true, true, true);
SELECT add_form_permission('badge_request', 'demoadmin', true, true, true, true);

-- ==========================================
-- DEFAULT PERMISSIONS FOR OTHER FORMS
-- Apply to any other forms that might exist
-- ==========================================

-- For any other forms not explicitly listed above:
-- District: Full access
-- Unit Admin: Full access
-- Leaders: View and edit
-- Parents: View and submit their own children's forms

DO $$
DECLARE
  form_rec RECORD;
  covered_forms TEXT[] := ARRAY[
    'organization_info',
    'risk_acceptance',
    'fiche_sante',
    'participant_registration',
    'parent_guardian',
    'badge_request'
  ];
BEGIN
  FOR form_rec IN
    SELECT DISTINCT form_type
    FROM organization_form_formats
    WHERE form_type != ALL(covered_forms)
  LOOP
    -- District: Full access
    PERFORM add_form_permission(form_rec.form_type, 'district', true, true, true, true);

    -- Unit Admin: Full access
    PERFORM add_form_permission(form_rec.form_type, 'unitadmin', true, true, true, true);

    -- Leaders: View and edit
    PERFORM add_form_permission(form_rec.form_type, 'leader', true, true, true, false);

    -- Parents: View and submit
    PERFORM add_form_permission(form_rec.form_type, 'parent', true, true, false, false);

    -- Demo roles
    PERFORM add_form_permission(form_rec.form_type, 'demoadmin', true, true, true, true);
    PERFORM add_form_permission(form_rec.form_type, 'demoparent', true, true, false, false);
  END LOOP;
END $$;

-- ==========================================
-- CLEANUP: Drop the helper function
-- ==========================================
DROP FUNCTION IF EXISTS add_form_permission(VARCHAR, VARCHAR, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN);

-- ==========================================
-- Add helpful comment
-- ==========================================
COMMENT ON TABLE form_permissions IS 'Role-based access control for organization forms. Controls which roles can view, submit, edit, and approve specific form types.';

-- ==========================================
-- DOWN MIGRATION (for rollback)
-- ==========================================
-- Note: To rollback this migration, run:
-- TRUNCATE TABLE form_permissions;
