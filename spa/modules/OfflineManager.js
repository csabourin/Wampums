/**
 * OfflineManager.js
 *
 * Centralized offline state and sync management module.
 * Tracks online/offline status, provides offline-aware API methods,
 * handles background sync, and pre-caches critical data.
 */

import { debugLog, debugError, debugWarn } from '../utils/DebugUtils.js';
import {
  getCachedData,
  setCachedData,
  getOfflineData,
  saveOfflineData,
  deleteOfflineData,
  clearCacheEntriesWhere,
  clearPointsRelatedCaches
} from '../indexedDB.js';
import { CONFIG } from '../config.js';
import { isoToDateString } from '../utils/DateUtils.js';
import { OFFLINE_CAMPS } from '../config/offline-camps.js';
import {
  buildApiCacheKey,
  buildScopedCacheKey,
  cachePathsForMutation,
  normalizeApiPath
} from '../utils/OfflineCacheKeys.js';
import {
  getAuthHeader,
  getCurrentOrganizationId,
  getCurrentUserId
} from '../api/api-helpers.js';

/**
 * Cache duration constants (in milliseconds)
 */
const HOUR_MS = 3600000;
const DAY_MS = 86400000;
const CRITICAL_DAYS = 7;
const CAMP_MODE_DAYS = 15; // covers max 14-day camp + 1 day buffer
const VOLATILE_HOURS = 2;
const CACHE_DURATION = {
  CRITICAL: CRITICAL_DAYS * DAY_MS,
  CAMP_MODE: CAMP_MODE_DAYS * DAY_MS,
  STANDARD: DAY_MS,
  VOLATILE: VOLATILE_HOURS * HOUR_MS
};

/**
 * Local storage key for camp mode state
 */
const CAMP_MODE_STORAGE_KEY = 'wampums_camp_mode';
const PREPARED_ACTIVITIES_KEY = 'wampums_prepared_activities';

// Only operations with set/upsert semantics or transactional receipts may replay.
// Additive creates (honors, payments, roles, etc.) remain online-only
// until their endpoints implement transactional idempotency.
// `kind` names the change in the message that reports a refused replay
// (`sync.rejected_kind_<kind>`).
const SAFE_OFFLINE_MUTATIONS = [
  { method: 'POST', path: /^\/api\/v1\/points$/, kind: 'points' },
  { method: 'POST', path: /^\/api\/v1\/attendance(?:\/(?:carry-forward|departure))?$/, kind: 'attendance' },
  { method: 'PATCH', path: /^\/api\/v1\/medication\/(?:distributions|receptions)\/\d+$/, kind: 'medication' },
  { method: 'DELETE', path: /^\/api\/v1\/medication\/receptions\/\d+$/, kind: 'medication' },
  // Replaying badge history is safe: the server skips levels already recorded.
  { method: 'POST', path: /^\/api\/v1\/badges\/history$/, kind: 'badges' },
];

/**
 * Cache keys a screen stores under its own name, by kind of change: they hold
 * the optimistic copy of a refused change too, whether or not the screen is
 * open. Attendance is narrowed to the refused date (see rejectedCachePrefixes),
 * so a camp's other prepared days survive.
 */
const SCREEN_CACHE_PREFIXES = {
  points: ['manage_points_data', 'points_report'],
  medication: [
    'medication_', 'participant_medications', 'fiche_medications',
    '/api/medication_', '/api/participant_medications', '/api/fiche_medications'
  ],
  badges: ['badge_', '/api/badge']
};

/**
 * Web Lock that lets one tab at a time replay the outbox. Every tab of the app
 * shares one IndexedDB outbox; two tabs replaying it together would send each
 * change twice and could deliver an older attendance status after a newer one.
 */
const OUTBOX_REPLAY_LOCK = 'wampums-offline-outbox-replay';

/** Replay answers that will never succeed: the change is dropped, and said so. */
const NON_RETRIABLE_STATUSES = new Set([400, 403, 404, 409, 410, 422]);

