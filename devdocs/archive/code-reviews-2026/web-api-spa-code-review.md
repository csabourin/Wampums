# Wampums Web API + SPA Code Review (Excludes /mobile)

## Scope
- **Backend/API**: `api.js`, `routes/`, `middleware/`, `services/`, `utils/`, and config files that directly affect the API runtime.
- **SPA**: `spa/`, `css/`, `assets/`, and shared browser utilities.
- **Excluded**: `mobile/` per request.

## Executive Summary
The codebase is feature-rich and already includes many best practices: modular routes, rate limiting, JWT auth, CSP headers, and client-side sanitization utilities. The largest risks center around **inconsistent API versioning/response formats**, **tenancy enforcement and origin trust boundaries**, **CSP/CORS looseness**, and **frontend use of hardcoded fallbacks and console logging outside DebugUtils**. Addressing these will improve security posture, maintainability, and cross-team onboarding.

---

## Strengths & What’s Working Well

### API
- **Layered security controls** in `api.js` (Helmet CSP/HSTS, rate limiting, CORS) provide a solid baseline.
- **JWT auth with structured role/permission support** in `middleware/auth.js` is forward-looking, with a clear migration path away from role-only checks.
- **Reusable response helpers** in `middleware/response.js` encourage consistent output.
- **Organization fallback UX** in `utils/api-helpers.js` provides a clear, user-friendly failure path when tenant resolution fails.

### SPA
- **Centralized DOM sanitization** in `spa/utils/DOMUtils.js` and `spa/utils/SecurityUtils.js` is a strong foundation for XSS prevention.
- **Routing/bootstrapping separation** (`spa/app.js`, `spa/router.js`) keeps the SPA architecture approachable.
- **Debug utilities** (`spa/utils/DebugUtils.js`) formalize logging in a non-invasive way.

---

## API Review & Recommendations

### 1) **Inconsistent API Versioning**
**Why it matters:** makes client integration and documentation harder; increases migration risk.
- `api.js` registers a mix of `/api` and `/api/v1` routes, and in some cases duplicates both (e.g., attendance, participants).
- Recommendation:
  - Publish a migration roadmap to `/api/v1` only.
  - Add a deprecation banner in responses for legacy `/api` routes.
  - Keep a redirect or explicit compatibility wrapper until consumers are migrated.

### 2) **Response Shape Drift**
**Why it matters:** frontend must handle multiple formats; hard to maintain.
- `middleware/response.js` provides `success/error/paginated`, but many routes still respond via raw `res.json` with varying keys.
- Recommendation:
  - Standardize on `middleware/response` across all routes.
  - Enforce in new code via linting or a shared `asyncHandler` wrapper.

### 3) **Tenant Resolution Trust Boundaries**
**Why it matters:** multi-tenant isolation depends on correct org resolution.
- `middleware/auth.js` and `utils/api-helpers.js` accept `x-organization-id`, query params, and body values.
- Risk: these are **client-controlled** and can be spoofed unless every route re-validates against the authenticated user’s org.
- Recommendation:
  - Restrict or remove client-provided organization overrides for authenticated routes.
  - For admin tools, validate the org ID against permitted orgs in DB.
  - Consider a single, authoritative source (JWT org claim or domain mapping only).

### 4) **CSP and Inline Script Allowances**
**Why it matters:** weakens XSS protections.
- `api.js` CSP allows `'unsafe-inline'` for scripts and styles.
- Recommendation:
  - Move inline scripts to static files and use nonces or hashes.
  - Audit whether `styleSrc` can be limited to non-inline in production.

### 5) **CORS Whitelisting Patterns**
**Why it matters:** wide patterns can unintentionally allow unwanted origins.
- The wildcard patterns in `api.js` are flexible but permissive in dev and allow `*` in subdomains.
- Recommendation:
  - Separate dev/prod lists into explicit env vars.
  - Add a log entry when a wildcard match is used in production.
  - Consider stricter origin checks for high-risk endpoints (auth, payments).

### 6) **Logging Configuration Duplication**
**Why it matters:** logs are scattered and harder to trace.
- `api.js`, `middleware/auth.js`, and `utils/api-helpers.js` each create their own `winston` logger with different file locations (`logs/` vs root).
- Recommendation:
  - Consolidate logging into a single logger module used across the backend.
  - Standardize log file paths to avoid fractured logs and repeated file handlers.

### 7) **API Validation Consistency**
**Why it matters:** input validation reduces security risk and bugs.
- Validation is used in several modules (e.g., `routes/auth.js`) but not consistently enforced across all routes.
- Recommendation:
  - Create a shared validation policy with helper wrappers.
  - For each route module, enforce a baseline validation schema for query/body params.

