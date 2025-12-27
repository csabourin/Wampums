-- DIAGNOSTIC QUERIES FOR FORM PERMISSIONS ISSUE
-- Run these queries to check the current state of your form permissions

-- 1. Check if the display_context column exists (migration 2 applied)
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'organization_form_formats'
  AND column_name = 'display_context';
-- Expected: Should return one row showing the display_context column exists

-- 2. Check if form_permissions table exists (migration 1 applied)
SELECT table_name
FROM information_schema.tables
WHERE table_name = 'form_permissions';
-- Expected: Should return one row showing 'form_permissions'

-- 3. Check what forms exist in your organization
SELECT id, organization_id, form_type, display_context
FROM organization_form_formats
ORDER BY form_type;
-- Expected: Should show all your forms with their display_context arrays

-- 4. Check form permissions for the 'parent' role
SELECT
    r.role_name,
    off.form_type,
    fp.can_view,
    fp.can_submit,
    fp.can_edit,
    fp.can_approve
FROM form_permissions fp
JOIN roles r ON r.id = fp.role_id
JOIN organization_form_formats off ON off.id = fp.form_format_id
WHERE r.role_name = 'parent'
ORDER BY off.form_type;
-- Expected: Should show parent has can_view=true for risk_acceptance, fiche_sante, etc.

-- 5. Check all roles and their permissions for participant forms
SELECT
    r.role_name,
    off.form_type,
    off.display_context,
    fp.can_view,
    fp.can_submit
FROM form_permissions fp
JOIN roles r ON r.id = fp.role_id
JOIN organization_form_formats off ON off.id = fp.form_format_id
WHERE off.form_type IN ('risk_acceptance', 'fiche_sante', 'participant_registration', 'parent_guardian')
ORDER BY off.form_type, r.role_name;
-- Expected: Should show which roles can view/submit each participant form

-- 6. Check if forms have the 'participant' display context
SELECT form_type, display_context
FROM organization_form_formats
WHERE 'participant' = ANY(display_context);
-- Expected: Should show risk_acceptance, fiche_sante, etc. (NOT organization_info)

-- 7. If queries 1-2 return no results, you need to run the migrations:
-- Run: npm run migrate up
-- Or manually apply: migrations/20251227_setup_form_permissions.sql
-- And: migrations/20251227_add_display_context_to_forms.sql
