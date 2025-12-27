-- Migration: Grant district role permissions for participant forms
-- Date: 2025-12-27
-- Description: The district role was missing view/edit permissions for participant forms.
--              This migration adds those permissions so district admins can view and manage
--              all participant forms.

-- Add permissions for district role on all participant forms
-- District admins should be able to view, submit, edit, and approve all participant forms

DO $$
DECLARE
    v_district_role_id INTEGER;
    v_form_format_id INTEGER;
BEGIN
    -- Get the district role ID
    SELECT id INTO v_district_role_id FROM roles WHERE role_name = 'district' LIMIT 1;

    IF v_district_role_id IS NULL THEN
        RAISE NOTICE 'District role not found - skipping migration';
        RETURN;
    END IF;

    -- Grant permissions for each participant form type
    FOR v_form_format_id IN
        SELECT id FROM organization_form_formats
        WHERE form_type IN ('risk_acceptance', 'fiche_sante', 'participant_registration', 'parent_guardian')
    LOOP
        -- Check if permission already exists
        IF NOT EXISTS (
            SELECT 1 FROM form_permissions
            WHERE role_id = v_district_role_id AND form_format_id = v_form_format_id
        ) THEN
            -- Insert new permission
            INSERT INTO form_permissions (role_id, form_format_id, can_view, can_submit, can_edit, can_approve)
            VALUES (v_district_role_id, v_form_format_id, true, true, true, true);

            RAISE NOTICE 'Added district permissions for form_format_id: %', v_form_format_id;
        ELSE
            -- Update existing permission to ensure all flags are true
            UPDATE form_permissions
            SET can_view = true,
                can_submit = true,
                can_edit = true,
                can_approve = true
            WHERE role_id = v_district_role_id AND form_format_id = v_form_format_id;

            RAISE NOTICE 'Updated district permissions for form_format_id: %', v_form_format_id;
        END IF;
    END LOOP;

    RAISE NOTICE 'District role permissions updated successfully';
END $$;
