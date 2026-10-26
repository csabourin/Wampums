/**
 * @jest-environment jsdom
 *
 * What a write makes stale.
 *
 * Deleting a child cleared only `/api/v1/participants…`, while the points and
 * attendance screens read keys named `points_report`, `participants_v2`,
 * `manage_points_data` and `attendance_<date>`. None of them matched, so the
 * child stayed on those screens until the entries expired.
 *
 * Entries now record the API paths they were built from, and a roster change
 * made while connected clears everything but the unit's configuration. In camp
 * mode or offline the cache is the only copy of the data, so a write there
 * still clears only its own resource.
 */

import 'fake-indexeddb/auto';

const mockOfflineState = { isOffline: false, campMode: false };

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn(),
}));

jest.mock('../../spa/config.js', () => ({
  CONFIG: {
    API_BASE_URL: 'http://localhost',
    CACHE_DURATION: { SHORT: 60000, MEDIUM: 1800000, LONG: 7200000 },
  },
}));

jest.mock('../../spa/api/api-helpers.js', () => ({
  getCurrentOrganizationId: () => 12,
  getCurrentUserId: () => 'user-1',
  getAuthHeader: () => ({ Authorization: 'Bearer test' }),
}));

jest.mock('../../spa/modules/scout-year/ScoutYearContext.js', () => ({
  getSelectedScoutYearId: () => null,
  isArchiveMode: () => false,
}));

jest.mock('../../spa/modules/OfflineManager.js', () => ({
  offlineManager: {
    get isOffline() { return mockOfflineState.isOffline; },
    get campMode() { return mockOfflineState.campMode; },
    hasPendingPoints: jest.fn(() => Promise.resolve(false)),
    hasPendingAttendance: jest.fn(() => Promise.resolve(false)), queueMutation: jest.fn(),
    getTranslation: (key) => key,
  },
}));

import { API, makeApiRequestWithCache } from '../../spa/api/api-core.js';
import {
  setCachedData,
  getCachedData,
  saveOfflineData,
  getOfflineData,
} from '../../spa/indexedDB.js';
import { buildScopedCacheKey } from '../../spa/utils/OfflineCacheKeys.js';
import { planInvalidation, invalidateForWrite } from '../../spa/utils/CacheInvalidation.js';
import {
  getPageCachedRequests,
  notePageRequestPath,
  pageReadAnyOf,
  pageReadsAreReplayable,
  takeWriteState,
  resetPageReads,
  setLiveSyncClientId,
} from '../../spa/modules/live-sync/LiveSyncState.js';

const ONE_HOUR = 60 * 60 * 1000;

/**
 * Answer every request with a successful JSON body.
 * @returns {jest.Mock} The fetch mock
 */
function mockSuccessfulFetch() {
  const fetchMock = jest.fn(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => ({ success: true, data: [] }),
  }));
  global.fetch = fetchMock;
  return fetchMock;
}

/**
 * Cache what the points and attendance screens really keep.
 * @returns {Promise<Object<string, string>>} Scoped keys by name
 */
async function cacheWhatScreensKeep() {
  // Read through API.get, exactly as the screens do.
  await API.get('v1/participants', {}, { cacheKey: 'participants_v2' });
  await API.get('v1/points/report', {}, { cacheKey: 'points_report' });
  await API.get('v1/attendance', { date: '2026-09-27' }, { cacheKey: 'attendance_api_2026-09-27' });
  await API.get('v1/groups', {}, { cacheKey: 'groups' });
  await API.get('v1/organizations/settings', {}, { cacheKey: 'org_settings' });
  await API.get('v1/finance/fee-definitions', {}, { cacheKey: 'fee_definitions' });

  // Snapshots screens compose themselves and store under a bare name.
  await setCachedData('manage_points_data', { participants: [{ id: 42 }] }, ONE_HOUR);
  await setCachedData('attendance_2026-09-27', { participants: [{ id: 42 }] }, ONE_HOUR);

  return {
    participants: buildScopedCacheKey('participants_v2'),
    pointsReport: buildScopedCacheKey('points_report'),
    attendanceApi: buildScopedCacheKey('attendance_api_2026-09-27'),
    groups: buildScopedCacheKey('groups'),
    orgSettings: buildScopedCacheKey('org_settings'),
    feeDefinitions: buildScopedCacheKey('fee_definitions'),
    pointsSnapshot: buildScopedCacheKey('manage_points_data'),
    attendanceSnapshot: buildScopedCacheKey('attendance_2026-09-27'),
  };
}

