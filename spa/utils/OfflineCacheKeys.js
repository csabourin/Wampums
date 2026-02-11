import { getCurrentOrganizationId } from '../api/api-helpers.js';

/**
 * Normalize query params by removing null/undefined and sorting keys for stable cache keys.
 * @param {Object} params
 * @returns {Object}
 */
export function normalizeCacheParams(params = {}) {
    return Object.entries(params)
        .filter(([, value]) => value !== null && value !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .reduce((acc, [key, value]) => {
            acc[key] = value;
            return acc;
        }, {});
}

/**
 * Build a deterministic cache key for API responses.
 * Uses normalized path and sorted query parameters.
 *
 * @param {string} endpointOrUrl - API endpoint (e.g. "v1/attendance") or full URL
 * @param {Object} params - Query params
 * @param {string|number|null} organizationId - Optional organization id
 * @returns {string}
 */
export function buildApiCacheKey(endpointOrUrl, params = {}, organizationId = null) {
    const normalizedParams = normalizeCacheParams(params);
    const orgId = organizationId ?? getCurrentOrganizationId();

    let path = endpointOrUrl;
    const mergedParams = { ...normalizedParams };

    const baseOrigin = typeof window !== 'undefined'
        ? window.location.origin
        : (typeof self !== 'undefined' ? self.location.origin : undefined);

    try {
        const parsed = new URL(endpointOrUrl, baseOrigin);
        path = parsed.pathname;

        for (const [key, value] of parsed.searchParams.entries()) {
            if (mergedParams[key] === undefined) {
                mergedParams[key] = value;
            }
        }
    } catch (error) {
        path = endpointOrUrl.startsWith('/') ? endpointOrUrl : `/api/${endpointOrUrl}`;
    }

    // Path normalization: ensures all of the following resolve to the same cache key:
    //   "v1/participants"                      -> "/api/v1/participants"
    //   "/v1/participants"                     -> "/api/v1/participants"
    //   "/api/v1/participants"                 -> "/api/v1/participants" (no change)
    //   "https://host/api/v1/participants"     -> "/api/v1/participants" (URL parsed above)
    if (!path.startsWith('/api/')) {
        path = `/api/${path.replace(/^\/+/, '')}`;
    }

    if (orgId && mergedParams.organization_id === undefined) {
        mergedParams.organization_id = String(orgId);
    }

    const sortedParams = normalizeCacheParams(mergedParams);
    const query = new URLSearchParams(sortedParams).toString();

    return query ? `${path}?${query}` : path;
}
