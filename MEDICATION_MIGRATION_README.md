# Medication Frequency Preset Migration

## Overview

This migration adds structured frequency data storage to the medication management system, enabling the frequency preset UI (interval/time-of-day/meal/PRN) to persist and function correctly.

## Problem Fixed

**Before:** The frontend built a rich frequency configuration (preset type, times, slots, etc.) but the backend only saved `frequency_text` as a plain string. This meant:
- The frequency selector UI couldn't load saved presets
- Auto-scheduling features didn't work reliably
- Data was lost on page refresh

**After:** All frequency configuration is now properly stored in structured database columns and retrieved by the frontend.

## Required Steps

### 1. Run the Database Migration

Choose one of these methods:

**Option A: Using the provided script**
```bash
node run-frequency-migration.js
```

**Option B: Manual SQL execution**

Connect to your PostgreSQL database and run:
```sql
migrations/add_frequency_preset_columns.sql
```

**Option C: Using psql command line**
```bash
psql $DATABASE_URL -f migrations/add_frequency_preset_columns.sql
```

### 2. Restart the Server

After running the migration, restart your application server to load the updated API endpoints.

### 3. Clear Browser Cache

Clear your browser cache and hard-refresh the medication pages to load the new UI:
- Planning page: `/medication-planning`
- Dispensing page: `/medication-dispensing`

Press `Ctrl+Shift+R` (Windows/Linux) or `Cmd+Shift+R` (Mac) to hard refresh.

## What Changed

### Database Schema

Added 5 new columns to `medication_requirements` table:
- `frequency_preset_type` (VARCHAR(30)) - Type: 'interval', 'time_of_day', 'meal', or 'prn'
- `frequency_times` (JSONB) - Array of time strings for time-of-day preset
- `frequency_slots` (JSONB) - Meal slot mappings like `{"breakfast": "08:00"}`
- `frequency_interval_hours` (INTEGER) - Hours between doses for interval preset
- `frequency_interval_start` (TIME) - Starting time for interval preset

### Backend API Changes

Updated three endpoints in `routes/medication.js`:
- **GET /v1/medication/requirements** - Now returns frequency preset fields
- **POST /v1/medication/requirements** - Now saves frequency preset fields
- **PUT /v1/medication/requirements/:id** - Now updates frequency preset fields

### Frontend

No frontend changes needed! The medication management UI already had the frequency preset selector implemented, it was just missing backend persistence.

## Testing

After completing the steps above:

1. **Create a new medication requirement** with a frequency preset:
   - Go to `/medication-planning`
   - Select "Interval" and configure "Every 6 hours starting at 08:00"
   - Save the requirement

2. **Verify persistence**:
   - Refresh the page
   - The requirement should still show the structured frequency data

3. **Test scheduling**:
   - Go to `/medication-dispensing`
   - Select the requirement you created
   - The frequency helper should show the correct time slots automatically

## Troubleshooting

**Issue: "column does not exist" error**
- The migration hasn't been run yet
- Run one of the migration commands above

**Issue: Still seeing plain text frequency input**
- Clear browser cache completely
- Try hard refresh with Ctrl+Shift+R
- Check browser console for JavaScript errors

**Issue: Migration says "already exists"**
- The columns may have been added manually
- This is fine! The migration uses `IF NOT EXISTS` clauses
- Just restart the server

## Rollback

If you need to undo this migration:
```sql
BEGIN;
ALTER TABLE medication_requirements
  DROP COLUMN IF EXISTS frequency_preset_type,
  DROP COLUMN IF EXISTS frequency_times,
  DROP COLUMN IF EXISTS frequency_slots,
  DROP COLUMN IF EXISTS frequency_interval_hours,
  DROP COLUMN IF EXISTS frequency_interval_start;
DROP INDEX IF EXISTS idx_medication_requirements_frequency_type;
COMMIT;
```

Note: This will lose any structured frequency data that was saved.
