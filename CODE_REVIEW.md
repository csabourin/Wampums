# Code Review: Security, Internationalization, and UX

## Security Findings
- **Public issuance of organization-scoped JWTs.** The `/api/initial-data` endpoint signs and returns a JWT containing only the organization ID when the caller is unauthenticated, then writes it to `localStorage` for reuse. Because the route does not require authentication, any visitor can request a long-lived token and reuse it against endpoints that only check for a valid signature, which undermines tenant isolation and exposes API surface to anonymous callers. Consider requiring authentication (or restricting claims severely) and delivering tokens via HttpOnly cookies instead of `localStorage`.【F:routes/dashboards.js†L53-L104】
- **Silent cross-tenant fallback.** When the SPA cannot resolve an organization ID, it silently falls back to organization `1` and also retrieves an organization JWT for that tenant. This fallback can route users to the wrong tenant without notice and makes it easy for an attacker to coerce the app into using a predictable organization ID after a hostname lookup failure. Add explicit error handling and halt initialization when the organization cannot be determined instead of defaulting to a shared tenant.【F:spa/app.js†L153-L213】

## Internationalization
- Added the missing `back_to_home` translation so the error page link renders in both languages instead of showing the raw key.【F:lang/en.json†L103-L107】【F:lang/fr.json†L103-L107】【F:spa/app.js†L546-L553】
- The translation audit still reports 61 keys referenced in the SPA that are not defined in `lang/en.json` (for example: `admin`, `badge_total_stars`, `default_activity_name`). These gaps leave users seeing fallback keys in multiple screens; the missing keys should be populated in both locale files.【2e1cc6†L1-L15】

## UX Observations
- The organization fallback noted above also hurts UX: users receive data and branding for a different tenant with no warning. Replace the fallback with a user-facing error message and retry guidance so people are not inadvertently switched to another organization.【F:spa/app.js†L153-L221】
- The login error view uses the translated `back_to_home` link but previously lacked the translation entry; with the new string in place, the link now renders correctly and avoids exposing raw translation keys to end users.【F:spa/app.js†L546-L553】【F:lang/en.json†L103-L107】【F:lang/fr.json†L103-L107】
