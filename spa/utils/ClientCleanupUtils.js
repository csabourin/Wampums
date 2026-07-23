import { debugLog, debugWarn, debugError } from './DebugUtils.js';
import { clearUserData } from './StorageUtils.js';
import { deleteIndexedDB } from '../indexedDB.js';
import { deleteOfflineDatabase } from '../data/OfflineDatabase.js';

/**
 * Remove user-specific Cache Storage entries while preserving static assets.
 * This ensures the app remains functional after logout by keeping critical
 * JavaScript, CSS, and HTML files cached.
 * @returns {Promise<void>} Resolves after cache deletion attempts complete
 */
async function clearAllCaches() {
  if (!('caches' in window)) {
    debugWarn('CacheStorage API not available; skipping cache cleanup.');
    return;
  }

  try {
    const cacheNames = await caches.keys();

    const staticCacheNames = new Set([
      'html-cache',
      'font-awesome-cache',
      'google-fonts-cache',
      'translations-cache',
      'image-cache',
    ]);

    // Current authenticated API responses live in IndexedDB, not Cache
    // Storage. Preserve known static/precache entries and remove only unknown
    // legacy runtime caches that may contain user data.
    const cachesToClear = cacheNames.filter(cacheName => {
      const isWorkboxPrecache = cacheName.startsWith('workbox-precache-');
      return !isWorkboxPrecache && !staticCacheNames.has(cacheName);
    });

    await Promise.all(cachesToClear.map((cacheName) => caches.delete(cacheName)));
    debugLog('User data caches cleared:', cachesToClear);
    debugLog('Static caches preserved:', cacheNames.filter(name => !cachesToClear.includes(name)));
  } catch (error) {
    debugError('Error clearing caches:', error);
  }
}

/**
 * Ask the active service worker to wipe its scoped API cache. The SW also
 * keys cache entries by user/org, but doing both prevents a stale entry from
 * leaking if the next signed-in user happens to share the same scope.
 * @returns {Promise<void>}
 */
async function clearServiceWorkerApiCache() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const sw = registration?.active;
    if (!sw) return;
    await new Promise((resolve) => {
      const channel = new MessageChannel();
      const timeout = setTimeout(resolve, 1500);
      channel.port1.onmessage = () => {
        clearTimeout(timeout);
        resolve();
      };
      sw.postMessage({ type: 'CLEAR_CLIENT_DATA' }, [channel.port2]);
    });
  } catch (error) {
    debugWarn('Could not message service worker to clear API cache:', error);
  }
}

/**
 * Clear all client-side storage, caches, and IndexedDB data.
 * Intended for logout flows to prevent cross-account data leakage.
 * Preserves device-level preferences like 2FA device trust tokens.
 * @returns {Promise<void>} Resolves when cleanup tasks finish
 */
export async function clearAllClientData() {
  debugLog('Clearing user data (preserving device preferences like 2FA device tokens)');

  // Clear user-specific data while preserving device-level preferences
  // This ensures device_token (2FA trust) and language preferences persist
  clearUserData(false); // localStorage - selective clearing
  clearUserData(true);  // sessionStorage - full clearing (no device prefs here)

  // Clear Cache Storage and IndexedDB (SPA + SW-side)
  await Promise.all([
    clearAllCaches(),
    deleteIndexedDB().catch((error) => debugError('IndexedDB cleanup failed:', error)),
    deleteOfflineDatabase().catch((error) => debugError('Offline database cleanup failed:', error)),
    clearServiceWorkerApiCache(),
  ]);
}
