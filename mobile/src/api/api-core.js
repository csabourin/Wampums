/**
 * Core API Client for Wampums React Native App
 *
 * Mirrors spa/api/api-core.js functionality
 * Provides:
 * - HTTP request methods (GET, POST, PUT, DELETE)
 * - Automatic JWT token attachment
 * - Error handling and response normalization
 * - Request retry logic
 * - 401 handling (auto-logout on invalid session)
 */

import axios from 'axios';
import CONFIG, { getApiUrl, getDynamicApiUrl } from '../config';
import StorageUtils from '../utils/StorageUtils';
import CacheManager from '../utils/CacheManager';
import { debugLog, debugError } from '../utils/DebugUtils.js';

// Create axios instance with default config
const axiosInstance = axios.create({
  timeout: CONFIG.API.TIMEOUT,
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * Get auth headers with JWT token
 * Mirrors spa/jwt-helper.js getAuthHeader
 */
const getAuthHeaders = async () => {
  const token = await StorageUtils.getJWT();
  const headers = {};

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
};

/**
 * Get organization headers
 */
const getOrganizationHeaders = async () => {
  const orgId = await StorageUtils.getItem(CONFIG.STORAGE_KEYS.ORGANIZATION_ID);
  const headers = {};

  if (orgId) {
    headers['x-organization-id'] = orgId;
  }

  return headers;
};

/**
 * Get device token header for 2FA
 */
const getDeviceHeaders = async () => {
  const deviceToken = await StorageUtils.getItem(CONFIG.STORAGE_KEYS.DEVICE_TOKEN);
  const headers = {};

  if (deviceToken) {
    headers['x-device-token'] = deviceToken;
  }

  return headers;
};

/**
 * Build complete headers for request
 */
const buildHeaders = async (customHeaders = {}) => {
  const authHeaders = await getAuthHeaders();
  const orgHeaders = await getOrganizationHeaders();
  const deviceHeaders = await getDeviceHeaders();

  return {
    ...authHeaders,
    ...orgHeaders,
    ...deviceHeaders,
    ...customHeaders,
  };
};

/**
 * Handle API errors
 * Mirrors spa/api/api-core.js error handling
 */
const handleApiError = async (error, originalRequest) => {
  if (CONFIG.FEATURES.DEBUG_LOGGING) {
    debugError('API Error:', error.response?.status, error.response?.data || error.message);
  }

  // Handle 401 - Unauthorized (invalid or expired token)
  if (error.response?.status === 401) {
    // Clear user data and redirect to login
    await StorageUtils.clearUserData();

    // You can emit an event here to trigger navigation to login screen
    // For now, we'll just throw the error
    throw {
      success: false,
      message: 'Session expired. Please login again.',
      status: 401,
      requiresLogin: true,
    };
  }

  // Normalize error response
  const errorResponse = {
    success: false,
    message: error.response?.data?.message || error.message || 'An error occurred',
    status: error.response?.status,
    data: error.response?.data,
  };

  throw errorResponse;
};

/**
 * Make HTTP request with retry logic and offline support
 */
const makeRequest = async (method, endpoint, data = null, options = {}) => {
  const {
    headers: customHeaders = {},
    retries = CONFIG.API.RETRY_ATTEMPTS,
    currentAttempt = 0,
    useCache = true, // Enable cache by default for GET requests
    forceRefresh = false, // Skip cache and fetch fresh data
    cacheDuration, // Optional custom cache duration
    cacheKey, // Optional custom cache key (useful for endpoints with query params)
    ...axiosOptions
  } = options;

  // Determine the cache key to use
  const finalCacheKey = cacheKey || endpoint;

  // GET requests: Check cache first (unless forceRefresh)
  if (method === 'GET' && useCache && !forceRefresh) {
    const cachedData = await CacheManager.getCachedData(finalCacheKey);
    if (cachedData) {
      if (CONFIG.FEATURES.DEBUG_LOGGING) {
        debugLog(`[API] Cache hit: ${finalCacheKey}`);
      }
      return cachedData;
    }
  }

  // Check network state for mutations (POST/PUT/DELETE)
  const isOnline = await CacheManager.getNetworkState();
  const isMutation = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method);

  // If offline and it's a mutation, queue it
  if (!isOnline && isMutation) {
    if (CONFIG.FEATURES.DEBUG_LOGGING) {
      debugLog(`[API] Offline - queuing mutation: ${method} ${endpoint}`);
    }

    const url = await getDynamicApiUrl(endpoint);
    const headers = await buildHeaders(customHeaders);

    await CacheManager.queueMutation({
      method,
      url,
      data,
      headers,
    });

    // Return optimistic response
    return {
      success: true,
      message: 'Request queued for sync when online',
      queued: true,
      data: data,
    };
  }

  try {
    const url = await getDynamicApiUrl(endpoint);
    const headers = await buildHeaders(customHeaders);

    const config = {
      method,
      url,
      headers,
      ...axiosOptions,
    };

    if (data) {
      if (method === 'GET') {
        config.params = data;
      } else {
        config.data = data;
      }
    }

    const response = await axiosInstance(config);

    // Normalize response to match backend format
    // { success: true, message: '...', data: {...}, timestamp: ... }
    let normalizedResponse;
    if (response.data && typeof response.data === 'object') {
      // If response already has success/message/data structure, return as-is
      if ('success' in response.data) {
        normalizedResponse = response.data;
      } else {
        // Otherwise, wrap the response
        normalizedResponse = {
          success: true,
          data: response.data,
          timestamp: new Date().toISOString(),
        };
      }
    } else {
      normalizedResponse = response.data;
    }

    // Cache successful GET responses
    if (method === 'GET' && useCache && normalizedResponse.success !== false) {
      await CacheManager.cacheData(finalCacheKey, normalizedResponse, cacheDuration);
    }

    return normalizedResponse;
  } catch (error) {
    // If offline and it's a GET request, try to return cached data
    if (!isOnline && method === 'GET' && useCache) {
      const cachedData = await CacheManager.getCachedData(finalCacheKey);
      if (cachedData) {
        if (CONFIG.FEATURES.DEBUG_LOGGING) {
          debugLog(`[API] Offline - returning cached: ${finalCacheKey}`);
        }
        return {
          ...cachedData,
          fromCache: true,
          offline: true,
        };
      }
    }

    // Check if we should retry
    if (
      currentAttempt < retries &&
      (!error.response || error.response.status >= 500)
    ) {
      // Wait before retrying (exponential backoff)
      const delay = CONFIG.API.RETRY_DELAY * Math.pow(2, currentAttempt);
      await new Promise((resolve) => setTimeout(resolve, delay));

      // Retry the request
      return makeRequest(method, endpoint, data, {
        ...options,
        currentAttempt: currentAttempt + 1,
      });
    }

    // Handle the error
    return handleApiError(error);
  }
};

/**
 * API client object
 * Mirrors spa/api/api-core.js API export
 */
const API = {
  /**
   * GET request
   */
  get: async (endpoint, params = null, options = {}) => {
    return makeRequest('GET', endpoint, params, options);
  },

  /**
   * POST request
   */
  post: async (endpoint, data = null, options = {}) => {
    return makeRequest('POST', endpoint, data, options);
  },

  /**
   * PUT request
   */
  put: async (endpoint, data = null, options = {}) => {
    return makeRequest('PUT', endpoint, data, options);
  },

  /**
   * DELETE request
   */
  delete: async (endpoint, data = null, options = {}) => {
    return makeRequest('DELETE', endpoint, data, options);
  },

  /**
   * PATCH request
   */
  patch: async (endpoint, data = null, options = {}) => {
    return makeRequest('PATCH', endpoint, data, options);
  },

  /**
   * Public request (no auth headers)
   * Mirrors spa/api/api-helpers.js fetchPublic
   */
  public: async (endpoint, data = null, method = 'GET', options = {}) => {
    try {
      const url = await getDynamicApiUrl(endpoint);
      const orgHeaders = await getOrganizationHeaders();
      const deviceHeaders = await getDeviceHeaders();

      const config = {
        method,
        url,
        headers: {
          'Content-Type': 'application/json',
          ...orgHeaders,
          ...deviceHeaders,
          ...options.headers,
        },
      };

      if (data) {
        if (method === 'GET') {
          config.params = data;
        } else {
          config.data = data;
        }
      }

      const response = await axiosInstance(config);

      // Normalize response
      if (response.data && typeof response.data === 'object') {
        if ('success' in response.data) {
          return response.data;
        }

        return {
          success: true,
          data: response.data,
          timestamp: new Date().toISOString(),
        };
      }

      return response.data;
    } catch (error) {
      return handleApiError(error);
    }
  },
};

export default API;
