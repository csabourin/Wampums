/**
 * State shared between the API layer, the cache and the live-sync client.
 *
 * Kept free of imports so `indexedDB.js` and `api-core.js` can record into it
 * without pulling in the socket client or the offline manager.
 */

let clientId = null;
const pageCacheKeys = new Set();
const pageRequestPaths = new Set();
const pageCachedRequests = new Map();
const pageCacheHits = new Set();
let pageMadeUncachedRead = false;
let writesInFlight = 0;
let unconfirmedWriteSinceCheck = false;
let writeSettledListener = null;

/**
 * Remember the live-sync connection id, sent with each write so the server
 * does not echo the change back to the tab that made it.
 * @param {string|null} id - Socket id, or null when disconnected
 */
export function setLiveSyncClientId(id) {
  clientId = id || null;
}

/**
 * @returns {string|null} Live-sync connection id, when connected
 */
export function getLiveSyncClientId() {
  return clientId;
}

/**
 * Record a cache entry read or written while the current page was shown.
 * @param {string} scopedKey - Full (scoped) cache key
 */
export function notePageCacheKey(scopedKey) {
  pageCacheKeys.add(String(scopedKey));
}

/**
 * Record an API path fetched while the current page was shown.
 * @param {string} path - Normalized API path, e.g. "/api/v1/points"
 */
export function notePageRequestPath(path) {
  pageRequestPaths.add(String(path));
}

/**
 * Record a cached GET made while the current page was shown, so live sync can
 * fetch the same data again before redrawing the page. Only the latest request
 * for each cache entry is kept: replaying older ones (another filter stored
 * under the same key) would race to overwrite what the page now shows.
 * @param {string} scopedCacheKey - Cache entry the request fills
 * @param {string} endpoint - Endpoint as the screen requested it
 * @param {Object} options - Request options (params)
 * @param {Object} cacheOptions - Cache options (key, duration), without forceRefresh
 */
export function notePageCachedRequest(scopedCacheKey, endpoint, options, cacheOptions) {
  pageCachedRequests.set(String(scopedCacheKey), {
    endpoint,
    options: { ...options },
    cacheOptions: { ...cacheOptions },
  });
}

/**
 * @returns {Array<{endpoint: string, options: Object, cacheOptions: Object}>}
 *   Cached GETs made while the current page was shown
 */
export function getPageCachedRequests() {
  return Array.from(pageCachedRequests.values());
}

/**
 * @param {Object} request - One of getPageCachedRequests()
 * @returns {boolean} Whether the page still reads its entry through this
 *   request: false once it navigated, or asked again with other parameters
 */
export function isPageCachedRequestCurrent(request) {
  for (const recorded of pageCachedRequests.values()) {
    if (recorded === request) {
      return true;
    }
  }
  return false;
}

/**
 * Record a cache entry the current page found and used. An entry no recorded
 * request fills (a snapshot a screen stores itself) cannot be fetched again in
 * advance: once cleared, the screen would rebuild it from the network.
 * @param {string} scopedKey - Full (scoped) cache key
 */
export function notePageCacheHit(scopedKey) {
  pageCacheHits.add(String(scopedKey));
}

/**
 * Record a GET made while the current page was shown that no cache keeps, so
 * fetching the page's cached reads again would not spare its redraw the network.
 */
export function notePageUncachedRead() {
  pageMadeUncachedRead = true;
}

/**
 * @returns {boolean} True when every read the current page made can be fetched
 *   again before the page is redrawn: no GET bypassed the cache, and every cache
 *   entry it found is one a recorded request fills
 */
export function pageReadsAreReplayable() {
  if (pageMadeUncachedRead) {
    return false;
  }
  for (const key of pageCacheHits) {
    if (!pageCachedRequests.has(key)) {
      return false;
    }
  }
  return true;
}

/**
 * Forget what the previous page read. Called on every navigation.
 */
export function resetPageReads() {
  pageCacheKeys.clear();
  pageRequestPaths.clear();
  pageCachedRequests.clear();
  pageCacheHits.clear();
  pageMadeUncachedRead = false;
}

/**
 * Whether the page on screen read any of the data a change invalidated.
 *
 * @param {Object} invalidation - Result of an invalidation
 * @param {string[]} invalidation.deletedKeys - Cache keys removed
 * @param {function(string): boolean} invalidation.matchesPath - Whether an API path was affected
 * @returns {boolean} True when the page shows data that just changed
 */
export function pageReadAnyOf({ deletedKeys = [], matchesPath = () => false }) {
  if (deletedKeys.some((key) => pageCacheKeys.has(key))) {
    return true;
  }
  for (const path of pageRequestPaths) {
    if (matchesPath(path)) {
      return true;
    }
  }
  return false;
}

/**
 * Record a write sent to the server. The server may tell live sync it has
 * seen the change before this client has dropped what the write made stale.
 */
export function noteWriteStarted() {
  writesInFlight += 1;
}

/**
 * Record that a write's response was handled, its cache invalidation included.
 * @param {boolean} confirmed - Whether the server confirmed it (not queued, not failed)
 */
export function noteWriteSettled(confirmed) {
  writesInFlight = Math.max(0, writesInFlight - 1);
  if (!confirmed) {
    unconfirmedWriteSinceCheck = true;
  }
  writeSettledListener?.();
}

/**
 * @returns {'pending'|'unconfirmed'|'settled'} Whether this client's writes
 *   have all been handled since the last check, and whether one went
 *   unconfirmed (a response lost to the network, for instance). Reading an
 *   'unconfirmed' result clears it.
 */
export function takeWriteState() {
  if (writesInFlight > 0) {
    return 'pending';
  }
  if (unconfirmedWriteSinceCheck) {
    unconfirmedWriteSinceCheck = false;
    return 'unconfirmed';
  }
  return 'settled';
}

/**
 * @param {function(): void|null} listener - Called whenever a write settles
 */
export function onWriteSettled(listener) {
  writeSettledListener = listener;
}
