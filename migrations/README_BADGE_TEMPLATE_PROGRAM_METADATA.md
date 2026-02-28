# Badge Template Program Metadata Migration

## Overview

This migration introduces program catalog metadata on `badge_templates` to support legacy and future badge catalogs with deterministic keys and versioned uniqueness per organization.

## What Changed

### Database Changes

1. **Added `program_type`** (`varchar(30)`, not null, default `legacy_badge`)
2. **Added `official_key`** (`varchar(255)`, nullable)
3. **Added `version`** (`integer`, not null, default `1`)
4. **Added `requirements`** (`jsonb`, not null, default `'{}'::jsonb`)

### Indexes

1. `idx_badge_templates_program_type` on `(program_type)`
2. `idx_badge_templates_official_key` on `(official_key)`
3. Partial unique index on `(organization_id, official_key, version)` where `official_key is not null`

## Backfill Rules

### `official_key` mapping

For existing rows with `official_key is null`, the migration builds a deterministic key as:

```text
legacy:${coalesce(template_key, id::text)}
```

Then normalization is applied:

- lowercase output
- replace one-or-more non `[a-zA-Z0-9:]` characters with `_`
- trim leading/trailing `_`

Examples:

- `template_key = "Kaa Badge"` → `legacy:kaa_badge`
- `template_key = null` and `id = 42` → `legacy:42`

### `program_type` heuristic

All rows default to `legacy_badge`, then are reassigned when `template_key` has known catalog prefixes:

- `oas:%` → `oas`
- `pab:%` → `pab`
- `top:%` → `top`
- otherwise → `legacy_badge`

## Fallback Behavior

- If a badge template has no `template_key`, `official_key` falls back to `legacy:<id>`.
- If a template key does not match a known future namespace, `program_type` remains `legacy_badge`.
- Uniqueness is enforced only when `official_key` is present (partial unique index), allowing controlled null states during transition.

## API Query Coverage

`routes/badges.js` now includes `program_type`, `official_key`, `version`, and `requirements` in badge template SELECT projections so downstream readers can consume the new metadata fields.

## Running the Migration

```bash
export DATABASE_URL="postgresql://username:password@host:port/database"
psql "$DATABASE_URL" -f migrations/add_program_metadata_to_badges.sql
```

## Verification

```sql
-- Verify new columns
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'badge_templates'
  AND column_name IN ('program_type', 'official_key', 'version', 'requirements')
ORDER BY column_name;

-- Verify deterministic official_key backfill
SELECT id, template_key, official_key
FROM public.badge_templates
ORDER BY id
LIMIT 25;

-- Verify program_type heuristic distribution
SELECT program_type, COUNT(*)
FROM public.badge_templates
GROUP BY program_type
ORDER BY program_type;

-- Verify partial uniqueness guard exists
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'badge_templates'
  AND indexname = 'idx_badge_templates_org_official_key_version_unique';
```
