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
// Keep the OfflineManager module loaded so shared singleton state is initialized
// before sync wiring runs. Event listeners are attached by OfflineManager.init().
import '../modules/OfflineManager.js';
import { debugLog, debugError } from '../utils/DebugUtils.js';
import { CONFIG } from '../config.js';

let initialized = false;

/**
 * Sync delay constants (milliseconds).
 * Centralized to avoid magic numbers scattered through the module.
 */
const SYNC_DELAYS = {
  /** Delay before initial sync on app startup to avoid blocking rendering */
  INITIAL: 2000,
  /** Delay after coming online to let the network stabilise */
  ONLINE: 1500,
  /** Delay after login to allow the token to be written to storage */
  POST_LOGIN: 3000,
};

/** Active timer IDs so we can cancel them during cleanup. */
const pendingTimers = new Set();

/**
 * Schedule a callback with a tracked timer that is auto-cleared on cleanup.
 * @param {Function} fn
 * @param {number} delayMs
 */
function scheduleSync(fn, delayMs) {
  const id = setTimeout(() => {
    pendingTimers.delete(id);
    fn();
  }, delayMs);
  pendingTimers.add(id);
}

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
    if (navigator.onLine && localStorage.getItem(CONFIG.STORAGE_KEYS.JWT_TOKEN)) {
      scheduleSync(() => {
        syncEngine.sync().catch((err) => {
          debugError('SyncInit: Initial sync failed', err);
        });
      }, SYNC_DELAYS.INITIAL);
    }
  } catch (error) {
    debugError('SyncInit: Initialization failed', error);
  }
}

/**
 * Handle coming online - trigger sync after a short delay.
 */
function handleOnline() {
  debugLog('SyncInit: Device came online, scheduling sync');

  scheduleSync(async () => {
    if (!navigator.onLine) return;

    try {
      await syncEngine.sync();
    } catch (error) {
      debugError('SyncInit: Online sync failed', error);
    }
  }, SYNC_DELAYS.ONLINE);
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

  if (!isOffline && localStorage.getItem(CONFIG.STORAGE_KEYS.JWT_TOKEN)) {
    // Just came online - the 'online' handler will handle sync
    debugLog('SyncInit: OfflineManager reports online');
  }
}

/**
 * Handle user login - trigger initial data pull.
 */
function handleUserLoggedIn() {
  debugLog('SyncInit: User logged in, scheduling initial sync');

  scheduleSync(async () => {
    if (!navigator.onLine) return;

    try {
      await syncEngine.sync({ fullRefresh: true });
    } catch (error) {
      debugError('SyncInit: Post-login sync failed', error);
    }
  }, SYNC_DELAYS.POST_LOGIN);
}

/**
 * Cleanup sync system (e.g., on logout).
 * Cancels pending timers, removes listeners, destroys UI.
 */
export function cleanupSync() {
  // Cancel all pending scheduled syncs
  for (const id of pendingTimers) {
    clearTimeout(id);
  }
  pendingTimers.clear();

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
