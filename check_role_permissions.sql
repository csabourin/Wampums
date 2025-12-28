-- Check what role ID 1 is
SELECT * FROM roles WHERE id = 1;

-- Check what permissions are assigned to role ID 1
SELECT 
    rp.role_id,
    r.role_name,
    rp.permission_id,
    p.permission_key,
    p.permission_name
FROM role_permissions rp
JOIN roles r ON r.id = rp.role_id
JOIN permissions p ON p.id = rp.permission_id
WHERE rp.role_id = 1
ORDER BY p.permission_key
LIMIT 100;

-- Count how many permissions role 1 has
SELECT 
    r.role_name,
    COUNT(rp.permission_id) as permission_count
FROM roles r
LEFT JOIN role_permissions rp ON rp.role_id = r.id
WHERE r.id = 1
GROUP BY r.role_name;
