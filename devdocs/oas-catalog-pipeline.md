# Program Catalog Pipeline (Versioned + Bilingual + DB-Bound)

This document defines a maintainable catalog pipeline for OAS and other pedagogies.

## Why not mutable catalog data in code?

It is **not** wise to store mutable pedagogical content directly in route handlers or application constants when compliance spans jurisdictions and programs.

Use this model instead:

1. **Versioned source files in Git** for reviewability/audit trail.
2. **Database runtime tables** for active catalog lookup and reporting.
3. **Program + version keys** so multiple pedagogies coexist safely.

This keeps behavior deterministic, traceable, and expandable.

## Source of truth files

Catalog data is authored per program/version directory:

- `catalog/<program>/<version>/skills.json`
- `catalog/<program>/<version>/stages.json`
- `catalog/<program>/<version>/competencies.en.json`
- `catalog/<program>/<version>/competencies.fr.json`
- `catalog/<program>/<version>/program-rules.json`

Example: OAS v1 uses `catalog/oas/v1/*`.

Immutable identifiers:

- Skills: `official_key`
- Stages: `stage_no`
- Competencies: `code`

## Database model (expandable beyond OAS)

Runtime tables are program/version scoped:

- `program_catalog_versions`
- `program_catalog_skills`
- `program_catalog_stages`
- `program_catalog_competencies`
- `program_catalog_rules`

This allows multiple pedagogies (for example `oas`, `wosm`, `custom_org_program`) without schema rewrites.

## Loader

Use `scripts/load-oas-catalog.js` (program-agnostic despite filename).

### Validate only

```bash
node scripts/load-oas-catalog.js --program oas --version v1 --validate-only
```

### Load into database

```bash
node scripts/load-oas-catalog.js --program oas --version v1
```

Behavior:

1. Validates JSON schema shape before writes.
2. Fails if any competency `code` is missing in either EN/FR file.
3. Verifies immutable identifier consistency between EN/FR entries.
4. Stores catalog version metadata (`checksum`, `source_path`) in `program_catalog_versions`.
5. Rebuilds version-specific rows in `program_catalog_skills`, `program_catalog_stages`, and `program_catalog_competencies`.
6. Stores rules JSON in `program_catalog_rules`.
7. If legacy `oas_*` tables exist, performs compatibility sync to avoid breaking older query paths.

## Adding `v2` without mutating `v1`

1. Copy `catalog/oas/v1/` to `catalog/oas/v2/`.
2. Update only `v2` files.
3. Keep immutable IDs stable where concept identity is unchanged.
4. Validate and load `v2`.

```bash
node scripts/load-oas-catalog.js --program oas --version v2 --validate-only
node scripts/load-oas-catalog.js --program oas --version v2
```

5. Confirm a `program_catalog_versions` row for `(program='oas', version='v2')`.

## Mapping old keys to new versions

If wording changes but the concept is unchanged, keep identifiers (`official_key`, `code`) stable and update text only.

If concept identity changes, introduce a new key and keep an explicit mapping table for traceability:

```sql
CREATE TABLE IF NOT EXISTS program_catalog_key_mappings (
  id BIGSERIAL PRIMARY KEY,
  program TEXT NOT NULL,
  from_version TEXT NOT NULL,
  to_version TEXT NOT NULL,
  entity_type TEXT NOT NULL, -- skill | competency
  old_key TEXT NOT NULL,
  new_key TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

## Config-driven program rules

Program rules (for example PAB section minimums) belong in versioned catalog rules JSON and DB rows (`program_catalog_rules`), not inline constants in route handlers.
