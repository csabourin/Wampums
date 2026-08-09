import { getCurrentOrganizationId, getCurrentUserId } from '../api/api-helpers.js';
import { getSelectedScoutYearId } from '../modules/scout-year/ScoutYearContext.js';

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
 * Normalize an endpoint or URL to the `/api/...` path used in cache keys.
 *
 * Mirrors the path handling in buildApiCacheKey so callers can match cached
 * entries for a resource without reconstructing its query string:
 *   "v1/fundraisers"                    -> "/api/v1/fundraisers"
 *   "/api/v1/fundraisers/7"             -> "/api/v1/fundraisers/7"
 *   "https://host/api/v1/fundraisers"   -> "/api/v1/fundraisers"
 *
 * @param {string} endpointOrUrl - API endpoint or full URL
 * @returns {string} Normalized path, without query string
 */
export function normalizeApiPath(endpointOrUrl) {
    const baseOrigin = typeof window !== 'undefined'
        ? window.location.origin
        : (typeof self !== 'undefined' ? self.location.origin : undefined);

    let path = String(endpointOrUrl || '');
    try {
        path = new URL(path, baseOrigin).pathname;
    } catch (error) {
        path = path.split('?')[0];
    }

    if (!path.startsWith('/api/')) {
        path = `/api/${path.replace(/^\/+/, '')}`;
    }
    return path.replace(/\/+$/, '');
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

/**
 * Namespace any cache key by authenticated user and selected organization.
 * This also scopes legacy/custom keys which do not use buildApiCacheKey().
 *
 * @param {string} cacheKey - Logical or URL-shaped cache key
 * @param {string|number|null} organizationId - Optional organization override
 * @param {string|null} userId - Optional user override
 * @returns {string} User- and organization-scoped cache key
 */
export function buildScopedCacheKey(
    cacheKey,
    organizationId = null,
    userId = null,
) {
    const rawKey = String(cacheKey);
    if (/\|scope:user:[^|]+\|org:[^|]+(\|year:\d+)?$/.test(rawKey)) {
        return rawKey;
    }
    const orgScope = organizationId ?? getCurrentOrganizationId() ?? 'none';
    const userScope = userId ?? getCurrentUserId() ?? 'anonymous';
    const base = `${rawKey}|scope:user:${encodeURIComponent(String(userScope))}|org:${encodeURIComponent(String(orgScope))}`;

    // Archived years get their own entries. The suffix is only appended while
    // one is selected, so keys for the current season stay byte-identical to
    // what is already cached and nothing has to be invalidated.
    const yearScope = getSelectedScoutYearId();
    return yearScope ? `${base}|year:${yearScope}` : base;
}
