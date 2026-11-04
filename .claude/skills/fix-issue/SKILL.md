---
name: fix-issue
description: Fix a Wampums GitHub issue with the smallest change that resolves it, read narrowly, verify locally with targeted checks only, push, and watch CI on that commit until it is green. Use when asked to work on, fix, address or implement a GitHub issue (an issue number or URL) in this repository.
---

# Fixing an issue

CLAUDE.md › "Working on an issue" is the rule; this is the procedure. The goal is
the same quality at a fraction of the cost: CI already runs every lint, the build,
every Jest suite, the integration suite and the accessibility suite once on each
pushed commit (any branch), so a session never repeats them by default.

## 1. Understand the issue (read narrowly)

1. Read the issue and its comments (GitHub MCP `issue_read`). Note what "done"
   means; if it is unclear, ask before writing code.
2. Locate the code it names: `grep -rn` for the route, screen, key or function.
   Read only the relevant functions (`sed -n`/`Read` with offset and limit), not
   whole files.
3. If the code is in a CLAUDE.md "Feature areas" row, read that devdoc. Otherwise
   open no devdoc.
4. Find the existing tests for the files you will change:
   `grep -rln '<file or function name>' test/` and read only the `describe`/`test`
   blocks that cover the behaviour. Tests are the specification (CLAUDE.md §12).

## 2. Change

- Fix what the issue asks. Bring only the parts you edit up to CLAUDE.md §7.
- Note anything else you see (old conventions, `KNOWN_VIOLATIONS` entries,
  duplicated helpers) as a follow-up for the pull request description. Do not fix it.
- Add or update a test that states the behaviour from the person's side. For a new
  or changed screen, dialog or form: escaping test and axe check (copy the pattern
  from a neighbouring `test/spa/*.test.js`).
- A new translation key goes in both `lang/en.json` and `lang/fr.json`.
- A new permission key needs a migration in the same change (CLAUDE.md §3).

## 3. Verify locally (targeted only)

Run from the repository root, with the files the change touched:

```bash
npx jest --findRelatedTests <changed source files> <added or edited test files>
```

```bash
npx eslint <changed .js/.mjs files>
```

Then only those that apply:

| Changed | Also run |
|---|---|
| `lang/*.json` | `npm run lint:i18n-parity` |
| `routes/`, `middleware/`, `services/`, `spa/` | `npm run lint:policy` |
| a route, or a client in `spa/api/` | `npm run lint:api-contracts` |
| a mount in `routes/index.js` | `npm run lint:duplicate-mounts && npm run lint:non-versioned-mounts` |
| a migration; roles, access to children, family links, scout years | integration suites for that area, against the run-wampums database (see that skill) |
| imports, `vite.config.mjs`, service worker | `npm run build` |
| how a screen looks | a screenshot through the run-wampums skill |

Do **not** run `npm run test:quality`, `npm run lint:all` or `npm run test:a11y`
unless the issue or the user asks.

If `lint:policy` reports fewer violations than the baseline, run
`npm run lint:policy -- --update-baseline`; after fixing a suppressed ESLint error,
`npm run lint:eslint:prune`. Commit the smaller files.

## 4. Push and watch CI (always, without being asked)

CI (`.github/workflows/ci-integrity.yml`) runs once on every pushed commit, on any
branch; it does not run again for a pull request. A full run takes 9 to 13 minutes.

1. Commit on the session's branch (message: what changed and why, `Fixes #<n>`),
   then `git push -u origin <branch>`. Note the commit's SHA (`git rev-parse HEAD`).
2. Schedule the check: `send_later` with `delay_minutes: 12` and a message naming
   the branch and SHA. End the turn; do not poll with `sleep`.
3. When it fires, find the run: GitHub MCP `actions_list`, `list_workflow_runs`,
   `resource_id: ci-integrity.yml`, filtered by `branch`; take the run whose
   `head_sha` is that commit.
   - Still `queued` or `in_progress`: `send_later` again in 5 minutes.
   - `cancelled`: a newer push replaced it; follow the newer run.
   - `success`: report it to the user, and stop.
   - `failure`: `get_job_logs` with the `run_id`, `failed_only: true`,
     `return_content: true`, `tail_lines: 200`. Reproduce the one failing test or
     check locally, fix only that, commit, push, and go back to step 2.
4. After three failed attempts, stop and report what still fails and why.
5. Do not open a pull request to get CI; open one only when the user asks. Then use
   the repository's template, with:
   - what changed and how it was verified (locally and CI run link);
   - **Accessibility notes** (keyboard, screen-reader semantics, axe test added or
     why none was needed);
   - **Follow-ups**: out-of-scope gaps noticed, one line each;
   and `subscribe_pr_activity` for its reviews.
