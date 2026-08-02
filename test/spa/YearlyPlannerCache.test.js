/**
 * @jest-environment jsdom
 *
 * Guards the defect that made the yearly planner look broken: every read in
 * api-yearly-planner.js goes through the IndexedDB API cache, so a mutation that
 * does not invalidate leaves the SPA rendering pre-write state and the feature
 * appears to do nothing.
 *
 * The mutation list is table-driven on purpose — a new mutating export added
 * without invalidation fails here instead of shipping.
 */

// Mocks are declared inside the factories: jest.mock is hoisted above every
// const in this file, so a factory closing over one would hit its TDZ.
jest.mock('../../spa/indexedDB.js', () => ({
  clearYearlyPlannerCaches: jest.fn(() => Promise.resolve())
}));

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn()
}));

// spa/config.js uses import.meta, which jest cannot parse — stub it like the
// other SPA suites do.
jest.mock('../../spa/config.js', () => ({
  CONFIG: { CACHE_DURATION: { SHORT: 1, MEDIUM: 2, LONG: 3 } }
}));

jest.mock('../../spa/api/api-core.js', () => ({
  API: {
    get: jest.fn(),
    getNoCache: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn()
  }
}));

import * as planner from '../../spa/api/api-yearly-planner.js';
import { API as mockApi } from '../../spa/api/api-core.js';
import { clearYearlyPlannerCaches as mockClearYearlyPlannerCaches } from '../../spa/indexedDB.js';
import { CONFIG } from '../../spa/config.js';

beforeEach(() => {
  jest.clearAllMocks();
  mockClearYearlyPlannerCaches.mockResolvedValue(undefined);
  mockApi.get.mockResolvedValue({ success: true, data: [] });
  mockApi.getNoCache.mockResolvedValue({ success: true, data: [] });
  mockApi.post.mockResolvedValue({ success: true, data: {} });
  mockApi.put.mockResolvedValue({ success: true, data: {} });
  mockApi.patch.mockResolvedValue({ success: true, data: {} });
  mockApi.delete.mockResolvedValue({ success: true, data: null });
});

/**
 * Every mutating export, with arguments and the invalidation scope it must request.
 * `scope` is asserted loosely: only the keys listed must be true.
 */
const MUTATIONS = [
  ['createYearPlan', [{ title: 'Plan' }], { includeMeetingPrep: true }],
  ['updateYearPlan', [1, { title: 'Plan' }], { includeMeetingPrep: true }],
  ['deleteYearPlan', [1], { includeMeetingPrep: true }],
  ['createPeriod', [1, { title: 'P' }], {}],
  ['updatePeriod', [1, { title: 'P' }], {}],
  ['deletePeriod', [1], {}],
  ['createObjective', [1, { title: 'O' }], {}],
  ['updateObjective', [1, { title: 'O' }], {}],
  ['deleteObjective', [1], {}],
  ['updateYearPlanMeeting', [1, { theme: 'T' }], { includeMeetingPrep: true }],
  ['createPlanMeeting', [1, { meeting_date: '2025-10-17' }], { includeMeetingPrep: true, includeActivities: true }],
  ['deletePlanMeeting', [1], { includeMeetingPrep: true, includeActivities: true }],
  ['unlinkActivityEvent', [1], { includeMeetingPrep: true, includeActivities: true }],
  ['createActivityEventFromMeeting', [1, {}], { includeMeetingPrep: true, includeActivities: true }],
  ['addMeetingActivity', [1, { name: 'A' }], { includeMeetingPrep: true }],
  ['updateMeetingActivity', [1, { name: 'A' }], { includeMeetingPrep: true }],
  ['deleteMeetingActivity', [1], { includeMeetingPrep: true }],
  ['updateMeetingDay', [1, 0, { title: 'Day' }], { includeMeetingPrep: true }],
  ['copyMeetingSchedule', [1, 2], { includeMeetingPrep: true }],
  ['batchPlaceActivity', [1, { meeting_ids: [1], activity: { name: 'A' } }], { includeMeetingPrep: true }],
  ['deleteSeries', ['ser-1'], { includeMeetingPrep: true }],
  ['updateSeries', ['ser-1', { name: 'Updated' }], { includeMeetingPrep: true }],
  ['createLibraryActivity', [{ name: 'A' }], {}],
  ['updateLibraryActivity', [1, { name: 'A' }], {}],
  ['deleteLibraryActivity', [1], {}],
  ['grantAchievements', [{ objective_id: 1 }], {}],
  ['removeAchievement', [1], {}],
  ['createDistributionRule', [1, {}], {}],
  ['deleteDistributionRule', [1], {}],
  ['createReminder', [1, {}], { includeMeetingPrep: true }]
];

describe('yearly planner cache invalidation', () => {
  test.each(MUTATIONS)('%s invalidates the planner cache', async (name, args) => {
    await planner[name](...args);
    expect(mockClearYearlyPlannerCaches).toHaveBeenCalledTimes(1);
  });

  test.each(MUTATIONS.filter(([, , scope]) => Object.keys(scope).length > 0))(
    '%s requests the right invalidation scope',
    async (name, args, scope) => {
      await planner[name](...args);
      expect(mockClearYearlyPlannerCaches).toHaveBeenCalledWith(
        expect.objectContaining(scope)
      );
    }
  );

  test('every mutating export is covered by this table', () => {
    // Exports that only read; everything else must appear in MUTATIONS.
    const readOnly = [
      'getYearPlans', 'getYearPlan', 'getPeriods', 'getObjectives',
      'getYearPlanMeeting', 'getMeetingSchedule', 'getActivityLibrary', 'getAchievements',
      'getDistributionRules', 'getReminders', 'getMeetingReminders'
    ];
    const covered = new Set([...readOnly, ...MUTATIONS.map(([name]) => name)]);
    const uncovered = Object.keys(planner).filter((name) => !covered.has(name));
    expect(uncovered).toEqual([]);
  });

  test('a failing cache clear does not fail the mutation', async () => {
    mockClearYearlyPlannerCaches.mockRejectedValueOnce(new Error('IndexedDB unavailable'));
    await expect(planner.createYearPlan({ title: 'Plan' })).resolves.toEqual({
      success: true,
      data: {}
    });
  });
});

describe('yearly planner reads', () => {
  test('reads stay cached but with a short TTL', async () => {
    await planner.getYearPlans();
    expect(mockApi.get).toHaveBeenCalledWith(
      'v1/yearly-planner/plans',
      {},
      { forceRefresh: false, cacheDuration: CONFIG.CACHE_DURATION.SHORT }
    );
  });

  test('forceRefresh is passed through for explicit refreshes', async () => {
    await planner.getYearPlan(7, { forceRefresh: true });
    expect(mockApi.get).toHaveBeenCalledWith(
      'v1/yearly-planner/plans/7',
      {},
      { forceRefresh: true, cacheDuration: CONFIG.CACHE_DURATION.SHORT }
    );
  });

  test('reads never invalidate', async () => {
    await planner.getYearPlans();
    await planner.getActivityLibrary({ category: 'games' });
    expect(mockClearYearlyPlannerCaches).not.toHaveBeenCalled();
  });
});