beforeEach(async () => {
  mockOfflineState.isOffline = false;
  mockOfflineState.campMode = false;
  setLiveSyncClientId(null);
  resetPageReads();
  mockSuccessfulFetch();
  // Start every test from an empty cache.
  await invalidateForWrite('/api/v1/participants');
});

describe('deleting a child while connected', () => {
  test('drops them from points, attendance and every screen built from the roster', async () => {
    const keys = await cacheWhatScreensKeep();

    await API.delete('v1/participants/42');

    for (const name of ['participants', 'pointsReport', 'attendanceApi', 'groups', 'pointsSnapshot', 'attendanceSnapshot']) {
      expect([name, await getCachedData(keys[name])]).toEqual([name, null]);
    }
  });

  test("keeps the unit's configuration, which does not depend on the roster", async () => {
    const keys = await cacheWhatScreensKeep();

    await API.delete('v1/participants/42');

    expect(await getCachedData(keys.orgSettings)).not.toBeNull();
    expect(await getCachedData(keys.feeDefinitions)).not.toBeNull();
  });

  test('never touches writes queued offline', async () => {
    await saveOfflineData('updatePoints', { participant_id: 7 });

    await API.delete('v1/participants/42');

    expect(await getOfflineData()).toHaveLength(1);
  });

  test("leaves another unit's cache alone", async () => {
    const otherUnit = buildScopedCacheKey('participants_v2', 99, 'user-1');
    await setCachedData(otherUnit, { success: true }, ONE_HOUR, { sources: ['/api/v1/participants'] });

    await API.delete('v1/participants/42');

    expect(await getCachedData(otherUnit)).not.toBeNull();
  });
});

describe('the same deletion in camp mode or offline', () => {
  test.each([
    ['camp mode', () => { mockOfflineState.campMode = true; }],
    ['offline', () => { mockOfflineState.isOffline = true; }],
  ])('%s clears only the resource written', async (_label, enterMode) => {
    const keys = await cacheWhatScreensKeep();
    enterMode();

    await API.delete('v1/participants/42');

    expect(await getCachedData(keys.pointsReport)).not.toBeNull();
    expect(await getCachedData(keys.attendanceSnapshot)).not.toBeNull();
    expect(await getCachedData(keys.groups)).not.toBeNull();
  });
});

describe('writes that do not change the roster', () => {
  test('awarding points refreshes the screens showing points, not finance', async () => {
    const keys = await cacheWhatScreensKeep();
    await API.get('v1/finance/participant-fees', {}, { cacheKey: 'participant_fees' });
    const fees = buildScopedCacheKey('participant_fees');

    await API.post('v1/points', { participant_id: 7, value: 5 });

    expect(await getCachedData(keys.pointsReport)).toBeNull();
    expect(await getCachedData(keys.pointsSnapshot)).toBeNull();
    expect(await getCachedData(keys.groups)).toBeNull();
    expect(await getCachedData(fees)).not.toBeNull();
    expect(await getCachedData(keys.orgSettings)).not.toBeNull();
  });

  test('a read made with POST invalidates nothing', () => {
    expect(planInvalidation('v1/users/permissions/check')).toBeNull();
    expect(planInvalidation('v1/transfers/preview')).toBeNull();
    expect(planInvalidation('v1/ai/ask')).toBeNull();
  });

  test('reserving equipment refreshes the handout, and lending refreshes the inventory', () => {
    const reservation = planInvalidation('v1/resources/equipment/reservations/bulk');
    expect(reservation.matchesPath('/api/v1/equipment-loans/handout')).toBe(true);

    const loan = planInvalidation('v1/equipment-loans');
    expect(loan.matchesPath('/api/v1/resources/equipment')).toBe(true);
    expect(loan.matchesPath('/api/v1/participants')).toBe(false);
  });

  test("changing one's own profile does not flush the roster", () => {
    const plan = planInvalidation('v1/users/me/language');

    expect(plan.matchesPath('/api/v1/users/me')).toBe(true);
    expect(plan.matchesPath('/api/v1/participants')).toBe(false);
  });

  test('an unrelated resource is not matched by a lookalike name', () => {
    const plan = planInvalidation('v1/points');

    expect(plan.matchesPath('/api/v1/points/report')).toBe(true);
    expect(plan.matchesPath('/api/v1/points-archive')).toBe(false);
  });

  test('changing a role refreshes the announcement composer, which lists them', () => {
    const plan = planInvalidation('v1/roles/12');

    expect(plan.matchesPath('/api/v1/roles')).toBe(true);
    expect(plan.matchesPath('/api/v1/announcements')).toBe(true);
    expect(plan.matchesPath('/api/v1/participants')).toBe(false);
  });
});

