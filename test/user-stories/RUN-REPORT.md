# User-Story Suite — Run Report

**Date:** 2026-07-20
**Status: pending CI for jest execution.** This workspace runs Windows node against a
WSL-hosted repo over UNC; jest cannot resolve `<rootDir>` there (see
`test/CI_TEST_FIXES_SUMMARY.md` history and the workspace notes), so the suites were
verified statically and by executing their core logic in plain node. CI (`npm run
test:stories`) is the authoritative run.

## What WAS executed locally (all green)

| Verification | Result |
|---|---|
| `node --check` on all 10 test files + helpers | OK (no syntax errors) |
| `helpers/story-helpers.js` smoke run (tr, i18nGaps, maxPlaceholder, deferred, builders) | OK |
| **PointsStore invariants executed against the real module** (`spa/modules/points/PointsStore.js` as .mjs): US-PTS-004 interleaving (10→14, confirm 13 → still 14, settle 14), US-PTS-007 load-keeps-pending, US-PTS-008 skipped-member snap, US-PTS-009 subscribe/emit/fold/rollback | **11/11 assertions pass** |
| **`calculateAttendancePoints` executed against `utils/api-helpers.js`**: null→present=+1, no-change=0, present→absent=−1, object-shape `{points: 2}`=+2, unknown status=0 | matches every US-ATT-003 expectation |
| Every i18n key asserted by the suites checked against `lang/en.json` and `lang/fr.json` | all present in both (US-I18N-001 will pass) |
| Honors batch bind-parameter layout reproduced in isolation | **defect confirmed** (see Bug 1) |

## Expected CI outcome per suite

| Suite | Stories | Expected |
|---|---|---|
| points-store.stories | PTS-004/007/008/009, I18N | **PASS** (logic already executed locally) |
| backend-attendance.stories | ATT-003/013/014/015/016, PERM-001..003 | PASS |
| backend-points.stories | PTS-013..017, PERM-004 | PASS |
| backend-honors.stories | HON-004/006/007/015 | PASS |
| backend-honors.stories | **HON-005** | **FAIL — real product bug (Bug 1)** |
| backend-activities.stories | ACT-005/006 | PASS |
| manage-points.stories | PTS-001..003/005/006/010..012/019, NAV-001 | PASS |
| attendance.stories | ATT-001..012/017..020, NAV-002 | PASS |
| manage-honors.stories | HON-001/003/008..014 | PASS |
| manage-honors.stories | **HON-002 "marks the kid as honored before the server responds"** | **FAIL — real product bug (Bug 2)** |
| offline.stories | OFF-001..005/007 | PASS |
| interactions.stories | INT-001..008 | PASS |

The two FAILs are deliberate: the acceptance criteria describe what the user should
see; the tests were **not** weakened to match the defective behavior.

## Product bugs found

### Bug 1 — Awarding 2+ honors in one request breaks (P1)
**Where:** [routes/honors.js:213-221](routes/honors.js#L213-L221) (`POST /api/v1/honors`, batch insert)
**Story:** US-HON-005 (test asserts bind-parameter consistency; fails against current code)
**What happens:** the VALUES clause hardcodes `$5` as the `created_by` placeholder for
every row, while parameters are laid out 4-per-honor with the user id appended last.
Executed repro for 2 honors:

```
VALUES ($1, $2, $3, $4, $5, NOW()), ($5, $6, $7, $8, $5, NOW())
params length: 9 | max placeholder used: 8
row 2 created_by binds to $5 = 2   (participant 2's id, not the user UUID)
```

On real PostgreSQL this aborts with "bind message supplies 9 parameters, but prepared
statement requires 8" → **every multi-kid honor night 500s**; even if the count matched,
`created_by` would record a participant id instead of the awarding user. Single-honor
awards work ($5 correctly lands on the user id), which is why this survived. The SPA's
`ManageHonors.submitHonors` sends exactly this multi-honor array. The legacy
`/api/award-honor` loop (one insert per honor) is unaffected.
**Suggested fix:** put `created_by` inside each row's parameter block (5 params per
honor) or use `unnest`, mirroring the points batch insert above it.

### Bug 2 — Optimistic honor marking is invisible (P2)
**Where:** [spa/manage_honors.js:470](spa/manage_honors.js#L470) (string
`dataset.participantId`) vs [spa/manage_honors.js:138](spa/manage_honors.js#L138)
(strict `===` against the API's numeric `participant_id`)
**Story:** US-HON-002, acceptance "rows show as honored before the response"
**What happens:** `awardHonor()` builds `pendingHonors` from `dataset.participantId`
(always a string); `optimisticallyAddHonors` stores that string as `participant_id`;
`processHonors` compares it with `===` to the numeric `participant_id` from the API →
no match → the row never shows as honored, neither optimistically nor after the server
confirms (the board only corrects on the next full fetch). `applyAwardResults` "works"
only because the server echoes back the same string.
**Suggested fix:** normalize to `Number(...)` (or compare with `String(a) === String(b)`
as `manage_points.js` does elsewhere).

## Observations (not test failures)

1. **Divergent default point rules.** `utils/index.js:616-621` defaults `absent: -1`
   while `utils/api-helpers.js:260-268` defaults `absent: 0`. `POST /v1/attendance`
   uses the former, `POST /v1/points`/honors use the latter. For orgs without a
   `point_system_rules` setting, marking absent→present yields +2 via attendance while
   the rest of the system treats absent as worth 0. The suites pin explicit rules so
   they don't depend on either default, but the divergence deserves a single source.
2. **`ManagePoints.unsubscribeStore` is stored but never called** (no `destroy()`), so
   each visit leaks a store subscription. Not user-visible today because each visit
   also creates a fresh store (US-INT-008 passes), but it is the exact gap the Phase 4
   BaseModule-adoption plan targets.
3. **Points cache refresh after sync:** after an offline fold, a later online
   `preloadManagePointsData` overwrites folded totals with server totals *before* the
   queued mutation replays. US-INT-006 sidesteps this by reloading offline; a
   follow-up story should pin the desired online-reload-before-sync behavior once the
   Phase 4 sync-completed event exists.

## How to run

```bash
npm run test:stories        # just these suites
npm test                    # full suite (user-stories included by default)
```

Structure: one `describe` per story ID (`US-<MODULE>-<NNN>` — see
[CATALOG.md](CATALOG.md)); each `it` is an acceptance criterion phrased as what the
user observes. Backend suites use the repo's `jest.mock('pg')` + `mock-helpers`
pattern with supertest against `api.js`; SPA suites run under jsdom with
`fake-indexeddb`, the real page classes, the real `PointsStore`/`indexedDB.js`, and
`translate` backed by the real `lang/en.json`.
