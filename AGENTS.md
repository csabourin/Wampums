# Agent Guidelines for Wampums

These instructions apply to all work in this repository. Follow them alongside the system prompts.

## Core Principles
- Follow **CLAUDE.md**: bilingual pages (one language per page), all user-facing text translatable via `lang/*.json` or translation APIs, locale-aware date/number formatting, and RESTful APIs under `/api/v1` with correct verbs/status codes.
- Design **mobile-first** (web): default to small screens, enhance with `min-width` media queries, and keep touch targets responsive. Keep UI consistent (buttons/forms/tables/modals/loading/error states) and simple.
- **No hacks**: avoid hardcoded values or magic numbers—use `spa/config.js` and shared utilities. Remove commented-out or duplicate code.
- **Security first**: sanitize/escape all user input and HTML (frontend `spa/utils/SecurityUtils.js`, backend `utils/api-helpers.js` + parameterized queries). Validate inputs, and keep JWT handling consistent. Respect rate limits and avoid exposing secrets.
- **Documentation**: add JSDoc for non-trivial functions and explain intent. Update docs when behavior changes.

## Architecture & API
- Keep routes modular per `routes/*.js`, registered in `api.js`.
- Use `middleware/auth.js` for JWT auth (`authenticate`, `authorize`).
- Use `middleware/response.js` for standardized responses (`success`, `error`, `paginated`).
- Preserve multi-tenant isolation by filtering queries with `organization_id` from authenticated context.

## Frontend (SPA)
- Use ES modules with shared utilities (`ajax`, `DebugUtils`, `DateUtils`, `StorageUtils`).
- Prefer `debugLog`/`debugError` over `console.*`.
- Ensure loading/error/empty states, sanitized rendering, and configuration-driven behavior.

## Mobile (Expo)
- Mobile app lives in `mobile/` and mirrors web security practices (`mobile/src/utils/SecurityUtils.js`).
- Keep translations aligned with `lang/*.json` keys and avoid mixed-language screens.

## Testing & Deployment
- Run relevant tests/linters when feasible. Confirm server startup/migrations when modifying backend behavior.
- Note required env vars (e.g., `JWT_SECRET_KEY`, database URLs, VAPID keys).
