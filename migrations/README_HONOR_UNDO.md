# Honor Undo/Edit Migration

## Overview
This migration adds undo and edit functionality for honor assignments.

## What it does
1. Adds audit trail columns to `honors` table:
   - `created_at` - Timestamp when honor was awarded (for undo time window)
   - `created_by` - User ID who awarded the honor
   - `updated_at` - Timestamp of last edit
   - `updated_by` - User ID who last edited

2. Links points to honors explicitly:
   - Adds `honor_id` column to `points` table
   - Sets up CASCADE delete so points are removed when honor is deleted

3. Migrates existing data:
   - Sets `created_at` to the honor date for existing honors
   - Links existing points to honors where possible (by matching participant + date)

## How to apply

### Production
```bash
psql $DATABASE_URL -f migrations/add_honor_audit_and_point_linking.sql
```

### Development
```bash
psql -h localhost -U your_user -d wampums -f migrations/add_honor_audit_and_point_linking.sql
```

## After migration

Once the migration is applied, restart your server. The new features will be available:

1. **Quick Undo (10-minute window)**
   - Recently awarded honors show an "Undo" option
   - Displays countdown timer
   - One-click removal

2. **Edit Capabilities**
   - Edit honor reason
   - Change honor date (points date syncs automatically)
   - Delete honors with confirmation

## Permissions

Users with `honors.create` permission can:
- Award honors
- Edit honors (reason and date)
- Delete honors
- Undo recent honors

This follows the principle: "if you can award it, you can fix it."

## Rollback

If you need to rollback this migration:

```sql
-- Remove audit columns from honors
ALTER TABLE honors DROP COLUMN IF EXISTS created_at;
ALTER TABLE honors DROP COLUMN IF EXISTS created_by;
ALTER TABLE honors DROP COLUMN IF EXISTS updated_at;
ALTER TABLE honors DROP COLUMN IF EXISTS updated_by;

-- Remove honor_id link from points
ALTER TABLE points DROP COLUMN IF EXISTS honor_id;

-- Drop indexes
DROP INDEX IF EXISTS idx_honors_created_at;
DROP INDEX IF EXISTS idx_honors_created_by;
DROP INDEX IF EXISTS idx_points_honor_id;
DROP INDEX IF EXISTS idx_honors_org_date;
```

⚠️ **Warning**: Rollback will remove audit trail information and the explicit link between honors and points.

## Notes

- Existing honors will have `created_at` set to their award date
- `created_by` will be NULL for existing honors (no way to determine original awarder)
- Points linked to honors will be automatically deleted when the honor is deleted (CASCADE)
- The migration attempts to link existing points to honors, but may leave some unlinked if there are multiple honors on the same date for the same participant
