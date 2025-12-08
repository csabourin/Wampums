import { debugLog, debugWarn, debugError } from './DebugUtils.js';
import { clearStorage } from './StorageUtils.js';
import { deleteIndexedDB } from '../indexedDB.js';

/**
 * Remove all Cache Storage entries for the current origin.
 * @returns {Promise<void>} Resolves after cache deletion attempts complete
 */
async function clearAllCaches() {
  if (!('caches' in window)) {
    debugWarn('CacheStorage API not available; skipping cache cleanup.');
    return;
  }

  try {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
    debugLog('Cache storage cleared:', cacheNames);
  } catch (error) {
    debugError('Error clearing caches:', error);
  }
}

/**
 * Clear all client-side storage, caches, and IndexedDB data.
 * Intended for logout flows to prevent cross-account data leakage.
 * @returns {Promise<void>} Resolves when cleanup tasks finish
 */
export async function clearAllClientData() {
  debugLog('Clearing client data (localStorage, sessionStorage, caches, IndexedDB)');

  // Clear Web Storage synchronously to remove tokens immediately
  clearStorage(false);
  clearStorage(true);

  // Clear Cache Storage and IndexedDB
  await Promise.all([
    clearAllCaches(),
    deleteIndexedDB().catch((error) => debugError('IndexedDB cleanup failed:', error))
  ]);
}
