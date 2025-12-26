/**
 * CacheManager - Offline Support for Wampums Mobile App
 *
 * Provides caching and offline queue functionality for API requests.
 * Mirrors the IndexedDB caching patterns from the web app (spa/indexedDB.js).
 *
 * Features:
 * - Cache GET requests with expiration
 * - Queue POST/PUT/DELETE mutations when offline
 * - Background sync when connection restored
 * - Cache invalidation following web app patterns
 * - Network state detection
 *
 * @module CacheManager
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

// Cache configuration (matches web app settings)
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes default
const CACHE_PREFIX = 'cache:';
const QUEUE_PREFIX = 'queue:';
const QUEUE_KEY = 'offline_mutation_queue';

/**
 * Cache Manager Class
 */
class CacheManager {
  constructor() {
    this.isOnline = true;
    this.listeners = [];

    // Initialize network state listener
    this.initializeNetworkListener();
  }

  /**
   * Initialize network state listener
   * Monitors connection and triggers sync when online
   */
  initializeNetworkListener() {
    NetInfo.addEventListener(state => {
      const wasOffline = !this.isOnline;
      this.isOnline = state.isConnected && state.isInternetReachable;

      // Notify listeners of network state change
      this.listeners.forEach(listener => listener(this.isOnline));

      // If coming back online, sync queued mutations
      if (wasOffline && this.isOnline) {
        this.syncQueuedMutations();
      }
    });
  }

  /**
   * Add a network state change listener
   * @param {Function} listener - Callback function (receives isOnline boolean)
   */
  addNetworkListener(listener) {
    this.listeners.push(listener);
  }

  /**
   * Remove a network state change listener
   * @param {Function} listener - Callback function to remove
   */
  removeNetworkListener(listener) {
    this.listeners = this.listeners.filter(l => l !== listener);
  }

  /**
   * Get current network state
   * @returns {boolean} True if online, false if offline
   */
  async getNetworkState() {
    const state = await NetInfo.fetch();
    this.isOnline = state.isConnected && state.isInternetReachable;
    return this.isOnline;
  }

  /**
   * Cache a GET request response
   * @param {string} key - Cache key (e.g., 'v1/participants')
   * @param {Object} data - Response data to cache
   * @param {number} duration - Cache duration in ms (default: CACHE_DURATION)
   */
  async cacheData(key, data, duration = CACHE_DURATION) {
    try {
      const cacheEntry = {
        key,
        data,
        type: 'cache',
        timestamp: Date.now(),
        expiration: Date.now() + duration,
      };

      await AsyncStorage.setItem(
        `${CACHE_PREFIX}${key}`,
        JSON.stringify(cacheEntry)
      );

      console.log(`[Cache] Cached: ${key}`);
    } catch (error) {
      console.error(`[Cache] Error caching ${key}:`, error);
    }
  }

  /**
   * Retrieve cached data if available and not expired
   * @param {string} key - Cache key
   * @returns {Object|null} Cached data or null if not found/expired
   */
  async getCachedData(key) {
    try {
      const cached = await AsyncStorage.getItem(`${CACHE_PREFIX}${key}`);

      if (!cached) {
        return null;
      }

      const cacheEntry = JSON.parse(cached);

      // Check if expired
      if (Date.now() > cacheEntry.expiration) {
        console.log(`[Cache] Expired: ${key}`);
        await this.deleteCachedData(key);
        return null;
      }

      console.log(`[Cache] Hit: ${key}`);
      return cacheEntry.data;
    } catch (error) {
      console.error(`[Cache] Error retrieving ${key}:`, error);
      return null;
    }
  }

  /**
   * Delete a specific cache entry
   * @param {string} key - Cache key to delete
   */
  async deleteCachedData(key) {
    try {
      await AsyncStorage.removeItem(`${CACHE_PREFIX}${key}`);
      console.log(`[Cache] Deleted: ${key}`);
    } catch (error) {
      console.error(`[Cache] Error deleting ${key}:`, error);
    }
  }

