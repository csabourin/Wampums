/**
 * Which Cache Storage buckets an accepted app update may delete.
 *
 * An update replaces code, not what the person prepared for offline use. Only
 * HTML kept by the network-first navigation handler and unversioned
 * translations belong to the build being replaced; everything else either
 * names its build in its keys (the Workbox precache, versioned translations),
 * holds no build-specific content (images, fonts), or is the shell that lets
 * the app start without a network (offline-shell). IndexedDB (cached API
 * answers and queued changes) is never touched by an update.
 */
const BUILD_SPECIFIC_CACHES = new Set(['html-cache', 'translations-cache']);

/**
 * Pick the caches an update clears from the names Cache Storage holds.
 * @param {string[]} cacheNames - Names from `caches.keys()`
 * @returns {string[]} Names to delete
 */
export function cachesToClearOnUpdate(cacheNames = []) {
  return cacheNames.filter((name) => BUILD_SPECIFIC_CACHES.has(name));
}
