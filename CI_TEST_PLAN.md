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

## 4) Current full-suite failures and remediation plan

Latest local full-suite run reports two failing suites:

- `test/push-subscription.test.js`
  - Fails with `404` because tests still target legacy endpoint `/api/v1/push-subscription`.
  - Suggested fix: update tests to use canonical route `/api/v1/notifications/subscription`, and align response envelope expectations with `middleware/response` helpers.

- `test/activities.create.test.js`
  - Fails with `403` from authorization middleware before route assertions run.
  - Suggested fix: update test setup to mock membership/permission checks used by `requirePermission('activities.create')` and ensure JWT fixture mirrors current auth contract (`req.user.id`, org membership, permissions resolution).

## 5) Mobile regression suite

Mobile tests remain temporarily disabled in CI until their environment is stabilized.
