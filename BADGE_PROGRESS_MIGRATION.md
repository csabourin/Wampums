# Badge Progress Normalization Migration

## Overview
Legacy badge progress data stored multiple stars (`etoiles`) in a single `badge_progress` row. The `migrations/002_split_badge_progress_levels.sql` migration normalizes this data to one row per badge level so level-specific logic and approvals remain accurate.

## When to Run
- After deploying the badge template changes that introduce `level_count` support.
- Before enabling or testing any new badge UI that expects one row per badge level.
- Only in environments that still contain legacy `badge_progress` rows where `etoiles > 1`.

## How to Run
Choose one of these approaches:

**Using the Node helper**
```bash
node run-migration.js migrations/002_split_badge_progress_levels.sql
```

**Using psql directly**
```bash
psql "$DATABASE_URL" -f migrations/002_split_badge_progress_levels.sql
```

## Safety and Verification
- The migration is idempotent: inserts use `ON CONFLICT ON CONSTRAINT unique_badge_progress_template DO NOTHING`, and the source row is reset to `etoiles = 1`.
- Run a quick check before and after to confirm rows were expanded:
  ```sql
  SELECT COUNT(*) FROM badge_progress WHERE etoiles > 1;
  ```
  Expect this count to reach **0** after the migration completes.

## Rollback Notes
If you must undo the split, delete the cloned rows and restore the original `etoiles` counts from a backup. The migration itself does not drop columns or alter schemas, so a full database backup is the simplest rollback path.
