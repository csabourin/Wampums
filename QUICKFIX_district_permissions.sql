-- QUICK FIX: Grant district role permissions for participant forms
-- Run this immediately to fix the missing forms issue

-- This adds view/submit/edit/approve permissions for district role on all participant forms

DO $$
DECLARE
    v_district_role_id INTEGER;
    v_form_format_id INTEGER;
    v_form_type TEXT;
BEGIN
    -- Get the district role ID
    SELECT id INTO v_district_role_id FROM roles WHERE role_name = 'district' LIMIT 1;

    IF v_district_role_id IS NULL THEN
        RAISE EXCEPTION 'District role not found!';
    END IF;

    RAISE NOTICE 'District role ID: %', v_district_role_id;

    -- Grant permissions for each participant form type
    FOR v_form_format_id, v_form_type IN
        SELECT id, form_type FROM organization_form_formats
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

            RAISE NOTICE 'Added district permissions for % (ID: %)', v_form_type, v_form_format_id;
        ELSE
            -- Update existing permission to ensure all flags are true
            UPDATE form_permissions
            SET can_view = true,
                can_submit = true,
                can_edit = true,
                can_approve = true
            WHERE role_id = v_district_role_id AND form_format_id = v_form_format_id;

            RAISE NOTICE 'Updated district permissions for % (ID: %)', v_form_type, v_form_format_id;
        END IF;
    END LOOP;

    RAISE NOTICE 'District role permissions updated successfully!';
END $$;

-- Verify the permissions were added
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
WHERE r.role_name = 'district'
ORDER BY off.form_type;
