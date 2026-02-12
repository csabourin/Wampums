/**
 * OfflineManager.js
 *
 * Centralized offline state and sync management module.
 * Tracks online/offline status, provides offline-aware API methods,
 * handles background sync, and pre-caches critical data.
 */

import { debugLog, debugError, debugWarn } from '../utils/DebugUtils.js';
import { getCachedData, setCachedData, getOfflineData, clearOfflineData, deleteCachedData } from '../indexedDB.js';
import { CONFIG } from '../config.js';
import { buildApiCacheKey } from '../utils/OfflineCacheKeys.js';

/**
 * Cache duration constants (in milliseconds)
 */
const CACHE_DURATION = {
    CRITICAL: 7 * 24 * 60 * 60 * 1000,   // 7 days
    CAMP_MODE: 15 * 24 * 60 * 60 * 1000, // 15 days (covers max 14-day camp + 1 day buffer)
    STANDARD: 24 * 60 * 60 * 1000,       // 24 hours
    VOLATILE: 2 * 60 * 60 * 1000         // 2 hours
};

/**
 * Local storage key for camp mode state
 */
const CAMP_MODE_STORAGE_KEY = 'wampums_camp_mode';
const PREPARED_ACTIVITIES_KEY = 'wampums_prepared_activities';

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
        this._pendingCountFromSW = 0;
        this.syncInProgress = false;
        this.listeners = [];

        // Camp mode properties
        this.campMode = false;
        this.activeActivityId = null;
        this.preparedActivities = new Map(); // activityId -> { startDate, endDate, preparedAt, dates }
        this.preparationProgress = { current: 0, total: 0, status: 'idle', message: '' };
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

        // Restore camp mode state from localStorage
        this.restoreCampMode();

        // Auto-detect if we should enable/disable camp mode based on dates
        this.autoDetectCampMode();

        debugLog('OfflineManager: Initialized', { isOffline: this.isOffline, campMode: this.campMode });
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
            // Try service worker background sync if available
            let usedServiceWorker = false;
            if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
                try {
                    const registration = await navigator.serviceWorker.ready;
                    if (registration && 'sync' in registration) {
                        await registration.sync.register('sync-mutations');
                        debugLog('OfflineManager: Background sync registered');
                        usedServiceWorker = true;

                        // Give service worker time to process
                        const syncTimeout = CONFIG.UI?.SYNC_TIMEOUT || 2000;
                        await new Promise(resolve => setTimeout(resolve, syncTimeout));
                    }
                } catch (swError) {
                    debugWarn('OfflineManager: Service worker sync failed, using fallback', swError);
                }
            }

            // Fallback: replay mutations directly when no service worker is available
            if (!usedServiceWorker) {
                debugLog('OfflineManager: No service worker, replaying mutations directly');
                await this.replayPendingMutations();
            }

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
     * Replay pending mutations directly via fetch (fallback when no service worker)
     * Handles both new format (url/headers/body) and legacy format (action/data)
     */
    async replayPendingMutations() {
        const pendingData = await getOfflineData();
        if (!pendingData || pendingData.length === 0) {
            debugLog('OfflineManager: No pending mutations to replay');
            return;
        }

        debugLog('OfflineManager: Replaying', pendingData.length, 'pending mutations');

        // Refresh auth token for replay
        const token = localStorage.getItem('jwtToken');
        if (!token) {
            debugWarn('OfflineManager: No auth token, cannot replay mutations');
            return;
        }

        const authHeaders = {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        };

        // Batch legacy updatePoints entries into a single request
        const legacyPointUpdates = [];
        const legacyPointKeys = [];

        for (const record of pendingData) {
            try {
                // New format: stored by OfflineManager.queueMutation fallback
                // record.data has { url, headers, body, timestamp }
                if (record.data?.url) {
                    debugLog('OfflineManager: Replaying mutation', record.data.url);
                    const response = await fetch(record.data.url, {
                        method: record.action || record.data.method || 'POST',
                        headers: { ...record.data.headers, ...authHeaders },
                        body: record.data.body
                    });

                    if (response.ok || (response.status >= 400 && response.status < 500)) {
                        // Success or client error (don't retry client errors)
                        await deleteCachedData(record.key);
                        debugLog('OfflineManager: Mutation replayed successfully', record.key);
                        if (!response.ok) {
                            debugWarn('OfflineManager: Server rejected mutation (4xx), discarding', response.status);
                        }
                    } else {
                        debugWarn('OfflineManager: Mutation replay failed (will retry)', response.status);
                    }
                }
                // Legacy format: action="updatePoints", data={type, id, points, ...}
                else if (record.action === 'updatePoints' && record.data) {
                    legacyPointUpdates.push(record.data);
                    legacyPointKeys.push(record.key);
                }
                else {
                    debugWarn('OfflineManager: Unknown offline record format, discarding', record.key, record.action);
                    await deleteCachedData(record.key);
                }
            } catch (error) {
                debugError('OfflineManager: Failed to replay mutation', record.key, error);
                // Leave record in IndexedDB for next sync attempt
            }
        }

        // Batch replay legacy point updates
        if (legacyPointUpdates.length > 0) {
            try {
                const url = `${CONFIG.API_BASE_URL}/api/update-points`;
                debugLog('OfflineManager: Replaying', legacyPointUpdates.length, 'legacy point updates');
                const response = await fetch(url, {
                    method: 'POST',
                    headers: authHeaders,
                    body: JSON.stringify(legacyPointUpdates)
                });

                if (response.ok) {
                    for (const key of legacyPointKeys) {
                        await deleteCachedData(key);
                    }
                    debugLog('OfflineManager: Legacy point updates replayed successfully');
                } else if (response.status >= 400 && response.status < 500) {
                    // Client error — don't retry
                    for (const key of legacyPointKeys) {
                        await deleteCachedData(key);
                    }
                    debugWarn('OfflineManager: Server rejected legacy point updates (4xx), discarding', response.status);
                } else {
                    debugWarn('OfflineManager: Legacy point updates replay failed (will retry)', response.status);
                }
            } catch (error) {
                debugError('OfflineManager: Failed to replay legacy point updates', error);
            }
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
                    const endpointForKey = endpoint.replace(/^\/api\//, '');
                    const cacheKey = buildApiCacheKey(endpointForKey);
                    await this.cacheData(cacheKey, data, CACHE_DURATION.CRITICAL);
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
            if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
                const swCount = await this.getServiceWorkerPendingCount();
                if (swCount !== null) {
                    // Store the numeric count separately for consumers that only need
                    // the count (e.g., badge indicators). The pendingMutations array
                    // is populated with placeholder objects -- they do NOT contain real
                    // mutation payloads and must NOT be iterated for replay/sync.
                    this._pendingCountFromSW = swCount;
                    this.pendingMutations = Array(swCount).fill({ type: 'pending' });
                    debugLog('OfflineManager: Pending mutations count (service worker)', swCount);
                    this.dispatchEvent('pendingCountChanged', { count: swCount });
                    return;
                }
            }

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
     * Get pending mutation count from service worker queue.
     * @returns {Promise<number|null>} Count, or null when unavailable
     */
    async getServiceWorkerPendingCount() {
        return new Promise((resolve) => {
            try {
                const channel = new MessageChannel();
                const timeoutMs = CONFIG.UI?.SW_PENDING_TIMEOUT || 3000;
                const timeout = setTimeout(() => resolve(null), timeoutMs);

                channel.port1.onmessage = (event) => {
                    clearTimeout(timeout);
                    if (event.data?.type === 'PENDING_COUNT') {
                        resolve(Number(event.data.count) || 0);
                    } else {
                        resolve(null);
                    }
                };

                navigator.serviceWorker.controller.postMessage(
                    { type: 'GET_PENDING_COUNT' },
                    [channel.port2]
                );
            } catch (error) {
                debugWarn('OfflineManager: Unable to get pending count from service worker', error);
                resolve(null);
            }
        });
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
            'offline.savedLocally': 'Saved locally - will sync when online',
            'offline.fetchingData': 'Fetching activity data...',
            'offline.cachingParticipants': 'Caching participants...',
            'offline.cachingAttendance': 'Caching attendance data...',
            'offline.cachingHonors': 'Caching honors...',
            'offline.cachingMedications': 'Caching medications...',
            'offline.cachingBadges': 'Caching badges...',
            'offline.cachingCarpools': 'Caching carpool data...',
            'offline.cachingModules': 'Pre-loading pages for offline use...',
            'offline.modulePreloadWarning': 'Some pages may not work offline',
            'offline.finalizing': 'Finalizing...',
            'offline.campModeAutoEnabled': 'Camp mode automatically enabled',
            'offline.campModeAutoDisabled': 'Camp mode automatically disabled'
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

    // ============================================
    // CAMP MODE METHODS
    // ============================================

    /**
     * Get upcoming multi-day activities that may need offline preparation
     * @returns {Promise<Array>} Array of upcoming activities
     */
    async getUpcomingCamps() {
        const token = localStorage.getItem('jwtToken');
        if (!token) {
            debugWarn('OfflineManager: No auth token, cannot fetch upcoming camps');
            return [];
        }

        const cacheKey = buildApiCacheKey('v1/activities/upcoming-camps');

        try {
            const response = await fetch(`${CONFIG.API_BASE_URL}/api/v1/activities/upcoming-camps`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const result = await response.json();
            if (result.success) {
                await this.cacheData(cacheKey, result, CACHE_DURATION.CAMP_MODE);
            }
            return result.success ? result.data : [];
        } catch (error) {
            debugError('OfflineManager: Failed to fetch upcoming camps', error);
            try {
                const cached = await getCachedData(cacheKey);
                if (cached?.success && Array.isArray(cached.data)) {
                    return cached.data;
                }
            } catch (cacheError) {
                debugWarn('OfflineManager: No cached upcoming camps available', cacheError);
            }
            return [];
        }
    }

    /**
     * Prepare for offline operation during a multi-day activity
     * Fetches and caches all data needed for the date range
     *
     * @param {number|null} activityId - Optional activity ID
     * @param {string} startDate - Start date in YYYY-MM-DD format
     * @param {string} endDate - End date in YYYY-MM-DD format
     * @returns {Promise<Object>} Preparation result
     */
    async prepareForActivity(activityId, startDate, endDate) {
        const token = localStorage.getItem('jwtToken');
        if (!token) {
            throw new Error('Not authenticated');
        }

        const dates = this.generateDateRange(startDate, endDate);
        const totalSteps = 9; // 8 data steps + 1 module pre-loading step

        this.preparationProgress = { current: 0, total: totalSteps, status: 'preparing', message: '' };
        this.dispatchEvent('preparationProgress', this.preparationProgress);

        try {
            // Step 1: Fetch bulk data from server
            this.updatePreparationProgress(1, this.getTranslation('offline.fetchingData'));

            const response = await fetch(`${CONFIG.API_BASE_URL}/api/v1/offline/prepare-activity`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    activity_id: activityId,
                    start_date: startDate,
                    end_date: endDate
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.message || `HTTP ${response.status}`);
            }

            const result = await response.json();
            if (!result.success) {
                throw new Error(result.message || 'Server returned error');
            }

            const bulkData = result.data;
            debugLog('OfflineManager: Received bulk data', {
                participants: bulkData.participants?.length,
                dates: bulkData.dates?.length,
                honors: bulkData.honors?.length
            });

            // Step 2: Cache participants and groups
            this.updatePreparationProgress(2, this.getTranslation('offline.cachingParticipants'));
            await this.cacheData('participants_v2', { success: true, data: bulkData.participants }, CACHE_DURATION.CAMP_MODE);
            await this.cacheData('groups', { success: true, data: bulkData.groups }, CACHE_DURATION.CAMP_MODE);
            await this.cacheData(buildApiCacheKey('v1/participants'), { success: true, data: bulkData.participants }, CACHE_DURATION.CAMP_MODE);
            await this.cacheData(buildApiCacheKey('v1/groups'), { success: true, data: bulkData.groups }, CACHE_DURATION.CAMP_MODE);

            // Cache points-data in the format manage_points expects
            await this.cacheData('manage_points_data', {
                success: true,
                groups: bulkData.groups,
                participants: bulkData.participants
            }, CACHE_DURATION.CAMP_MODE);

            // Step 3: Cache attendance for each date
            this.updatePreparationProgress(3, this.getTranslation('offline.cachingAttendance'));
            for (const date of dates) {
                const attendanceForDate = bulkData.attendance[date] || [];
                const attendancePayload = {
                    success: true,
                    data: {
                        participants: bulkData.participants,
                        attendanceData: this.transformAttendanceData(attendanceForDate, bulkData.participants, date),
                        guests: [],
                        groups: bulkData.groups,
                        currentDate: date,
                        availableDates: dates
                    }
                };
                await this.cacheData(`attendance_${date}`, attendancePayload, CACHE_DURATION.CAMP_MODE);
                // Also cache in the format the attendance module expects
                await this.cacheData(buildApiCacheKey('v1/attendance', { date }), attendancePayload, CACHE_DURATION.CAMP_MODE);
            }
            // Cache attendance dates list
            await this.cacheData(buildApiCacheKey('v1/attendance/dates'), { success: true, data: dates }, CACHE_DURATION.CAMP_MODE);

            // Step 4: Cache honors
            this.updatePreparationProgress(4, this.getTranslation('offline.cachingHonors'));
            await this.cacheData('honors_all', { success: true, data: bulkData.honors }, CACHE_DURATION.CAMP_MODE);
            await this.cacheData(buildApiCacheKey('v1/honors'), { success: true, data: bulkData.honors }, CACHE_DURATION.CAMP_MODE);
            // Cache honors by date
            for (const date of dates) {
                const honorsForDate = bulkData.honorsByDate[date] || [];
                await this.cacheData(`honors_${date}`, { success: true, data: honorsForDate }, CACHE_DURATION.CAMP_MODE);
                await this.cacheData(buildApiCacheKey('v1/honors', { date }), { success: true, data: honorsForDate }, CACHE_DURATION.CAMP_MODE);
            }

            // Step 5: Cache medications
            this.updatePreparationProgress(5, this.getTranslation('offline.cachingMedications'));
            await this.cacheData('medication_requirements', { success: true, data: bulkData.medications.requirements }, CACHE_DURATION.CAMP_MODE);
            await this.cacheData('medication_distributions', { success: true, data: bulkData.medications.distributions }, CACHE_DURATION.CAMP_MODE);
            await this.cacheData(buildApiCacheKey('v1/medication/requirements'), { success: true, data: bulkData.medications.requirements }, CACHE_DURATION.CAMP_MODE);
            await this.cacheData(buildApiCacheKey('v1/medication/distributions'), { success: true, data: bulkData.medications.distributions }, CACHE_DURATION.CAMP_MODE);
            // Cache medication receptions
            if (bulkData.medications.receptions && activityId) {
                const receptionsPayload = { success: true, data: { receptions: bulkData.medications.receptions } };
                await this.cacheData(`medication_receptions?activity_id=${activityId}`, receptionsPayload, CACHE_DURATION.CAMP_MODE);
                await this.cacheData(buildApiCacheKey('v1/medication/receptions', { activity_id: activityId }), receptionsPayload, CACHE_DURATION.CAMP_MODE);
                // Also cache without activity_id filter for dispensing view
                await this.cacheData('medication_receptions', receptionsPayload, CACHE_DURATION.CAMP_MODE);
                await this.cacheData(buildApiCacheKey('v1/medication/receptions'), receptionsPayload, CACHE_DURATION.CAMP_MODE);
            }

            // Step 6: Cache badges
            this.updatePreparationProgress(6, this.getTranslation('offline.cachingBadges'));
            await this.cacheData('badge_dashboard_settings', { success: true, data: { templates: bulkData.badges.templates } }, CACHE_DURATION.CAMP_MODE);
            await this.cacheData('badge_dashboard_badges', { success: true, data: bulkData.badges.progress }, CACHE_DURATION.CAMP_MODE);
            await this.cacheData(buildApiCacheKey('v1/badges/settings'), { success: true, data: bulkData.badges.templates }, CACHE_DURATION.CAMP_MODE);
            await this.cacheData(buildApiCacheKey('v1/badges/summary'), { success: true, data: bulkData.badges.progress }, CACHE_DURATION.CAMP_MODE);

            // Step 7: Cache carpools (if activity has carpool data)
            this.updatePreparationProgress(7, this.getTranslation('offline.cachingCarpools'));
            if (bulkData.carpools && activityId) {
                await this.cacheData(`carpool_offers_activity_${activityId}`, { success: true, data: bulkData.carpools.offers }, CACHE_DURATION.CAMP_MODE);
                await this.cacheData(`carpool_assignments_activity_${activityId}`, { success: true, data: bulkData.carpools.assignments }, CACHE_DURATION.CAMP_MODE);
                await this.cacheData(buildApiCacheKey(`v1/carpools/activity/${activityId}/offers`), { success: true, data: bulkData.carpools.offers }, CACHE_DURATION.CAMP_MODE);
                await this.cacheData(buildApiCacheKey(`v1/carpools/activity/${activityId}/assignments`), { success: true, data: bulkData.carpools.assignments }, CACHE_DURATION.CAMP_MODE);
                // Also cache the activity itself
                if (bulkData.activity) {
                    await this.cacheData(`activity_${activityId}`, { success: true, data: bulkData.activity }, CACHE_DURATION.CAMP_MODE);
                    await this.cacheData(buildApiCacheKey(`v1/activities/${activityId}`), { success: true, data: bulkData.activity }, CACHE_DURATION.CAMP_MODE);
                }
            }

            // Step 8: Pre-load JavaScript modules for offline use
            this.updatePreparationProgress(8, this.getTranslation('offline.cachingModules'));
            await this.preloadCampModules();

            // Step 9: Save preparation state and enable camp mode
            this.updatePreparationProgress(9, this.getTranslation('offline.finalizing'));

            const prepInfo = {
                activityId,
                startDate,
                endDate,
                preparedAt: Date.now(),
                dates,
                expiresAt: bulkData.expiresAt
            };

            this.preparedActivities.set(activityId || `manual_${startDate}`, prepInfo);
            this.savePreparedActivities();
            this.enableCampMode(activityId || `manual_${startDate}`);

            // Notify service worker about camp mode
            this.notifyServiceWorkerCampMode(true);

            this.preparationProgress = { current: totalSteps, total: totalSteps, status: 'complete', message: '' };
            this.dispatchEvent('preparationProgress', this.preparationProgress);

            debugLog('OfflineManager: Preparation complete', { datesPrepared: dates.length });

            return {
                success: true,
                datesPrepared: dates.length,
                activity: bulkData.activity
            };

        } catch (error) {
            debugError('OfflineManager: Preparation failed', error);
            this.preparationProgress = {
                current: 0,
                total: totalSteps,
                status: 'error',
                message: error.message
            };
            this.dispatchEvent('preparationProgress', this.preparationProgress);
            throw error;
        }
    }

    /**
     * Transform attendance data to the format expected by the attendance module
     */
    transformAttendanceData(attendanceRows, participants, date) {
        const attendanceMap = new Map();
        for (const row of attendanceRows) {
            attendanceMap.set(row.participant_id, row.status);
        }

        return participants.map(p => ({
            participant_id: p.id,
            first_name: p.first_name,
            last_name: p.last_name,
            group_id: p.group_id,
            group_name: p.group_name,
            attendance_status: attendanceMap.get(p.id) || null,
            date: date || null
        }));
    }

    /**
     * Pre-load JavaScript modules needed for camp mode offline use.
     * This eagerly imports the modules while still online so they are
     * available in the browser/service-worker cache when offline.
     */
    async preloadCampModules() {
        const campModules = [
            () => import('../attendance.js'),
            () => import('../manage_points.js'),
            () => import('../manage_honors.js'),
            () => import('../activities.js'),
            () => import('../medication_management.js'),
            () => import('../medication_reception.js'),
            () => import('../badge_dashboard.js'),
            () => import('../badge_tracker.js'),
            () => import('../carpool.js'),
            () => import('../carpool_dashboard.js'),
            () => import('../manage_participants.js'),
            () => import('../manage_groups.js'),
            () => import('../upcoming_meeting.js'),
            () => import('../offline_preparation.js'),
            () => import('../init-activity-widget.js'),
        ];

        const results = await Promise.allSettled(campModules.map(loader => loader()));
        const loaded = results.filter(r => r.status === 'fulfilled').length;
        const failed = results.filter(r => r.status === 'rejected').length;
        debugLog(`OfflineManager: Pre-loaded ${loaded} modules for camp mode` +
            (failed > 0 ? `, ${failed} failed` : ''));

        if (failed > 0) {
            results.forEach((r, i) => {
                if (r.status === 'rejected') {
                    debugError(`OfflineManager: Module preload failed:`, r.reason);
                }
            });
            this.showToast(
                `${failed} ${this.getTranslation('offline.modulePreloadWarning')}`,
                'warning'
            );
        }
    }

    /**
     * Update preparation progress and dispatch event
     */
    updatePreparationProgress(step, message) {
        this.preparationProgress = {
            current: step,
            total: this.preparationProgress.total,
            status: 'preparing',
            message
        };
        this.dispatchEvent('preparationProgress', this.preparationProgress);
    }

    /**
     * Enable camp mode
     * @param {number|string} activityId - Activity ID or manual identifier
     */
    enableCampMode(activityId) {
        this.campMode = true;
        this.activeActivityId = activityId;

        const campModeState = {
            enabled: true,
            activityId,
            enabledAt: Date.now()
        };
        localStorage.setItem(CAMP_MODE_STORAGE_KEY, JSON.stringify(campModeState));

        this.dispatchEvent('campModeChanged', { enabled: true, activityId });
        debugLog('OfflineManager: Camp mode enabled', { activityId });
    }

    /**
     * Disable camp mode
     */
    disableCampMode() {
        this.campMode = false;
        this.activeActivityId = null;
        localStorage.removeItem(CAMP_MODE_STORAGE_KEY);

        // Notify service worker
        this.notifyServiceWorkerCampMode(false);

        this.dispatchEvent('campModeChanged', { enabled: false });
        debugLog('OfflineManager: Camp mode disabled');
    }

    /**
     * Notify service worker about camp mode status
     */
    notifyServiceWorkerCampMode(enabled) {
        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({
                type: 'SET_CAMP_MODE',
                enabled
            });
        }
    }

    /**
     * Restore camp mode state from localStorage
     */
    restoreCampMode() {
        try {
            // Restore camp mode state
            const stored = localStorage.getItem(CAMP_MODE_STORAGE_KEY);
            if (stored) {
                const { enabled, activityId, enabledAt } = JSON.parse(stored);
                // Auto-disable after 14 days
                const maxAge = 14 * 24 * 60 * 60 * 1000;
                if (enabled && (Date.now() - enabledAt) < maxAge) {
                    this.campMode = true;
                    this.activeActivityId = activityId;
                    this.notifyServiceWorkerCampMode(true);
                    debugLog('OfflineManager: Camp mode restored', { activityId });
                } else if (enabled) {
                    // Camp mode expired
                    this.disableCampMode();
                }
            }

            // Restore prepared activities
            const preparedStored = localStorage.getItem(PREPARED_ACTIVITIES_KEY);
            if (preparedStored) {
                const preparedArray = JSON.parse(preparedStored);
                for (const [key, value] of preparedArray) {
                    this.preparedActivities.set(key, value);
                }
            }
        } catch (error) {
            debugError('OfflineManager: Failed to restore camp mode', error);
        }
    }

    /**
     * Auto-detect if we should enable/disable camp mode based on current date
     */
    autoDetectCampMode() {
        const today = new Date().toISOString().split('T')[0];

        // Check if we're within any prepared activity's date range
        for (const [activityId, prep] of this.preparedActivities) {
            if (prep.startDate <= today && today <= prep.endDate) {
                if (!this.campMode) {
                    this.enableCampMode(activityId);
                    this.showToast(this.getTranslation('offline.campModeAutoEnabled'), 'info');
                    debugLog('OfflineManager: Auto-enabled camp mode', { activityId });
                }
                return;
            }
        }

        // If we're past all prepared activities, disable camp mode
        if (this.campMode && this.activeActivityId) {
            const activePrep = this.preparedActivities.get(this.activeActivityId);
            if (activePrep && today > activePrep.endDate) {
                this.disableCampMode();
                this.showToast(this.getTranslation('offline.campModeAutoDisabled'), 'info');
                debugLog('OfflineManager: Auto-disabled camp mode (past end date)');
            }
        }
    }

    /**
     * Save prepared activities to localStorage
     */
    savePreparedActivities() {
        try {
            const arrayForm = Array.from(this.preparedActivities.entries());
            localStorage.setItem(PREPARED_ACTIVITIES_KEY, JSON.stringify(arrayForm));
        } catch (error) {
            debugError('OfflineManager: Failed to save prepared activities', error);
        }
    }

    /**
     * Check if a specific date is prepared for camp mode
     * @param {string} date - Date in YYYY-MM-DD format
     * @returns {boolean} True if the date is prepared
     */
    isDatePrepared(date) {
        for (const prep of this.preparedActivities.values()) {
            if (prep.dates && prep.dates.includes(date)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Get prepared activity info for a date
     * @param {string} date - Date in YYYY-MM-DD format
     * @returns {Object|null} Prepared activity info or null
     */
    getPreparedActivityForDate(date) {
        for (const [id, prep] of this.preparedActivities) {
            if (prep.dates && prep.dates.includes(date)) {
                return { id, ...prep };
            }
        }
        return null;
    }

    /**
     * Generate array of date strings between start and end (inclusive)
     * @param {string} startDate - Start date in YYYY-MM-DD format
     * @param {string} endDate - End date in YYYY-MM-DD format
     * @returns {string[]} Array of date strings
     */
    generateDateRange(startDate, endDate) {
        const dates = [];
        const current = new Date(startDate);
        const end = new Date(endDate);

        while (current <= end) {
            dates.push(current.toISOString().split('T')[0]);
            current.setDate(current.getDate() + 1);
        }
        return dates;
    }

    /**
     * Get cache duration based on camp mode
     * @returns {number} Cache duration in milliseconds
     */
    getCacheDuration() {
        return this.campMode ? CACHE_DURATION.CAMP_MODE : CACHE_DURATION.STANDARD;
    }

    /**
     * Clear all prepared activities and disable camp mode
     */
    clearPreparedActivities() {
        this.preparedActivities.clear();
        localStorage.removeItem(PREPARED_ACTIVITIES_KEY);
        this.disableCampMode();
        debugLog('OfflineManager: Cleared all prepared activities');
    }

    /**
     * Get camp mode status
     * @returns {boolean} True if camp mode is active
     */
    get isCampMode() {
        return this.campMode;
    }
}

// Export singleton instance
export const offlineManager = new OfflineManager();
