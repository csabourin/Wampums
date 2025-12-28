-- Debug script to check user permissions
-- Replace with your actual email and organization_id

-- 1. Check user_organizations for your user
SELECT 
    uo.user_id,
    uo.organization_id,
    uo.role_ids,
    u.email,
    u.full_name
FROM user_organizations uo
JOIN users u ON u.id = uo.user_id
WHERE u.email = 'info@christiansabourin.com'  -- Replace with your email
LIMIT 5;

-- 2. Check what roles those role_ids correspond to
SELECT DISTINCT 
    r.id as role_id, 
    r.role_name
FROM user_organizations uo
CROSS JOIN LATERAL jsonb_array_elements_text(uo.role_ids) AS role_id_text
JOIN roles r ON r.id = role_id_text::integer
JOIN users u ON u.id = uo.user_id
WHERE u.email = 'info@christiansabourin.com'  -- Replace with your email
LIMIT 10;

-- 3. Check what permissions those roles have
SELECT DISTINCT 
    p.permission_key,
    p.permission_name,
    r.role_name
FROM user_organizations uo
CROSS JOIN LATERAL jsonb_array_elements_text(uo.role_ids) AS role_id_text
JOIN role_permissions rp ON rp.role_id = role_id_text::integer
JOIN permissions p ON p.id = rp.permission_id
JOIN roles r ON r.id = role_id_text::integer
JOIN users u ON u.id = uo.user_id
WHERE u.email = 'info@christiansabourin.com'  -- Replace with your email
ORDER BY r.role_name, p.permission_key
LIMIT 100;

-- 4. If no results above, check if role_ids is empty or malformed
SELECT 
    user_id,
    organization_id,
    role_ids,
    jsonb_typeof(role_ids) as role_ids_type,
    jsonb_array_length(role_ids) as role_count
FROM user_organizations uo
JOIN users u ON u.id = uo.user_id
WHERE u.email = 'info@christiansabourin.com';  -- Replace with your email
