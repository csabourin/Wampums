# Stale Code Review: Commit `fb1d49a` vs `main`

**Date:** 2026-03-01
**Commit:** `fb1d49a` — "feat: Implement comprehensive updates across landing pages, SPA, backend routes, services, database schema, API contracts, testing infrastructure, and documentation."
**Scope:** 277 files changed, ~248K lines modified

## Executive Summary

This single monolithic commit bundles legitimate new features alongside **critical regressions** hidden inside massive whitespace reformatting. Of 277 files changed, **~161 (58%) are whitespace-only** (CRLF→LF normalization), inflating the diff by ~190,000 lines with zero functional change. The remaining ~116 files contain a mix of real improvements, deliberate feature removals, and **serious bugs** including 11+ broken API endpoints, a route-ordering bug that shadows 8-10 form endpoints, and removed security handlers.

---

## CRITICAL Issues (Will break production)

### 1. Route Ordering Bug in `routes/forms.js`

The parameterized `/:id` routes were moved from the **END** of the router to **near the TOP**. The old file explicitly warned:

```
// ---- Parameterized /:id routes MUST be last to avoid shadowing literal paths ----
```

Now `router.get('/:id', ...)` appears before `/submissions`, `/formats`, `/structure/:form_type`, `/risk-acceptance`, `/form-permissions`, etc. Since `/:id` matches any path segment, **8-10 form GET endpoints will return 404** because they get intercepted by the `/:id` handler.

### 2. 11+ Broken Frontend API URLs

Frontend API paths in `spa/api/api-endpoints.js`, `spa/reset_password.js`, and `spa/modules/AI.js` were renamed to "cleaner" URLs, but **the backend routes were NOT updated to match**. The `buildApiUrl()` function in `api-core.js` has prefix-detection logic where `api/` gets `/` prepended, `v1/` gets `/api/` prepended, and everything else gets `/api/v1/` prepended.

| Function | Old Path (correct) | New Path (broken) | Resolves To | Server Route |
|---|---|---|---|---|
| `requestPasswordReset()` | `api/auth/request-reset` | `auth/request-reset` | `/api/v1/auth/request-reset` | `/api/auth/request-reset` |
| `resetPassword()` | `api/auth/reset-password` | `auth/reset-password` | `/api/v1/auth/reset-password` | `/api/auth/reset-password` |
| `verifySession()` | `api/auth/verify-session` | `v1/auth/verify-session` | `/api/v1/auth/verify-session` | `/api/auth/verify-session` |
| `updateUserRole()` | `users/update-role` | `update-user-role` | `/api/v1/update-user-role` | `/api/v1/users/update-role` |
| `getParticipantProgressReport()` | `reports/participant-progress` | `participant-progress` | `/api/v1/participant-progress` | `/api/reports/participant-progress` |
| `updateBadgeProgress()` | `v1/badges/badge-progress/{id}` | `v1/badges/{id}/progress` | `/api/v1/badges/{id}/progress` | `/api/v1/badges/badge-progress/:id` |
| `getBadgesAwaitingDelivery()` | `v1/badges/badges-awaiting-delivery` | `v1/badges/awaiting-delivery` | `/api/v1/badges/awaiting-delivery` | `/api/v1/badges/badges-awaiting-delivery` |
| `markBadgeDelivered()` | `v1/badges/mark-badge-delivered` | `v1/badges/mark-delivered` | `/api/v1/badges/mark-delivered` | `/api/v1/badges/mark-badge-delivered` |
| `markBadgesDeliveredBulk()` | `v1/badges/mark-badges-delivered-bulk` | `v1/badges/mark-delivered-bulk` | `/api/v1/badges/mark-delivered-bulk` | `/api/v1/badges/mark-badges-delivered-bulk` |
| `saveReunionPreparation()` | `v1/meetings/preparation` | `v1/meetings` | `/api/v1/meetings` | `/api/v1/meetings/preparation` |
| AI module `API_BASE` | `/api/v1/ai` | `/api/ai` | `/api/ai` | `/api/v1/ai` (returns 410) |

The same password reset breakage is duplicated in `spa/reset_password.js`.

### 3. Stripe CSP Removed But Stripe Routes Still Active

In `middleware/global.js`, CSP directives for Stripe were removed:
- `scriptSrc`: Removed `https://js.stripe.com`
- `connectSrc`: Removed `https://api.stripe.com`
- `frameSrc`: Changed from `["https://js.stripe.com"]` to `["'none'"]`

