# Wampums Legacy Modernization TODO (Complete Inventory + Migration Workflow)

This document supersedes the previous high-level TODO by:

1. Listing **legacy components explicitly** (backend + SPA + auth/policy compatibility surfaces).
2. Defining a **complete modernization workflow** to migrate the system to a modern, modular architecture.
3. Providing **wave-based execution** with acceptance criteria so migration can be tracked to completion.

---

## 1) Legacy Component Inventory (Complete)

## 1.1 Backend legacy API mount surfaces (`api.js`)

These route mounts still use legacy `/api` or mixed-prefix compatibility patterns:

- [ ] `app.use("/api", organizationsRoutes)`
- [ ] `app.use("/api", usersRoutes)`
- [ ] `app.use("/api", userProfileRoutes)`
- [ ] `app.use("/api/ai", aiRoutes)` (legacy prefix)
- [ ] `app.use("/api/ai", aiRoutes)` (**duplicate mount**)
- [ ] `app.use("/api", meetingsRoutes)`
- [ ] `app.use("/api", calendarsRoutes)`
- [ ] `app.use("/api", fundraisersRoutes)`
- [ ] `app.use("/api", formsRoutes)`
- [ ] `app.use("/api", formBuilderRoutes)`
- [ ] `app.use("/api", reportsRoutes)`
- [ ] `app.use("/api", dashboardsRoutes)`
- [ ] `app.use("/api", badgesRoutes)`
- [ ] `app.use("/api", guardiansRoutes)`
- [ ] `app.use("/api", notificationsRoutes)`
- [ ] `app.use("/api", announcementsRoutes)`
- [ ] `app.use("/api", whatsappBaileysRoutes)`
- [ ] `app.use("/api", googleChatRoutes)`
- [ ] `app.use("/api", honorsRoutes)`
- [ ] `app.use("/api", pointsRoutes)`
- [ ] `app.use("/api/attendance", attendanceRoutes)`
- [ ] `app.use("/api", publicRoutes)`
- [ ] `app.use("/api", importRoutes)`
- [ ] `app.use("/api", financeRoutes)`
- [ ] `app.use("/api", stripeRoutes)`
- [ ] `app.use("/api", budgetsRoutes)`
- [ ] `app.use("/api", externalRevenueRoutes)`
- [ ] `app.use("/api", medicationRoutes)`
- [ ] `app.use("/api", participantsRoutes)`

Also legacy-compatible root/public mounts that should be standardized:

- [ ] `app.use("/", authRoutes)`
- [ ] `app.use("/", rolesRoutes)`
- [ ] `app.use("/public", organizationsRoutes)`

## 1.2 Backend architecture legacy patterns

- [ ] `api.js` monolithic composition root (~1400 lines).
- [ ] Manual route registration spread in one file (no canonical route registry object).
- [ ] Mixed authorization paradigms (`authorize` role-based compatibility + permission-based model).
- [ ] Legacy API versioning coexistence (`/api` and `/api/v1`) without strict enforcement gate.

## 1.3 SPA legacy feature modules (top-level scripts)

These top-level `spa/*.js` modules represent legacy page-style architecture that should be migrated into a modern module/page structure:

