# Offline/Camp Mode Audit: Why it is not truly offline-first

Date: 2026-02-11

This audit reviews SPA offline behavior (`OfflineManager`, API core/cache layer, service worker, IndexedDB schema) to identify why camp mode does not provide a dependable offline-first experience.

## Executive Summary

The implementation has **multiple independent offline stacks** that do not share keys, storage, or sync semantics:

1. SPA API caching (keyed mainly by endpoint string).
2. Offline preparation cache seeding (keyed by full URL strings and feature-specific keys).
3. Service worker runtime caching + mutation queue (separate IndexedDB database and store).
4. Legacy `offlineData` mutation queue fallback in `WampumsAppDB`.

Because these layers are not aligned, users can prepare data successfully but still hit cache misses offline, and mutation/sync indicators can report incorrect state.

## Findings

### 1) API cache keying ignores query parameters and URL shape (high impact)

`makeApiRequestWithCache()` defaults `cacheKey` to only `endpoint`, and `API.get()` does not include params in cache key generation. This means:

- Different requests can overwrite each other (`v1/attendance?date=A` vs `?date=B`).
- Prepared cache entries seeded with full URL keys are often not found by API methods reading endpoint keys.

Evidence:
- `cacheKey = endpoint` default and `API.get(endpoint, params)` pass-through.【F:spa/api/api-core.js†L202-L207】【F:spa/api/api-core.js†L270-L272】
- Offline preparation writes many entries as full absolute URLs (e.g., `${CONFIG.API_BASE_URL}/api/v1/...`) and also custom keys like `attendance_YYYY-MM-DD`.【F:spa/modules/OfflineManager.js†L622-L625】【F:spa/modules/OfflineManager.js†L649-L655】

### 2) GET flow is cache-assisted but not offline-first resilient (high impact)

`makeApiRequest()` only has explicit offline handling for **non-GET** methods. For GET requests it performs network retries and throws on failure; there is no fallback there. Fallback depends on the cache check done earlier by `makeApiRequestWithCache()`, which fails if keying mismatches.

Evidence:
- Explicit offline handling only when `method !== 'GET'`.【F:spa/api/api-core.js†L144-L163】
- GET path attempts network fetch/retry and eventually throws.【F:spa/api/api-core.js†L168-L194】

Result: any read that misses the exact cache key hard-fails offline.

### 3) Mutation queue storage is split across incompatible databases/stores (high impact)

The service worker stores queued mutations in `wampums-cache / pending-mutations`, while SPA pending-count logic reads `WampumsAppDB / offlineData` via `getOfflineData()`.

Evidence:
- SW DB/store names: `wampums-cache`, `pending-mutations`.【F:src-sw.js†L169-L173】
- `QUEUE_MUTATION` writes to SW pending store via `saveOfflineMutation()`.【F:src-sw.js†L761-L767】
- OfflineManager pending count reads `getOfflineData()` from SPA IndexedDB module (legacy store).【F:spa/modules/OfflineManager.js†L427-L437】

Result: pending counters and “all synced” notifications can be wrong because app UI and SW queue are observing different stores.

### 4) Fallback mutation persistence can overwrite earlier operations (high impact)

When SW is unavailable, fallback uses `saveOfflineData(mutation.method, ...)`. In IndexedDB this sets `key: action` (e.g., `POST`, `PUT`), so later operations of same method overwrite earlier ones.

Evidence:
- Fallback writes keyed by HTTP method.【F:spa/modules/OfflineManager.js†L265-L273】
- `saveOfflineData()` uses `key: `${action}`` and `put()` into keyPath store.【F:spa/indexedDB.js†L141-L150】【F:spa/indexedDB.js†L157-L160】

Result: data loss in queued offline mutations in fallback mode.

### 5) Background sync capability check is likely incorrect (medium impact)

`syncPendingData()` checks `'sync' in navigator.serviceWorker`, but `sync` is a registration capability (`SyncManager` on registration/window), not on the container in most implementations.

