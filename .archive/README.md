# Archived Files

This directory contains files that were identified as unreferenced/dead and archived on 2026-02-13.

## Why These Files Were Archived

These files were not imported, required, or linked by any other code in the repository. They appear to be:
- Orphaned test/debug files
- Old versions of components
- Unused utilities
- Duplicate files
- Unintegrated services

## Archive Date

2026-02-13

## Files Archived

### Root Level
- `deletion.html` - Data deletion instructions page (not linked anywhere)
- `reproduction_reset.js` - Debug/test script
- `run-migration.js` - Duplicate of scripts/run-migration.js
- `test_date_utils.js` - Orphaned test file
- `termsofservice.html` - Terms of service page (not linked anywhere)

### Utils
- `utils/DebugUtils.js` - Duplicate of spa/utils/DebugUtils.js

### Documentation
- `attached_assets/BadgeTrackerV3.jsx` - Old component version

### SPA (Frontend)
- `spa/utils/SimpleWYSIWYG.js` - WYSIWYG editor (never imported)
- `spa/api/api-offline-wrapper.js` - Offline API wrapper (not actively used)
- `spa/modules/ActivityManager_addAchievementListeners.js` - Orphaned module fragment
- `spa/modules/modals/PermissionSlipQuickAccessModal.js` - Unused modal component
- `spa/sync/SyncInit.js` - Old sync initialization code

### Services (Backend)
- `services/mindee.js` - Mindee OCR service integration (never activated/used)

### Translations
- `lang/update_translations.js` - Translation update utility script

## Restoration

If any of these files are needed in the future, they can be restored from this archive directory or from git history.

## Analysis Method

Files were identified using:
1. Static analysis of import/require statements
2. Manual verification of references
3. Checking Express static file serving
4. Checking dynamic imports and loadStylesheet() calls

Files that ARE still used (and were NOT archived):
- All CSS files in `/css/*` (loaded dynamically via loadStylesheet())
- All mobile app files (screens, components, navigation)
- Static HTML files served as error pages or linked from main pages
- Configuration files (.eslintrc.js, jest configs)