  /**
   * Delete all cache entries matching a pattern
   * @param {string} pattern - Pattern to match (e.g., 'v1/participants')
   */
  async deleteCachedDataByPattern(pattern) {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const cacheKeys = keys.filter(key =>
        key.startsWith(CACHE_PREFIX) && key.includes(pattern)
      );

      if (cacheKeys.length > 0) {
        await AsyncStorage.multiRemove(cacheKeys);
        console.log(`[Cache] Deleted ${cacheKeys.length} entries matching: ${pattern}`);
      }
    } catch (error) {
      console.error(`[Cache] Error deleting pattern ${pattern}:`, error);
    }
  }

  /**
   * Clear all cached data
   */
  async clearAllCache() {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const cacheKeys = keys.filter(key => key.startsWith(CACHE_PREFIX));

      if (cacheKeys.length > 0) {
        await AsyncStorage.multiRemove(cacheKeys);
        console.log(`[Cache] Cleared all cache (${cacheKeys.length} entries)`);
      }
    } catch (error) {
      console.error('[Cache] Error clearing all cache:', error);
    }
  }

  /**
   * Queue a mutation (POST/PUT/DELETE) for later sync
   * @param {Object} mutation - Mutation details
   * @param {string} mutation.method - HTTP method (POST/PUT/DELETE)
   * @param {string} mutation.url - API endpoint URL
   * @param {Object} mutation.data - Request payload
   * @param {Object} mutation.headers - Request headers
   */
  async queueMutation(mutation) {
    try {
      const queue = await this.getMutationQueue();

      const queueEntry = {
        id: `${Date.now()}_${Math.random()}`,
        timestamp: Date.now(),
        ...mutation,
      };

      queue.push(queueEntry);

      await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
      console.log(`[Queue] Queued mutation: ${mutation.method} ${mutation.url}`);

      return queueEntry.id;
    } catch (error) {
      console.error('[Queue] Error queuing mutation:', error);
      throw error;
    }
  }

  /**
   * Get the current mutation queue
   * @returns {Array} Array of queued mutations
   */
  async getMutationQueue() {
    try {
      const queue = await AsyncStorage.getItem(QUEUE_KEY);
      return queue ? JSON.parse(queue) : [];
    } catch (error) {
      console.error('[Queue] Error getting queue:', error);
      return [];
    }
  }

  /**
   * Sync queued mutations with the server
   * Called automatically when connection is restored
   * @param {Function} apiClient - Function to make API requests
   * @returns {Object} Sync results { success: number, failed: number }
   */
  async syncQueuedMutations(apiClient) {
    if (!this.isOnline) {
      console.log('[Sync] Offline, skipping sync');
      return { success: 0, failed: 0 };
    }

    try {
      const queue = await this.getMutationQueue();

      if (queue.length === 0) {
        console.log('[Sync] Queue empty, nothing to sync');
        return { success: 0, failed: 0 };
      }

      console.log(`[Sync] Syncing ${queue.length} queued mutations...`);

      let successCount = 0;
      let failedCount = 0;
      const remainingQueue = [];

      for (const mutation of queue) {
        try {
          // Execute the queued mutation
          if (apiClient) {
            await apiClient({
              method: mutation.method,
              url: mutation.url,
              data: mutation.data,
              headers: mutation.headers,
            });
          }

          successCount++;
          console.log(`[Sync] ✓ ${mutation.method} ${mutation.url}`);
        } catch (error) {
          failedCount++;
          console.error(`[Sync] ✗ ${mutation.method} ${mutation.url}:`, error);

          // Re-queue failed mutations (unless they're 400 errors)
          if (!error.response || error.response.status >= 500) {
            remainingQueue.push(mutation);
          }
        }
      }

      // Update queue with remaining mutations
      await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(remainingQueue));

      console.log(`[Sync] Complete: ${successCount} success, ${failedCount} failed`);

      return { success: successCount, failed: failedCount };
    } catch (error) {
      console.error('[Sync] Error during sync:', error);
      return { success: 0, failed: 0 };
    }
  }

  /**
   * Clear the mutation queue
   */
  async clearMutationQueue() {
    try {
      await AsyncStorage.removeItem(QUEUE_KEY);
      console.log('[Queue] Cleared mutation queue');
    } catch (error) {
      console.error('[Queue] Error clearing queue:', error);
    }
  }

  // ========================================
  // CACHE INVALIDATION FUNCTIONS
  // These mirror the web app's IndexedDB cache invalidation patterns
  // See: spa/indexedDB.js and CLAUDE.md
  // ========================================

  /**
   * Clear all participant-related caches
   * Use after: creating/updating/deleting participants
   */
  async clearParticipantRelatedCaches() {
    console.log('[Cache] Invalidating participant caches...');
    await this.deleteCachedDataByPattern('v1/participants');
    await this.deleteCachedDataByPattern('v1/activities');
    await this.deleteCachedDataByPattern('v1/groups');
  }

  /**
   * Clear all activity-related caches
   * Use after: creating/updating/deleting activities
   */
  async clearActivityRelatedCaches() {
    console.log('[Cache] Invalidating activity caches...');
    await this.deleteCachedDataByPattern('v1/activities');
    await this.deleteCachedDataByPattern('v1/participants');
    await this.deleteCachedDataByPattern('v1/carpools');
    await this.deleteCachedDataByPattern('attendance-report');
  }

  /**
   * Clear all carpool-related caches for an activity
   * Use after: creating/updating/deleting carpool offers or assignments
   * @param {string|number} activityId - Optional activity ID to clear specific activity caches
   */
  async clearCarpoolRelatedCaches(activityId = null) {
    console.log('[Cache] Invalidating carpool caches...');

    if (activityId) {
      await this.deleteCachedData(`v1/carpools/activity/${activityId}`);
      await this.deleteCachedData(`v1/carpools/activity/${activityId}/unassigned`);
      await this.deleteCachedData(`v1/activities/${activityId}/participants`);
    } else {
      await this.deleteCachedDataByPattern('v1/carpools');
    }

    await this.deleteCachedDataByPattern('v1/carpools/my-offers');
  }

  /**
   * Clear all group-related caches
   * Use after: creating/updating/deleting groups
   */
  async clearGroupRelatedCaches() {
    console.log('[Cache] Invalidating group caches...');
    await this.deleteCachedDataByPattern('v1/groups');
    await this.deleteCachedDataByPattern('v1/participants');
  }

  /**
   * Clear all badge-related caches
   * Use after: submitting/approving/rejecting badges, awarding honors
   */
  async clearBadgeRelatedCaches() {
    console.log('[Cache] Invalidating badge caches...');
    await this.deleteCachedDataByPattern('badge-dashboard');
    await this.deleteCachedDataByPattern('badge-progress');
    await this.deleteCachedDataByPattern('badge-history');
    await this.deleteCachedDataByPattern('honors');
    await this.deleteCachedDataByPattern('points-report');
  }

  /**
   * Clear all fundraiser-related caches
   * Use after: creating/updating fundraiser sales or payments
   * @param {string|number} fundraiserId - Optional fundraiser ID
   */
  async clearFundraiserRelatedCaches(fundraiserId = null) {
    console.log('[Cache] Invalidating fundraiser caches...');

    if (fundraiserId) {
      await this.deleteCachedData(`fundraisers/${fundraiserId}`);
      await this.deleteCachedData(`calendars/${fundraiserId}`);
    } else {
      await this.deleteCachedDataByPattern('fundraisers');
      await this.deleteCachedDataByPattern('calendars');
    }
  }

  /**
   * Clear all finance-related caches
   * Use after: recording payments, updating fees, creating fee definitions
   * @param {string|number} participantFeeId - Optional participant fee ID
   */
  async clearFinanceRelatedCaches(participantFeeId = null) {
    console.log('[Cache] Invalidating finance caches...');

    if (participantFeeId) {
      await this.deleteCachedData(`v1/finance/participant-fees/${participantFeeId}`);
    }

    await this.deleteCachedDataByPattern('v1/finance');
    await this.deleteCachedDataByPattern('v1/budget');
    await this.deleteCachedDataByPattern('v1/participants');
  }

  /**
   * Clear permission slip related caches
   * Use after: creating/sending/signing permission slips
   */
  async clearPermissionSlipRelatedCaches() {
    console.log('[Cache] Invalidating permission slip caches...');
    await this.deleteCachedDataByPattern('v1/resources/permission-slips');
  }

  /**
   * Clear medication-related caches
   * Use after: updating medication requirements, recording distributions
   */
  async clearMedicationRelatedCaches() {
    console.log('[Cache] Invalidating medication caches...');
    await this.deleteCachedDataByPattern('v1/medication');
  }

  /**
   * Clear equipment/resource related caches
   * Use after: creating/updating reservations
   */
  async clearResourceRelatedCaches() {
    console.log('[Cache] Invalidating resource caches...');
    await this.deleteCachedDataByPattern('v1/resources/equipment');
  }

  /**
   * Clear attendance-related caches
   * Use after: creating/updating attendance records or guests
   */
  async clearAttendanceRelatedCaches() {
    console.log('[Cache] Invalidating attendance caches...');
    await this.deleteCachedDataByPattern('v1/attendance');
    await this.deleteCachedDataByPattern('guests-by-date');
  }
}

// Export singleton instance
export default new CacheManager();