- [ ] `spa/JSONFormRenderer.js`
- [ ] `spa/acceptation_risque.js`
- [ ] `spa/activities.js`
- [ ] `spa/activity-widget.js`
- [ ] `spa/admin.js`
- [ ] `spa/ajax-functions.js`
- [ ] `spa/approve_badges.js`
- [ ] `spa/attendance.js`
- [ ] `spa/badge_dashboard.js`
- [ ] `spa/badge_form.js`
- [ ] `spa/badge_tracker.js`
- [ ] `spa/budgets.js`
- [ ] `spa/calendars.js`
- [ ] `spa/carpool.js`
- [ ] `spa/carpool_dashboard.js`
- [ ] `spa/communication-settings.js`
- [ ] `spa/create_organization.js`
- [ ] `spa/dashboard.js`
- [ ] `spa/district_management.js`
- [ ] `spa/dynamicFormHandler.js`
- [ ] `spa/expenses.js`
- [ ] `spa/external-revenue.js`
- [ ] `spa/fiche_sante.js`
- [ ] `spa/finance.js`
- [ ] `spa/formBuilder.js`
- [ ] `spa/form_permissions.js`
- [ ] `spa/formulaire_inscription.js`
- [ ] `spa/fundraisers.js`
- [ ] `spa/group-participant-report.js`
- [ ] `spa/guardian-management.js`
- [ ] `spa/indexedDB.js`
- [ ] `spa/init-activity-widget.js`
- [ ] `spa/inventory.js`
- [ ] `spa/jwt-helper.js`
- [ ] `spa/login.js`
- [ ] `spa/mailing_list.js`
- [ ] `spa/manage_groups.js`
- [ ] `spa/manage_honors.js`
- [ ] `spa/manage_participants.js`
- [ ] `spa/manage_points.js`
- [ ] `spa/manage_users_participants.js`
- [ ] `spa/material_management.js`
- [ ] `spa/medication_management.js`
- [ ] `spa/medication_reception.js`
- [ ] `spa/offline-init.js`
- [ ] `spa/offline_preparation.js`
- [ ] `spa/parent_contact_list.js`
- [ ] `spa/parent_dashboard.js`
- [ ] `spa/parent_finance.js`
- [ ] `spa/permission_slip_dashboard.js`
- [ ] `spa/permission_slip_sign.js`
- [ ] `spa/preparation_reunions.js`
- [ ] `spa/pwa-update-manager.js`
- [ ] `spa/register.js`
- [ ] `spa/register_organization.js`
- [ ] `spa/reports.js`
- [ ] `spa/reset_password.js`
- [ ] `spa/resource_dashboard.js`
- [ ] `spa/revenue-dashboard.js`
- [ ] `spa/role_management.js`
- [ ] `spa/time_since_registration.js`
- [ ] `spa/upcoming_meeting.js`
- [ ] `spa/view_participant_documents.js`

## 1.4 SPA transitional core files (keep but modernize boundaries)

These are foundational and may remain, but should be reduced to orchestration-only responsibilities:

- [ ] `spa/app.js`
- [ ] `spa/router.js`
- [ ] `spa/config.js`
- [ ] `spa/functions.js`

## 1.5 Mobile architecture parity debt (not legacy, but migration dependency)

Not legacy in structure, but part of full modernization because duplicated API behavior exists across clients:

- [ ] `mobile/src/api/api-core.js` behavior parity alignment with `spa/api/api-core.js`.
- [ ] Shared API behavior specification and test vectors for both clients.

---


## 1.6 Backend endpoint usage audit baseline (frontend/backend comparison)

Based on `devdocs/API_ENDPOINT_USAGE_AUDIT.md` static comparison:

- [ ] Candidate backend endpoints analyzed: `336`
- [ ] Frontend/mobile unique referenced API paths: `50`
- [ ] Statically unreferenced backend endpoint candidates: `283`
- [ ] Frontend/mobile paths with no backend match (possible stale calls): `6`

Follow-up actions:

- [ ] Validate each unreferenced candidate with runtime logs before deletion (external consumers may exist).
- [ ] Add endpoint hit telemetry (per route) to distinguish truly dead endpoints from low-frequency endpoints.
- [ ] Prioritize deprecation/removal for endpoints unreferenced by both SPA/mobile and with zero production hits.
- [ ] Reconcile stale frontend/mobile paths listed in the audit report.

## 2) Target Modern Architecture

## 2.1 Backend target

- Single route registry with metadata (name, prefix, version, auth mode, tenant scoped, owner).
- `/api/v1` as canonical endpoint prefix.
- Legacy compatibility adapter layer isolated and sunset-tracked.
- `api.js` replaced by thin composition root with extracted modules:
  - `server/bootstrap/*`
  - `server/routes/*`
  - `server/runtime/*`

## 2.2 SPA target

- Feature pages implemented as modular units under `spa/modules` (+ route mapping).
- API access only through `spa/api/*` wrappers.
- Sanitized DOM utilities and shared debug utilities used universally.
- Offline capabilities retained via dedicated sync/data modules (not embedded per-page).

## 2.3 Mobile target

- Keep current screen/component/navigation modular architecture.
- Standardize API semantics with SPA using shared contract tests + behavior spec.

---

## 3) End-to-End Modernization Workflow (Migrate Everything)

## Wave 0 — Governance and safety rails (must complete first)

- [ ] Create `devdocs/API_VERSIONING_POLICY.md` with explicit legacy allowlist and deprecation dates.
- [ ] Replace brittle `lint:api-version` script with deterministic checker.
- [ ] Add CI check for duplicate `app.use(path, router)` mounts.
- [ ] Add CI check to block new top-level SPA feature scripts (`spa/*.js`) except approved entry files.

**Exit criteria**
- CI blocks new legacy-pattern additions.
- Migration can proceed without architecture regression.

## Wave 1 — Backend migration to `/api/v1` (compatibility-preserving)

For each legacy backend mount listed in Section 1.1:

