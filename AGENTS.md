# Agent Guidelines for Wampums

These instructions apply to all work in this repository. Follow them alongside the system prompts.

## Core Principles
- Follow **CLAUDE.MD**: bilingual pages (one language per page), all user-facing text translatable via `lang/*.json` or translations API, locale-aware date/number formatting, and JWT-protected RESTful APIs under `/api/v1` with correct verbs and status codes.
- Design **mobile-first**: default to small screens, enhance with `min-width` media queries, and keep touch targets responsive. Keep UI consistent (buttons/forms/tables/modals/loading/error states) and simple.
- **No hacks**: avoid hardcoded values or magic numbers—use `CONFIG` constants and shared utilities. Remove commented-out or duplicate code.
- **Security first**: always sanitize/escape user input and HTML (use `SecurityUtils` on the frontend, and `escapeHtml` plus parameterized queries on the backend), validate inputs, and keep JWT handling consistent. Respect rate limits and avoid exposing secrets.
- **Documentation**: add JSDoc for functions and explain intent behind non-trivial logic. Update relevant docs when behavior changes.

## Architecture & API
- Keep routes modular per `routes/*.js` plan; new endpoints should follow existing module patterns with authentication/authorization middleware and standardized responses.
- Preserve multi-tenant isolation by filtering queries with `organization_id` from authenticated context.
- Maintain translation storage conventions and avoid mixing languages within a single page.

## Frontend Practices
- Use ES modules with shared utilities (e.g., `ajax`, `DebugUtils`, `DateUtils`, `StorageUtils`). Use `debugLog/debugError` instead of console statements.
- Ensure loading/error states, sanitized rendering, and configuration-driven behavior. Align UI/UX with existing mobile patterns.

## Testing & Deployment
- Run relevant tests/linters when feasible. Confirm server startup/migrations when modifying backend behavior. Note required env vars (e.g., `JWT_SECRET_KEY`, database URLs, VAPID keys).
