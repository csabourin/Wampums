# GitHub Copilot Instructions for Wampums

Follow [`../CLAUDE.md`](../CLAUDE.md) as the primary engineering standard and [`../AGENTS.md`](../AGENTS.md) as the concise repository instruction set.

Before proposing code, inspect the relevant implementation and tests. Prefer these sources of truth:

1. Tests for verified behavior.
2. `routes/index.js`, route modules, and middleware for API behavior.
3. Package manifests and configuration modules for commands and runtime settings.
4. SQL files in `migrations/` for schema changes.

Core constraints:

- Keep each user-facing page in one language and add matching English/French translation keys.
- Use locale-aware date and number formatting.
- Put new APIs under `/api/v1`, register routes in `routes/index.js`, and use standard response helpers.
- Use `authenticate`, `requirePermission`, and `blockDemoRoles` as appropriate.
- Preserve tenant isolation with the authenticated organization context and parameterized SQL.
- Sanitize untrusted data, avoid direct SPA `innerHTML` assignments, and never expose secrets.
- Keep web UI mobile-first and touch-friendly.
- Put new SPA screens under `spa/modules/<feature>/` and their API calls in `spa/api/api-<feature>.js`; use `setContent()`, `escapeHTML()`, `openModal()`, `DialogUtils`, `apiErrorMessage()` and `hasPermission()` (never `hasRole()`), and avoid `console.*` in SPA code. CLAUDE.md §7 describes a screen end to end.
- Never show the server's English `message`, a raw translation key, or a role's internal name.
- Add or update tests with behavior changes (SPA tests in `test/spa/`, with an `axe-core` check for new screens and dialogs) and run `npm run lint:all`, `npm run build` and `npm run test:quality`.

Do not rely on historical plans, audits, or test-result summaries; Git history is the record for completed work.