Evidence:
- Current check and registration flow.【F:spa/modules/OfflineManager.js†L297-L301】

Result: background sync may silently never register, reducing reliability of automatic replay.

### 6) Camp preparation endpoint coverage does not guarantee runtime query parity (medium impact)

Preparation caches selected endpoints and some date-specific URL variants, but runtime modules use a mix of API wrappers, legacy endpoints, and module-specific cache keys. Without one canonical request-key strategy, coverage remains partial.

Evidence:
- Camp-prep seeds mixed keys (`participants_v2`, `attendance_DATE`, full URLs, etc.).【F:spa/modules/OfflineManager.js†L622-L655】
- API layer expects endpoint-based keys by default.【F:spa/api/api-core.js†L202-L207】

Result: “Prepared” does not guarantee all actual runtime reads resolve offline.

### 7) Upcoming camp discovery has no offline fallback (low/UX impact)

`getUpcomingCamps()` fetches network data and returns `[]` on error; it does not use cached fallback.

Evidence:
- Direct fetch + catch returns empty array.【F:spa/modules/OfflineManager.js†L538-L557】

Result: offline users can’t inspect upcoming camps in prep UI unless already loaded elsewhere.

## Why users experience “not truly offline-first”

From a user perspective, this creates a pattern:

- They prepare camp data successfully.
- Some pages still fail offline due to key mismatches and GET path dependency on exact pre-existing cache keys.
- Sync status appears inconsistent because queue accounting in UI and SW diverges.
- In fallback mode, some queued edits are overwritten before reconnection.

## Recommended remediation order

1. **Unify cache keying** (single canonical key function using full path + sorted query params + org context).
2. **Unify mutation queue storage** (single queue owner, ideally SW store, and expose count/status back to SPA via message channel).
3. **Fix fallback queue record identity** (unique IDs, not method-keyed records).
4. **Make GET path explicitly offline-first** (cache-first or stale-while-revalidate for declared offline-capable endpoints).
5. **Correct background sync feature detection** and add explicit fallback sync loop.
6. **Add offline contract tests** (prepared -> airplane mode -> critical flows -> reconnect sync replay).

## Suggested acceptance criteria for “true offline-first camp mode”

- Camp prep yields deterministic key list for all routes used during camp workflows.
- 100% of listed flows work with network disabled after prep.
- Pending mutations survive reload/tab close and replay in-order on reconnect.
- UI pending count matches real queue count at all times.
- No mutation loss in fallback scenarios.

---

## Update 2026-02-13: HTML Caching Fix

### Issue Fixed: 404 Errors for Dynamically Imported Modules

**Problem:** Users reported 404 errors when navigating to manage_points and other pages:
```
GET https://demo.wampums.app/assets/init-activity-widget-X1hLd8Cw.js net::ERR_ABORTED 404
GET https://demo.wampums.app/assets/staff-IN8JJ3li.js net::ERR_ABORTED 404
```

**Root Cause:** The service worker was precaching `index.html` via Workbox's `precacheAndRoute()`. When a new deployment generated new hashed filenames for JS chunks, users with cached HTML had references to non-existent assets.

**Solution Implemented:**
1. **Excluded index.html from precaching** by adding it to `globIgnores` in `vite.config.js`
2. **Changed navigation strategy** from `createHandlerBoundToURL('/index.html')` to `NetworkFirst` with 1-hour TTL
3. **Added comprehensive tests** to verify configuration prevents future recurrence

**Files Changed:**
- `vite.config.js`: Added `**/index.html` to `injectManifest.globIgnores`
- `src-sw.js`: Replaced precached HTML handler with `NetworkFirst` strategy
- `test/service-worker-config.test.js`: Added 17 tests verifying configuration

**Impact:**
- Users now always fetch fresh HTML with correct asset references
- Reduces cache-related 404 errors to near zero
- Maintains offline capability via 1-hour HTML cache
- Precache count reduced from 104 to 103 entries

**References:**
- PR: copilot/fix-manage-points-404-error
- Commits: 500eecf, 1adbb8a
