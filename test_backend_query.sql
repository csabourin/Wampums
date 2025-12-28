-- This is the EXACT query the backend uses in routes/auth.js
-- Test it to see if it returns permissions for your user

-- Replace these values:
-- user_id: a1d9d39f-d842-41e0-9aee-620806eb54bc (from your screenshot)
-- organization_id: 1, 2, or 3 (pick one that you're trying to log into)

-- Test the permissions query (this is what auth.js line 236-243 does)
SELECT DISTINCT p.permission_key
FROM user_organizations uo
CROSS JOIN LATERAL jsonb_array_elements_text(uo.role_ids) AS role_id_text
JOIN role_permissions rp ON rp.role_id = role_id_text::integer
JOIN permissions p ON p.id = rp.permission_id
WHERE uo.user_id = 'a1d9d39f-d842-41e0-9aee-620806eb54bc'::uuid 
  AND uo.organization_id = 1  -- Try with 1, 2, or 3
ORDER BY p.permission_key;

-- Also test the roles query (this is what auth.js line 227-234 does)
SELECT DISTINCT r.id as role_id, r.role_name
FROM user_organizations uo
CROSS JOIN LATERAL jsonb_array_elements_text(uo.role_ids) AS role_id_text
JOIN roles r ON r.id = role_id_text::integer
WHERE uo.user_id = 'a1d9d39f-d842-41e0-9aee-620806eb54bc'::uuid 
  AND uo.organization_id = 1;  -- Try with 1, 2, or 3

-- Check the raw data in user_organizations
SELECT 
    user_id,
    organization_id,
    role_ids,
    jsonb_typeof(role_ids) as type,
    jsonb_array_length(role_ids) as length,
    role_ids::text as role_ids_text
FROM user_organizations
WHERE user_id = 'a1d9d39f-d842-41e0-9aee-620806eb54bc'::uuid;
