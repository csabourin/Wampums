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
import CONFIG, { getApiUrl } from '../config';
import StorageUtils from '../utils/StorageUtils';

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
    console.error('API Error:', error.response?.status, error.response?.data || error.message);
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
 * Make HTTP request with retry logic
 */
const makeRequest = async (method, endpoint, data = null, options = {}) => {
  const {
    headers: customHeaders = {},
    retries = CONFIG.API.RETRY_ATTEMPTS,
    currentAttempt = 0,
    ...axiosOptions
  } = options;

  try {
    const url = getApiUrl(endpoint);
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
    if (response.data && typeof response.data === 'object') {
      // If response already has success/message/data structure, return as-is
      if ('success' in response.data) {
        return response.data;
      }

      // Otherwise, wrap the response
      return {
        success: true,
        data: response.data,
        timestamp: new Date().toISOString(),
      };
    }

    return response.data;
  } catch (error) {
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
      const url = getApiUrl(endpoint);
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
