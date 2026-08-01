// api-core.js
// Core API request infrastructure for the Wampums application
import {
    setCachedData,
    getCachedData,
    getCachedDataIgnoreExpiration
} from "../indexedDB.js";
import { CONFIG } from "../config.js";
import { debugLog, debugError, debugWarn } from "../utils/DebugUtils.js";
import { getCurrentOrganizationId, getAuthHeader } from "./api-helpers.js";
import { PerformanceMonitor } from "../utils/PerformanceUtils.js";
import { buildApiCacheKey, buildScopedCacheKey } from "../utils/OfflineCacheKeys.js";

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

    // Guard: ensure params is a plain object, and copy it so the caller's
    // object is never mutated (organization_id is injected below)
    if (typeof params !== 'object' || params === null || Array.isArray(params)) {
        debugWarn('buildApiUrl received non-object params, ignoring:', params);
        params = {};
    } else {
        params = { ...params };
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
    const getHeader = (name) => response.headers?.get?.(name) || null;
    const contentType = getHeader("content-type");

    if (!response.ok) {
        // Handle 401 Unauthorized specifically
        if (response.status === 401) {
            const hadAuthenticatedSession = Boolean(localStorage.getItem("jwtToken"));
            if (hadAuthenticatedSession) {
                try {
                    const { clearAllClientData } = await import("../utils/ClientCleanupUtils.js");
                    await clearAllClientData();
                } catch (cleanupError) {
                    debugError('Failed to clear client data after 401:', cleanupError);
                    localStorage.removeItem("jwtToken");
                    localStorage.removeItem("userRole");
                    localStorage.removeItem("userFullName");
                    localStorage.removeItem("userId");
                }
            }

            // Only redirect when actually online to avoid redirect on offline cached responses
            if (navigator.onLine) {
                // '/permission-slip/' keeps its trailing slash so the staff
                // dashboard at /permission-slips still redirects on 401.
                const publicPages = ['/login', '/reset-password', '/register', '/permission-slip/', '/public/'];
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

        const httpError = new Error(errorMessage);
        httpError.status = response.status;
        httpError.isNetworkError = getHeader('X-Network-Error') === 'true';
        throw httpError;
    }

    if (response.status === 204) {
        return { success: true, data: null };
    }

    if (
        (contentType && contentType.includes("application/json"))
        || (!contentType && typeof response.json === "function")
    ) {
        return response.json();
    } else {
        throw new Error(`Unexpected response type: ${contentType}`);
    }
}

/**
 * Core API request function
 */
import { offlineManager } from "../modules/OfflineManager.js";
import { isArchiveMode } from "../modules/scout-year/ScoutYearContext.js";

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

    // Consulting an archived year is read-only. The guard sits here rather than
    // only in the interface because every screen goes through this function:
    // one forgotten disabled button would otherwise write last year's data into
    // the current season.
    if (method !== 'GET' && isArchiveMode()) {
        // Translated here so the toast a caller shows stays in the page's
        // language rather than dropping an English sentence into a French UI.
        const archiveError = new Error(offlineManager.getTranslation('scout_year_read_only'));
        archiveError.status = 403;
        archiveError.isArchiveReadOnly = true;
        debugWarn(`[Archive] Blocked ${method} ${url} while consulting an archived year`);
        throw archiveError;
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
    if ((offlineManager.isOffline || navigator.onLine === false) && method !== 'GET') {
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
                hasAuthorization: Boolean(requestConfig.headers.Authorization),
                hasBody: Boolean(requestConfig.body)
            });

            const response = await fetch(url, requestConfig);
            const result = await handleResponse(response);

            // Log API call performance
            const duration = performance.now() - startTime;
            PerformanceMonitor.logAPICall(endpoint, duration, false);

            debugLog('API response received:', {
                success: result?.success,
                queued: result?.queued,
            });
            return result;

        } catch (error) {
            lastError = error;
            debugError(`API request failed (attempt ${attempt + 1}):`, error);

            // Only retry idempotent GETs, and only for transient failures
            // (network errors or 5xx). Retrying writes can duplicate them
            // (e.g. timeout after the server processed the request), and
            // retrying 4xx responses just delays user-facing feedback.
            const isTransient = !error.status || error.status >= 500;
            const isRetryable = method === 'GET' && isTransient;

            if (!isRetryable) {
                break;
            }

            if (attempt < retries) {
                // Wait before retry with exponential backoff
                await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
            }
        }
    }

    const isNetworkError = Boolean(
        lastError?.isNetworkError ||
        (!lastError?.status && lastError?.name !== 'AbortError')
    );

    if (method !== 'GET' && isNetworkError) {
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
    }

    const finalError = new Error(`API request failed: ${lastError.message}`, {
        cause: lastError
    });
    finalError.status = lastError.status;
    finalError.isNetworkError = isNetworkError;
    throw finalError;
}

// Request deduplication: Track in-flight requests to prevent duplicate API calls
const pendingRequests = new Map();

/**
 * Make API request with caching support and request deduplication
 */
export async function makeApiRequestWithCache(endpoint, options = {}, cacheOptions = {}) {
    const {
        cacheKey: requestedCacheKey = buildApiCacheKey(endpoint, options.params || {}),
        cacheDuration = CONFIG.CACHE_DURATION.MEDIUM,
        forceRefresh = false
    } = cacheOptions;
    const cacheKey = buildScopedCacheKey(requestedCacheKey);

    // Create a unique request key for deduplication
    const requestKey = `${endpoint}-${JSON.stringify(options)}`;

    // Check for in-flight request (deduplication). A forced refresh must not
    // reuse an in-flight request it was explicitly asked to bypass.
    if (!forceRefresh && pendingRequests.has(requestKey)) {
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
            // Only connectivity failures may use expired data. HTTP 4xx/5xx
            // responses must reach callers so authorization and validation
            // failures cannot be hidden by stale cache entries.
            if (navigator.onLine === false || requestError.isNetworkError === true) {
                try {
                    const fallbackCachedData = await getCachedDataIgnoreExpiration(cacheKey);
                    if (fallbackCachedData) {
                        debugWarn('Offline request failed, serving stale cached fallback for:', cacheKey);
                        return fallbackCachedData;
                    }
                } catch (cacheFallbackError) {
                    debugError('Cache fallback retrieval failed:', cacheFallbackError);
                }
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
     *
     * Takes an optional body for the rare deletion that needs the caller to
     * confirm what they are destroying rather than just name it in the URL.
     */
    async delete(endpoint, params = {}, body = null) {
        return makeApiRequest(endpoint, {
            method: 'DELETE',
            params,
            body
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

// Offline sync is handled by OfflineManager.syncPendingData(), which clears
// each queued mutation individually after it succeeds. The old all-or-nothing
// syncOfflineData() here was unused and could replay successful writes.
