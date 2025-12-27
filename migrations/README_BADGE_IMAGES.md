# Badge Image Migration

## Overview

This migration adds image support to the badge_templates table, allowing badge images to be displayed in the web interface.

## What Changed

### Database Changes

1. **Added `image` column** to `badge_templates` table
   - Type: `VARCHAR(255)`
   - Nullable: Yes
   - Description: Stores the filename of the badge image (e.g., "kaa.webp")

2. **Auto-populated existing badges** with images based on their names:
   - Kaa → `kaa.webp`
   - Baloo → `baloo.webp`
   - Rikki Tikki Tavi → `rikki.webp`
   - Bagheera → `bagheera.webp`
   - Ferao → `ferao.webp`
   - Frère Gris → `frereGris.webp`

### Code Changes

#### Backend (`routes/badges.js`)
- Updated all badge template queries to include the `image` field
- Modified endpoints:
  - `/api/badge-progress`
  - `/api/pending-badges`
  - `/api/badge-summary`
  - `/api/badge-history`
  - `/api/badge-system-settings`
  - `/api/current-stars`

#### Frontend
- **`spa/badge_dashboard.js`**:
  - Updated `getBadgeImage()` to prioritize template images over old territoires system
  - Added image field to badge records during buildRecords()
  - Badge chips now display images from templates

- **`spa/badge_form.js`**:
  - Already supported template images, ensured compatibility

## Running the Migration

### Method 1: Using psql (Recommended)

```bash
# Set your database connection string
export DATABASE_URL="postgresql://username:password@host:port/database"

# Run the migration
psql "$DATABASE_URL" -f migrations/20251227_add_badge_template_images.sql
```

### Method 2: Using node-pg-migrate

```bash
# If you prefer to use node-pg-migrate, convert this to a JS migration:
npm run migrate:create add_badge_template_images

# Then copy the SQL content into the up() and down() functions
```

## Verification

After running the migration, verify it worked:

```sql
-- Check that the column was added
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'badge_templates' AND column_name = 'image';

-- Check that existing badges have images
SELECT id, name, image
FROM badge_templates
WHERE image IS NOT NULL;
```

## Rollback

If you need to rollback this migration:

```sql
ALTER TABLE badge_templates DROP COLUMN IF EXISTS image;
```

## Image Files

The migration expects badge images to be located in `/images/` directory:

```
/images/
  ├── kaa.webp
  ├── baloo.webp
  ├── rikki.webp
  ├── bagheera.webp
  ├── ferao.webp
  └── frereGris.webp
```

These images already exist in the project. PNG versions are also available.

## Backward Compatibility

The system maintains backward compatibility:

1. If a badge template doesn't have an image, the frontend falls back to the old `territoires` system
2. Old organization_settings with `badge_system.territoires` will still work
3. No existing functionality is broken

## Future Considerations

- When creating new badge templates, you can now set the `image` field
- Images should be stored in `/images/` directory
- Recommended format: WebP for better compression
- Fallback to PNG is also supported

## Testing

1. **Login to the application**
2. **Navigate to Badge Dashboard** (`/badge-dashboard`)
3. **Verify that badge images appear** next to badge names
4. **Check badge form** - images should display in the badge grid
5. **Create a new badge template** with an image and verify it displays

## Questions?

If you encounter issues:
- Check that the images exist in `/images/` directory
- Verify the migration ran successfully (check the database)
- Check browser console for any image loading errors
- Ensure API responses include the `image` field
