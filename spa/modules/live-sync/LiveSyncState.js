/**
 * State shared between the API layer, the cache and the live-sync client.
 *
 * Kept free of imports so `indexedDB.js` and `api-core.js` can record into it
 * without pulling in the socket client or the offline manager.
 */

let clientId = null;
const pageCacheKeys = new Set();
const pageRequestPaths = new Set();

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
 * Forget what the previous page read. Called on every navigation.
 */
export function resetPageReads() {
  pageCacheKeys.clear();
  pageRequestPaths.clear();
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
