---
name: fix-issue
description: Fix a Wampums GitHub issue with the smallest change that resolves it, read narrowly, verify locally with targeted checks only, and let CI on the pull request run the full suites. Use when asked to work on, fix, address or implement a GitHub issue (an issue number or URL) in this repository.
---

# Fixing an issue

CLAUDE.md › "Working on an issue" is the rule; this is the procedure. The goal is
the same quality at a fraction of the cost: CI already runs every lint, the build,
every Jest suite, the integration suite and the accessibility suite on each pull
request, so a session never repeats them by default.

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

## 4. Push and let CI decide

1. Commit on the session's branch (message: what changed and why, `Fixes #<n>`),
   then `git push -u origin <branch>`.
2. CI runs only on pull requests. Open the pull request as a **draft** (or reuse the
   open one for this branch), using the repository's template. Include:
   - what changed and how it was verified locally;
   - **Accessibility notes** (keyboard, screen-reader semantics, axe test added or
     why none was needed);
   - **Follow-ups**: out-of-scope gaps noticed, one line each.
3. Offer to watch the pull request (`subscribe_pr_activity`). When CI fails, read
   that job's log, reproduce the one failing test locally, fix it, and push again.
   Do not rerun the whole suite to confirm; CI does that.
