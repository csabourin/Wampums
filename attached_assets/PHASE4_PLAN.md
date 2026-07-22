# Phase 4 — Cross-Module Plumbing: Detailed Plan

**Date:** 2026-07-20
**Prerequisites:** Phases 1–3 (merged on `deps-update-2026-07`): server-derived attendance point baselines, canonical attendance cache + activity-aware carry-forward, `PointsStore` with base+pending reconciliation in `spa/modules/points/PointsStore.js`.

**Goal:** Replace ad-hoc cross-module coordination with three explicit mechanisms:

1. a **declarative cache-invalidation registry** (which mutation invalidates which cached data, including cascades like attendance → points),
2. an **app event bus** so live pages react to data changes made elsewhere,
3. a **converged module lifecycle** (every page adopts `BaseModule` so subscriptions and listeners are cleaned up on navigation).

Current pain this removes: 12 hand-maintained `clear*RelatedCaches()` helpers in `spa/indexedDB.js` that each open IndexedDB separately and must be remembered at every mutation call site; no way for an open page to learn that another page (or the offline sync queue) changed its data; three root-level pages (`attendance.js`, `manage_points.js`, `manage_honors.js`) with no `destroy()`, which now leak store/bus subscriptions on every navigation.

---

## 4.1 Declarative cache-invalidation registry

**New file:** `spa/utils/CacheInvalidation.js` (utility, not a feature module — `spa/utils/` is allowed by `lint:spa-files`).

### Design

```js
// Every cached key belongs to exactly one domain. A mutation invalidates a
// domain; cascades express server-side coupling (attendance writes point rows).
const CACHE_DOMAINS = {
  points: {
    keys: ['participants', 'manage_points_data', 'points_report',
           'dashboard_groups', 'dashboard_participant_info'],
    prefixes: [],
    cascades: [],
  },
  attendance: {
    keys: ['attendance_dates'],
    prefixes: ['attendance_api_'],
    cascades: ['points'],            // POST /v1/attendance inserts point rows
  },
  honors: {
    keys: ['honors_all', 'recent_honors', 'honors_report'],
    prefixes: ['honors_'],
    cascades: ['points'],            // POST /v1/honors inserts point rows
  },
  activities: {
    keys: ['activities', 'upcoming_activities', 'v1/activities', 'attendance_dates'],
    prefixes: ['activity_', 'carpool_', 'v1/activities/', 'v1/carpools/'],
    cascades: [],
  },
  groups: {
    keys: ['groups', 'participants', 'participants_v2'],
    prefixes: ['attendance_'],       // attendance caches embed group structure
    cascades: ['points'],
  },
  // ... badges, finance, fundraisers, budgets, forms, carpools, medication
};

/** Pure function — unit-testable without IndexedDB */
export function resolveInvalidation(domain) { /* cascade walk with visited set → {keys, prefixes} */ }

/** One DB open, one getAllKeys pass, batch delete, then emit on the event bus */
export async function invalidate(domain, { emit = true } = {}) { ... }
```

Key properties:

