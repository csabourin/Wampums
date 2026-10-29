# Permission catalog audit — 2026-10-29

Every new permission must be granted to district and exposed in `/roles` with
French and English permission and category labels. This applies to future features
as well as existing ones.

The repository scan found 105 distinct permission keys in SQL catalog declarations,
covering 30 categories. All permission labels were present in both languages.
Two category labels were missing: `communication` and `personal_equipment`.
They now have bilingual labels instead of the matrix's generic category fallback.
No permission-specific control is hardcoded: the API loads every catalog entry and
the matrix generates a cell for every role/permission pair.

Migration 016 marks built-in district with `grants_all_permissions`, backfills every
existing grant and installs an AFTER INSERT trigger to grant future permissions.
The absence of an explicit district grant in an individual feature migration is
therefore not evidence of a missing grant. Production state requires a separate
configuration/database verification; this audit does not inspect production data.

Regression checks:
- `test/permission-matrix-labels.test.js`: SQL declarations have bilingual labels.
- `test/permission-catalog.integration.test.js`: every checked permission exists,
  every actual database key/category has bilingual labels, district holds the entire
  catalog, and a newly inserted permission is automatically granted (rolled back).
- `test/roles-matrix.integration.test.js`: the authenticated API returns the entire
  actual catalog and a cell for every permission on every role.

The database checks require a disposable database with all migrations applied,
using `TEST_DATABASE_URL`. CI's database-integration job provides it.
