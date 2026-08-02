/**
 * @jest-environment jsdom
 *
 * Reproduces the reported symptom: "when I create a yearly plan, it lets me
 * fill a form but nothing comes out of it."
 *
 * Runs the real api-core cache layer over a real (fake) IndexedDB with only
 * fetch stubbed, so the assertion is about the actual read-write-read cycle
 * rather than about mocks agreeing with each other. Without invalidation the
 * second read is served from the pre-write cache and the new plan is invisible.
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
  CONFIG: {
    API_BASE_URL: 'http://localhost:5000',
    CACHE_DURATION: { SHORT: 300000, MEDIUM: 1800000, LONG: 86400000 }
  },
  getStorageKey: (key) => key
}));

// OfflineCacheKeys derives the cache scope from here, so this is the only
// identity mock needed for keys to be built the way the app builds them.
jest.mock('../../spa/api/api-helpers.js', () => ({
  getCurrentOrganizationId: () => 3,
  getCurrentUserId: () => 'user-abc',
  getAuthHeader: () => ({ Authorization: 'Bearer test' })
}));

jest.mock('../../spa/utils/PerformanceUtils.js', () => ({
  PerformanceMonitor: {
    start: jest.fn(),
    end: jest.fn(),
    measure: jest.fn(),
    logAPICall: jest.fn()
  }
}));

jest.mock('../../spa/modules/OfflineManager.js', () => ({
  offlineManager: {
    isOnline: true,
    campMode: false,
    queueRequest: jest.fn()
  }
}));

jest.mock('../../spa/modules/scout-year/ScoutYearContext.js', () => ({
  isArchiveMode: () => false,
  getSelectedScoutYearId: () => null
}));

import { getYearPlans, createYearPlan } from '../../spa/api/api-yearly-planner.js';

const EXISTING_PLAN = { id: 1, title: 'Année 2024-2025', meeting_count: 32 };
const NEW_PLAN = { id: 2, title: 'Année 2025-2026', meeting_count: 34 };

let serverPlans;

beforeEach(() => {
  global.indexedDB = new IDBFactory();
  serverPlans = [EXISTING_PLAN];

  // jsdom's navigator.onLine is read-only and already true.
  global.fetch = jest.fn(async (url, options = {}) => {
    const method = options.method || 'GET';

    if (method === 'POST' && String(url).includes('/yearly-planner/plans')) {
      serverPlans = [...serverPlans, NEW_PLAN];
      return jsonResponse({ success: true, data: NEW_PLAN, message: 'Year plan created' }, 201);
    }
    if (method === 'GET' && String(url).includes('/yearly-planner/plans')) {
      return jsonResponse({ success: true, data: serverPlans });
    }
    return jsonResponse({ success: false, message: 'unexpected request' }, 500);
  });
});

afterEach(() => {
  delete global.fetch;
});

/**
 * Build a fetch Response-like object.
 * @param {Object} body - JSON body
 * @param {number} [status=200] - HTTP status
 * @returns {Object} Response-like object
 */
function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

/** @returns {number} How many GETs for the plan list have hit the network */
function planListFetchCount() {
  return global.fetch.mock.calls.filter(
    ([url, options]) => (options?.method || 'GET') === 'GET' && String(url).includes('/yearly-planner/plans')
  ).length;
}

describe('creating a year plan', () => {
  test('the new plan is visible on the next load', async () => {
    // The user opens the planner: the empty-ish list is now cached.
    const before = await getYearPlans();
    expect(before.data).toHaveLength(1);

    await createYearPlan({ title: NEW_PLAN.title, start_date: '2025-09-01', end_date: '2026-06-30' });

    // The module reloads exactly as YearlyPlanner.handleCreatePlan does.
    const after = await getYearPlans();

    expect(after.data).toHaveLength(2);
    expect(after.data.map((plan) => plan.title)).toContain(NEW_PLAN.title);
  });

  test('the reload really goes to the server, not the stale cache', async () => {
    await getYearPlans();
    expect(planListFetchCount()).toBe(1);

    // Proves the first read was cached: a second read without any mutation
    // must not hit the network.
    await getYearPlans();
    expect(planListFetchCount()).toBe(1);

    await createYearPlan({ title: NEW_PLAN.title, start_date: '2025-09-01', end_date: '2026-06-30' });
    await getYearPlans();

    expect(planListFetchCount()).toBe(2);
  });

  test('deleting a plan removes it from the next load', async () => {
    await getYearPlans();

    const { deleteYearPlan } = await import('../../spa/api/api-yearly-planner.js');
    global.fetch.mockImplementationOnce(async () => {
      serverPlans = serverPlans.filter((plan) => plan.id !== EXISTING_PLAN.id);
      return jsonResponse({ success: true, data: null, message: 'deleted' });
    });
    await deleteYearPlan(EXISTING_PLAN.id);

    const after = await getYearPlans();
    expect(after.data).toHaveLength(0);
  });
});