- **Cascades resolved with a visited set** (cycle-safe), then **one** IndexedDB transaction: open once, `getAllKeys()` once, delete every matching key. Today a single group-attendance update of 30 participants triggers ~60 separate open/scan/delete cycles.
- `invalidate()` is the **only** emitter of the `data:invalidated` event (see 4.2), so cache state and notifications can never disagree.
- Page-local caches a module deliberately rewrites itself (e.g. the attendance page's per-date `attendance_${date}` entries via `writeAttendanceCache`) stay out of the registry — same rule as today.

### Steps

1. **Inventory (0.5 day).** Grep every `setCachedData(`, `cacheKey:`, and `cacheData(` call site (including `OfflineManager.prepareForActivity`); produce a table `key/prefix → owning domain → writers → readers`. Commit it at the top of `CacheInvalidation.js` as the registry's source-of-truth comment. Anything unowned is dead cache — delete the writer or claim it.
2. **Implement (0.5 day).** `resolveInvalidation` + `invalidate` + node-runnable assertions for the resolver (cascades, cycles, unknown domain throws).
3. **Rewire (1 day).** Convert the 12 `clear*RelatedCaches` exports in `spa/indexedDB.js` into one-line wrappers that delegate to `invalidate('<domain>', {emit:false})`, so nothing breaks; then migrate mutation call sites (`api-endpoints.js`, `api-activities.js`, module-local clears like `manage_honors.js:697`) to call `invalidate()` directly with `emit:true`. Delete wrappers once call sites are migrated.
4. **Guardrail (0.5 day).** New `scripts/modernization/check-cache-invalidation.js` + npm script `lint:cache-invalidation`: forbid `deleteCachedData(`/`clear*RelatedCaches(` outside `indexedDB.js`, `CacheInvalidation.js`, and an explicit allow-list of page-local uses. Wire into the pre-PR checklist in CLAUDE.md.

---

## 4.2 App event bus

**New file:** `spa/utils/EventBus.js` — a thin, typed wrapper over `CustomEvent` on `window` (the exact mechanism `OfflineManager.dispatchEvent` already uses at `spa/modules/OfflineManager.js:624`, so there is one pattern, not two).

### Design

```js
export const APP_EVENTS = {
  DATA_INVALIDATED: 'wampums:data-invalidated',   // detail: { domains: ['attendance','points'] }
  CAMP_MODE_CHANGED: 'campModeChanged',           // bridge: already emitted by OfflineManager
  OFFLINE_STATUS_CHANGED: 'offlineStatusChanged', // bridge: already emitted by OfflineManager
  SYNC_COMPLETED: 'wampums:sync-completed',       // emit from OfflineManager after mutation queue drains
};

export function emit(eventName, detail) { window.dispatchEvent(new CustomEvent(eventName, { detail })); }
export function on(eventName, handler, { signal } = {}) {
  window.addEventListener(eventName, handler, { signal });
  return () => window.removeEventListener(eventName, handler);
}
```

Rules:

- **Events carry domain names and ids, never data payloads.** Consumers refetch through the normal cached API path (the cache was just invalidated, so the refetch is fresh). This avoids a second source of truth traveling through events.
- `on()` accepts an `AbortSignal` so BaseModule modules pass `this.signal` and cleanup is automatic.
- **Consumers must debounce.** A group attendance sweep fires many invalidations; pages coalesce with the existing `debounce()` from `PerformanceUtils.js` (≥500 ms) before refetching.
- `invalidate()` must never *listen* to `DATA_INVALIDATED` (no feedback loops); only pages/widgets consume it.

### Wiring (first consumers)

| Consumer | Listens for | Reaction |
|---|---|---|
| `ManagePoints` | `points`/`attendance`/`honors` invalidated | debounced `refreshPointsData()`; skip while `store.hasPendingDeltas()` or a batch is in flight, re-check after flush |
| `Attendance` | `activities` invalidated | re-run `detectActivityContext()`; refresh date list |
| `Attendance` | `SYNC_COMPLETED` | refetch current date (offline camp edits from the queue are now on the server) |
| `dashboard.js` widgets (points/attendance tiles) | `points`/`attendance` invalidated | debounced tile refresh |
| `manage_honors.js` | `honors` invalidated | reload honors for current date |

**Emitter side:** after 4.1, mutations already emit via `invalidate()`. Add one `SYNC_COMPLETED` emission in `OfflineManager` when its mutation queue drains (it already tracks `pendingCountChanged`), plus a call to `invalidate()` for the domains of the synced mutations.

**Stretch (separate PR):** cross-tab propagation via `BroadcastChannel` re-emitting `DATA_INVALIDATED` — the bus API stays identical, so this is additive.

Estimate: 1 day bus + first two consumers; 0.5 day dashboard/honors consumers.

---

## 4.3 Module lifecycle convergence

13 files already use `BaseModule`/`initializeCleanup` (e.g. `Activities`, `MeetingPrep`, `dashboard.js`); the pages we just made stateful do not. **Concrete bug this fixes:** `ManagePoints.init()` stores `this.unsubscribeStore` but nothing ever calls it — every visit to the page adds a live store subscription. The router already calls `currentModuleInstance.destroy()` on navigation (`spa/router.js:223`), so adopting BaseModule is sufficient.

Per-module conversion (order: `manage_points.js`, `attendance.js`, `manage_honors.js`, then remaining root pages opportunistically):

1. `extends BaseModule` + `super(app)`.
2. Replace bare `addEventListener` with `this.addEventListener(...)` (signal-based). This deletes the attendance page's `cloneNode` dateSelect hack — the clone existed only to drop stale listeners.
3. Register store/bus subscriptions via `this.addSubscription(key, unsubscribe)` so `destroy()` cleans them.
4. Replace DOM-presence guards (`document.querySelector('.attendance-container')`) with `this.ifNotDestroyed(...)` / `isDestroyed` checks in async completions.
5. Audit `spa/router.js`: every `case` that instantiates a module must assign `this.currentModuleInstance` (several of the 62 dynamic imports do; verify the rest — any missing assignment means destroy is never called).

Acceptance per module: navigate in → interact → navigate out → navigate back; assert (via debug logs / jest) exactly one live subscription, no duplicate event handling, no updates applied to detached DOM.

Estimate: 0.5 day per page for the three stateful pages + 0.5 day router audit.

---

## 4.4 Shared data services (stretch, only after 4.1–4.3 land)

- **App-level PointsStore singleton** (per organization) so dashboard tiles, honors, and manage_points display identical totals and optimistic deltas; today each page constructs its own.
- **AttendanceService** exposing `parseAttendanceCacheEntry`/`writeAttendanceCache` (currently methods on the `Attendance` class) so `OfflineManager.prepareForActivity` writes the canonical shape through the same serializer instead of hand-building its payload (`OfflineManager.js:821-832`).

Each is a small, independent PR. Do not gate Phase 4 on them.

## 4.5 Guardrails & verification

- New lint: `lint:cache-invalidation` (see 4.1.4). All existing lint scripts must stay green.
- Node-runnable assertion scripts for `resolveInvalidation` and `EventBus` (same pattern as the Phase 3 PointsStore test; jest cannot run from this Windows/WSL setup — CI runs the jest suite).
- Manual browser matrix: (a) take attendance → open points page → totals fresh without hard reload; (b) award honor → points tile refreshes; (c) create activity → attendance date list gains its days while attendance page is open; (d) camp-mode offline edits → reconnect → `SYNC_COMPLETED` refreshes open pages.
- **Update CLAUDE.md**: mutations must call `invalidate(domain)`; pages must extend `BaseModule`; direct `deleteCachedData` is lint-blocked; events carry ids not payloads.

### Sequencing

| PR | Contents | Depends on |
|---|---|---|
| 1 | Inventory + `CacheInvalidation.js` + resolver tests + wrappers | — |
| 2 | `EventBus.js` + emissions from `invalidate()` + OfflineManager bridge | 1 |
| 3 | BaseModule adoption: manage_points, attendance, manage_honors + router audit | 2 (consumers need `this.signal`) |
| 4 | Dashboard/honors consumers + lint script + CLAUDE.md update | 3 |
| 5 (opt) | Shared PointsStore singleton / AttendanceService / BroadcastChannel | 4 |

Risks: refetch storms (mitigated by debounce + pending-delta guard), event feedback loops (single emitter rule), cascade cycles (visited set), silent registry drift (the lint script and the inventory comment are the countermeasures).

---

# Prompt: Generate the User-Story Test Suite

> Copy everything between the lines into a fresh Claude Code session (or a `general-purpose` agent) run from the repo root.

---

You are writing a **user-story-driven test suite** for the Wampums scout-management app (Node/Express + PostgreSQL backend, vanilla-JS SPA in `spa/`). Your job is to (1) produce a catalog of user stories that covers every user-reachable function of each SPA module and every cross-module interaction, and (2) implement them as executable jest tests. Work from the user's point of view: every test name is a user story, every assertion is something a user would observe.

## Step 1 — Read before writing anything

- `CLAUDE.md` — response envelope (`success/error/paginated`), permission naming, status-code contract, i18n rules. Every expectation you write must match these contracts.
- `test/mock-helpers.js`, `test/mock-factory.js`, `test/jest-conditional-helpers.js`, and 3–4 existing `test/*.test.js` files — reuse this infrastructure and follow its conventions (jest 30, jsdom environment available, supertest for routes). Do not invent a parallel mocking system.
- The modules under test, at minimum: `spa/attendance.js`, `spa/manage_points.js`, `spa/modules/points/PointsStore.js`, `spa/manage_honors.js`, `spa/modules/activities/Activities.js`, `spa/modules/OfflineManager.js`, `spa/api/api-endpoints.js`, `spa/indexedDB.js`, and backend `routes/attendance.js`, `routes/points.js`, `routes/honors.js`, `routes/activities.js`, `utils/api-helpers.js`.
- `lang/en.json` / `lang/fr.json` for any UI text you assert on (assert on translation **keys** or both languages, never on hardcoded English only).

## Step 2 — Build the story catalog first (deliverable 1)

Create `test/user-stories/CATALOG.md`. For **each module**, enumerate its public/user-reachable functions and write stories in this exact format:

```
### US-ATT-007 — Carry-forward on day 2 of camp
As a unit leader at a 3-day camp,
when I open the attendance page on day 2 and nobody has been marked yet,
I want yesterday's present/late participants pre-filled and persisted,
so that I don't re-enter 40 kids every morning.

Covers: Attendance.autoCarryForward, Attendance.findCarryForwardSourceOnline,
        POST /v1/attendance/carry-forward
Priority: P1   Personas: leader   Modes: online, offline, camp-mode
Acceptance:
  Given attendance exists for day 1 (25 present, 3 late, 2 absent)
  And no attendance exists for day 2
  When the leader opens /attendance on day 2
  Then 28 participants show present/late carried from day 1
  And the 2 absent participants show "unmarked" (not absent)
  And an info toast shows the carried-forward count and source date
  And the server has day-2 attendance rows for the 28
```

Catalog requirements:

- **ID scheme:** `US-<MODULE>-<NNN>` (ATT, PTS, HON, ACT, OFF, NAV, PERM, I18N).
- **Personas:** unit leader (attendance/points/honors manager), parent (read-mostly), org admin, **demo user** (blocked from writes with `isDemo: true` 403), unauthenticated visitor.
- **Function coverage:** every method of every listed module must appear in at least one story's `Covers:` line. Finish the catalog with a coverage table (function → story IDs) and an explicit list of anything intentionally uncovered, with reasons.
- **Cross-module interaction stories are mandatory**, minimum:
  1. Marking attendance changes point totals (server inserts adjustment rows; points page shows fresh totals after cache invalidation — no stale "jump").
  2. Group point award skips absent/excused members both optimistically (UI) and server-side, and the two agree.
  3. Awarding/deleting an honor changes point totals on the points page.
  4. Creating a multi-day activity makes its dates selectable on the attendance page and triggers the camp banner + carry-forward flow.
  5. Rapid-fire +1/+3/-1 clicking during slow/out-of-order server responses never makes a displayed total jump backwards (PointsStore invariant: displayed = confirmed base + pending deltas).
  6. Going offline mid-action queues the mutation, keeps optimistic state across a page reload (IndexedDB), and reconciles after reconnect.
  7. A failed server call rolls the UI back to the exact pre-action state and shows a translated error toast.
  8. Navigating away and back to a page does not duplicate event handling or leak subscriptions (act twice, assert effects happen once).
- **Edge-case stories** per module: empty states (no groups, no participants), permission denied (403 with `required`/`missing` arrays), demo-role blocked writes, invalid dates, participant in no group, activity spanning >31 days, both point-rule shapes (`{present: 1}` and `{present: {points: 1}}`), first-time marking vs. status change.

## Step 3 — Implement the tests (deliverable 2)

- Layout: `test/user-stories/<module>.stories.test.js` plus `test/user-stories/interactions.stories.test.js`. One `describe` per story ID; `it` blocks are the acceptance criteria, phrased as user-visible behavior:

  ```js
  describe('US-PTS-004 — Points never jump during rapid clicking', () => {
    it('shows 14 after +3 then +1 while the first response is still in flight', ...);
    it('still shows 14 after both server responses arrive out of order', ...);
  });
  ```

- **Backend stories:** supertest against the route factories with the fake-pool/mock-helpers pattern from the existing suite. Assert envelope shape, status codes, org isolation (`organization_id` in every query), and point-row side effects.
- **SPA stories:** jsdom + a mocked fetch layer (or mock `spa/api/api-endpoints.js` at module boundary) + `fake-indexeddb` if the repo lacks an IndexedDB shim (add it as a devDependency if needed). Drive the real module classes (`new Attendance(app)` with a stub `app` exposing `showMessage`, `router`, `lang`), then assert on the DOM the user sees: status chips, toasts, totals, banner text, button counts.
- **Pure-logic stories** (PointsStore, `calculateAttendancePoints`, cache-entry parsing, date-range enumeration): direct unit tests, including the interleaved-batch, fold (offline), and rollback sequences.
- Determinism: fake timers for debounce/animation timeouts; no real network; no test depends on another's state; seed data through the mock factory, not literals scattered across tests.
- Respect repo lint rules inside tests: `===`, `const/let`, single quotes, 2-space indent, semicolons; `no-magic-numbers`/`no-console` are off in `*.test.js`.

## Step 4 — Deliver

1. `test/user-stories/CATALOG.md` (stories + coverage table + gaps list).
2. The test files, each header-commented with the story IDs it implements.
3. A run report: which stories pass against current code, and for each failure, whether it is a test bug or a real product bug — with the file:line of the suspected product defect. Do not silently change a test to make a defect pass; surface it.
4. An npm script `test:stories` (jest with a testPathPattern for `test/user-stories/`).

Constraint: jest cannot run in the Windows-over-WSL environment this repo is sometimes edited from — make no assumptions that tests were executed there; if you cannot run jest, still deliver the suite plus a static verification (node --check / ESM parse) and mark the run report as "pending CI".

---