describe('sending the write', () => {
  test('names the live-sync connection so the server does not echo it back', async () => {
    const fetchMock = mockSuccessfulFetch();
    setLiveSyncClientId('socket-abc');

    await API.post('v1/points', { value: 1 });
    await API.get('v1/points/leaderboard');

    const [, writeInit] = fetchMock.mock.calls[0];
    const [, readInit] = fetchMock.mock.calls[1];
    expect(writeInit.headers['X-Live-Sync-Client']).toBe('socket-abc');
    expect(readInit.headers['X-Live-Sync-Client']).toBeUndefined();
  });
});

describe('whether the screen on display must be redrawn', () => {
  test('yes when it read an entry that was cleared', async () => {
    await API.get('v1/points/report', {}, { cacheKey: 'points_report' });
    resetPageReads();
    await getCachedData('points_report');

    const invalidation = await invalidateForWrite('/api/v1/points');

    expect(pageReadAnyOf(invalidation)).toBe(true);
  });

  test('yes when it fetched an affected path without caching it', async () => {
    notePageRequestPath('/api/v1/participants/42');

    const invalidation = await invalidateForWrite('/api/v1/participants/42');

    expect(pageReadAnyOf(invalidation)).toBe(true);
  });

  test('no when it shows something else', async () => {
    notePageRequestPath('/api/v1/finance/participant-fees');

    const invalidation = await invalidateForWrite('/api/v1/points');

    expect(pageReadAnyOf(invalidation)).toBe(false);
  });
});

