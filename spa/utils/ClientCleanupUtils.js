import { debugLog, debugWarn, debugError } from './DebugUtils.js';
import { clearUserData } from './StorageUtils.js';
import { deleteIndexedDB } from '../indexedDB.js';

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

    // Filter out static asset caches to preserve app functionality
    // Only clear API and dynamic data caches
    const cachesToClear = cacheNames.filter(cacheName => {
      // Keep static caches (contains JS, CSS, HTML)
      // Keep image caches (contains app icons and images)
      return !cacheName.includes('-static-') && !cacheName.includes('-images-');
    });

    await Promise.all(cachesToClear.map((cacheName) => caches.delete(cacheName)));
    debugLog('User data caches cleared:', cachesToClear);
    debugLog('Static caches preserved:', cacheNames.filter(name => !cachesToClear.includes(name)));
  } catch (error) {
    debugError('Error clearing caches:', error);
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

  // Clear Cache Storage and IndexedDB
  await Promise.all([
    clearAllCaches(),
    deleteIndexedDB().catch((error) => debugError('IndexedDB cleanup failed:', error))
  ]);
}
