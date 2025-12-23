/**
 * OptimisticUpdateManager
 *
 * Utility for managing optimistic updates with automatic rollback on error.
 * Provides instant UI feedback while API requests complete in the background.
 *
 * Usage Example:
 * ```javascript
 * const manager = new OptimisticUpdateManager();
 *
 * await manager.execute('assign-participant-123', {
 *   optimisticFn: () => {
 *     // Update UI immediately
 *     this.assignments.push(newAssignment);
 *     this.render();
 *     return { rollbackData: originalState };
 *   },
 *   apiFn: async () => {
 *     return await assignParticipantAPI(data);
 *   },
 *   successFn: (result) => {
 *     // Replace optimistic data with real data
 *     this.assignments = this.assignments.map(a =>
 *       a.id === 'temp-id' ? result : a
 *     );
 *     this.render();
 *   },
 *   rollbackFn: ({ rollbackData }) => {
 *     // Revert to original state
 *     this.assignments = rollbackData.assignments;
 *     this.render();
 *   }
 * });
 * ```
 */

import { debugLog, debugWarn, debugError } from './DebugUtils.js';

export class OptimisticUpdateManager {
  constructor() {
    this.pendingUpdates = new Map();
    this.updateHistory = [];
    this.maxHistorySize = 50; // Keep last 50 updates for debugging
  }

  /**
   * Execute an optimistic update with automatic rollback on error
   *
   * @param {string} key - Unique identifier for this update (prevents duplicates)
   * @param {Object} handlers - Handler functions for the optimistic update
   * @param {Function} handlers.optimisticFn - Function to apply optimistic update, returns rollback data
   * @param {Function} handlers.apiFn - Async function for API call
   * @param {Function} handlers.successFn - Optional function to finalize on success (receives API result)
   * @param {Function} handlers.rollbackFn - Function to rollback on error (receives rollback data and error)
   * @param {Function} [handlers.onError] - Optional custom error handler
   * @returns {Promise<any>} Result from API call
   * @throws {Error} Re-throws error after rollback if API call fails
   */
  async execute(key, { optimisticFn, apiFn, successFn, rollbackFn, onError }) {
    // Prevent duplicate optimistic updates
    if (this.pendingUpdates.has(key)) {
      debugWarn(`Optimistic update already pending for key: ${key}`);
      return this.pendingUpdates.get(key);
    }

    const startTime = Date.now();
    let rollbackData = null;

    const updatePromise = (async () => {
      try {
        // 1. Apply optimistic update immediately
        debugLog(`[Optimistic] Starting: ${key}`);
        rollbackData = optimisticFn();

        // 2. Make API call in background
        const result = await apiFn();

        // 3. Finalize with real data on success
        if (successFn) {
          successFn(result);
        }

        const duration = Date.now() - startTime;
        debugLog(`[Optimistic] Success: ${key} (${duration}ms)`);

        // Track successful update
        this._addToHistory({
          key,
          success: true,
          duration,
          timestamp: Date.now()
        });

        return result;

      } catch (error) {
        debugError(`[Optimistic] Failed: ${key}`, error);

        // 4. Rollback on error
        if (rollbackFn && rollbackData) {
          rollbackFn(rollbackData, error);
          debugLog(`[Optimistic] Rolled back: ${key}`);
        }

        // Track failed update
        this._addToHistory({
          key,
          success: false,
          error: error.message,
          duration: Date.now() - startTime,
          timestamp: Date.now()
        });

        // Custom error handler
        if (onError) {
          onError(error);
        }

        throw error;

      } finally {
        // Remove from pending updates
        this.pendingUpdates.delete(key);
      }
    })();

    // Store the promise to prevent duplicate updates
    this.pendingUpdates.set(key, updatePromise);

    return updatePromise;
  }

  /**
   * Execute multiple optimistic updates in parallel
   *
   * @param {Array<{key: string, handlers: Object}>} updates - Array of updates to execute
   * @returns {Promise<Array>} Results from all API calls
   */
  async executeMany(updates) {
    const promises = updates.map(({ key, handlers }) =>
      this.execute(key, handlers).catch(err => ({ error: err }))
    );

    return Promise.all(promises);
  }