- [ ] Introduce corresponding `/api/v1/...` canonical routes if not present.
- [ ] Keep temporary compatibility aliases under `/api/...`.
- [ ] Add deprecation logging for legacy route hits.
- [ ] Update SPA/mobile API endpoint maps to canonical `/api/v1`.

**Special mandatory tasks**
- [ ] Remove duplicate `/api/ai` registration.
- [ ] Standardize auth/roles root mounts to versioned API where appropriate.

**Exit criteria**
- All active client traffic uses `/api/v1`.
- Legacy aliases remain only for controlled sunset period.

## Wave 2 — Decompose monolithic server bootstrap

- [ ] Extract middleware config from `api.js` to `server/bootstrap/middleware.js`.
- [ ] Extract route mounting to `server/routes/registerRoutes.js` driven by registry.
- [ ] Extract static/catch-all handling to `server/bootstrap/static.js`.
- [ ] Extract Socket.IO setup to `server/runtime/socket.js`.
- [ ] Keep `api.js` as orchestration-only file.

**Exit criteria**
- `api.js` reduced to thin startup composition.
- Route registration source-of-truth is centralized and testable.

## Wave 3 — SPA legacy feature migration (complete list execution)

For each legacy SPA feature file in Section 1.3:

- [ ] Create modern module counterpart under `spa/modules/<feature>/` (or agreed structure).
- [ ] Move API calls to `spa/api/*` wrappers.
- [ ] Move DOM write paths to shared safe helpers (`DOMUtils`, `SecurityUtils`).
- [ ] Ensure loading/error/empty states are explicit.
- [ ] Ensure all user-facing text is translation-key based.
- [ ] Replace top-level file export with temporary compatibility shim.
- [ ] Remove shim after route switch-over stabilization.

**Batching strategy**
- Batch A (auth/profile): `login`, `register`, `reset_password`, profile/user linkage.
- Batch B (core operations): participants/groups/attendance/activities.
- Batch C (forms/permissions): registration, health, risk, permission slip flows.
- Batch D (finance/reporting): finance/budgets/reports/revenue/fundraisers.
- Batch E (admin/inventory/resources): role mgmt, admin, inventory, resources, medication.
- Batch F (parent/district dashboards + auxiliary pages).

**Exit criteria**
- No remaining business-feature logic in top-level legacy `spa/*.js` files.
- Top-level files reduced to bootstrap-only entries or removed.

## Wave 4 — Cross-client API contract unification

- [ ] Publish `devdocs/API_CLIENT_BEHAVIOR_SPEC.md`.
- [ ] Define shared behavior vectors: retries, timeout, 401 handling, envelope parsing, org header handling.
- [ ] Add automated tests validating SPA and mobile API client parity.

**Exit criteria**
- Equivalent client behavior for shared API error/success scenarios.

## Wave 5 — Security and tenancy regression hardening

- [ ] Add tenant isolation tests for representative read/write endpoints in every major domain.
- [ ] Add tests for organization resolution precedence and override rejection.
- [ ] Add response envelope contract tests for `success/error/paginated`.

**Exit criteria**
- CI can detect authz, tenancy, and envelope regressions early.

## Wave 6 — Legacy sunset and cleanup

- [ ] Remove `/api` compatibility aliases per policy timeline.
- [ ] Remove compatibility shims for migrated SPA files.
- [ ] Remove deprecated role-based middleware usage where permission middleware exists.
- [ ] Archive migration status and final architecture decision records (ADRs).

**Exit criteria**
- Canonical architecture only (versioned APIs + modular clients).
- Legacy pathways removed or explicitly isolated.

---

## 4) Migration Tracking Matrix

Use the following status tags for each legacy item in Section 1:

- `NOT_STARTED`
- `IN_PROGRESS`
- `MIGRATED_CANONICAL`
- `COMPAT_ALIAS_ACTIVE`
- `SUNSETTED`

For each item, track:

- Owner
- Start date
- Target sunset date
- Blocking dependencies
- Test coverage status
- Rollback plan

---

## 5) Definition of Done (program-level)

Modernization is complete only when all are true:

- [ ] No duplicate route mounts.
- [ ] No new non-allowlisted legacy `/api` mounts.
- [ ] All core endpoints consumed via `/api/v1`.
- [ ] SPA business features migrated out of legacy top-level scripts.
- [ ] API behavior parity documented and tested across SPA/mobile.
- [ ] Tenant isolation and response envelope tests enforced in CI.
- [ ] Legacy compatibility layers either sunsetted or explicitly isolated with owner + date.