/**
 * What kind of change a queued request was, for the message that reports it.
 * @param {string} url - Queued request URL
 * @param {string} method - HTTP method
 * @returns {string} A `kind` from SAFE_OFFLINE_MUTATIONS, or 'other'
 */
function mutationKind(url, method) {
  const pathname = normalizeApiPath(url);
  const rule = SAFE_OFFLINE_MUTATIONS.find((candidate) =>
    candidate.method === String(method).toUpperCase() && candidate.path.test(pathname));
  return rule?.kind || 'other';
}

/**
 * Critical endpoints to pre-cache
 */
const CRITICAL_ENDPOINTS = [
  '/api/v1/participants',
  '/api/v1/groups',
  '/api/v1/dashboards/initial',
  '/api/v1/organizations/settings',
  '/api/v1/badges/summary',
  '/api/v1/badges/settings',
  '/api/v1/attendance/dates',
  '/api/v1/activities?days=30'
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
    // A radio can reconnect without a browser online event (or a first replay
    // can fail on a captive portal). Retry while the authenticated SPA is open.
    this.syncTimer ??= window.setInterval(() => {
      if (navigator.onLine && !document.hidden && this.pendingMutations.length > 0) {
        void this.syncPendingData();
      }
    }, CONFIG.UI.OFFLINE_SYNC_RETRY_INTERVAL);

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

    // The persistent status banner announces this change without covering
    // the page with a second, temporary notification.
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
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          // Clone response to cache it
          const cloneForCache = response.clone();
          const data = await cloneForCache.json();

          // Cache the data
          await this.cacheData(url, data, cacheDuration);
        } else {
          debugWarn('OfflineManager: Skipping cache for non-JSON response', { url, contentType });
        }

        return response;
      }

      // HTTP errors are authoritative server responses. Only transport
      // failures may use stale cached data.
      return response;

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
      const mutationUrl = new URL(url, window.location.origin);
      const method = String(options.method || 'POST').toUpperCase();
      const isSafeMutation = mutationUrl.origin === window.location.origin &&
                SAFE_OFFLINE_MUTATIONS.some((rule) =>
                  rule.method === method && rule.path.test(mutationUrl.pathname)
                );
      if (!isSafeMutation) {
        throw new Error(this.getTranslation('offline.writeUnavailable'));
      }

      const currentUserId = getCurrentUserId();
      const organizationId = getCurrentOrganizationId();
      if (!currentUserId) {
        throw new Error('An authenticated user is required to save offline changes.');
      }

      const sourceHeaders = new Headers(options.headers || {});
      const safeHeaders = {};
      for (const headerName of ['Accept', 'Content-Type']) {
        const value = sourceHeaders.get(headerName);
        if (value) { safeHeaders[headerName] = value; }
      }
      const idempotencyKey = sourceHeaders.get('Idempotency-Key') || (typeof globalThis.crypto?.randomUUID === 'function'
        ? globalThis.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
      safeHeaders['Idempotency-Key'] = idempotencyKey;

      const mutation = {
        url,
        method,
        headers: safeHeaders,
        body: options.body || null,
        timestamp: Date.now(),
        userId: String(currentUserId),
        organizationId: organizationId ? String(organizationId) : null,
        idempotencyKey
      };

      // Store token-free data in the SPA-owned IndexedDB outbox.
      await this.storePendingMutation(mutation);

      // Update pending count
      await this.updatePendingCount();

      debugLog('OfflineManager: Mutation queued', {
        url: mutation.url,
        method: mutation.method,
        userId: mutation.userId,
        organizationId: mutation.organizationId
      });
      // The idempotency key also names this mutation in its replay event.
      return idempotencyKey;
    } catch (error) {
      debugError('OfflineManager: Failed to queue mutation', error);
      throw error;
    }
  }

  /**
     * Store a token-free, user- and organization-scoped pending mutation.
     */
  async storePendingMutation(mutation) {
    try {
      await saveOfflineData(mutation.method, {
        url: mutation.url,
        headers: mutation.headers,
        body: mutation.body,
        timestamp: mutation.timestamp,
        userId: mutation.userId,
        organizationId: mutation.organizationId,
        idempotencyKey: mutation.idempotencyKey
      });
      debugLog('OfflineManager: Mutation stored in authenticated SPA outbox');
    } catch (error) {
      debugError('OfflineManager: Failed to store mutation', error);
      throw error;
    }
  }

  /** Whether this account and unit have awards waiting for confirmation. */
  hasPendingPoints() { return this.hasPendingResource('/api/v1/points'); }

  /** Arrivals cannot overtake a departure still waiting in the outbox. */
  hasPendingAttendance() { return this.hasPendingResource('/api/v1/attendance'); }

  /** Match the authenticated account, unit and resource, including subpaths. */
  async hasPendingResource(resource) {
    const records = await getOfflineData();
    return records.some((record) => {
      if (!record.data?.url) { return false; }
      const path = normalizeApiPath(record.data.url);
      return (path === resource || path.startsWith(`${resource}/`)) &&
        String(record.data.userId) === String(getCurrentUserId()) &&
        String(record.data.organizationId) === String(getCurrentOrganizationId());
    });
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
      // Replay only in the open, authenticated SPA. A service worker
      // cannot safely obtain a fresh bearer token or verify the active
      // account, so it must never replay authenticated writes.
      const { replayed, rejected } = await this.replayPendingMutations();

      // Check pending count
      await this.updatePendingCount();

      // A refused change is never reported as synced. Otherwise, announce a
      // sync only when changes made offline were sent: this runs on every
      // page load, and announcing it with nothing to send put the same
      // message over each page, twice.
      if (rejected.length > 0) {
        this.showToast(this.describeRejected(rejected), 'error');
      } else if (replayed > 0 && this.pendingMutations.length === 0) {
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
     * Replay pending mutations with a freshly obtained authorization header.
     * Unscoped legacy records are discarded instead of crossing accounts.
     * A change the server refuses for good is dropped, announced with
     * `offlineMutationRejected` and its cached resource forgotten, so the
     * screens stop showing what was never saved.
     *
     * Only one tab replays at a time. While another tab holds the outbox,
     * this one sends nothing and reports nothing: that tab announces the
     * outcome, and this one retries on its next sync.
     *
     * @returns {Promise<{replayed: number, rejected: Array<{url: string, method: string, kind: string, mutationId: string, status: number}>}>}
     *   How many changes the server accepted, and the ones it refused
     */
  replayPendingMutations() {
    const locks = globalThis.navigator?.locks;
    if (typeof locks?.request !== 'function') {
      // Browsers without Web Locks keep the per-tab guard; the server's
      // receipts and attendance locks still keep a double send harmless.
      return this.replayOutbox();
    }
    return locks.request(OUTBOX_REPLAY_LOCK, { ifAvailable: true }, (lock) => {
      if (!lock) {
        debugLog('OfflineManager: Another tab is replaying the outbox');
        return { replayed: 0, rejected: [] };
      }
      return this.replayOutbox();
    });
  }

  /**
   * Send the outbox in order. Call through replayPendingMutations, which
   * keeps other tabs from sending the same changes at the same time.
   * @returns {Promise<{replayed: number, rejected: Array<Object>}>} Outcome of the replay
   */
  async replayOutbox() {
    const nothing = { replayed: 0, rejected: [] };
    const pendingData = await getOfflineData();
    if (!pendingData || pendingData.length === 0) {
      debugLog('OfflineManager: No pending mutations to replay');
      return nothing;
    }

    debugLog('OfflineManager: Replaying', pendingData.length, 'pending mutations');

    // Refresh auth token for replay
    const currentUserId = getCurrentUserId();
    const currentOrganizationId = getCurrentOrganizationId();
    if (!currentUserId || !localStorage.getItem('jwtToken')) {
      debugWarn('OfflineManager: No auth token, cannot replay mutations');
      return nothing;
    }

    const authHeaders = {
      ...getAuthHeader(),
      'Content-Type': 'application/json'
    };
    let replayed = 0;
    let replayedPoints = false;
    const rejected = [];
    // Kept apart from `rejected`, which is announced: a body is never broadcast.
    const refusedBodies = [];
    const refusedScopes = [];

    for (const record of pendingData) {
      try {
        // New format: stored by OfflineManager.queueMutation fallback
        // record.data has { url, headers, body, timestamp }
        if (record.data?.url) {
          const sameUser = String(record.data.userId || '') === String(currentUserId);
          const sameOrganization = String(record.data.organizationId || '') === String(currentOrganizationId || '');
          if (!sameUser || !sameOrganization) {
            debugWarn('OfflineManager: Discarding mutation from a different or legacy account scope', record.key);
            await deleteOfflineData(record.key);
            continue;
          }

          debugLog('OfflineManager: Replaying mutation', record.data.url);
          const response = await fetch(record.data.url, {
            method: record.action || record.data.method || 'POST',
            headers: {
              ...record.data.headers,
              ...authHeaders,
              'Idempotency-Key': record.data.idempotencyKey
            },
            body: record.data.body
          });

          const method = record.data.method || record.action || 'POST';
          if (response.ok) {
            await deleteOfflineData(record.key);
            replayed += 1;
            replayedPoints ||= normalizeApiPath(record.data.url) === '/api/v1/points';
            this.dispatchEvent('offlineMutationReplayed', {
              url: record.data.url,
              method,
              mutationId: record.data.idempotencyKey
            });
            debugLog('OfflineManager: Mutation replayed successfully', record.key);
          } else if (NON_RETRIABLE_STATUSES.has(response.status)) {
            // Refused for good: retrying cannot help, so drop it and say so.
            await deleteOfflineData(record.key);
            refusedScopes.push(this.currentSeasonScope(record.data.userId, record.data.organizationId));
            rejected.push({
              url: record.data.url,
              method,
              kind: mutationKind(record.data.url, method),
              mutationId: record.data.idempotencyKey,
              status: response.status
            });
            refusedBodies.push(record.data.body);
            debugWarn('OfflineManager: Server rejected mutation, discarding', response.status);
          } else {
            // Preserve ordering: attendance must reach the server before a
            // later group award that uses it to determine eligibility.
            debugWarn('OfflineManager: Mutation replay failed (will retry)', response.status);
            break;
          }
        }
        // Legacy records have no user/organization scope and cannot be
        // replayed safely after an account change.
        else if (record.action === 'updatePoints' && record.data) {
          debugWarn('OfflineManager: Discarding unscoped legacy point mutation', record.key);
          await deleteOfflineData(record.key);
        }
        else {
          debugWarn('OfflineManager: Unknown offline record format, discarding', record.key, record.action);
          await deleteOfflineData(record.key);
        }
      } catch (error) {
        debugError('OfflineManager: Failed to replay mutation', record.key, error);
        // Leave record in IndexedDB for next sync attempt
        break;
      }
    }

    // Forget the refused changes' cached copies first, so the screens that
    // reload on the announcement read what the server holds. The screen that
    // queued a change recognizes it by its mutationId.
    await Promise.all(rejected.map((change, index) =>
      this.forgetRejectedResource(change, refusedBodies[index], refusedScopes[index])));
    rejected.forEach((change) => this.dispatchEvent('offlineMutationRejected', change));

    if (replayedPoints && !await this.hasPendingPoints()) {
      await clearPointsRelatedCaches();
    }
    return { replayed, rejected };
  }

  /**
   * Drop every cached copy of a refused change, so the next read, by an open
   * screen or one opened later, shows what the server holds. Only that
   * resource goes: in camp mode the cache is the only copy of everything else.
   * Other users, units and archived years keep theirs: they cannot hold it.
   * @param {{url: string, kind: string}} change - The refused change
   * @param {string|null} body - The request body it carried
   * @param {string} scope - Cache-key suffix of the account and unit that queued it
   * @returns {Promise<void>}
   */
  async forgetRejectedResource(change, body, scope) {
    const prefixes = this.rejectedCachePrefixes(change, body);
    try {
      await clearCacheEntriesWhere((record) => {
        const key = String(record.key);
        if (!key.endsWith(scope)) {
          return false;
        }
        const name = key.slice(0, key.length - scope.length);
        return prefixes.some((prefix) => name.startsWith(prefix));
      });
    } catch (error) {
      debugWarn('OfflineManager: Could not clear the cache of a refused change', error);
    }
  }

  /**
   * The cache-key suffix of a user and unit in the current season. Writes are
   * refused while an archived year is consulted, so a queued change only ever
   * touched current-season entries, which carry no year.
   * @param {string} userId - Who queued the change
   * @param {string|null} organizationId - The unit it was queued in
   * @returns {string} e.g. `|scope:user:u1|org:1`
   */
  currentSeasonScope(userId, organizationId) {
    return buildScopedCacheKey('', organizationId ?? 'none', userId).replace(/\|year:\d+$/, '');
  }

  /**
   * The cache keys that may hold a refused change: its API resource, and the
   * keys its screen stores under its own name.
   * @param {{url: string, kind: string}} change - The refused change
   * @param {string|null} body - The request body it carried
   * @returns {string[]} Key prefixes, compared without the user/unit scope
   */
  rejectedCachePrefixes(change, body) {
    const prefixes = [...cachePathsForMutation(normalizeApiPath(change.url))];
    if (change.kind === 'attendance') {
      let date = null;
      try {
        const payload = JSON.parse(body || '{}');
        date = payload.date || payload.toDate || null;
      } catch (_error) {
        date = null;
      }
      prefixes.push(...(date ? [`attendance_${date}`, `attendance_api_${date}`] : ['attendance_']));
    }
    prefixes.push(...(SCREEN_CACHE_PREFIXES[change.kind] || []));
    return prefixes;
  }

  /**
   * The message reporting changes the server refused on replay.
   * @param {Array<{kind: string}>} rejected - The refused changes
   * @returns {string} Translated message naming how many, and of what kind
   */
  describeRejected(rejected) {
    const kinds = [...new Set(rejected.map((change) => change.kind))]
      .map((kind) => this.getTranslation(`sync.rejected_kind_${kind}`));
    return this.getTranslation('sync.rejected')
      .replace('{count}', String(rejected.length))
      .replace('{kinds}', kinds.join(', '));
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
      ...getAuthHeader(),
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
      'sync.rejected': '{count} change(s) made offline were refused and not saved: {kinds}',
      'sync.rejected_kind_attendance': 'attendance',
      'sync.rejected_kind_medication': 'medication',
      'sync.rejected_kind_badges': 'badge history',
      'sync.rejected_kind_points': 'points',
      'sync.rejected_kind_other': 'other changes',
      'offline.dataUnavailable': 'This data is not available offline',
      'offline.savedLocally': 'Saved locally - will sync when online',
      'offline.writeUnavailable': 'This action requires an internet connection',
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
      'offline.campModeAutoDisabled': 'Camp mode automatically disabled',
      'scout_year_read_only': 'You are viewing an archived year: nothing can be changed.'
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

    // The activities collection is the supported endpoint; there is no upcoming-camps route.
    const { getActivities } = await import('../api/api-activities.js');
    const activities = await getActivities({ forceRefresh: navigator.onLine });
    const today = new Date().toLocaleDateString('en-CA');
    return activities.map((activity) => ({ ...activity,
      activity_start_date: isoToDateString(activity.activity_start_date),
      activity_end_date: isoToDateString(activity.activity_end_date),
    })).filter((activity) => activity.activity_start_date &&
      activity.activity_end_date > activity.activity_start_date && activity.activity_end_date >= today);
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
    if (this.preparationTask) { throw new Error('Preparation already in progress'); }
    this.preparationTask = this.prepareActivityData(activityId, startDate, endDate);
    try { return await this.preparationTask; }
    finally { this.preparationTask = null; }
  }

  /** Store a complete snapshot; never replace unsent changes or cross an account switch. */
  async prepareActivityData(activityId, startInput, endInput) {
    const startDate = isoToDateString(startInput);
    const endDate = isoToDateString(endInput);
    const token = localStorage.getItem('jwtToken');
    if (!token) {
      throw new Error('Not authenticated');
    }

    const scope = buildScopedCacheKey('');
    const assertScope = () => {
      if (scope !== buildScopedCacheKey('')) { throw new Error('Session changed'); }
    };
    if (await this.hasPendingResource('/api/v1')) {
      throw new Error('Local changes must be synchronized first');
    }
    assertScope();
    const cacheKeys = [];
    const cache = async (key, data, duration) => {
      assertScope();
      const scopedKey = buildScopedCacheKey(key);
      // Required writes must reject on quota/storage errors, unlike optional prefetches.
      await setCachedData(scopedKey, data, duration);
      cacheKeys.push(scopedKey);
    };
    const preparationKey = activityId || `manual_${startDate}`;
    const previous = this.preparedActivities.get(preparationKey);
    if (previous) {
      this.preparedActivities.set(preparationKey, { ...previous, cacheKeys: [] });
      this.savePreparedActivities();
    }
    const dates = this.generateDateRange(startDate, endDate);
    if (!dates.length || dates.length > OFFLINE_CAMPS.MAX_DAYS) { throw new Error('Invalid preparation range'); }
    const duration = Math.max(CACHE_DURATION.CAMP_MODE,
      new Date(`${endDate}T00:00:00`).getTime() + OFFLINE_CAMPS.EXPIRY_BUFFER_DAYS * DAY_MS - Date.now());
    const totalSteps = 9; // 8 data steps + 1 module pre-loading step

    this.preparationProgress = { current: 0, total: totalSteps, status: 'preparing', message: '' };
    this.dispatchEvent('preparationProgress', this.preparationProgress);

    try {
      // Step 1: Fetch bulk data from server
      this.updatePreparationProgress(1, this.getTranslation('offline.fetchingData'));

      const response = await fetch(`${CONFIG.API_BASE_URL}/api/v1/offline/prepare-activity`, {
        method: 'POST',
        headers: {
          ...getAuthHeader(),
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

      assertScope();
      if (await this.hasPendingResource('/api/v1')) { throw new Error('Local changes must be synchronized first'); }
      const bulkData = result.data;
      if (!bulkData.actionRoster) { throw new Error('Missing action roster'); }
      debugLog('OfflineManager: Received bulk data', {
        participants: bulkData.participants?.length,
        dates: bulkData.dates?.length,
        honors: bulkData.honors?.length
      });

      // Step 2: Cache participants and groups
      this.updatePreparationProgress(2, this.getTranslation('offline.cachingParticipants'));
      await cache('participants_v2', { success: true, data: bulkData.participants }, duration);
      await cache('groups', { success: true, data: bulkData.groups }, duration);
      await cache(buildApiCacheKey('v1/participants'), { success: true, data: bulkData.participants }, duration);
      await cache(buildApiCacheKey('v1/groups'), { success: true, data: bulkData.groups }, duration);

      // Cache points-data in the format manage_points expects
      await cache('manage_points_data', {
        success: true,
        groups: bulkData.groups,
        participants: bulkData.participants
      }, duration);

      // Snapshot signed authorizations as well as rosters before losing the network.
      if (bulkData.actionRoster) {
        await Promise.all(dates.map((date) =>
          cache(`action_roster_${date}`, bulkData.actionRoster, duration)));
      }

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
        await cache(`attendance_${date}`, attendancePayload, duration);
        // Also cache in the format the attendance module expects
        await cache(buildApiCacheKey('v1/attendance', { date }), attendancePayload, duration);
      }
      // Cache attendance dates list
      await cache(buildApiCacheKey('v1/attendance/dates'), { success: true, data: dates }, duration);

      // Step 4: Cache honors
      this.updatePreparationProgress(4, this.getTranslation('offline.cachingHonors'));
      await cache('honors_all', { success: true, data: bulkData.honors }, duration);
      await cache(buildApiCacheKey('v1/honors'), { success: true, data: bulkData.honors }, duration);
      // Cache honors by date
      for (const date of dates) {
        const honorsForDate = bulkData.honorsByDate[date] || [];
        await cache(`honors_${date}`, { success: true, data: honorsForDate }, duration);
        await cache(buildApiCacheKey('v1/honors', { date }), { success: true, data: honorsForDate }, duration);
      }

      // Step 5: Cache medications
      this.updatePreparationProgress(5, this.getTranslation('offline.cachingMedications'));
      await cache('medication_requirements', { success: true, data: bulkData.medications.requirements }, duration);
      await cache('medication_distributions', { success: true, data: bulkData.medications.distributions }, duration);
      await cache(buildApiCacheKey('v1/medication/requirements'), { success: true, data: bulkData.medications.requirements }, duration);
      await cache(buildApiCacheKey('v1/medication/distributions'), { success: true, data: bulkData.medications.distributions }, duration);
      // Cache medication receptions
      if (bulkData.medications.receptions && activityId) {
        const receptionsPayload = { success: true, data: { receptions: bulkData.medications.receptions } };
        const activityReceptionsPayload = { success: true, data: { ...receptionsPayload.data, ...bulkData.medications.participation } };
        await cache(`medication_receptions?activity_id=${activityId}`, activityReceptionsPayload, duration);
        await cache(buildApiCacheKey('v1/medication/receptions', { activity_id: activityId }), activityReceptionsPayload, duration);
        await cache(buildApiCacheKey('medication_receptions', { activity_id: activityId }), activityReceptionsPayload, duration);
        // Also cache without activity_id filter for dispensing view
        await cache('medication_receptions', receptionsPayload, duration);
        await cache(buildApiCacheKey('v1/medication/receptions'), receptionsPayload, duration);
      }

      // Step 6: Cache badges
      this.updatePreparationProgress(6, this.getTranslation('offline.cachingBadges'));
      await cache(buildApiCacheKey('v1/badges/settings'), { success: true, data: bulkData.badges.templates }, duration);
      await cache(buildApiCacheKey('v1/badges/summary'), { success: true, data: bulkData.badges.progress }, duration);

      // Step 7: Cache carpools (if activity has carpool data)
      this.updatePreparationProgress(7, this.getTranslation('offline.cachingCarpools'));
      if (bulkData.carpools && activityId) {
        await cache(`carpool_offers_activity_${activityId}`, { success: true, data: bulkData.carpools.offers }, duration);
        await cache(`carpool_assignments_activity_${activityId}`, { success: true, data: bulkData.carpools.assignments }, duration);
        await cache(buildApiCacheKey(`v1/carpools/activity/${activityId}/offers`), { success: true, data: bulkData.carpools.offers }, duration);
        await cache(buildApiCacheKey(`v1/carpools/activity/${activityId}/assignments`), { success: true, data: bulkData.carpools.assignments }, duration);
        // Also cache the activity itself
        if (bulkData.activity) {
          await cache(`activity_${activityId}`, { success: true, data: bulkData.activity }, duration);
          await cache(buildApiCacheKey(`v1/activities/${activityId}`), { success: true, data: bulkData.activity }, duration);
        }
      }

      // Step 8: Pre-load JavaScript modules for offline use
      this.updatePreparationProgress(8, this.getTranslation('offline.cachingModules'));
      await this.preloadCampModules();

      // Step 9: Save preparation state and enable camp mode
      this.updatePreparationProgress(9, this.getTranslation('offline.finalizing'));

      assertScope();
      const prepInfo = {
        scope,
        cacheKeys,
        activityId,
        startDate,
        endDate,
        preparedAt: Date.now(),
        dates,
        expiresAt: new Date(Date.now() + duration).toISOString()
      };

      this.preparedActivities.set(activityId || `manual_${startDate}`, prepInfo);
      this.savePreparedActivities();
      this.autoDetectCampMode();

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
      is_on_site: attendanceRows.find((row) => String(row.participant_id) === String(p.id))?.is_on_site,
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
      () => import('./attendance/Attendance.js'),
      () => import('./points/ManagePoints.js'),
      () => import('./honors/ManageHonors.js'),
      () => import('./activities/Activities.js'),
      () => import('./medication/MedicationManagement.js'),
      () => import('./medication/MedicationReception.js'),
      () => import('./badges/BadgeTracker.js'),
      () => import('./carpool/CarpoolLanding.js'),
      () => import('./carpool/CarpoolDashboard.js'),
      () => import('./participants/ManageParticipants.js'),
      () => import('./groups/ManageGroups.js'),
      () => import('./meetings/UpcomingMeeting.js'),
      // Shell + tabs for the merged destinations reachable offline
      () => import('./TabbedPage.js'),
      () => import('./meetings/MeetingPrep.js'),
      () => import('./program-progress/ProgramProgressDashboard.js'),
      () => import('./offline/OfflinePreparation.js'),
    ];

    const results = await Promise.allSettled(campModules.map(loader => loader()));
    const loaded = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;
    debugLog(`OfflineManager: Pre-loaded ${loaded} modules for camp mode${ 
      failed > 0 ? `, ${failed} failed` : ''}`);

    if (failed > 0) {
      results.forEach((r, _i) => {
        if (r.status === 'rejected') {
          debugError(`OfflineManager: Module preload failed:`, r.reason);
        }
      });
      throw new Error('Required offline screens could not be loaded');
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
    localStorage.setItem(buildScopedCacheKey(CAMP_MODE_STORAGE_KEY), JSON.stringify(campModeState));

    this.notifyServiceWorkerCampMode(true);
    this.dispatchEvent('campModeChanged', { enabled: true, activityId });
    debugLog('OfflineManager: Camp mode enabled', { activityId });
  }

  /**
     * Disable camp mode
     */
  disableCampMode() {
    this.campMode = false;
    this.activeActivityId = null;
    localStorage.removeItem(buildScopedCacheKey(CAMP_MODE_STORAGE_KEY));

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
    this.preparedActivities.clear();
    this.campMode = false;
    this.activeActivityId = null;
    try {
      // Restore camp mode state
      const stored = localStorage.getItem(buildScopedCacheKey(CAMP_MODE_STORAGE_KEY));
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
      const preparedStored = localStorage.getItem(buildScopedCacheKey(PREPARED_ACTIVITIES_KEY));
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
    // Local date, not toISOString(): UTC "today" is already tomorrow in
    // the evening, which would disable camp mode on the last camp night.
    const today = new Date().toLocaleDateString('en-CA');

    // Check if we're within any prepared activity's date range
    for (const [activityId, prep] of this.preparedActivities) {
      if (prep.scope && prep.scope !== buildScopedCacheKey('')) { continue; }
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
      localStorage.setItem(buildScopedCacheKey(PREPARED_ACTIVITIES_KEY), JSON.stringify(arrayForm));
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
      if (prep.scope && prep.scope !== buildScopedCacheKey('')) { continue; }
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
      if (prep.scope && prep.scope !== buildScopedCacheKey('')) { continue; }
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
    // Parse and format in local time so the range matches the literal
    // YYYY-MM-DD inputs regardless of timezone.
    const current = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${endDate}T00:00:00`);

    if (isNaN(current) || isNaN(end)) {
      return dates;
    }

    while (current <= end) {
      dates.push(current.toLocaleDateString('en-CA'));
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
    localStorage.removeItem(buildScopedCacheKey(PREPARED_ACTIVITIES_KEY));
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
