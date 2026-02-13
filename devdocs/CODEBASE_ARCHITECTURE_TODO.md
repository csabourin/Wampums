# Wampums Architecture Backlog (Re-baselined)

**Last verified:** 2026-02-13  
**Verified against:** `api.js`, `config/app.js`, `routes/index.js`, `scripts/modernization/*`, `spa/`, `mobile/src/`, `devdocs/*`

---

## 1) What is already done (validated)

### 1.1 Backend composition and routing modernization

- [x] `api.js` is now a thin startup/composition entrypoint (no monolithic 1400-line bootstrap anymore).
- [x] Middleware + server setup extracted to modular bootstrap (`config/app.js`, `middleware/global.js`, `config/rate-limit.js`).
- [x] Route mounting is centralized in a canonical route registry (`routes/index.js`).
- [x] Duplicate `/api/ai` route mount was removed.
- [x] Canonical `/api/v1/*` mounts exist for core domains (organizations, users, meetings, groups, AI, calendars, forms, reports, dashboards, badges, guardians, notifications, points, attendance, import, participants, resources, activities, offline, carpools).
- [x] Legacy `/api` compatibility now has explicit deprecation handling (`legacyApiDeprecationLogger` + 410 responder).

### 1.2 Guardrails and modernization scripts

- [x] Duplicate-mount checker exists (`scripts/modernization/check-duplicate-mounts.js`).
- [x] SPA top-level file gate exists (`scripts/modernization/check-spa-files.js`).
- [x] Non-versioned mount policy checker exists and is pointed at `routes/index.js` (`scripts/modernization/check-non-versioned-mounts.js`).

### 1.3 Legacy inventory items that are no longer current

The original backlog listed many legacy `app.use("/api", ...)` entries inside `api.js`. Those are now outdated because route composition moved to `routes/index.js` and most mounts are versioned.

---

## 2) What is still left (validated)

### 2.1 Remaining intentional non-versioned mounts (still technical debt)

- [ ] Keep/replace root mounts that rely on internal absolute paths:
  - `app.use("/", authRoutes)`
  - `app.use("/", rolesRoutes)`
- [ ] Migrate or isolate routers still mounted at `/api`:
  - `announcementsRoutes`, `honorsRoutes`, `financeRoutes`, `stripeRoutes`, `budgetsRoutes`, `externalRevenueRoutes`, `medicationRoutes`, `whatsappBaileysRoutes`.
- [ ] Keep `/public` compatibility mount scoped and sunset-tracked.

### 2.2 Backlog items still missing from original waves

- [ ] Publish active `devdocs/API_VERSIONING_POLICY.md` (currently only available in `devdocs/archive/`).
- [ ] Replace/repair `lint:api-version` to inspect `routes/index.js` (it still targets `api.js`, so it can pass without validating real route mounts).
- [ ] Add CI wiring to enforce modernization scripts on PRs (scripts exist, enforcement path not documented in active backlog).
- [ ] Add endpoint hit telemetry + deprecation metrics before removing remaining legacy mounts.
- [ ] Publish `devdocs/API_CLIENT_BEHAVIOR_SPEC.md` and add SPA/mobile client parity tests.
- [ ] Add response envelope contract tests for `success/error/paginated` coverage.

### 2.3 SPA migration debt still open

- [ ] Large set of legacy top-level SPA feature files (`spa/*.js`) still exists; modernization batches are not complete.
- [ ] Compatibility shims and module-by-module cutovers are still needed for full migration to `spa/modules/*`.

---

## 3) New prioritized TODO (recommended execution order)

## P0 — Correctness + governance (do first)

- [ ] **Fix `lint:api-version` immediately** to scan `routes/index.js` and fail on unauthorized legacy mounts.
- [ ] **Promote API versioning policy out of archive** into active docs (`devdocs/API_VERSIONING_POLICY.md`) with explicit deprecation dates.
- [ ] **Add CI job** that runs:
  - `npm run lint:api-version`
  - `npm run lint:duplicate-mounts`
  - `npm run lint:non-versioned-mounts`
  - `npm run lint:spa-files`

## P1 — Complete backend versioning migration

- [ ] Refactor remaining `/api`-mounted routers to `/api/v1/*` canonical paths.
- [ ] For each migrated route, keep short-lived compatibility aliases with deprecation logs + removal date.
- [ ] Remove `/public` and root compatibility mounts where no longer required.

## P2 — Contract quality and cross-client parity

- [ ] Create `devdocs/API_CLIENT_BEHAVIOR_SPEC.md` (timeouts, retries, auth refresh, envelope parsing, org context behavior).
- [ ] Add automated parity tests between `spa/api/api-core.js` and `mobile/src/api/api-core.js`.
- [ ] Add response contract tests covering key route modules.

## P3 — SPA legacy module retirement

- [ ] Execute SPA migration in batches (auth/profile → operations → forms → finance/reporting → admin/resource → parent dashboards).
- [ ] Retire top-level legacy feature files once each batch is stabilized.

---

## 4) Verification commands used for this re-baseline

- `rg -n "app\.use\(" routes/index.js`
- `sed -n '1,260p' api.js`
- `sed -n '1,320p' config/app.js`
- `sed -n '1,360p' routes/index.js`
- `sed -n '1,220p' scripts/modernization/check-api-version.js`
- `sed -n '1,220p' scripts/modernization/check-duplicate-mounts.js`
- `sed -n '1,260p' scripts/modernization/check-non-versioned-mounts.js`
- `sed -n '1,220p' scripts/modernization/check-spa-files.js`
- `npm run -s lint:api-version`
- `npm run -s lint:duplicate-mounts`
- `npm run -s lint:non-versioned-mounts`
- `npm run -s lint:spa-files`
