/**
 * OfflineManager.js
 *
 * Centralized offline state and sync management module.
 * Tracks online/offline status, provides offline-aware API methods,
 * handles background sync, and pre-caches critical data.
 */

import { debugLog, debugError, debugWarn } from '../utils/DebugUtils.js';
import { getCachedData, setCachedData, getOfflineData, clearOfflineData } from '../indexedDB.js';
import { CONFIG } from '../config.js';

/**
 * Cache duration constants (in milliseconds)
 */
const CACHE_DURATION = {
    CRITICAL: 7 * 24 * 60 * 60 * 1000,  // 7 days
    STANDARD: 24 * 60 * 60 * 1000,       // 24 hours
    VOLATILE: 2 * 60 * 60 * 1000         // 2 hours
};

/**
 * Critical endpoints to pre-cache
 */
const CRITICAL_ENDPOINTS = [
    '/api/v1/participants',
    '/api/v1/groups',
    '/api/initial-data',
    '/api/organization-settings',
    '/api/v1/badges/summary',
    '/api/v1/badges/settings',
    '/api/v1/attendance/dates',
    '/api/v1/activities?days=30',
    '/api/v1/health/report'
];

/**
 * OfflineManager class
 * Manages offline state, caching, and synchronization
 */
export class OfflineManager {
    constructor() {
        this.isOffline = !navigator.onLine;
        this.isSyncing = false;
        this.pendingMutations = [];
        this.syncInProgress = false;
        this.listeners = [];
    }

    /**
     * Initialize the OfflineManager
     * Sets up event listeners for online/offline status
     */
    init() {
        debugLog('OfflineManager: Initializing');

        // Listen for online/offline events
        window.addEventListener('online', () => this.handleOnline());
        window.addEventListener('offline', () => this.handleOffline());

        // Initial status
        this.updateOnlineStatus();

        // Check for pending mutations on init
        this.checkPendingMutations();

        debugLog('OfflineManager: Initialized', { isOffline: this.isOffline });
    }

    /**
     * Handle online event
     */
    async handleOnline() {
        debugLog('OfflineManager: Device is online');
        this.isOffline = false;
        this.updateOnlineStatus();

        // Show toast notification
        this.showToast(this.getTranslation('connection.restored'), 'success');

        // Dispatch custom event
        this.dispatchEvent('offlineStatusChanged', { isOffline: false });

        // Sync pending data
        await this.syncPendingData();
    }

    /**
     * Handle offline event
     */
    handleOffline() {
        debugLog('OfflineManager: Device is offline');
        this.isOffline = true;
        this.updateOnlineStatus();

        // Show toast notification
        this.showToast(this.getTranslation('connection.lost'), 'info');

        // Dispatch custom event
        this.dispatchEvent('offlineStatusChanged', { isOffline: true });
    }

    /**
     * Update online status and dispatch events
     */
    updateOnlineStatus() {
        const wasOffline = this.isOffline;
        this.isOffline = !navigator.onLine;

        if (wasOffline !== this.isOffline) {
            this.dispatchEvent('offlineStatusChanged', { isOffline: this.isOffline });
        }
    }

    /**
     * Fetch with offline support
     * Network-first with cache fallback for read operations
     * 
     * @param {string} url - API endpoint URL
     * @param {Object} options - Fetch options
     * @param {number} cacheDuration - Cache duration in milliseconds
     * @returns {Promise<Response>} Response object
     */
    async fetchWithOfflineSupport(url, options = {}, cacheDuration = CACHE_DURATION.STANDARD) {
        const method = (options.method || 'GET').toUpperCase();
        const isReadOperation = method === 'GET' || method === 'HEAD';

        debugLog(`OfflineManager: Fetching ${method} ${url}`, { isOffline: this.isOffline });

        if (isReadOperation) {
            return this.handleReadOperation(url, options, cacheDuration);
        } else {
            return this.handleWriteOperation(url, options);
        }
    }

    /**
     * Handle read operations with cache fallback
     */
    async handleReadOperation(url, options, cacheDuration) {
        try {
            // Try network first
            const response = await fetch(url, options);

            if (response.ok) {
                // Clone response to cache it
                const cloneForCache = response.clone();
                const data = await cloneForCache.json();

                // Cache the data
                await this.cacheData(url, data, cacheDuration);

                return response;
            }

            // If response is not OK, try cache
            return this.getCachedResponse(url);

        } catch (error) {
            debugWarn('OfflineManager: Network request failed, trying cache', error);

            // Network failed, try cache
            return this.getCachedResponse(url);
        }
    }

