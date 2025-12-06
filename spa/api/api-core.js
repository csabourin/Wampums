// api-core.js
// Core API request infrastructure for the Wampums application
import {
    saveOfflineData,
    getOfflineData,
    setCachedData,
    getCachedData,
    clearOfflineData
} from "../indexedDB.js";
import { CONFIG } from "../config.js";
import { debugLog, debugError, debugWarn } from "../utils/DebugUtils.js";
import { getCurrentOrganizationId, getAuthHeader } from "./api-helpers.js";

/**
 * Add cache buster parameter to URL
 */
function addCacheBuster(url) {
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}_=${Date.now()}`;
}

/**
 * Build API URL with parameters
 */
export function buildApiUrl(endpoint, params = {}) {
    const url = new URL(`/api/${endpoint}`, CONFIG.API_BASE_URL);

    // Add organization ID if not already present
    const organizationId = getCurrentOrganizationId();
    if (organizationId && !params.organization_id) {
        params.organization_id = organizationId;
    }

    // Add all parameters to URL
    Object.entries(params).forEach(([key, value]) => {
        if (value !== null && value !== undefined) {
            url.searchParams.append(key, value);
        }
    });

    return url.toString();
}

/**
 * Handle API response with error handling
 */
export async function handleResponse(response) {
    const contentType = response.headers.get("content-type");

    if (!response.ok) {
        // Handle 401 Unauthorized specifically
        if (response.status === 401) {
            // Clear invalid auth data
            localStorage.removeItem("jwtToken");
            localStorage.removeItem("userRole");
            localStorage.removeItem("userFullName");
            localStorage.removeItem("userId");

            // Optionally redirect to login if not already there
            if (window.location.pathname !== '/login') {
                window.location.href = '/login';
            }
        }

        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;

        try {
            if (contentType && contentType.includes("application/json")) {
                const errorData = await response.json();
                errorMessage = errorData.message || errorMessage;
            } else {
                const textError = await response.text();
                errorMessage = textError || errorMessage;
            }
        } catch (parseError) {
            debugError('Error parsing error response:', parseError);
        }

        throw new Error(errorMessage);
    }

    if (contentType && contentType.includes("application/json")) {
        return response.json();
    } else {
        throw new Error(`Unexpected response type: ${contentType}`);
    }
}

/**
 * Core API request function
 */
export async function makeApiRequest(endpoint, options = {}) {
    const {
        method = 'GET',
        params = {},
        body = null,
        headers = {},
        cacheBuster = false,
        retries = 1
    } = options;

    let url = buildApiUrl(endpoint, params);
    if (cacheBuster) {
        url = addCacheBuster(url);
    }

    const requestConfig = {
        method,
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            ...getAuthHeader(),
            ...headers
        }
    };

    if (body && method !== 'GET') {
        requestConfig.body = JSON.stringify(body);
    }

    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            debugLog(`API Request (attempt ${attempt + 1}):`, method, url);

            const response = await fetch(url, requestConfig);
            const result = await handleResponse(response);

            debugLog('API Response:', result);
            return result;

        } catch (error) {
            lastError = error;
            debugError(`API request failed (attempt ${attempt + 1}):`, error);

            if (attempt < retries) {
                // Wait before retry with exponential backoff
                await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
            }
        }
    }

    throw new Error(`Failed to complete API request after ${retries + 1} attempts: ${lastError.message}`);
}

/**
 * Make API request with caching support
 */
export async function makeApiRequestWithCache(endpoint, options = {}, cacheOptions = {}) {
    const {
        cacheKey = endpoint,
        cacheDuration = CONFIG.CACHE_DURATION.MEDIUM,
        forceRefresh = false
    } = cacheOptions;

    // Try cache first (unless force refresh)
    if (!forceRefresh) {
        try {
            const cachedData = await getCachedData(cacheKey);
            if (cachedData) {
                debugLog('Cache hit for:', cacheKey);
                return cachedData;
            }
        } catch (cacheError) {
            debugError('Cache retrieval failed:', cacheError);
        }
    }

    // Make API request
    const result = await makeApiRequest(endpoint, options);

    // Cache successful results
    if (result.success) {
        try {
            await setCachedData(cacheKey, result, cacheDuration);
            debugLog('Data cached for:', cacheKey);
        } catch (cacheError) {
            debugError('Failed to cache data:', cacheError);
        }
    }

    return result;
}

/**
 * Main API object with HTTP methods
 */
export const API = {
    /**
     * GET request with optional caching
     */
    async get(endpoint, params = {}, cacheOptions = {}) {
        return makeApiRequestWithCache(endpoint, { params }, cacheOptions);
    },

    /**
     * GET request without caching
     */
    async getNoCache(endpoint, params = {}) {
        return makeApiRequest(endpoint, { params, cacheBuster: true });
    },

    /**
     * POST request
     */
    async post(endpoint, body = {}, params = {}) {
        return makeApiRequest(endpoint, {
            method: 'POST',
            body,
            params
        });
    },

    /**
     * PUT request
     */
    async put(endpoint, body = {}, params = {}) {
        return makeApiRequest(endpoint, {
            method: 'PUT',
            body,
            params
        });
    },

    /**
     * DELETE request
     */
    async delete(endpoint, params = {}) {
        return makeApiRequest(endpoint, {
            method: 'DELETE',
            params
        });
    }
};

/**
 * Batch API requests with concurrency control
 */
export async function batchApiRequests(requests, concurrency = 3) {
    const results = [];

    for (let i = 0; i < requests.length; i += concurrency) {
        const batch = requests.slice(i, i + concurrency);
        const batchPromises = batch.map(request => {
            const { endpoint, options } = request;
            return makeApiRequest(endpoint, options);
        });

        const batchResults = await Promise.allSettled(batchPromises);
        results.push(...batchResults);
    }

    return results;
}

/**
 * Error handling wrapper for functions
 */
export function withErrorHandling(fn) {
    return async function(...args) {
        try {
            return await fn.apply(this, args);
        } catch (error) {
            debugError(`Error in ${fn.name}:`, error);

            // Optionally show user-friendly error messages
            if (error.message.includes('401') || error.message.includes('Unauthorized')) {
                debugWarn('Authentication required - redirecting to login');
            }

            throw error;
        }
    };
}

/**
 * Offline sync functionality
 */
export async function syncOfflineData() {
    if (!navigator.onLine) {
        return;
    }

    const offlineData = await getOfflineData();
    const results = [];

    for (const item of offlineData) {
        try {
            const { endpoint, options } = item;
            const result = await makeApiRequest(endpoint, options);
            results.push({ success: true, result });
        } catch (error) {
            results.push({ success: false, error: error.message });
        }
    }

    if (results.every(r => r.success)) {
        await clearOfflineData();
    }

    return results;
}
