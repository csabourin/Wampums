# CI Integrity Test Plan

This repository now uses a layered CI approach to protect application integrity while keeping pull request feedback fast.

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

Why: This enforces architectural rules (API versioning/mount policy), frontend security hygiene (`console`/`innerHTML` scanning), SQL parameterization, and production bundle buildability.

## 2) Blocking stable backend/frontend Jest suite (web)

The CI job runs Jest with known unstable suites temporarily excluded:

```bash
npm test -- --runInBand --testPathIgnorePatterns="test/push-subscription.test.js|test/activities.create.test.js"
```

Why: Keeps branch protection reliable while preserving broad automated coverage.

## 3) Non-blocking full web regression visibility

A separate CI job runs all web Jest suites and uploads a machine-readable report (`jest-results.json`) as an artifact.

Why: Maintainers still get complete failure visibility without blocking all merges on pre-existing failing suites.

## 4) Blocking mobile regression suite

The mobile package runs its own isolated Jest suite:

```bash
cd mobile && npm test -- --runInBand
```

Why: Prevents regressions in the Expo app while remaining decoupled from server/web setup.

## Follow-up hardening recommendations

1. Fix and re-enable `test/push-subscription.test.js` in the blocking web suite.
2. Fix and re-enable `test/activities.create.test.js` in the blocking web suite.
3. Add coverage thresholds (web + mobile) once flaky suites are stabilized.
4. Add scheduled nightly runs for the full regression job and alerting on new failures.
