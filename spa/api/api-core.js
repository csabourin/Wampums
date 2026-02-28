// api-core.js
// Core API request infrastructure for the Wampums application
import {
    saveOfflineData,
    getOfflineData,
    setCachedData,
    getCachedData,
    getCachedDataIgnoreExpiration,
    clearOfflineData
} from "../indexedDB.js";
import { CONFIG } from "../config.js";
import { debugLog, debugError, debugWarn } from "../utils/DebugUtils.js";
import { getCurrentOrganizationId, getAuthHeader } from "./api-helpers.js";
import { PerformanceMonitor } from "../utils/PerformanceUtils.js";
import { buildApiCacheKey } from "../utils/OfflineCacheKeys.js";

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
    const normalizedEndpoint = String(endpoint || '').replace(/^\/+/, '');

    let requestPath;
    if (normalizedEndpoint.startsWith('public/')) {
        requestPath = `/${normalizedEndpoint}`;
    } else if (normalizedEndpoint.startsWith('api/')) {
        requestPath = `/${normalizedEndpoint}`;
    } else if (normalizedEndpoint.startsWith('v1/')) {
        requestPath = `/api/${normalizedEndpoint}`;
    } else {
        requestPath = `/api/v1/${normalizedEndpoint}`;
    }

    const url = new URL(requestPath, CONFIG.API_BASE_URL);

    // Guard: ensure params is a plain object
    if (typeof params !== 'object' || params === null || Array.isArray(params)) {
        debugWarn('buildApiUrl received non-object params, ignoring:', params);
        params = {};
    }

    // Add organization ID if not already present
    const organizationId = getCurrentOrganizationId();
    const shouldSkipOrgId = endpoint.includes('organizations/get_organization_id');
    if (organizationId && !params.organization_id && !shouldSkipOrgId) {
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

            // Only redirect when actually online to avoid redirect on offline cached responses
            if (navigator.onLine) {
                const publicPages = ['/login', '/reset-password', '/register', '/permission-slip', '/public/'];
                const isPublicPage = publicPages.some(page => window.location.pathname.startsWith(page));

                if (!isPublicPage) {
                    window.location.href = '/login';
                } else {
                    debugWarn('[API] 401 error on public page, skipping automatic redirect');
                }
            } else {
                debugWarn('[API] 401 while offline, deferring redirect until online');
            }
        }

        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;

        try {
            if (contentType && contentType.includes("application/json")) {
                const errorData = await response.json();
                errorMessage = errorData.message || errorMessage;
                // Log detailed validation errors if present
                if (errorData.errors && Array.isArray(errorData.errors)) {
                    debugError('Validation errors:', errorData.errors);
                    // Create a detailed error message
                    const errorDetails = errorData.errors.map(e => `${e.param || e.field}: ${e.msg}`).join(', ');
                    errorMessage = `${errorMessage}: ${errorDetails}`;
                }
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
import { offlineManager } from "../modules/OfflineManager.js";

// ... (imports remain)

// ...

export async function makeApiRequest(endpoint, options = {}) {
    const {
        method = 'GET',
        params = {},
        body = null,
        headers = {},
        cacheBuster = false,
        retries = 1,
        signal = null
    } = options;

    let url = buildApiUrl(endpoint, params);
    if (cacheBuster) {
        url = addCacheBuster(url);
    }

    const isFormData = body instanceof FormData;
    const requestConfig = {
        method,
        headers: {
            'Accept': 'application/json',
            ...getAuthHeader(),
            ...headers
        },
        signal
    };

    if (body && method !== 'GET') {
        if (isFormData) {
            requestConfig.body = body;
            // browser sets proper boundary
        } else {
            requestConfig.headers['Content-Type'] = 'application/json';
            requestConfig.body = JSON.stringify(body);
        }
    }

    // Offline Handling for Write Operations
    if (offlineManager.isOffline && method !== 'GET') {
        debugLog(`[Offline] Queueing ${method} ${url}`);
        try {
            await offlineManager.queueMutation(url, {
                method,
                headers: requestConfig.headers,
                body: requestConfig.body
            });

            return {
                success: true,
                queued: true,
                message: offlineManager.getTranslation('offline.savedLocally')
            };
        } catch (error) {
            debugError('Failed to queue offline mutation:', error);
            throw new Error('Failed to save offline: ' + error.message);
        }
    }

    let lastError;
    const startTime = performance.now();

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            debugLog(`API Request (attempt ${attempt + 1}):`, method, url);
            debugLog('Request config:', {
                method: requestConfig.method,
                headers: requestConfig.headers,
                bodyType: typeof requestConfig.body,
                bodyPreview: requestConfig.body ? 
                    (typeof requestConfig.body === 'string' ? requestConfig.body.substring(0, 500) : requestConfig.body) 
                    : null
            });

            const response = await fetch(url, requestConfig);
            const result = await handleResponse(response);

            // Log API call performance
            const duration = performance.now() - startTime;
            PerformanceMonitor.logAPICall(endpoint, duration, false);

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

// Request deduplication: Track in-flight requests to prevent duplicate API calls
const pendingRequests = new Map();

/**
 * Make API request with caching support and request deduplication
 */
export async function makeApiRequestWithCache(endpoint, options = {}, cacheOptions = {}) {
    const {
        cacheKey = buildApiCacheKey(endpoint, options.params || {}),
        cacheDuration = CONFIG.CACHE_DURATION.MEDIUM,
        forceRefresh = false
    } = cacheOptions;

    // Create a unique request key for deduplication
    const requestKey = `${endpoint}-${JSON.stringify(options)}`;

    // Check for in-flight request (deduplication)
    if (pendingRequests.has(requestKey)) {
        debugLog('Reusing in-flight request:', requestKey);
        return pendingRequests.get(requestKey);
    }

    // Try cache first (unless force refresh)
    const startTime = performance.now();
    if (!forceRefresh) {
        try {
            const cachedData = await getCachedData(cacheKey);
            if (cachedData) {
                const duration = performance.now() - startTime;
                PerformanceMonitor.logAPICall(endpoint, duration, true);
                debugLog('Cache hit for:', cacheKey);
                return cachedData;
            }
        } catch (cacheError) {
            debugError('Cache retrieval failed:', cacheError);
        }
    }

    // Create the request promise
    const requestPromise = (async () => {
        try {
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
        } catch (requestError) {
            // If the request fails (typically while offline), return any existing cache
            // even if expired. Stale data is preferable to no data when offline.
            try {
                const fallbackCachedData = await getCachedDataIgnoreExpiration(cacheKey);
                if (fallbackCachedData) {
                    debugWarn('Network request failed, serving stale cached fallback for:', cacheKey);
                    return fallbackCachedData;
                }
            } catch (cacheFallbackError) {
                debugError('Cache fallback retrieval failed:', cacheFallbackError);
            }

            throw requestError;
        } finally {
            // Remove from pending requests after completion
            pendingRequests.delete(requestKey);
        }
    })();

    // Store the promise to enable deduplication
    pendingRequests.set(requestKey, requestPromise);

    return requestPromise;
}

/**
 * Main API object with HTTP methods
 */
export const API = {
    /**
     * GET request with optional caching
     */
    async get(endpoint, params = {}, cacheOptions = {}) {
        const mergedCacheOptions = {
            cacheKey: cacheOptions.cacheKey || buildApiCacheKey(endpoint, params),
            ...cacheOptions
        };
        return makeApiRequestWithCache(endpoint, { params }, mergedCacheOptions);
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
     * PATCH request
     */
    async patch(endpoint, body = {}, params = {}) {
        return makeApiRequest(endpoint, {
            method: 'PATCH',
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
    return async function (...args) {
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
