# CI Integrity Test Plan

This repository uses a pre-release beta CI strategy that prioritizes fast quality and integrity checks over full integration coverage.

## 1) Blocking quality gates (web)

These checks run first and must pass:

- `npm run lint:api-version`
- `npm run lint:duplicate-mounts`
- `npm run lint:spa-files`
- `npm run lint:spa-console`
- `npm run lint:spa-innerhtml`
- `npm run lint:sql-params`
- `npm run lint:non-versioned-mounts`
- `npm run build`

Why: This enforces architectural rules (API versioning/mount policy), frontend security hygiene (`console`/`innerHTML` scanning), SQL parameterization, and production buildability.

## 2) Blocking integrity-focused Jest suite (non-integration)

The CI job runs only Jest suites focused on code quality and integrity. Integration-heavy API suites are excluded for beta velocity:

```bash
npm run test:quality
```

Current exclusions include supertest-heavy end-to-end API suites and manual external-integration tests.

Why: keeps branch protection reliable while preserving safeguards around core logic, utilities, configuration, and offline data integrity.

## 3) Non-blocking full regression visibility

A separate non-blocking CI job runs the complete web Jest suite and uploads `jest-results.json` as an artifact.

```bash
npx jest --runInBand --json --outputFile=jest-results.json
```

Why: Maintainers retain visibility into failing integration suites during beta without blocking merges.

## 4) Recently remediated regression suites

The following suites were repaired and are now suitable for the blocking quality-focused run:

- `test/push-subscription.test.js`
  - Updated test route target from legacy `/api/v1/push-subscription` to canonical `/api/v1/notifications/subscription`.
  - Kept assertions aligned with standardized `middleware/response` envelope (`202`, `success`, message).

- `test/activities.create.test.js`
  - Updated mock query chain to satisfy `blockDemoRoles` and `requirePermission('activities.create')` middleware before route assertions.
  - Removed duplicate payload field in test input to keep fixture behavior explicit and deterministic.

These suites are no longer excluded from `npm run test:quality`.

## 5) Mobile regression suite

Mobile tests remain temporarily disabled in CI until their environment is stabilized.
