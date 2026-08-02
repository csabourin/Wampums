# Wampums Scout Management Application

Wampums is a bilingual, multi-tenant scout management system with a Node.js/Express API, a Vite-powered web SPA, and an Expo/React Native mobile app.

## Source of truth

Use executable artifacts before narrative documentation:

1. Tests in `test/`, `tests/`, and `mobile/src/**/__tests__/` define verified behavior.
2. Route registration in `routes/index.js`, route modules in `routes/`, and middleware define the HTTP contract.
3. `package.json`, `mobile/package.json`, configuration modules, and `.env.example` define commands and runtime configuration.
4. SQL files in `migrations/` define repository-managed schema changes.
5. `CLAUDE.md` defines development conventions; `AGENTS.md` is its concise agent-facing companion.

Point-in-time audits, implementation reports, and test-run summaries are intentionally not maintained as documentation. Git history is the record for completed work.

## Requirements

- Node.js 22.12 or newer (see `.nvmrc` and `package.json`)
- npm
- PostgreSQL

The mobile package accepts Node.js 20.18 or newer, but using the root project version avoids switching runtimes.

## Local setup

```bash
npm install
cp .env.example .env
```

Configure at least:

- `JWT_SECRET_KEY`
- `DATABASE_URL` with a PostgreSQL connection string
- `LOCAL_REGISTRATION_PASSWORD` when initializing a local development database
- `PORT` if the API should not use its default port, `5000`

Existing deployments that still define `SB_URL` remain supported. Migrate by
copying that PostgreSQL URL to `DATABASE_URL`, deploying with both variables,
then removing `SB_URL` after the new deployment connects successfully.

The repository also supports the service-specific variables listed in `.env.example`. Do not commit populated environment files.

Run the API and web development server in separate terminals:

```bash
npm start
npm run dev
```

The API defaults to `http://localhost:5000`; Vite defaults to `http://localhost:5173`.

For a fresh local PostgreSQL database owned by your operating-system user, set
`DATABASE_URL=postgresql:///wampums?host=/var/run/postgresql`, then run:

```bash
npm run db:local:setup
```

This imports the checked-in schema when the database is empty, applies tracked
base migrations, and seeds the local organization, current scout year, roles,
permission catalog, and five standard versioned form formats. The canonical
form definitions live in `config/default-form-formats.json` and do not require
access to Railway during installation.

To apply only the base migrations to an existing configured database, run:

```bash
npm run db:migrate:base
```

Applied migrations are recorded in `schema_migrations`; re-running the command
is safe. Existing tenant form customizations and permission overrides are not
replaced.

Database changes live in `migrations/` as SQL or JavaScript migrations. Use
`scripts/run-migration.js <filename>` to apply a reviewed migration. JavaScript
migrations must export `up(client, context)` and are useful for parameterized,
data-driven catalog changes.

## Common commands

```bash
npm test
npm run test:quality
npm run test:stories
npm run build
npm run lint:api-version
npm run lint:duplicate-mounts
npm run lint:non-versioned-mounts
npm run lint:spa-files
npm run lint:spa-console
npm run lint:spa-innerhtml
npm run lint:sql-params
npm run lint:i18n-parity
```

The complete command list is authoritative in `package.json`.

## Project map

- `api.js` — API process entry point
- `config/` — application, database, and logging configuration
- `routes/index.js` — canonical route registration and legacy API handling
- `routes/` — REST endpoints, primarily under `/api/v1`
- `middleware/` — authentication, authorization, validation, and response envelopes
- `services/` — long-running and domain services
- `spa/` — web application modules, API clients, utilities, offline support, and routing
- `mobile/` — Expo/React Native application
- `lang/` — English and French web translations; key parity is enforced by lint
- `migrations/` — SQL schema and seed changes
- `test/` and `tests/` — server, SPA, integration, security, and user-story tests
- `content/blog/` — published bilingual Markdown content, not developer documentation

## Maintained documentation

- `CLAUDE.md` — primary engineering standards and review checklist
- `AGENTS.md` — repository instructions for coding agents
- `mobile/docs/README.md` — mobile setup and architecture entry point
- `devdocs/oas-catalog-pipeline.md` — versioned program catalog workflow
- `devdocs/go-to-market/` — current positioning and pilot material
- `spa/MANUEL_PARENTS.md` — French parent-dashboard user guide
- `.archive/README.md` — index of intentionally archived source files

See `devdocs/README.md` for the documentation lifecycle policy.

## License

Proprietary. All rights reserved.
