/**
 * api-offline-wrapper.js
 *
 * Wrapper module for adding offline support to API functions.
 * Provides higher-order functions to wrap existing API calls with offline capabilities.
 */

import { debugLog, debugWarn } from '../utils/DebugUtils.js';
import { offlineManager } from '../modules/OfflineManager.js';

/**
 * Configuration for different endpoint types
 */
const CACHE_STRATEGY = {
    CRITICAL: 7 * 24 * 60 * 60 * 1000,  // 7 days
    STANDARD: 24 * 60 * 60 * 1000,       // 24 hours
    VOLATILE: 2 * 60 * 60 * 1000,        // 2 hours
    NONE: 0                               // No caching
};

/**
 * Endpoint cache configuration
 * Maps endpoint patterns to cache durations
 */
const ENDPOINT_CACHE_CONFIG = {
    '/api/v1/participants': CACHE_STRATEGY.CRITICAL,
    '/api/v1/groups': CACHE_STRATEGY.CRITICAL,
    '/api/v1/dashboards/initial': CACHE_STRATEGY.CRITICAL,
    '/api/v1/organizations/settings': CACHE_STRATEGY.CRITICAL,
    '/api/v1/attendance': CACHE_STRATEGY.STANDARD,
    '/api/v1/points': CACHE_STRATEGY.STANDARD,
    '/api/v1/honors': CACHE_STRATEGY.STANDARD,
    '/api/v1/badges/summary': CACHE_STRATEGY.STANDARD,
    '/api/v1/public/translations': CACHE_STRATEGY.STANDARD,
};

/**
 * Get cache duration for a URL
 * @param {string} url - API endpoint URL
 * @returns {number} Cache duration in milliseconds
 */
function getCacheDurationForUrl(url) {
    try {
        const urlObj = new URL(url, window.location.origin);
        const pathname = urlObj.pathname;

        // Check exact matches first
        for (const [pattern, duration] of Object.entries(ENDPOINT_CACHE_CONFIG)) {
            if (pathname === pattern || pathname.startsWith(pattern + '/')) {
                return duration;
            }
        }

        // Default to standard cache
        return CACHE_STRATEGY.STANDARD;
    } catch (error) {
        debugWarn('api-offline-wrapper: Error parsing URL', error);
        return CACHE_STRATEGY.STANDARD;
    }
}

/**
 * Higher-order function to wrap an API function with offline support
 * 
 * @param {Function} apiFunction - The original API function to wrap
 * @param {Object} options - Configuration options
 * @param {string} options.endpoint - API endpoint pattern for cache configuration
 * @param {number} options.cacheDuration - Override cache duration (optional)
 * @param {boolean} options.queueable - Whether mutations should be queued when offline (default: true)
 * @returns {Function} Wrapped function with offline support
 */
export function withOfflineSupport(apiFunction, options = {}) {
    const {
        endpoint = '',
        cacheDuration = null,
        queueable = true
    } = options;

    return async function wrappedApiFunction(...args) {
        debugLog('api-offline-wrapper: Calling wrapped function', { endpoint, args });

        try {
            // Call original function
            const result = await apiFunction(...args);
            return result;

        } catch (error) {
            debugWarn('api-offline-wrapper: API call failed, checking offline fallback', error);

            // If offline and this is a mutation, it may have been queued
            if (offlineManager.isOffline && queueable) {
                // Check if error indicates queued operation
                // Handle different error structures
                const isQueued = error.queued ||
                    (error.response && error.response.status === 202) ||
                    (error.status === 202);

                if (isQueued) {
                    return {
                        success: true,
                        queued: true,
                        message: 'Saved locally - will sync when online',
                        data: null
                    };
                }
            }

            // Re-throw error if not handled
            throw error;
        }
    };
}

/**
 * Create offline-aware API object with wrapped methods
 * 
 * @param {Object} apiMethods - Object containing API methods to wrap
 * @param {Object} endpointMap - Maps method names to their endpoint patterns
 * @returns {Object} Object with wrapped API methods
 * 
 * @example
 * const offlineAwareAPI = createOfflineAwareAPI({
 *   getParticipants: originalGetParticipants,
 *   saveParticipant: originalSaveParticipant
 * }, {
 *   getParticipants: { endpoint: '/api/v1/participants', cacheDuration: CACHE_STRATEGY.CRITICAL },
 *   saveParticipant: { endpoint: '/api/v1/participants', queueable: true }
 * });
 */
export function createOfflineAwareAPI(apiMethods, endpointMap = {}) {
    const wrappedAPI = {};

    for (const [methodName, apiFunction] of Object.entries(apiMethods)) {
        const config = endpointMap[methodName] || {};
        wrappedAPI[methodName] = withOfflineSupport(apiFunction, config);

        debugLog(`api-offline-wrapper: Wrapped method ${methodName}`, config);
    }

    return wrappedAPI;
}

/**
 * Wrapper for fetch calls with offline support
 * This is a lower-level wrapper that can be used directly with fetch
 * 
 * @param {string} url - URL to fetch
 * @param {Object} options - Fetch options
 * @returns {Promise<Response>} Fetch response
 */
export async function offlineFetch(url, options = {}) {
    debugLog('api-offline-wrapper: offlineFetch called', { url, method: options.method });

    const cacheDuration = getCacheDurationForUrl(url);

    return offlineManager.fetchWithOfflineSupport(url, options, cacheDuration);
}

/**
 * Helper to determine if an endpoint supports offline mode
 * 
 * @param {string} url - API endpoint URL
 * @returns {boolean} True if endpoint has offline support configured
 */
export function isOfflineSupported(url) {
    try {
        const urlObj = new URL(url, window.location.origin);
        const pathname = urlObj.pathname;

        // Check if endpoint has cache configuration
        for (const pattern of Object.keys(ENDPOINT_CACHE_CONFIG)) {
            if (pathname === pattern || pathname.startsWith(pattern + '/')) {
                return true;
            }
        }

        return false;
    } catch (error) {
        return false;
    }
}

/**
 * Utility to check if current operation should queue mutations
 * 
 * @param {string} method - HTTP method
 * @returns {boolean} True if method is a mutation that should be queued
 */
export function isMutationMethod(method) {
    const mutationMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];
    return mutationMethods.includes((method || 'GET').toUpperCase());
}

/**
 * Export cache strategies for external use
 */
export { CACHE_STRATEGY };

/**
 * Export endpoint cache configuration for external inspection
 */
export { ENDPOINT_CACHE_CONFIG };