But `routes/stripe.js` is still registered and mounted. Browser-side Stripe payment integration will fail with CSP violations.

---

## HIGH Severity Issues

### 4. `config/app.js` — Two Regressions

- **Test environment guard removed:** `isTestEnvironment()` check around `serviceManager.init()` was deleted. Tests will now attempt to initialize real WhatsApp/Google Chat service connections.
- **URIError handler removed:** Malformed URL-encoded requests previously returned `400 Bad Request` with `"invalid_url_encoding"`. They now fall through to generic `500 Internal Server Error`.

### 5. Animateurs Data Parsing Broken (`spa/preparation_reunions.js`)

Changed from `animateursResponse?.data || []` to `animateursResponse?.animateurs || []`. The server returns data under the `data` key (via `success()` helper), so the leaders list will **always render as empty** on the meeting preparation page.

### 6. Admin Role Management Downgraded (`spa/admin.js`)

Replaced a multi-role checkbox modal (dynamically loaded from role catalog API) with a **hardcoded dropdown of 9 role names** allowing only one role per user. Users with multiple roles cannot be managed. The hardcoded list will drift out of sync with the database.

### 7. JSONFormRenderer Multi-select Broken (`spa/JSONFormRenderer.js`)

Multi-select checkbox group rendering for `select` fields with `field.multiple` was deleted. `getFormData()` simplified to `Object.fromEntries(formData.entries())` which only captures the **last selected value** for multi-checkbox fields.

### 8. `services/openai.js` — Regression

`max_completion_tokens: 2000` was changed to deprecated `max_tokens: 2000` (hidden inside whitespace reformatting).

---

## MEDIUM Severity Issues

### 9. Feature Removals (intentional but significant)

Three features were fully removed across backend, frontend, migrations, and translations:

**Incident Reports (complete system):**
- `routes/incidents.js` (946 lines, 14 endpoints)
- `spa/modules/incident-report/incident-report.js` (1,008 lines)
- `spa/api/api-incidents.js` (154 lines)
- `migrations/create_incident_reports.sql`, `seed_incident_report_form.sql`
- Router entries, permission utils, email queue processor, translation keys
- Internally consistent removal — no dangling references

**Medication Authorizations:**
- 4 endpoints removed from `routes/medication.js` (first-aid supplies, PDF A/B consent forms)
- 330 lines removed from `spa/medication_management.js`
- 4 API functions removed from `spa/api/api-endpoints.js`
- `migrations/add_medication_authorizations.sql` deleted
- Route removed from `spa/router.js`

**Medication Reminders:**
- `services/medication-reminders.js` deleted (push notification service for upcoming doses)
- `services/manager.js` cleaned up (also removed `shutdown()` export entirely)
- `api.js` graceful shutdown no longer calls `serviceManager.shutdown()`

### 10. Additional API Endpoints Removed

| Endpoint | File | Purpose |
|---|---|---|
| `GET /api/v1/activities/:id/participants` | `routes/activities.js` | Carpool dashboard participant ride status |
| `POST /api/v1/participants/remove-guardians` | `routes/participants.js` | Unlink guardians from participants |
| `DELETE /api/v1/forms/submissions` | `routes/forms.js` | Delete form submissions |

### 11. Sitemap/Robots.txt/Blog SSR Removed (`middleware/global.js`)

- Dynamic `/sitemap.xml` generation gone (static sitemaps remain)
- `/robots.txt` Disallow rules for authenticated routes removed (search engines may crawl `/dashboard`, `/login`, etc.)
- Blog SSR routes gone (consistent with blog system deletion)
- 301 redirect rules gone (French `comparatif` ↔ `comparer`)

### 12. SEO Impact — No 301 Redirects

~25 deleted landing page URLs have no redirects:
- `/en/features/*` (6 pages)
- `/fr/fonctionnalites/*` (6 pages)
- `/fr/comparer/*` (5 pages)
- `/en/blog/*`, `/fr/blogue/*` (8 posts)

### 13. `routes/roles.js` — API Path Regression

New role endpoints use `/api/` instead of `/api/v1/`, violating the CLAUDE.md guideline: "NEW ENDPOINTS: Use `/api/v1/` for all new API routes."

---

## LOW Severity Issues

### 14. Package.json Version Downgrades

