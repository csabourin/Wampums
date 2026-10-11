# Agent Guidelines for Wampums

These instructions apply to all work in this repository. **`CLAUDE.md` is the full standard**; this file
is its summary, and where they differ, `CLAUDE.md` wins. **The tests are the most current specification:**
read the tests of the area you touch before you change it, and when a test and a document disagree, the
test wins and the document gets fixed.

## Core Principles
- **One language per page**, English and French always at parity (`npm run lint:i18n-parity`). Every key
  the code uses exists in both (`test/spa/TranslationCoverage.test.js`). Never show a raw key, a role's
  internal name, or the server's English `message`. Use locale-aware date and number formatting.
- **Mobile-first and accessible** (WCAG 2.2 AA): native labelled controls, 44px touch targets, visible
  focus, no sideways scroll at 390px.
- **No hacks**: no hardcoded values or magic numbers (use `spa/config.js` and named constants), no
  commented-out or duplicate code. Check `spa/utils/` before writing a helper.
- **Security first**: escape what you inject, parameterized SQL only, validate input, never log or
  return secrets, tokens or stack traces.
- **Documentation**: JSDoc for non-trivial functions; update the docs when behaviour changes.

## Architecture & API
- Routes in `routes/*.js`, mounted in `routes/index.js`, under `/api/v1/`; responses through
  `success` / `error` / `paginated` / `forbidden` from `middleware/response.js`.
- `authenticate` + `requirePermission('x.y')` (+ `blockDemoRoles` on writes) from `middleware/auth.js`.
  Never decide access by a role's name. `authorize()`, `hasAnyRole()` and route-local JWT checks are gone.
- Tenant isolation: `getOrganizationId(req, pool)` and `organization_id` in every query.
- Access to children goes through `services/participantAccess.js`; roles through
  `services/roleAssignment.js`. Schema changes are re-runnable files in `migrations/`.

## Frontend (SPA)
- New screens in `spa/modules/<feature>/`, never the `spa/` root. API calls in
  `spa/api/api-<feature>.js` through `API` from `spa/api/api-core.js`; writes invalidate the cache.
- `setContent()`, never `innerHTML =`; `escapeHTML()` / `escapeAttribute()` for anything from people.
- Every screen: `renderBackLink()` first, then loading, error-with-retry and empty states.
- `openModal()` and `DialogUtils`, never hand-built overlays or browser dialogs.
- `hasPermission()` / `isParent()`, never `hasRole()`; guard the route with the permission its
  endpoints require.
- `apiErrorMessage()` for failures, `this.app.showMessage()` for toasts, `debugLog` / `debugError`
  instead of `console.*`.
- Reference screens: `spa/modules/walk-in/WalkInChildren.js`, `spa/modules/messages/Messages.js`.

## Mobile (Expo)
- `mobile/` has its own toolchain and is changed only when a task asks for it. It mirrors web security
  practices (`mobile/src/utils/SecurityUtils.js`) and the `lang/*.json` keys.

## Testing & Deployment
- Every behaviour change comes with a test named as a plain statement of behaviour. SPA tests live in
  `test/spa/` (jsdom, with an `axe-core` check for new screens and dialogs). Integration tests
  (`*.integration.test.js`) need `TEST_DATABASE_URL`.
- Before a PR: `npm run lint:all`, `npm run build`, `npm run test:quality`, and the integration suites
  when you touch access, roles, families or scout years.
- To see a change in a browser, use the `run-wampums` skill (`.claude/skills/run-wampums/`).
- Required env vars: `DATABASE_URL`, `JWT_SECRET_KEY`; see `.env.example` for the rest.
