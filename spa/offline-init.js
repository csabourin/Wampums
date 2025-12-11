/**
 * offline-init.js
 *
 * Initialization module for offline support features.
 * Sets up OfflineIndicator, OfflineManager, and handles event listeners.
 */

import { debugLog, debugError } from './utils/DebugUtils.js';
import { OfflineIndicator } from './components/OfflineIndicator.js';
import { offlineManager } from './modules/OfflineManager.js';

let offlineIndicator = null;
let initialized = false;

/**
 * Initialize offline support
 * Sets up indicator, manager, and event listeners
 */
export function initOfflineSupport() {
    if (initialized) {
        debugLog('offline-init: Already initialized');
        return;
    }

    debugLog('offline-init: Initializing offline support');

    try {
        // Initialize OfflineManager
        offlineManager.init();

        // Initialize OfflineIndicator
        offlineIndicator = new OfflineIndicator();
        offlineIndicator.init();

        // Listen for user login to pre-cache critical data
        window.addEventListener('userLoggedIn', handleUserLogin);

        // Listen for page visibility to sync when user returns
        document.addEventListener('visibilitychange', handleVisibilityChange);

        // Listen for toast events from OfflineManager
        window.addEventListener('showToast', handleToastEvent);

        // Check for pending mutations on init
        offlineManager.checkPendingMutations();

        initialized = true;
        debugLog('offline-init: Initialization complete');

    } catch (error) {
        debugError('offline-init: Failed to initialize offline support', error);
    }
}

/**
 * Handle user login event
 * Pre-caches critical data after successful login
 */
async function handleUserLogin(event) {
    debugLog('offline-init: User logged in, pre-caching critical data', event.detail);

    try {
        // Check for token with exponential backoff
        const maxAttempts = 5;
        const baseDelay = 100; // Start with 100ms
        let token = null;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            token = localStorage.getItem('jwtToken');
            if (token) {
                break;
            }
            
            // Exponential backoff: 100ms, 200ms, 400ms, 800ms, 1600ms
            const delay = baseDelay * Math.pow(2, attempt);
            debugLog(`offline-init: Waiting for token, attempt ${attempt + 1}/${maxAttempts}, delay: ${delay}ms`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }

        if (!token) {
            debugWarn('offline-init: No token found after waiting, skipping pre-cache');
            return;
        }

        // Pre-cache critical data
        await offlineManager.preCacheCriticalData();
        
        debugLog('offline-init: Critical data pre-cached');
    } catch (error) {
        debugError('offline-init: Failed to pre-cache critical data', error);
    }
}

/**
 * Handle page visibility change
 * Syncs pending data when user returns to the app
 */
function handleVisibilityChange() {
    if (!document.hidden) {
        debugLog('offline-init: Page became visible, checking for pending sync');
        
        // Check if online and has pending mutations
        if (!offlineManager.offline && offlineManager.pendingCount > 0) {
            debugLog('offline-init: Syncing pending data');
            offlineManager.syncPendingData().catch(error => {
                debugError('offline-init: Failed to sync on visibility change', error);
            });
        }

        // Update online status
        offlineManager.updateOnlineStatus();
    }
}

/**
 * Handle toast event from OfflineManager
 * Forwards to app's toast system
 */
function handleToastEvent(event) {
    const { message, type } = event.detail;
    
    // Try to use app's showMessage if available
    if (window.app && typeof window.app.showMessage === 'function') {
        window.app.showMessage(message, type);
    } else {
        // Fallback - log to console
        console.log(`[${type.toUpperCase()}] ${message}`);
    }
}

/**
 * Get OfflineIndicator instance
 * @returns {OfflineIndicator|null} Indicator instance
 */
export function getOfflineIndicator() {
    return offlineIndicator;
}

/**
 * Get initialization status
 * @returns {boolean} True if initialized
 */
export function isInitialized() {
    return initialized;
}

/**
 * Manually trigger sync
 * Useful for testing or manual sync buttons
 */
export async function triggerSync() {
    debugLog('offline-init: Manual sync triggered');
    
    try {
        await offlineManager.syncPendingData();
    } catch (error) {
        debugError('offline-init: Manual sync failed', error);
        throw error;
    }
}

/**
 * Manually trigger pre-cache
 * Useful for testing or refresh buttons
 */
export async function triggerPreCache() {
    debugLog('offline-init: Manual pre-cache triggered');
    
    try {
        await offlineManager.preCacheCriticalData();
    } catch (error) {
        debugError('offline-init: Manual pre-cache failed', error);
        throw error;
    }
}

/**
 * Cleanup offline support
 * Removes event listeners and destroys components
 */
export function cleanupOfflineSupport() {
    debugLog('offline-init: Cleaning up offline support');

    try {
        // Remove event listeners
        window.removeEventListener('userLoggedIn', handleUserLogin);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        window.removeEventListener('showToast', handleToastEvent);

        // Destroy indicator
        if (offlineIndicator) {
            offlineIndicator.destroy();
            offlineIndicator = null;
        }

        initialized = false;
        debugLog('offline-init: Cleanup complete');

    } catch (error) {
        debugError('offline-init: Failed to cleanup offline support', error);
    }
}

// Export offlineManager for direct access if needed
export { offlineManager };
