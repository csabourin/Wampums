# Test Suite Evaluation (2026-02-15)

## Scope and method

This review evaluates the repository's Jest suite for:

1. **Pertinence** (do tests check behaviors that matter for production risk).
2. **Edge-case depth** (boundary, invalid-input, security, and isolation coverage).
3. **Skipped-test quality** (whether each skip is justified and what risk it leaves).

The assessment is based on full execution of Jest plus targeted review of high-impact suites and all skipped tests.

## Quantitative inventory

- Total tests: **687**
- Passed: **662**
- Skipped: **25**
- Failed: **0**
- Total suites: **34**

Largest suites by assertion count:

- `test/api-consistency.test.js`: 92
- `test/security.test.js`: 62
- `test/spa/ValidationUtils.test.js`: 62
- `test/routes-users.test.js`: 37
- `test/spa/SecurityUtils.test.js`: 37

This is a strong breadth baseline for regression detection across API contracts, input validation, and front-end sanitization.

## Pertinence assessment by area

### 1) API contract and routing integrity — **High pertinence**

The suite heavily exercises route mounting, versioning conventions, and authenticated access patterns. That aligns with this codebase's multi-route modular architecture and `/api/v1` modernization goals.

**Strength:** Broad detection of accidental route drift, missing auth guards, and API version regressions.

### 2) Security and validation controls — **High pertinence**

The suite includes substantial coverage for:

- XSS prevention (`SecurityUtils`, HTML escaping, sanitization behavior).
- Field-level validation (`ValidationUtils`, email/password validation, edge inputs).
- Permission/auth middleware and unauthorized write protection.

**Strength:** These tests target common exploit paths and are directly relevant to production risk.

### 3) Multi-tenant isolation — **Medium-high pertinence**

There are tests validating organization filtering and tenant-aware behavior; however, one tenant-isolation case is skipped due stale contract assumptions.

**Strength:** Important isolation checks exist.

**Gap:** A critical header-vs-token org-priority scenario is currently skipped and documented as a security concern in the suite itself.

### 4) Finance and participant workflows — **Medium pertinence**

Core read/write validation is covered, but a meaningful subset is skipped due stale endpoint contracts. Several skipped tests are for participant linking/group membership and finance summary/fee definition behaviors.

**Strength:** Existing active tests still verify validation and permission flows.

**Gap:** Contract drift has reduced confidence for some operational finance and participant workflows.

### 5) Integration realism (database/rate limit) — **Medium pertinence with known blind spots**

- AI budget integration tests are conditionally skipped when `DATABASE_URL` is absent.
- Auth/reset rate-limit tests are skipped because limits are relaxed in test mode.

**Strength:** Skips are explicit and documented.

**Gap:** Behavior under true operational constraints (real DB transactional guarantees, production-like rate limiting) is under-verified in default CI mode.

## Skipped-test analysis (all 25)

### A) Environment-conditional integration skips (12) — **Justified but leaves risk**

All 12 skipped tests in `test/services-ai-budget.test.js` are wrapped in `describe.skipIf(!HAS_DATABASE)`, explicitly requiring `DATABASE_URL`.

- **Justification quality:** Good (clear rationale and deterministic gate).
- **Residual risk:** Monthly cap and atomicity behavior may regress unnoticed in DB-less CI pipelines.

### B) Stale-contract skips (11) — **Partially justified, needs remediation**

The suite marks multiple tests as `STALE CONTRACT` or skips endpoint paths no longer matching implementation.

- Finance stale tests: fee-definition create/update/permission, payment path variant, summary report contract.
- Participants stale path tests: `/participants/:id/link-parent`, `/participants/:id/add-group` variants.
- Organizations stale test: header override behavior for organization selection.

- **Justification quality:** Mixed (accurate signal of drift, but long-lived skips normalize missing coverage).
- **Residual risk:** Silent API contract divergence and untested security/isolation edges.

### C) Rate-limit skips (2) — **Understandable, but missing a key abuse-control check**

Login and password-reset rate-limit tests are skipped because test env config increases limits from production thresholds.

- **Justification quality:** Good explanation.
- **Residual risk:** Regressions in abuse throttling may not be caught before production.

## Edge-case depth evaluation

## Well-covered edge cases

- Invalid/empty/malformed input values for validators and auth payloads.
- XSS/sanitization safety conditions in SPA utility layers.
- Permission denials and unauthenticated write operations.
- Several finance input boundaries (invalid money, negative values).
- Offline/service-worker behavior in SPA/PWA paths.

## Under-covered or fragile edge cases

1. **Production-equivalent rate limiting**
   - Missing reliable assertions for 429 behavior at real thresholds.

2. **Tenant-isolation precedence rules**
   - Header/token conflict behavior has a skipped stale test and should be formalized.

3. **Contract-drift hot spots**
   - Participant link/group endpoints and finance summary/definition operations have skipped legacy contracts.

4. **DB-backed concurrency under CI defaults**
   - AI budget race-condition tests are robust but not exercised without DB provisioning.

5. **Date/time and locale boundaries in route-level integration tests**
   - Some domain routes would benefit from explicit DST/leap-day/timezone boundary tests.

## Verdict

**Overall pertinence:** **Good** for regression safety in validation, security utilities, route integrity, and common API behavior.

**Edge-case sufficiency:** **Moderate, not yet exhaustive**.

The suite is strong for deterministic unit/integration-with-mocks checks, but confidence is reduced in three areas: (1) production-like rate limiting, (2) stale-contract endpoint zones, and (3) DB-backed atomic scenarios when CI lacks DB.

## Recommended remediation plan (priority order)

1. **Unskip by contract realignment (highest impact)**
   - Replace stale endpoint tests with current route contracts (participants + finance + org isolation).

2. **Add dedicated rate-limit harness**
   - Parameterize limits in tests to simulate production thresholds with low request counts (fast deterministic 429 checks).

3. **Run DB-backed budget tests in CI nightly (or required pre-release)**
   - Ensure `DATABASE_URL` integration lane exists for atomicity/race assertions.

4. **Add tenant precedence regression test for token vs header org source**
   - Lock expected secure precedence and prevent future bypass regression.

5. **Expand edge boundary matrix for date/locale-sensitive routes**
   - Add targeted tests for DST crossover, leap day, and timezone-aware parsing/formatting interactions.