describe('what live sync fetches again before redrawing a screen', () => {
  test('the cached reads the screen made, as it made them, once each', async () => {
    await API.get('v1/attendance', { date: '2026-09-27' }, { cacheKey: 'attendance_api_2026-09-27' });
    await API.get('v1/attendance', { date: '2026-09-27' }, { cacheKey: 'attendance_api_2026-09-27' });
    await API.get('v1/groups', {}, { cacheKey: 'groups', forceRefresh: true });

    expect(getPageCachedRequests()).toEqual([
      {
        endpoint: 'v1/attendance',
        options: { params: { date: '2026-09-27' } },
        cacheOptions: { cacheKey: 'attendance_api_2026-09-27' },
      },
      { endpoint: 'v1/groups', options: { params: {} }, cacheOptions: { cacheKey: 'groups' } },
    ]);
    expect(pageReadsAreReplayable()).toBe(true);
  });

  test('only the latest filter read into a shared cache entry, so an older one cannot overwrite it', async () => {
    await API.get('v1/expenses', { category: 'camp' }, { cacheKey: 'budget_expenses' });
    await API.get('v1/expenses', { category: 'food' }, { cacheKey: 'budget_expenses' });

    expect(getPageCachedRequests()).toEqual([
      { endpoint: 'v1/expenses', options: { params: { category: 'food' } }, cacheOptions: { cacheKey: 'budget_expenses' } },
    ]);
  });

  test('a snapshot a screen found in the cache cannot be fetched in advance', async () => {
    await setCachedData('attendance_2026-09-27', { participants: [{ id: 42 }] }, ONE_HOUR);
    resetPageReads();

    await API.get('v1/groups', {}, { cacheKey: 'groups' });
    await getCachedData('attendance_2026-09-27');

    expect(pageReadsAreReplayable()).toBe(false);
  });

  test('a snapshot that was missing, then rebuilt from cached reads, can be', async () => {
    await getCachedData('attendance_2026-09-27');
    await API.get('v1/attendance', { date: '2026-09-27' }, { cacheKey: 'attendance_api_2026-09-27' });
    await setCachedData('attendance_2026-09-27', { participants: [{ id: 42 }] }, ONE_HOUR);

    expect(pageReadsAreReplayable()).toBe(true);
  });

  test('a cached read found in the cache can be fetched again', async () => {
    await API.get('v1/groups', {}, { cacheKey: 'groups' });
    resetPageReads();

    await API.get('v1/groups', {}, { cacheKey: 'groups' });

    expect(pageReadsAreReplayable()).toBe(true);
  });

  test('a replay the page no longer wants does not overwrite its entry, nor count as a read', async () => {
    global.fetch = jest.fn((url) => Promise.resolve({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({ success: true, data: [String(url).includes('camp') ? 'camp' : 'food'] }),
    }));
    await API.get('v1/expenses', { category: 'food' }, { cacheKey: 'budget_expenses' });
    const recorded = getPageCachedRequests();

    await makeApiRequestWithCache('v1/expenses', { params: { category: 'camp' } }, {
      cacheKey: 'budget_expenses',
      forceRefresh: true,
      isCurrent: () => false,
    });

    expect(getPageCachedRequests()).toEqual(recorded);
    expect(await getCachedData('budget_expenses')).toEqual({ success: true, data: ['food'] });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('a read no cache keeps cannot be fetched in advance', async () => {
    await API.get('v1/groups', {}, { cacheKey: 'groups' });
    await API.getNoCache('v1/walk-in-children');

    expect(pageReadsAreReplayable()).toBe(false);

    resetPageReads();

    expect(pageReadsAreReplayable()).toBe(true);
  });

  test('nothing the previous screen read', async () => {
    await API.get('v1/groups', {}, { cacheKey: 'groups' });

    resetPageReads();

    expect(getPageCachedRequests()).toEqual([]);
  });
});

describe('whether this client has handled its own writes', () => {
  test('a write the server confirmed is settled once its response is handled', async () => {
    takeWriteState();
    const sent = API.post('v1/points', { points: 1 });

    expect(takeWriteState()).toBe('pending');
    await sent;
    expect(takeWriteState()).toBe('settled');
  });

  test('a write whose response was lost is unconfirmed, once', async () => {
    takeWriteState();
    global.fetch = jest.fn(() => Promise.reject(new TypeError('Failed to fetch')));

    await API.post('v1/points', { points: 1 });

    expect(takeWriteState()).toBe('unconfirmed');
    expect(takeWriteState()).toBe('settled');
  });

  test('a refused write is unconfirmed', async () => {
    takeWriteState();
    global.fetch = jest.fn(() => Promise.resolve({
      ok: false,
      status: 403,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({ success: false, message: 'forbidden' }),
    }));

    await expect(API.post('v1/points', { points: 1 })).rejects.toThrow();

    expect(takeWriteState()).toBe('unconfirmed');
  });

  test('a write whose cache could not be cleared is unconfirmed', async () => {
    takeWriteState();
    const cacheInvalidation = jest.requireActual('../../spa/utils/CacheInvalidation.js');
    const failure = jest.spyOn(cacheInvalidation, 'invalidateForWrite').mockRejectedValueOnce(new Error('quota'));

    const result = await API.post('v1/points', { points: 1 });

    expect(result.success).toBe(true);
    expect(takeWriteState()).toBe('unconfirmed');
    failure.mockRestore();
  });
});



test('attendance changes invalidate the signed-authorization snapshot used by honors', async () => {
  await setCachedData('action_roster_2026-07-15', { attendance: [] }, ONE_HOUR);
  await invalidateForWrite('v1/attendance/departure');
  expect(await getCachedData('action_roster_2026-07-15')).toBeNull();
});

describe('the roster totals a camp preparation stored', () => {
  /** What an earlier camp preparation left: API read keys, no sources recorded. */
  async function cacheWhatAPreparationLeft() {
    await setCachedData('participants_v2', { success: true, data: [{ id: 42, total_points: 43 }] }, ONE_HOUR);
    await setCachedData('groups', { success: true, data: [{ id: 7, total_points: 27 }] }, ONE_HOUR);
    return { participants: buildScopedCacheKey('participants_v2'), groups: buildScopedCacheKey('groups') };
  }

  test('an award made while connected clears them, so the dashboard counts the new totals', async () => {
    const keys = await cacheWhatAPreparationLeft();

    await API.post('v1/points', [{ type: 'individual', id: 42, points: 1 }]);

    expect(await getCachedData(keys.participants)).toBeNull();
    expect(await getCachedData(keys.groups)).toBeNull();
  });

  test('in camp mode an award keeps them: they are the only copy of the roster', async () => {
    const keys = await cacheWhatAPreparationLeft();
    mockOfflineState.campMode = true;

    await API.post('v1/points', [{ type: 'individual', id: 42, points: 1 }]);

    expect(await getCachedData(keys.participants)).not.toBeNull();
  });
});
