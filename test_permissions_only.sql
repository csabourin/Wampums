-- Test the permissions query (this is what auth.js uses)
SELECT DISTINCT p.permission_key
FROM user_organizations uo
CROSS JOIN LATERAL jsonb_array_elements_text(uo.role_ids) AS role_id_text
JOIN role_permissions rp ON rp.role_id = role_id_text::integer
JOIN permissions p ON p.id = rp.permission_id
WHERE uo.user_id = 'a1d9d39f-d842-41e0-9aee-620806eb54bc'::uuid 
  AND uo.organization_id = 1
ORDER BY p.permission_key;
