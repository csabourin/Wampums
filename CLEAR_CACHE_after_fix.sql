-- Run this AFTER applying the permission fix to clear cached data
-- This ensures users see the updated form permissions immediately

-- Option 1: Delete specific cached form format entries
-- (If you have a cache table - adjust table name as needed)
-- DELETE FROM cache WHERE key LIKE 'org_form_formats%';

-- Option 2: Clear IndexedDB cache by reloading the page
-- Just do a hard refresh in your browser: Ctrl+Shift+R or Cmd+Shift+R

-- Option 3: Clear all caches programmatically
-- Run this in your browser console after applying the SQL fix:
/*
indexedDB.deleteDatabase('WampumsCache');
localStorage.clear();
location.reload();
*/

-- Instructions:
-- 1. Run QUICKFIX_district_permissions.sql first
-- 2. Then do a hard refresh in your browser (Ctrl+Shift+R)
-- 3. The forms should now appear!
