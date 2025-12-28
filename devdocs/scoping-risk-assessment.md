# Scoping & Risk Assessment (Web API + SPA)

Date: 2025-02-14

## Scope
- **Backend/API**: `api.js`, `routes/`, `middleware/`, `utils/`.
- **SPA**: `spa/`, `css/`, `assets/`.
- **Excluded**: `mobile/`.

## Inventory Summary

### API Route Versioning
- **`/api/v1` usage**
  - Registered in `api.js` for attendance, groups, local-groups, resources, activities, carpools, participants.
  - Dedicated v1 modules include: `routes/localGroups.js`, `routes/userProfile.js`, `routes/participants.js`, `routes/users.js`, `routes/attendance.js`, `routes/notifications.js`, `routes/external-revenue.js`, `routes/groups.js`, `routes/whatsapp-baileys.js`.
- **Legacy `/api` usage**
  - Broad `/api` registrations remain for many modules: organizations, users, userProfile, meetings, calendars, fundraisers, forms, formBuilder, reports, dashboards, badges, guardians, notifications, announcements, whatsappBaileys, googleChat, honors, points, public, import, finance, stripe, budgets, externalRevenue, medication, participants.
  - Dual registration still exists for at least **attendance** and **participants** (`/api/v1/...` and `/api/...`).

**Risk**: mixed versioning creates ambiguous contract expectations, and the duplicated routes increase maintenance and regression risk.

### Response Shape Consistency
- `middleware/response.js` provides standardized response helpers, but a large number of routes use direct `res.json(...)` with inconsistent keys (`success`, `data`, `message`, etc.).
- Examples found in: `routes/calendars.js`, `routes/fundraisers.js`, `routes/google-chat.js`, `routes/stripe.js`, `routes/announcements.js`, `routes/roles.js`, `routes/notifications.js`, `routes/dashboards.js`, `routes/groups.js`, `routes/points.js`, `routes/whatsapp-baileys.js`, `routes/auth.js`, `routes/honors.js`, `routes/users.js`, `routes/forms.js`, `routes/reports.js`, `routes/guardians.js`, `routes/organizations.js`, `routes/public.js`, `routes/meetings.js`, `routes/import.js`, `routes/badges.js`.

**Risk**: response drift forces the SPA to handle multiple shapes, increasing bugs and slowing iteration.

### Tenant Resolution & Org Scoping
- Client-provided org ID appears in multiple resolution paths:
  - `middleware/auth.js` accepts `x-organization-id`, query param `organization_id`, and body `organization_id`.
  - `utils/api-helpers.js` accepts `x-organization-id`.
- SPA sends org ID via headers and query/body in `spa/api/api-helpers.js`, `spa/api/api-core.js`, and `spa/api/api-endpoints.js`.

**Risk**: relying on client-controlled org identifiers can lead to tenant-boundary bypass if validation is inconsistent per route.

### SQL Parameterization
- Many queries use parameterized placeholders with `pool.query(...)`.
- Large surface area (hundreds of usages) makes manual audit necessary.

**Risk**: high risk surface for SQL injection if any `pool.query` slips through without parameterization.

### CSP/CORS
- CSP/CORS are defined in `api.js` but allow inline scripts/styles and permissive origins (per code review doc). Needs hardening for production.

**Risk**: inline allowances weaken XSS defenses; permissive CORS increases trust boundary risk.

### Logging Configuration
- Separate loggers currently appear in `api.js`, `middleware/auth.js`, and `utils/api-helpers.js`.

**Risk**: fragmented logs, duplicated handlers, inconsistent retention/format, and harder operational tracing.

### Validation Consistency
- Validation patterns exist in some routes (e.g., `routes/auth.js`), but not applied consistently across all modules.

**Risk**: inconsistent input validation increases security risk and increases data-shape handling complexity.

---

## SPA Inventory

### Hardcoded Organization Fallback
- `spa/app.js` falls back to `this.organizationId = 1` when org resolution fails.

**Risk**: hardcoded fallback violates multi-tenant boundaries and “no hacks” guidance; may hide org resolution failures.

### Console Usage Outside DebugUtils
- `console.*` usage exists outside `spa/utils/DebugUtils.js`:
  - `spa/offline-init.js`
  - `spa/router.js`
  - `spa/manage_points.js`
  - `spa/utils/BaseModule.js`

**Risk**: production logging leaks internal state, diverges from standard debug pipeline.

### Direct `innerHTML` usage
- Direct usage found in:
  - `spa/role_management.js`
  - `spa/utils/ValidationUtils.js`
  - `spa/reports.js`
  - `spa/utils/SimpleWYSIWYG.js`
  - `spa/utils/SecurityUtils.js` (sanitized usage)
  - `spa/utils/DOMUtils.js` (sanitized usage)

**Risk**: direct DOM injection increases XSS risk if sanitization is missed; some usage is safe but needs verification.

### i18n Coverage
- Multiple user-facing strings in SPA are not centrally audited.

**Risk**: bilingual requirements may be violated and locale-specific formatting inconsistent.

### AJAX/Fetch Consistency
- SPA uses both centralized `ajax` utilities and direct fetch (`spa/app.js` for push subscription).

**Risk**: inconsistent error handling, auth headers, and retries.

---

## Risk Prioritization (High → Low)
1. **Tenant isolation weaknesses** (client-controlled org IDs on authenticated routes).
2. **CSP/CORS looseness** (inline scripts and permissive origins).
3. **Response shape drift** (high maintenance burden + subtle UI bugs).
4. **API versioning inconsistencies** (dual `/api` + `/api/v1`).
5. **Direct DOM injection + logging leaks** (SPA hygiene/security).
6. **Validation inconsistencies and SQL audit gaps** (security hygiene at scale).

---

## Evidence / Commands Run
- `rg "api/v1" -n api.js routes`
- `rg "\"/api" -n api.js routes`
- `rg "console\." -n spa`
- `rg "innerHTML" -n spa`
- `rg "organizationId" -n spa/app.js spa`
- `rg "x-organization-id" -n middleware utils routes`
- `rg "organization_id" -n middleware utils routes`
- `rg "response\.success|response\.error|res\.json" -n routes middleware`