### 8) **Ensure Query Parameterization Everywhere**
**Why it matters:** SQL injection risk.
- Many routes use parameterized queries already, but not all are confirmed.
- Recommendation:
  - Add a lint rule or review checklist for all `pool.query` calls.
  - Extract query builders into helpers where possible.

### 9) **Explicit Use of `/api/v1` for New Endpoints**
**Why it matters:** aligns with CLAUDE.md and keeps routing predictable.
- Some new-looking endpoints still route under `/api`.
- Recommendation:
  - Use `/api/v1` exclusively for new feature work.
  - Add a regression check in review / tests to prevent new `/api` endpoints.

---

## SPA Review & Recommendations

### 1) **Hardcoded Organization Fallback**
**Why it matters:** breaks multi-tenant isolation and violates “no hacks” guidance.
- `spa/app.js` falls back to `organizationId = 1` on org lookup failure.
- Recommendation:
  - Replace hardcoded fallback with a config-driven value from `spa/config.js` or a redirect to organization selection.
  - Surface an i18n-friendly error state instead of silent fallback.

### 2) **Console Usage Outside DebugUtils**
**Why it matters:** inconsistent logging and potential leakage in production.
- Instances of `console.*` appear in `spa/router.js`, `spa/manage_points.js`, and `spa/offline-init.js`.
- Recommendation:
  - Route all logs through `debugLog/debugError` with `isDebugMode()` checks.
  - Use the single permitted console exception described in `spa/config.js`.

### 3) **i18n Coverage Audit**
**Why it matters:** bilingual requirement and translation parity.
- Many modules likely include strings not sourced from `lang/*.json` (e.g., router debug strings, offline banners, and some user-facing errors).
- Recommendation:
  - Audit all user-facing strings in `spa/` and move to translation keys.
  - Add a build-time check or script to flag inline string literals in UI render functions.

### 4) **Centralize Fetch/Ajax Patterns**
**Why it matters:** consistency and shared auth/timeout/retry behavior.
- `spa/app.js` uses `fetch` directly for push subscriptions, bypassing shared `ajax` helpers.
- Recommendation:
  - Use a single API client wrapper for auth headers, error handling, and retries.
  - Consolidate common response parsing into `spa/ajax-functions.js`.

### 5) **Loading/Error/Empty State Consistency**
**Why it matters:** user experience and operational clarity.
- Some modules implement their own loading banners; others rely on silent failures.
- Recommendation:
  - Define a shared UI pattern for loading/empty/error states and reuse across modules.
  - Ensure errors are translatable (translation keys instead of raw strings).

### 6) **Security Utilities Adoption**
**Why it matters:** avoid bypassing sanitization for dynamic HTML.
- `spa/utils/DOMUtils.js` provides safe helpers, but not all modules appear to use them.
- Recommendation:
  - Ensure modules use `setContent` or `setText` instead of direct `innerHTML`/`textContent` writes.
  - Add a lint rule or codemod to reduce direct DOM injection.

### 7) **Router Debug Paths**
**Why it matters:** debug logs can leak internal route structure.
- `spa/router.js` includes extensive console logging for route matching.
- Recommendation:
  - Wrap route debug logs in `isDebugMode()` and suppress them in production.

---

## Cross-Cutting Recommendations

1. **Create a “Security & Tenancy Checklist”** for all routes:
   - Requires: `authenticate`, org resolution, `organization_id` filtering, validation, and sanitized outputs.
2. **Adopt a unified config system** across API and SPA to avoid magic values.
3. **Add a lightweight linting pass** for:
   - raw `console.*` in SPA,
   - direct `innerHTML` usage,
   - non-parameterized SQL query usage,
   - any new `/api` (non-v1) routes.

---

## Suggested Next Steps (Prioritized)
1. **API versioning cleanup**: new features under `/api/v1` only; document `/api` deprecation.
2. **Tenant isolation hardening**: disallow client-provided org IDs on authenticated requests.
3. **CSP tightening**: remove `unsafe-inline` and adopt nonces/hashes.
4. **SPA hardcoded org fallback removal**: replace with config or error state.
5. **Standardize responses & logging**: enforce `middleware/response` and unified logger usage.

---

## Files & Key References (Non-Exhaustive)
- API entry: `api.js`
- Auth: `middleware/auth.js`, `routes/auth.js`
- Response helpers: `middleware/response.js`
- Org resolution: `utils/api-helpers.js`
- SPA app/router: `spa/app.js`, `spa/router.js`
- DOM sanitization: `spa/utils/DOMUtils.js`, `spa/utils/SecurityUtils.js`
- Debug logging: `spa/utils/DebugUtils.js`
