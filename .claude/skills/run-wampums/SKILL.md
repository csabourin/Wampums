---
name: run-wampums
description: Run, start, seed, screenshot and drive the Wampums web app (Express API + Vite SPA) locally in a headless browser, at phone or desktop size, signed in as an admin or a parent. Use when asked to run Wampums, start the app, see a change working, take screenshots, check a screen on mobile web, or run the integration tests against a real database.
---

Wampums is an Express API (`api.js`, port 5000) plus a Vite SPA (port 5173)
backed by PostgreSQL. An agent drives it with the scripts in this directory:
build a disposable database, seed one unit you can sign in to, start both
servers, then point `shot.mjs` at any paths to get screenshots and a JSON
report of what a phone user would trip over.

All paths are relative to the repo root.

## Prerequisites

- Node 20 and a local PostgreSQL reachable over the Unix socket
  `/var/run/postgresql`, with a role that may `CREATE DATABASE` (peer auth; no
  password). No `apt-get install` is needed: `setup.sh` unpacks the one missing
  system library into a cache.
- `npm install` already run in the repo.

## Setup (once)

```bash
.claude/skills/run-wampums/setup.sh
```

Installs `playwright-core@1.56.1` and its headless Chromium, and unpacks
`libasound.so.2`, all into `~/.cache/wampums-run` (override with
`WAMPUMS_RUN_CACHE`). Nothing is installed in the repo.

## Database

```bash
.claude/skills/run-wampums/db.sh
node .claude/skills/run-wampums/seed.mjs
```

`db.sh` **drops and recreates** `wampums_run` (override with `WAMPUMS_RUN_DB`)
from `attached_assets/Full_Database_schema.sql`, the permission catalog, and
every migration through the project's own runner. `seed.mjs` adds one unit with:

| account | password | what it is |
|---|---|---|
| `admin@run.test` | `Wampums2026!` | every permission in the unit |
| `parent@run.test` | `Wampums2026!` | parent role (`linked` scope), one child enrolled this year |

Two-factor sign-in is off for this unit only. `seed.json` is written to the
cache for `start.sh`.

## Run (agent path)

```bash
.claude/skills/run-wampums/start.sh
node .claude/skills/run-wampums/shot.mjs --as parent@run.test /parent-dashboard /parent-onboarding /family-access
node .claude/skills/run-wampums/shot.mjs --as admin@run.test --viewport desktop /parent-invitations /participant-duplicates
node .claude/skills/run-wampums/shot.mjs /login
.claude/skills/run-wampums/stop.sh
```

`shot.mjs` prints one JSON line per path:

```json
{"path":"/family-access","at":"/family-access","screenshot":"/home/…/.cache/wampums-run/shots/phone-family-access.png","scrollsSideways":false,"overflowing":[],"smallTargets":[],"pageErrors":[]}
```

**Open the screenshots and look at them** — the report catches overflow, tap
targets under 44px and thrown errors, not wrong copy or a confusing layout.

| option | meaning |
|---|---|
| `--as <email>` | sign in first; omit to stay logged out |
| `--viewport phone\|desktop` | 390×844 touch (default) or 1280×900 |
| `--wait <selector>` | wait for an element before the screenshot |
| `--out <dir>` | screenshot directory (default `~/.cache/wampums-run/shots`) |

Exit code is 1 if any page threw. `at` shows where a guard redirected you.
Logs: `~/.cache/wampums-run/logs/api.log` and `vite.log`.

### Pages opened from emails

`/complete-registration` and `/family-link` need a live token, and a token only
exists at the moment it is minted. Mint one, then drive the page:

```bash
TOKEN=$(DATABASE_URL="postgresql:///wampums_run?host=/var/run/postgresql" JWT_SECRET_KEY=x node -e "
const { Pool } = require('pg');
const { createInvitation } = require('./services/parentInvitations');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
createInvitation(pool, { organizationId: require(process.env.HOME + '/.cache/wampums-run/seed.json').organizationId, email: 'invited-' + Date.now() + '@run.test', firstName: 'Ada', language: 'fr' })
  .then((r) => { console.log(r.token); return pool.end(); });
" 2>/dev/null | tail -1)
node .claude/skills/run-wampums/shot.mjs --wait '#complete-registration-form' "/complete-registration?token=$TOKEN"
```

`createFamilyLinkRequest` in `services/familyLinks.js` mints family-link tokens
the same way (the requester needs a child of their own in the unit).

## Run (human path)

After `start.sh`, open http://127.0.0.1:5173 and sign in with an account above.
`stop.sh` stops both servers.

## Test

```bash
npm run test:quality
TEST_DATABASE_URL="postgresql:///wampums_run?host=/var/run/postgresql" npx jest test/parent-invitations.integration.test.js test/parent-onboarding.integration.test.js test/family-links.integration.test.js test/participant-access.integration.test.js test/participant-duplicates.integration.test.js
```

The first runs without a database (integration suites skip). The second runs
the family-access integration suites against the `db.sh` database: 96 tests.
They confine cleanup to what they create and may run in parallel with the
seeded unit present.

## Gotchas

- **Login stops on "Vérification en deux étapes".** Two-factor sign-in emails a
  code. `seed.mjs` switches it off for the seeded unit through the unit's
  `security` setting (`two_factor_disabled`); a unit you create by hand still
  has it on.
- **`.env` points at a stale production database.** `start.sh` sets
  `DATABASE_URL` in the environment, which dotenv never overwrites. Do not
  "fix" `.env` instead.
- **On localhost the API picks the unit from `ORGANIZATION_ID`,** not from
  `organization_domains`. `start.sh` sets it from `seed.json`; a different
  unit needs a restart with another id.
- **The SPA navigates with `history.pushState`.** No load event fires after
  login, so `waitForURL` times out; `shot.mjs` waits on `location.pathname`.
- **A parent role must have `data_scope = 'linked'`.** The column defaults to
  `organization`, and a parent with that scope sees every child in the unit on
  the dashboard — it looks like a data leak and is a seed mistake.
- **The date input renders `mm/dd/yyyy`** in headless Chromium whatever the
  page language; phones show their native picker.
- **`/api/v1/public/translations` returns 500** because `lang/it.json` and
  `lang/id.json` start with a UTF-8 BOM. The SPA does not need it; the React
  Native app does.
- **`test/alumni.integration.test.js` cannot pass on a database built from the
  repo:** `user_organizations.alumni_invited_at` is in no migration and not in
  the schema dump. And its cleanup sets `session_replication_role`, which needs
  a PostgreSQL superuser -- as do the other four suites in
  `npm run test:scout-year`.
- **`.gitignore` only ignores the root `node_modules/`.** Anything installed
  inside `.claude/` would be committed — hence the cache.

## Troubleshooting

- **`error while loading shared libraries: libasound.so.2`**: the headless
  shell was launched without the cache's library path. Run `setup.sh`;
  `shot.mjs` sets `LD_LIBRARY_PATH` itself.
- **`SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string`**: a
  connection string without `?host=/var/run/postgresql` went over TCP, which
  wants a password. Keep the socket host.
- **`violates foreign key constraint "organizations_program_section_fk"`**:
  an organization was inserted without its `organization_program_sections`
  row in the same transaction. Copy the pattern in `seed.mjs`.
- **`column uo.alumni_invited_at does not exist`** /
  **`permission denied to set parameter "session_replication_role"`**: see the
  alumni gotcha above.
