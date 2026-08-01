# SPA and Backend API Review Suggestions

Reviewed: 2026-08-01

## Review summary

The production SPA build succeeds, all 61 runnable Jest suites pass (917 tests), the API-version, route-mount, SQL-parameterization, SPA-structure, and translation-parity checks pass, and the English/French catalogs contain the same 3,032 keys. The current automated suite does not exercise several live SPA-to-API contracts, however. The review found the confirmed functional defects below.

The five skipped suites contain 84 skipped tests. Most backend tests use mocked database behavior, so this review does not establish production-database or third-party-service health.

## Confirmed functional defects

### P1 — Fundraiser management has three broken operations

1. **Editing calls the create endpoint with the wrong payload.** `spa/ajax-functions.js:258` aliases `updateFundraiser` to `saveFundraiser`. The edit screen calls it as `updateFundraiser(id, data)`, but `saveFundraiser` accepts one argument and posts that first argument to `POST /api/v1/fundraisers` (`spa/api/api-endpoints.js:1786-1787`). The submitted body is therefore the fundraiser ID, not the edited fields. Add a real `updateFundraiser(id, data)` wrapper using `PUT /api/v1/fundraisers/:id`.

2. **Archive/unarchive has no matching route.** The client calls `PUT /api/v1/fundraisers/:id/archive` (`spa/api/api-endpoints.js:1793-1794`), while the router is already mounted at `/api/v1/fundraisers` and declares `/fundraisers/:id/archive` (`routes/fundraisers.js:338`). Its effective URL is `/api/v1/fundraisers/fundraisers/:id/archive`. Change the router path to `/:id/archive`.

3. **Fundraiser entries are discarded by the SPA.** The backend standardizes the result as `data.fundraiser_entries` (`routes/calendars.js:86`), but `spa/calendars.js:51` reads `response.fundraiser_entries`. As a result, a successful request renders an empty list. Read `response.data?.fundraiser_entries`, ideally through a shared response-normalization convention.

Add an integration/contract test that creates, edits, archives, restores, opens, and updates a fundraiser and its entries through the same API helpers used by the SPA.

### P1 — Pending-user approval calls a nonexistent endpoint

`approveUser()` posts to `approve-user`, which resolves to `/api/v1/approve-user` (`spa/api/api-endpoints.js:714-715`). The registered backend endpoint is `/api/v1/users/approve` (`routes/users.js:245`, mounted at `routes/index.js:111`). This prevents approval from the Admin screen. Change the helper to `API.post('v1/users/approve', ...)` and add an Admin-screen contract test.

### P1 — Google Chat settings routes are double-prefixed

The router is mounted at `/api/v1/google-chat` (`routes/index.js:143`) but declares paths such as `/google-chat/config`, `/google-chat/spaces`, and `/google-chat/send-message` (`routes/google-chat.js:75`, `:153`, `:234`, and `:403`). Their effective paths contain `google-chat/google-chat`. The SPA correctly requests `/api/v1/google-chat/...` (`spa/communication-settings.js:42-43`, `:214`, `:245`, and `:282`), so configuration loading, credential saving, space registration, and test messaging cannot reach the handlers.

Make route declarations relative (`/config`, `/spaces`, `/send-message`, `/broadcast`, `/messages`) or mount this router at `/api/v1`. Add route tests for every Google Chat operation, including authentication, permissions, validation, tenant isolation, and demo-role write blocking.

### P2 — District Management cannot load the user's organizations

`getUserOrganizations()` requests `/api/v1/user-organizations` (`spa/api/api-endpoints.js:742-748`), but the only matching handler is mounted under Form Builder, making its registered URL `/api/v1/form-builder/user-organizations` (`routes/formBuilder.js:322`, `routes/index.js:129`). District Management catches the resulting error and silently shows no organizations.

Prefer a resource-oriented endpoint such as `GET /api/v1/users/me/organizations`; otherwise point the helper at the current Form Builder route. Add coverage for District Management initialization with one and multiple organizations.

## Security and integrity improvements

### P1 — Do not return internal exception messages in HTTP 500 responses

At least 35 handlers return `error.message` directly. Examples include `routes/forms.js:696` and `:1423`, `routes/announcements.js:781`, plus handlers in auth, dashboards, import, WhatsApp, honors, Google Chat, and notifications. Database and SDK exceptions can contain schema names, constraint names, filesystem paths, or other internals, conflicting with the documented no-stack/no-internal-path policy.

Log the detailed exception server-side and return a stable translation key or generic message through `middleware/response.js`. Extend security tests to inject errors containing paths, SQL details, and stack fragments across every route module.

### P2 — Make the two SPA source lint rules fail closed

`lint:spa-console` and `lint:spa-innerhtml` use an `rg ... && fail || success` shell expression (`package.json:24-25`). When `rg` is missing, the command-not-found exit is treated as success. This occurred during this review. Check for the executable first and fail with a clear setup error, or replace the shell expressions with Node scripts. The independent fallback scan found no current `console.*` or direct `innerHTML =` violations.

### P2 — Use the standard auth/authorization middleware consistently

Several older route modules manually decode JWTs and check roles or permissions. This duplicates security behavior and makes `blockDemoRoles`, standardized 401/403 payloads, and JWT changes easy to miss. Migrate protected endpoints to `authenticate`, `requirePermission`/`requireAnyPermission`, `blockDemoRoles` for writes, and `getOrganizationId`. Google Chat and legacy form writes should be prioritized.

### P2 — Add an automated SPA/API contract inventory

The current tests validate many handlers but did not catch the mismatched live URLs or response envelope. Generate or maintain an endpoint manifest from the Express route registry/OpenAPI definitions, then test every literal endpoint used by `spa/api/` and direct `makeApiRequest()` calls for:

- a registered method and path;
- expected authentication and permission middleware;
- standardized success/error envelopes;
- tenant scoping;
- correct demo-role behavior for writes.

This should also identify stale helpers for unregistered endpoints such as role bundles/audit logs and unused authentication compatibility functions, allowing them to be implemented or removed deliberately.

### P3 — Increase end-to-end coverage of high-value workflows

Add browser-level tests for login/2FA, participant CRUD, form submission, attendance, fundraiser lifecycle, user approval/role assignment, offline mutation replay, permission-slip signing, medication handling, and communication settings. Run a small PostgreSQL-backed suite for migrations, constraints, transactions, and multi-tenant isolation; mocked query sequences cannot detect schema drift.

### P3 — Normalize API response consumption

Some routes return standardized `{ success, data }` responses while older routes return resource properties at the top level. Introduce typed/schema-validated response adapters per resource and migrate callers to one convention. This would prevent defects like the fundraiser-entry envelope mismatch and make API modernization safer.

## Verification performed

- `npm test -- --runInBand`: 61 passed suites, 5 skipped; 917 passed tests, 84 skipped.
- `npm run test:quality`: 54 passed suites, 5 skipped; 720 passed tests, 84 skipped.
- `npm run build`: successful Vite and PWA production builds (155 SPA modules transformed).
- Passed: API versioning, duplicate mounts, SPA file placement, SQL parameterization, non-versioned mount policy, and i18n key parity.
- Independently checked SPA source for prohibited `console.*` and direct `innerHTML =` usage because the packaged lint commands falsely passed without `rg`; no current violations were found.
- Traced the central API request builder, 392 Express route declarations, route mounts, authentication/authorization patterns, and major SPA feature helpers.

