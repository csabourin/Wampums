/** @jest-environment jsdom */
jest.mock('../../spa/utils/DebugUtils.js', () => ({ debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn() }));
jest.mock('../../spa/config.js', () => ({ CONFIG: { API_BASE_URL: 'https://unit.example.test', CACHE_DURATION: { MEDIUM: 1000 } } }));
jest.mock('../../spa/api/api-helpers.js', () => ({
  getCurrentOrganizationId: jest.fn(() => 1),
  getCurrentUserId: jest.fn(() => 'first-user'),
  getAuthHeader: () => ({}),
}));
jest.mock('../../spa/indexedDB.js', () => ({
  setCachedData: jest.fn(), getCachedData: jest.fn(() => Promise.resolve(null)),
  getCachedDataIgnoreExpiration: jest.fn(() => Promise.resolve(null)), clearCachedApiPaths: jest.fn(),
}));
jest.mock('../../spa/utils/PerformanceUtils.js', () => ({ PerformanceMonitor: { logAPICall: jest.fn() } }));
jest.mock('../../spa/modules/OfflineManager.js', () => ({
  offlineManager: { isOffline: false, queueMutation: jest.fn(), getTranslation: (key) => key },
}));
jest.mock('../../spa/modules/scout-year/ScoutYearContext.js', () => ({ isArchiveMode: () => false, getSelectedScoutYearId: () => null }));
jest.mock('../../spa/modules/live-sync/LiveDataSync.js', () => ({ isLiveSyncActive: () => false }));

import { API, makeApiRequest } from '../../spa/api/api-core.js';
import { getCurrentOrganizationId, getCurrentUserId } from '../../spa/api/api-helpers.js';

function response(data) {
  return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: () => Promise.resolve({ success: true, data }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  getCurrentOrganizationId.mockReturnValue(1);
  getCurrentUserId.mockReturnValue('first-user');
  global.fetch = jest.fn();
});

test('simultaneous identical reads share one network request', async () => {
  global.fetch.mockResolvedValue(response(['child']));
  const results = await Promise.all([API.get('v1/participants'), API.get('v1/participants')]);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(results[0]).toEqual(results[1]);
});

test.each(['user', 'organization'])('a new %s never receives the previous session in-flight response', async (scope) => {
  let finishFirst;
  global.fetch.mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }));
  const first = API.get('v1/participants');
  // Let the asynchronous cache lookup start the first request.
  await Promise.resolve();
  await Promise.resolve();
  expect(global.fetch).toHaveBeenCalledTimes(1);
  if (scope === 'user') {
    getCurrentUserId.mockReturnValue('second-user');
  } else {
    getCurrentOrganizationId.mockReturnValue(2);
  }
  global.fetch.mockResolvedValueOnce(response(['second-session']));
  const second = API.get('v1/participants');
  finishFirst(response(['first-session']));
  expect((await second).data).toEqual(['second-session']);
  expect((await first).data).toEqual(['first-session']);
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

test('an older read finishing does not discard the pending forced refresh', async () => {
  let finishFirst;
  let finishRefresh;
  global.fetch
    .mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }))
    .mockImplementationOnce(() => new Promise((resolve) => { finishRefresh = resolve; }));
  const first = API.get('v1/participants');
  await Promise.resolve();
  await Promise.resolve();
  const refresh = API.get('v1/participants', {}, { forceRefresh: true });
  finishFirst(response(['old']));
  await first;
  const follower = API.get('v1/participants');
  finishRefresh(response(['fresh']));
  expect((await follower).data).toEqual(['fresh']);
  await refresh;
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

test('a cancelled read is not retried or treated as a connectivity failure', async () => {
  global.fetch.mockRejectedValue(new DOMException('Cancelled', 'AbortError'));
  await expect(makeApiRequest('v1/participants')).rejects.toMatchObject({ name: 'AbortError', isNetworkError: false });
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('field validation errors survive the complete request pipeline', async () => {
  const errors = [{ path: 'email', msg: 'invalid_email' }];
  global.fetch.mockResolvedValue({
    ok: false, status: 400, headers: { get: () => 'application/json' },
    json: () => Promise.resolve({ message: 'Validation failed', errors }),
  });
  await expect(API.post('v1/example', {})).rejects.toMatchObject({ status: 400, errors });
});

test('a demo account\'s refused write keeps the reason, so the screen can say the demo is read-only', async () => {
  global.fetch.mockResolvedValue({
    ok: false, status: 403, headers: { get: () => 'application/json' },
    json: () => Promise.resolve({ success: false, message: 'Demo accounts have read-only access.', required: [], missing: [], isDemo: true }),
  });
  await expect(API.post('v1/attendance', {})).rejects.toMatchObject({ status: 403, isDemo: true });
});
