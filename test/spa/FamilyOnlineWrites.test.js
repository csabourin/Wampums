/** @jest-environment jsdom */

jest.mock('../../spa/utils/DebugUtils.js', () => ({ debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn() }));
jest.mock('../../spa/config.js', () => ({
  CONFIG: {
    API_BASE_URL: 'https://unit.example.test',
    ONLINE_REQUIRED_MUTATION_RESOURCES: ['parent-invitations', 'parent-onboarding', 'walk-in-children', 'family-links', 'family-link-requests'],
  },
}));
jest.mock('../../spa/jwt-helper.js', () => ({ getOrganizationIdFromJWT: () => null, getUserInfoFromJWT: () => ({}) }));
jest.mock('../../spa/indexedDB.js', () => ({
  setCachedData: jest.fn(), getCachedData: jest.fn(() => Promise.resolve(null)),
  getCachedDataIgnoreExpiration: jest.fn(() => Promise.resolve(null)),
  clearCachedApiPaths: jest.fn(), clearCacheEntriesWhere: jest.fn(),
}));
jest.mock('../../spa/utils/PerformanceUtils.js', () => ({ PerformanceMonitor: { logAPICall: jest.fn() } }));
jest.mock('../../spa/modules/OfflineManager.js', () => ({
  offlineManager: { isOffline: false, queueMutation: jest.fn(), getTranslation: (key) => key },
}));

import { API, makeApiRequest } from '../../spa/api/api-core.js';
import { offlineManager } from '../../spa/modules/OfflineManager.js';
import { setSelectedScoutYear } from '../../spa/modules/scout-year/ScoutYearContext.js';

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  setSelectedScoutYear(null);
  offlineManager.isOffline = false;
  global.fetch = jest.fn(() => Promise.resolve({
    ok: true, status: 200, headers: { get: () => 'application/json' },
    json: () => Promise.resolve({ success: true, data: {} }),
  }));
});

test.each(['parent-invitations', 'parent-onboarding/children', 'walk-in-children', 'family-link-requests', 'family-links/3'])(
  'offline %s writes are refused before sending or queueing', async (path) => {
    offlineManager.isOffline = true;
    await expect(makeApiRequest(`v1/${path}`, { method: 'POST', body: {} })).rejects.toMatchObject({ code: 'online_required' });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(offlineManager.queueMutation).not.toHaveBeenCalled();
  });

test('loss of the response never queues a second invitation creation', async () => {
  global.fetch.mockRejectedValue(new TypeError('network lost'));
  await expect(API.post('v1/parent-invitations', { email: 'family@example.test' }))
    .rejects.toMatchObject({ code: 'operation_unconfirmed' });
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(offlineManager.queueMutation).not.toHaveBeenCalled();
});

test('registration paperwork can request confirmed online saving', async () => {
  offlineManager.isOffline = true;
  await expect(API.post('v1/forms/submissions', {}, {}, { queueOffline: false }))
    .rejects.toMatchObject({ code: 'online_required' });
  expect(offlineManager.queueMutation).not.toHaveBeenCalled();
});

test('ordinary offline attendance still queues normally', async () => {
  offlineManager.isOffline = true;
  expect(await API.post('v1/attendance', { participant_id: 1 })).toMatchObject({ success: true, queued: true });
  expect(offlineManager.queueMutation).toHaveBeenCalledTimes(1);
});