| Package | main | This commit |
|---|---|---|
| `@googleapis/chat` | ^44.6.0 | ^44.5.0 |
| `@supabase/supabase-js` | ^2.98.0 | ^2.93.3 |
| `dotenv` | ^17.3.1 | ^17.2.4 |
| `glob` | ^13.0.5 | ^13.0.3 |
| `openai` | ^6.22.0 | ^6.16.0 |

Suggests this branch was based on an older main.

### 15. Migration Quality Issues

- `migration_ai_budget.sql`: `user_id` typed as `INTEGER` but should be `UUID` per CLAUDE.md conventions
- `add_activity_start_end_datetime.sql`: Not wrapped in `BEGIN`/`COMMIT` transaction

### 16. Stale Test File

- `test/routes-activities-comprehensive.test.js.bak` still exists (should be deleted)
- `test/routes-forms.test.js` does not match rewritten `routes/forms.js`

### 17. Whitespace Churn

~161 files have ONLY whitespace/line-ending changes (CRLF→LF). Should add `.gitattributes` with `* text=auto eol=lf`.

---

## Real Solutions (Legitimate Improvements)

### New Migrations (6 files)
| File | Purpose |
|---|---|
| `add_program_progress_schema.sql` | OAS skills/stages/competencies, PAB plan-do-review, Top Awards |
| `create_program_catalog_versions.sql` | Version-tracked catalog tables |
| `create_program_catalog_runtime_tables.sql` | Runtime tables for catalog loader |
| `add_program_metadata_to_badges.sql` | `program_type`, `official_key`, `version`, `requirements` on badges |
| `migration_ai_budget.sql` | Monthly AI usage caps and audit logging |
| `add_activity_start_end_datetime.sql` | Proper start/end date/time columns for activities |

### Clean Deletions
- **Blog system**: `services/blog.js`, `views/**/*.ejs`, `content/blog/**/*.md` — complete removal with no dangling references
- **Duplicate French landing pages**: `/fr/comparer/*` removed (canonical at `/fr/comparatif/`)
- **Dev scripts**: `find-mismatches.js` (incomplete), `test-debug.js` (had hardcoded creds), `run_medication_authorizations_migration.js` (one-shot)
- **Dependencies**: `ejs`, `gray-matter`, `marked` removed (only used by deleted blog)

### Forms Route Rewrite (`routes/forms.js`)
Old code used manual JWT parsing (`req.headers.authorization?.split(' ')[1]`); new code uses proper `authenticate` middleware and `getOrganizationId()`. New CRUD endpoints added. **However**, the route ordering bug makes this improvement non-functional.

### Roles Route Expansion (`routes/roles.js`)
Added `GET /api/users/:userId/roles` and `PUT /api/users/:userId/roles`. Better role management endpoints (though path should be `/api/v1/`).

### Program Progress Feature
New translation keys, routes (`routes/programProgress.js`), and service (`services/programProgress.js`) for Canadian Path progress tracking.

---

## Summary Table

| Severity | Count | Category |
|---|---|---|
| **CRITICAL** | 3 | Route ordering bug, 11 broken API URLs, Stripe CSP removal |
| **HIGH** | 5 | Test guard removal, URIError handler removal, broken data parsing, admin downgrade, multi-select broken, openai regression |
| **MEDIUM** | 5 | 3 feature removals, additional endpoint deletions, SEO/sitemap/robots.txt loss |
| **LOW** | 4 | Dep downgrades, migration types, stale test file, whitespace churn |
| **GOOD** | 5 | New migrations, clean deletions, forms rewrite, roles expansion, program progress |

## Recommendation

**This commit should NOT be merged as-is.** The legitimate improvements should be extracted and the regressions fixed:

1. **Fix** `routes/forms.js` route ordering (move `/:id` routes to end)
2. **Revert** all 11 API endpoint URL changes in `spa/api/api-endpoints.js`, `spa/reset_password.js`, `spa/modules/AI.js`
3. **Restore** Stripe CSP directives in `middleware/global.js`
4. **Restore** `isTestEnvironment()` guard in `config/app.js`
5. **Restore** URIError handler in `config/app.js`
6. **Fix** animateurs parsing in `spa/preparation_reunions.js`
7. **Restore** multi-role admin UI or update backend to match
8. **Restore** JSONFormRenderer multi-select support
9. **Revert** `max_tokens` back to `max_completion_tokens` in `services/openai.js`
10. **Add** 301 redirects for deleted landing page URLs
11. **Restore** robots.txt Disallow rules for authenticated routes
12. **Fix** roles.js to use `/api/v1/` prefix
13. **Add** `.gitattributes` to prevent future whitespace churn
