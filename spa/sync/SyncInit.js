/**
 * SyncInit.js
 *
 * Initialization module that integrates the new SyncEngine with
 * the existing OfflineManager and app lifecycle.
 *
 * This is the bridge between the legacy offline system and the
 * new offline-first sync infrastructure. It:
 * - Initializes the SyncEngine on app start
 * - Wires up the SyncStatusPanel
 * - Triggers sync on connectivity changes
 * - Coordinates with OfflineManager events
 */

import { syncEngine } from './SyncEngine.js';
import { outboxManager } from './OutboxManager.js';
import { syncStatusPanel } from '../components/SyncStatusPanel.js';
import { offlineManager } from '../modules/OfflineManager.js';
import { debugLog, debugError } from '../utils/DebugUtils.js';

let initialized = false;

/**
 * Initialize the offline-first sync system.
 * Call this after the app is loaded and the user is authenticated.
 */
export async function initSync() {
  if (initialized) {
    debugLog('SyncInit: Already initialized');
    return;
  }

  try {
    // Initialize the sync engine (reset interrupted entries, load state)
    await syncEngine.init();

    // Initialize the sync status panel UI
    syncStatusPanel.init();

    // Wire up connectivity events to trigger sync
    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Listen for the existing OfflineManager's sync events
    window.addEventListener('offlineStatusChanged', handleOfflineStatusChanged);

    // Listen for userLoggedIn to do initial sync
    window.addEventListener('userLoggedIn', handleUserLoggedIn);

    initialized = true;
    debugLog('SyncInit: Initialized');

    // If we're online, do an initial sync
    if (navigator.onLine && localStorage.getItem('jwtToken')) {
      // Delay slightly to avoid blocking app startup
      setTimeout(() => {
        syncEngine.sync().catch((err) => {
          debugError('SyncInit: Initial sync failed', err);
        });
      }, 2000);
    }
  } catch (error) {
    debugError('SyncInit: Initialization failed', error);
  }
}

/**
 * Handle coming online - trigger sync after a short delay.
 */
async function handleOnline() {
  debugLog('SyncInit: Device came online, scheduling sync');

  // Wait a moment for network to stabilize
  setTimeout(async () => {
    if (!navigator.onLine) return;

    try {
      await syncEngine.sync();
    } catch (error) {
      debugError('SyncInit: Online sync failed', error);
    }
  }, 1500);
}

/**
 * Handle page becoming visible - sync if needed.
 */
function handleVisibilityChange() {
  if (document.hidden) return;
  if (!navigator.onLine) return;

  // Check if there are pending items to sync
  outboxManager.getPendingCount().then((count) => {
    if (count > 0) {
      debugLog('SyncInit: Page visible with pending items, syncing');
      syncEngine.sync().catch((err) => {
        debugError('SyncInit: Visibility sync failed', err);
      });
    }
  });
}

/**
 * Handle offline status change from existing OfflineManager.
 */
function handleOfflineStatusChanged(event) {
  const { isOffline } = event.detail;

  if (!isOffline && localStorage.getItem('jwtToken')) {
    // Just came online - the 'online' handler will handle sync
    debugLog('SyncInit: OfflineManager reports online');
  }
}

/**
 * Handle user login - trigger initial data pull.
 */
async function handleUserLoggedIn() {
  debugLog('SyncInit: User logged in, scheduling initial sync');

  // Wait for token to be available
  setTimeout(async () => {
    if (!navigator.onLine) return;

    try {
      await syncEngine.sync({ fullRefresh: true });
    } catch (error) {
      debugError('SyncInit: Post-login sync failed', error);
    }
  }, 3000);
}

/**
 * Cleanup sync system (e.g., on logout).
 */
export function cleanupSync() {
  window.removeEventListener('online', handleOnline);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  window.removeEventListener('offlineStatusChanged', handleOfflineStatusChanged);
  window.removeEventListener('userLoggedIn', handleUserLoggedIn);

  syncStatusPanel.destroy();
  initialized = false;

  debugLog('SyncInit: Cleaned up');
}

/**
 * Manually trigger a sync (for external callers).
 * @param {Object} [options]
 * @returns {Promise<Object>}
 */
export async function triggerManualSync(options = {}) {
  return syncEngine.sync(options);
}

/**
 * Get current sync state for external callers.
 */
export function getSyncState() {
  return {
    ...syncEngine.getMetrics(),
    initialized,
  };
}
