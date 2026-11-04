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
- Every screen lives in `spa/modules/<feature>/`; in an older screen, bring the parts you change up to CLAUDE.md §7. `mobile/` is frozen until the SPA is stable; do not change it unless asked.
- Never show the server's English `message`, a raw translation key, or a role's internal name.
- Add or update tests with behavior changes (SPA tests in `test/spa/`, with an `axe-core` check for new screens and dialogs). Locally, run only the tests and lints related to the change (`npx jest --findRelatedTests <files>`, `npx eslint <files>`, and `lint:i18n-parity` / `lint:policy` / `lint:api-contracts` when relevant). CI runs everything once on each pushed commit; check that run and fix what it reports.
- Keep to the issue's scope: list unrelated gaps as follow-ups. Feature-specific rules are in `devdocs/`, indexed under "Feature areas" in CLAUDE.md.

Do not rely on historical plans, audits, or test-result summaries; Git history is the record for completed work.
