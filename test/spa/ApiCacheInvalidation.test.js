/**
 * @jest-environment jsdom
 *
 * Cache invalidation after writes.
 *
 * `API.get` caches every response for 30 minutes under a key derived from the
 * request URL, then namespaced by user and organisation, e.g.
 *
 *   /api/v1/fundraisers?include_archived=true&organization_id=12|scope:user:u1|org:12
 *
 * The per-domain clear helpers matched *logical* key names ("fundraisers"),
 * which only exist for endpoints passing an explicit `cacheKey`. Campaign reads
 * do not, so creating or archiving a campaign never invalidated anything and the
 * list kept serving stale data until the entry expired or storage was cleared.
 */

import 'fake-indexeddb/auto';

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn(),
}));

jest.mock('../../spa/api/api-helpers.js', () => ({
  getCurrentOrganizationId: () => 12,
  getCurrentUserId: () => 'user-1',
  getAuthHeader: () => ({ Authorization: 'Bearer test' }),
}));

jest.mock('../../spa/modules/scout-year/ScoutYearContext.js', () => ({
  getSelectedScoutYearId: () => null,
}));

import {
  setCachedData,
  getCachedData,
  clearCachedApiPaths,
  clearFundraiserRelatedCaches,
} from '../../spa/indexedDB.js';
import { buildApiCacheKey, buildScopedCacheKey, normalizeApiPath } from '../../spa/utils/OfflineCacheKeys.js';

const ONE_HOUR = 60 * 60 * 1000;

/**
 * Cache a response under the key API.get would really use.
 *
 * @param {string} endpoint - Endpoint as passed to API.get
 * @param {Object} params - Query params
 * @param {*} payload - Response to cache
 * @returns {Promise<string>} The key that was written
 */
async function cacheAsApiGetWould(endpoint, params, payload) {
  const key = buildScopedCacheKey(buildApiCacheKey(endpoint, params));
  await setCachedData(key, payload, ONE_HOUR);
  return key;
}

describe('the key API.get actually writes', () => {
  test('is derived from the URL, not from a logical name', () => {
    const key = buildScopedCacheKey(buildApiCacheKey('v1/fundraisers', { include_archived: true }));

    expect(key).toContain('/api/v1/fundraisers');
    expect(key).toContain('|scope:user:user-1|org:12');
    // The mismatch that caused the bug: it does not start with "fundraisers".
    expect(key.startsWith('fundraisers')).toBe(false);
  });
});

describe('clearCachedApiPaths', () => {
  test('removes entries for a path regardless of query string or scope suffix', async () => {
    const listKey = await cacheAsApiGetWould('v1/fundraisers', { include_archived: true }, { success: true });
    const plainKey = await cacheAsApiGetWould('v1/fundraisers', {}, { success: true });

    expect(await getCachedData(listKey)).not.toBeNull();

    const removed = await clearCachedApiPaths(['v1/fundraisers']);

    expect(removed).toBeGreaterThanOrEqual(2);
    expect(await getCachedData(listKey)).toBeNull();
    expect(await getCachedData(plainKey)).toBeNull();
  });

  test('removes sub-resources of the path', async () => {
    const detailKey = await cacheAsApiGetWould('v1/fundraisers/7', {}, { success: true });

    await clearCachedApiPaths(['v1/fundraisers']);

    expect(await getCachedData(detailKey)).toBeNull();
  });

  test('leaves unrelated resources alone', async () => {
    const otherKey = await cacheAsApiGetWould('v1/participants', {}, { success: true });
    const budgetKey = await cacheAsApiGetWould('v1/budget/reports/summary', {}, { success: true });

    await clearCachedApiPaths(['v1/fundraisers']);

    expect(await getCachedData(otherKey)).not.toBeNull();
    expect(await getCachedData(budgetKey)).not.toBeNull();
  });

  test('does not match a path that merely shares a prefix', async () => {
    const lookalike = await cacheAsApiGetWould('v1/fundraisers-archive', {}, { success: true });

    await clearCachedApiPaths(['v1/fundraisers']);

    expect(await getCachedData(lookalike)).not.toBeNull();
  });

  test('is a no-op when given nothing', async () => {
    const key = await cacheAsApiGetWould('v1/fundraisers', {}, { success: true });

    expect(await clearCachedApiPaths([])).toBe(0);
    expect(await getCachedData(key)).not.toBeNull();
  });
});

describe('clearFundraiserRelatedCaches', () => {
  test('clears the campaign list a screen really cached', async () => {
    const listKey = await cacheAsApiGetWould('v1/fundraisers', { include_archived: true }, { success: true });
    const entriesKey = await cacheAsApiGetWould('v1/calendars', { fundraiser_id: 7 }, { success: true });

    await clearFundraiserRelatedCaches(7);

    expect(await getCachedData(listKey)).toBeNull();
    expect(await getCachedData(entriesKey)).toBeNull();
  });

  test('still clears the legacy logical keys', async () => {
    const legacyList = buildScopedCacheKey('fundraisers');
    const legacyEntries = buildScopedCacheKey('fundraiser_entries_7');
    await setCachedData(legacyList, { success: true }, ONE_HOUR);
    await setCachedData(legacyEntries, { success: true }, ONE_HOUR);

    await clearFundraiserRelatedCaches(7);

    expect(await getCachedData(legacyList)).toBeNull();
    expect(await getCachedData(legacyEntries)).toBeNull();
  });
});

describe('normalizeApiPath', () => {
  test.each([
    ['v1/fundraisers', '/api/v1/fundraisers'],
    ['/v1/fundraisers', '/api/v1/fundraisers'],
    ['/api/v1/fundraisers', '/api/v1/fundraisers'],
    ['v1/fundraisers/7', '/api/v1/fundraisers/7'],
    ['v1/fundraisers?include_archived=true', '/api/v1/fundraisers'],
    ['v1/fundraisers/', '/api/v1/fundraisers'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeApiPath(input)).toBe(expected);
  });
});
