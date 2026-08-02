/**
 * @jest-environment jsdom
 *
 * Proves clearYearlyPlannerCaches actually matches the keys the app writes.
 *
 * The invalidator scans by prefix rather than deleting a known key list,
 * because the activity-library keys carry arbitrary filter params. That scan is
 * only correct because buildScopedCacheKey appends its `|scope:user:…|org:…`
 * suffix at the END of the key. If that ever changes, the prefix scan silently
 * stops matching and the original "nothing comes out of it" bug returns — so
 * this test writes through the real cache layer instead of asserting on a mock.
 */

'use strict';

require('fake-indexeddb/auto');
const { IDBFactory } = require('fake-indexeddb');

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugWarn: jest.fn(),
  debugError: jest.fn(),
  debugInfo: jest.fn()
}));

jest.mock('../../spa/config.js', () => ({
  CONFIG: { CACHE_DURATION: { SHORT: 60000, MEDIUM: 300000, LONG: 3600000 } },
  getStorageKey: (key) => key
}));

jest.mock('../../spa/utils/OfflineCacheKeys.js', () => {
  const actual = jest.requireActual('../../spa/utils/OfflineCacheKeys.js');
  return {
    ...actual,
    getCurrentOrganizationId: () => 3,
    getCurrentUserId: () => 'user-abc'
  };
});

import {
  setCachedData,
  getCachedData,
  clearYearlyPlannerCaches
} from '../../spa/indexedDB.js';
import { buildApiCacheKey } from '../../spa/utils/OfflineCacheKeys.js';

beforeEach(() => {
  // Fresh database per test so key sets never leak between cases.
  global.indexedDB = new IDBFactory();
});

/** Keys written exactly as api-yearly-planner.js reads produce them. */
const PLANNER_KEYS = [
  buildApiCacheKey('v1/yearly-planner/plans', {}, 3),
  buildApiCacheKey('v1/yearly-planner/plans/12', {}, 3),
  buildApiCacheKey('v1/yearly-planner/plans/12/periods', {}, 3),
  buildApiCacheKey('v1/yearly-planner/meetings/88', {}, 3),
  buildApiCacheKey('v1/yearly-planner/activity-library', { category: 'games', sort_by: 'name' }, 3),
  buildApiCacheKey('v1/yearly-planner/activity-library', { search: 'piste' }, 3)
];

const PREP_KEYS = ['reunion_dates', 'reunion_preparation_2025-09-10'];
const UNRELATED_KEYS = ['participants', buildApiCacheKey('v1/participants', {}, 3)];

/**
 * Seed the cache with a value under each key.
 * @param {string[]} keys - Cache keys to write
 * @returns {Promise<void>}
 */
async function seed(keys) {
  for (const key of keys) {
    await setCachedData(key, { success: true, data: [key] }, 300000);
  }
}

describe('clearYearlyPlannerCaches', () => {
  test('the prefix it scans for is really how planner keys start', () => {
    for (const key of PLANNER_KEYS) {
      expect(key.startsWith('/api/v1/yearly-planner')).toBe(true);
    }
  });

  test('clears every planner key including filtered library variants', async () => {
    await seed([...PLANNER_KEYS, ...UNRELATED_KEYS]);
    for (const key of PLANNER_KEYS) {
      expect(await getCachedData(key)).not.toBeNull();
    }

    await clearYearlyPlannerCaches();

    for (const key of PLANNER_KEYS) {
      expect(await getCachedData(key)).toBeNull();
    }
  });

  test('leaves unrelated caches alone', async () => {
    await seed([...PLANNER_KEYS, ...UNRELATED_KEYS]);
    await clearYearlyPlannerCaches();

    for (const key of UNRELATED_KEYS) {
      expect(await getCachedData(key)).not.toBeNull();
    }
  });

  test('keeps meeting-prep caches by default', async () => {
    await seed([...PLANNER_KEYS, ...PREP_KEYS]);
    await clearYearlyPlannerCaches();

    for (const key of PREP_KEYS) {
      expect(await getCachedData(key)).not.toBeNull();
    }
  });

  test('clears meeting-prep caches when asked', async () => {
    await seed([...PLANNER_KEYS, ...PREP_KEYS]);
    await clearYearlyPlannerCaches({ includeMeetingPrep: true });

    for (const key of PREP_KEYS) {
      expect(await getCachedData(key)).toBeNull();
    }
  });

  test('is a no-op on an empty cache rather than throwing', async () => {
    await expect(clearYearlyPlannerCaches({ includeMeetingPrep: true })).resolves.toBeUndefined();
  });
});