    /**
     * Handle write operations with queueing for offline
     */
    async handleWriteOperation(url, options) {
        if (this.isOffline) {
            // Queue mutation for later sync
            debugLog('OfflineManager: Queueing mutation while offline', { url, method: options.method });
            await this.queueMutation(url, options);

            // Return a queued response
            return new Response(
                JSON.stringify({
                    success: true,
                    queued: true,
                    message: this.getTranslation('offline.savedLocally')
                }),
                {
                    status: 202,
                    headers: { 'Content-Type': 'application/json' }
                }
            );
        }

        // Online - perform the mutation
        return fetch(url, options);
    }

    /**
     * Queue a mutation for background sync
     * 
     * @param {string} url - API endpoint URL
     * @param {Object} options - Fetch options
     */
    async queueMutation(url, options) {
        try {
            const mutation = {
                url,
                method: options.method || 'POST',
                headers: options.headers || {},
                body: options.body || null,
                timestamp: Date.now()
            };

            // Store in IndexedDB via service worker
            // This will trigger the service worker to queue it
            await this.storePendingMutation(mutation);

            // Update pending count
            await this.updatePendingCount();

            debugLog('OfflineManager: Mutation queued', mutation);
        } catch (error) {
            debugError('OfflineManager: Failed to queue mutation', error);
            throw error;
        }
    }

    /**
     * Store pending mutation
     * Falls back to local storage if service worker is not available
     */
    async storePendingMutation(mutation) {
        // Try to use service worker first
        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
            try {
                navigator.serviceWorker.controller.postMessage({
                    type: 'QUEUE_MUTATION',
                    mutation
                });
                debugLog('OfflineManager: Mutation sent to service worker');
                return;
            } catch (error) {
                debugWarn('OfflineManager: Failed to send to service worker', error);
            }
        }

