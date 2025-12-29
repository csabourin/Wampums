-- Check if equipment items have photo_url values
-- Run this in your database to see the current state of photo URLs

SELECT 
  id,
  name,
  category,
  organization_id,
  photo_url,
  CASE 
    WHEN photo_url IS NULL THEN 'No photo URL'
    WHEN photo_url = '' THEN 'Empty string'
    ELSE 'Has photo URL'
  END as photo_status,
  LENGTH(photo_url) as url_length
FROM equipment_items
WHERE is_active = true
ORDER BY id;

-- Count equipment by photo status
SELECT 
  CASE 
    WHEN photo_url IS NULL THEN 'NULL'
    WHEN photo_url = '' THEN 'Empty string'
    ELSE 'Has URL'
  END as status,
  COUNT(*) as count
FROM equipment_items
WHERE is_active = true
GROUP BY status;