  /**
   * Check if an optimistic update is currently pending
   *
   * @param {string} key - Update identifier
   * @returns {boolean} True if update is pending
   */
  isPending(key) {
    return this.pendingUpdates.has(key);
  }

  /**
   * Get the number of pending updates
   *
   * @returns {number} Count of pending updates
   */
  getPendingCount() {
    return this.pendingUpdates.size;
  }

  /**
   * Get all pending update keys
   *
   * @returns {Array<string>} Array of pending update keys
   */
  getPendingKeys() {
    return Array.from(this.pendingUpdates.keys());
  }

  /**
   * Wait for all pending updates to complete
   *
   * @param {number} timeout - Optional timeout in milliseconds
   * @returns {Promise<void>}
   */
  async waitForAll(timeout = 30000) {
    if (this.pendingUpdates.size === 0) {
      return;
    }

    const promises = Array.from(this.pendingUpdates.values());

    if (timeout) {
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Optimistic updates timeout')), timeout)
      );

      return Promise.race([
        Promise.allSettled(promises),
        timeoutPromise
      ]);
    }

    return Promise.allSettled(promises);
  }

  /**
   * Cancel a pending optimistic update
   * Note: This doesn't actually cancel the API call (use AbortController for that),
   * but it removes it from the pending updates tracking
   *
   * @param {string} key - Update identifier
   */
  cancel(key) {
    if (this.pendingUpdates.has(key)) {
      this.pendingUpdates.delete(key);
      debugLog(`[Optimistic] Cancelled: ${key}`);
    }
  }

  /**
   * Cancel all pending optimistic updates
   */
  cancelAll() {
    const count = this.pendingUpdates.size;
    this.pendingUpdates.clear();
    debugLog(`[Optimistic] Cancelled all (${count} updates)`);
  }

  /**
   * Get update history for debugging
   *
   * @param {number} limit - Maximum number of history items to return
   * @returns {Array} Recent update history
   */
  getHistory(limit = 10) {
    return this.updateHistory.slice(-limit);
  }

  /**
   * Get statistics about optimistic updates
   *
   * @returns {Object} Statistics object
   */
  getStats() {
    const history = this.updateHistory;
    const successful = history.filter(h => h.success).length;
    const failed = history.filter(h => !h.success).length;
    const avgDuration = history.length > 0
      ? history.reduce((sum, h) => sum + h.duration, 0) / history.length
      : 0;

    return {
      total: history.length,
      successful,
      failed,
      successRate: history.length > 0 ? (successful / history.length * 100).toFixed(2) : 0,
      avgDuration: Math.round(avgDuration),
      pending: this.pendingUpdates.size
    };
  }

  /**
   * Clear update history
   */
  clearHistory() {
    this.updateHistory = [];
  }

  /**
   * Add update to history (internal method)
   * @private
   */
  _addToHistory(entry) {
    this.updateHistory.push(entry);

    // Keep history size manageable
    if (this.updateHistory.length > this.maxHistorySize) {
      this.updateHistory.shift();
    }
  }
}

/**
 * Create a singleton instance for global use
 */
export const globalOptimisticManager = new OptimisticUpdateManager();

/**
 * Helper function to generate unique optimistic IDs
 *
 * @param {string} prefix - Optional prefix for the ID
 * @returns {string} Unique optimistic ID
 */
export function generateOptimisticId(prefix = 'temp') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Helper to mark data as optimistic
 *
 * @param {Object} data - Data object to mark
 * @returns {Object} Data with _optimistic flag
 */
export function markAsOptimistic(data) {
  return {
    ...data,
    _optimistic: true,
    _optimisticTimestamp: Date.now()
  };
}

/**
 * Helper to check if data is optimistic
 *
 * @param {Object} data - Data object to check
 * @returns {boolean} True if data is optimistic
 */
export function isOptimistic(data) {
  return data && data._optimistic === true;
}

/**
 * Helper to remove optimistic markers from data
 *
 * @param {Object} data - Data object
 * @returns {Object} Data without optimistic markers
 */
export function cleanOptimisticMarkers(data) {
  if (!data) return data;

  const cleaned = { ...data };
  delete cleaned._optimistic;
  delete cleaned._optimisticTimestamp;
  return cleaned;
}