        // Fallback: Store directly in IndexedDB using existing functions
        debugLog('OfflineManager: Service worker not available, using IndexedDB directly');
        try {
            // Use the existing offline data storage from indexedDB.js
            const { saveOfflineData } = await import('../indexedDB.js');
            await saveOfflineData(mutation.method, {
                url: mutation.url,
                headers: mutation.headers,
                body: mutation.body,
                timestamp: mutation.timestamp
            });
            debugLog('OfflineManager: Mutation stored in IndexedDB');
        } catch (error) {
            debugError('OfflineManager: Failed to store mutation', error);
            throw error;
        }
    }

    /**
     * Sync pending data
     * Called when connection is restored
     */
    async syncPendingData() {
        if (this.syncInProgress) {
            debugLog('OfflineManager: Sync already in progress');
            return;
        }

        this.syncInProgress = true;
        this.isSyncing = true;
        this.dispatchEvent('syncStatusChanged', { isSyncing: true });

        debugLog('OfflineManager: Starting sync');

        try {
            // Trigger service worker sync
            if ('serviceWorker' in navigator && 'sync' in navigator.serviceWorker) {
                const registration = await navigator.serviceWorker.ready;
                await registration.sync.register('sync-mutations');
                debugLog('OfflineManager: Background sync registered');
            } else {
                debugLog('OfflineManager: Background Sync API not available, sync will happen on visibility change');
            }

            // Wait for sync to start and give service worker time to process
            // Use configurable timeout from CONFIG if available
            const syncTimeout = CONFIG.UI?.SYNC_TIMEOUT || 2000;
            await new Promise(resolve => setTimeout(resolve, syncTimeout));

            // Check pending count
            await this.updatePendingCount();

            // Show success message if all synced
            if (this.pendingMutations.length === 0) {
                this.showToast(this.getTranslation('sync.complete'), 'success');
            }

        } catch (error) {
            debugError('OfflineManager: Sync failed', error);
            this.showToast(this.getTranslation('sync.failed'), 'error');
        } finally {
            this.syncInProgress = false;
            this.isSyncing = false;
            this.dispatchEvent('syncStatusChanged', { isSyncing: false });
        }
    }

    /**
     * Pre-cache critical data
     * Called after login to ensure essential data is available offline
     */
    async preCacheCriticalData() {
        debugLog('OfflineManager: Pre-caching critical data');

        const token = localStorage.getItem('jwtToken');
        if (!token) {
            debugWarn('OfflineManager: No auth token, skipping pre-cache');
            return;
        }

        const headers = {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        };

        for (const endpoint of CRITICAL_ENDPOINTS) {
            try {
                const url = `${CONFIG.API_BASE_URL}${endpoint}`;
                debugLog(`OfflineManager: Pre-caching ${endpoint}`);

                const response = await fetch(url, { headers });

                if (response.ok) {
                    const data = await response.json();
                    await this.cacheData(url, data, CACHE_DURATION.CRITICAL);
                    debugLog(`OfflineManager: Cached ${endpoint}`);
                } else {
                    debugWarn(`OfflineManager: Failed to pre-cache ${endpoint}`, response.status);
                }
            } catch (error) {
                debugError(`OfflineManager: Error pre-caching ${endpoint}`, error);
            }
        }

        debugLog('OfflineManager: Pre-caching complete');
    }

    /**
     * Cache data with expiration
     */
    async cacheData(key, data, duration) {
        try {
            await setCachedData(key, data, duration);
        } catch (error) {
            debugError('OfflineManager: Failed to cache data', error);
        }
    }

    /**
     * Get cached response
     */
    async getCachedResponse(url) {
        try {
            const cachedData = await getCachedData(url);

            if (cachedData) {
                debugLog('OfflineManager: Serving from cache', url);
                return new Response(JSON.stringify(cachedData), {
                    status: 200,
                    headers: {
                        'Content-Type': 'application/json',
                        'X-From-Cache': 'true'
                    }
                });
            }

            // No cache available
            return new Response(
                JSON.stringify({
                    success: false,
                    error: this.getTranslation('offline.dataUnavailable'),
                    offline: true
                }),
                {
                    status: 503,
                    headers: { 'Content-Type': 'application/json' }
                }
            );

        } catch (error) {
            debugError('OfflineManager: Failed to get cached data', error);
            throw error;
        }
    }

    /**
     * Check and update pending mutations count
     */
    async checkPendingMutations() {
        await this.updatePendingCount();
    }

    /**
     * Update pending mutations count
     */
    async updatePendingCount() {
        try {
            // Get offline data from IndexedDB
            const offlineData = await getOfflineData();

            // Ensure offlineData is an array
            const dataArray = Array.isArray(offlineData) ? offlineData : [];
            const count = dataArray.length;

            this.pendingMutations = dataArray;

            debugLog('OfflineManager: Pending mutations count', count);

            // Dispatch event
            this.dispatchEvent('pendingCountChanged', { count });

        } catch (error) {
            debugError('OfflineManager: Failed to get pending count', error);
            // Set empty array as fallback
            this.pendingMutations = [];
            this.dispatchEvent('pendingCountChanged', { count: 0 });
        }
    }

    /**
     * Dispatch custom event
     */
    dispatchEvent(eventName, detail) {
        const event = new CustomEvent(eventName, { detail });
        window.dispatchEvent(event);
    }

    /**
     * Show toast notification
     */
    showToast(message, type = 'info') {
        const event = new CustomEvent('showToast', {
            detail: { message, type }
        });
        window.dispatchEvent(event);
    }

    /**
     * Get translation
     * @param {string} key - Translation key
     * @returns {string} Translated text
     */
    getTranslation(key) {
        if (window.app && typeof window.app.translate === 'function') {
            return window.app.translate(key);
        }

        const fallbacks = {
            'connection.restored': 'Connection restored - syncing changes',
            'connection.lost': 'You are offline - changes will sync when connected',
            'status.offline': 'Offline',
            'status.syncing': 'Syncing...',
            'sync.pending': '{{count}} change(s) pending',
            'sync.complete': 'All changes synced',
            'sync.failed': 'Some changes failed to sync',
            'offline.dataUnavailable': 'This data is not available offline',
            'offline.savedLocally': 'Saved locally - will sync when online'
        };

        return fallbacks[key] || key;
    }

    /**
     * Get offline status
     * @returns {boolean} True if offline
     */
    get offline() {
        return this.isOffline;
    }

    /**
     * Get syncing status
     * @returns {boolean} True if syncing
     */
    get syncing() {
        return this.isSyncing;
    }

    /**
     * Get pending count
     * @returns {number} Number of pending mutations
     */
    get pendingCount() {
        return this.pendingMutations.length;
    }
}

// Export singleton instance
export const offlineManager = new OfflineManager();
