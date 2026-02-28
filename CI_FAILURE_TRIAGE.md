# CI Failure Triage (Full Jest Suite)

## Run context
- Command run: `npx jest --runInBand --json --outputFile test-results.json`
- Aggregate result: **9 failed suites**, **58 failed tests**, **25 passed suites**.

## Classification summary

### A) Failures caused by false assumptions / stale tests (not product regressions)

1. **Forms suite (`test/routes-forms.test.js`, 26 failures)**
   - All failures are 404s against REST resources such as `GET /api/v1/forms` and `POST /api/v1/forms/:id/submit`.
   - Current forms router exposes `GET/POST /submissions` under the `/api/v1/forms` mount, not the CRUD+workflow endpoints asserted by the test suite.
   - **Conclusion:** tests target a different/older API contract than the currently mounted implementation.

2. **Organizations suite (`test/routes-organizations.test.js`, 13 failures)**
   - Includes 404s for endpoints like `/api/v1/organizations/status` and `/public/organizations/create`, which are not defined in the organizations router.
   - Existing router defines endpoints such as `/jwt`, `/info`, `/get_organization_id`, `/settings`, `/switch`, `/register`.
   - **Conclusion:** several tests assume endpoint names/shapes that do not match the active router contract.

3. **Finance suite (`test/routes-finance.test.js`, mixed stale-contract failures)**
   - Some 404s come from wrong endpoint assumptions (e.g., tests use `/api/v1/finance/payments`, `/api/v1/finance/summary`, `/api/v1/finance/outstanding`).
   - Router actually defines payments under `/v1/finance/participant-fees/:id/payments` and summary under `/v1/finance/reports/summary` (mounted at `/api`).
   - **Conclusion:** at least part of this suite is stale endpoint-path assumptions.

4. **Medication suite (`test/routes-medication.test.js`, 1 failure)**
   - Test dereferences `res.body.data.status` when status is 201.
   - Current implementation returns `success(res, null, 'Medication distributions saved', 201)` for create, i.e., `data` is intentionally `null`.
   - **Conclusion:** assertion expects payload shape that no longer exists.

5. **SPA suites (`test/spa/*.test.js`, 3 suites fail to boot)**
   - Failure: `Test environment jest-environment-jsdom cannot be found`.
   - SPA tests explicitly request `@jest-environment jsdom`, but local dependency resolution shows `jest-environment-jsdom` missing from installed modules.
   - **Conclusion:** CI/runtime dependency environment issue (missing installed test env), not a business-logic regression inside SPA modules.

### B) Failures likely indicating real product or robustness issues

1. **`test/security.test.js` – invalid content-type handling returns 500**
   - POSTing non-JSON body to participants route yields server error path (`Cannot destructure property 'first_name' of 'req.body' as it is undefined`) and test receives 500.
   - This indicates route-level defensive handling gap for malformed or non-JSON payloads.
   - **Conclusion:** real robustness bug (should return 4xx, not 500).

2. **`test/routes-finance.test.js` – demo-role policy and response-shape drift (potentially real, depending on intended contract)**
   - Create/update/delete tests return 403 with demo-mode message (`read-only access`).
   - If test fixtures are expected to represent fully privileged non-demo users, this is likely test setup drift.
   - If current behavior unintentionally blocks non-demo finance managers in CI fixtures, that would be a product bug.
   - Numeric-vs-string assertions (e.g., expected `'150.00'`, received `150`) point to serialization contract drift.
   - **Conclusion:** partly stale assumptions, partly contract ambiguity that should be normalized and documented.

3. **`test/routes-organizations.test.js` – switch validation expectations**
   - Tests expecting 400/403 in some `/switch` cases receive 200.
   - Route checks only truthiness of `organization_id` (not numeric type) and relies on membership query semantics.
   - **Conclusion:** this may reveal genuine validation strictness gaps if API spec requires numeric validation and stricter authorization checks.

4. **`test/middleware-validation.test.js` – mixed signal, but several likely real input-validation gaps**
   - Multiple expectations fail with 500 or unexpected status patterns on malformed input.
   - At least some failures are test-side assumptions (e.g., comment says password is “trimmed to nothing” even though sample includes non-space chars), but repeated 500 results on edge cases suggest hardening opportunities.
   - **Conclusion:** this suite mixes weak assertions + brittle mocks with likely real validation robustness issues.

## Recommended next steps (ordered)
1. **Split stale-contract tests vs. behavior tests:** quarantine/update suites for Forms/Organizations/Finance paths to current API map.
2. **Fix genuine 500s first:** participants route malformed body handling; auth/validation edge-case guards.
3. **Decide and codify response contracts:** numeric formatting (string decimals vs numbers), payload shape (`data: null` vs object), and demo-role behavior in write endpoints.
4. **Stabilize SPA CI environment:** ensure `jest-environment-jsdom` is installed in CI job (including devDependencies) before running SPA tests.
5. **Reduce brittle mocks in middleware/security tests:** align DB mock query handlers with current query set; prefer integration fixtures with explicit auth role/permission profiles.
