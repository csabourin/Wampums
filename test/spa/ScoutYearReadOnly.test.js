/**
 * @jest-environment jsdom
 */

/**
 * Archived years are read-only.
 *
 * The guard lives in `makeApiRequest` rather than only in the interface,
 * because every screen goes through that one function. A single button someone
 * forgot to disable would otherwise write last year's data into the current
 * season — silently, since the server stamps writes with the active year no
 * matter which year the page was showing.
 */

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn()
}));

jest.mock('../../spa/config.js', () => ({
  CONFIG: { API_BASE_URL: 'https://unit.wampums.app' }
}));

jest.mock('../../spa/jwt-helper.js', () => ({
  getOrganizationIdFromJWT: () => null,
  getUserInfoFromJWT: () => ({})
}));

jest.mock('../../spa/indexedDB.js', () => ({
  setCachedData: jest.fn(),
  getCachedData: jest.fn(() => Promise.resolve(null)),
  getCachedDataIgnoreExpiration: jest.fn(() => Promise.resolve(null))
}));

jest.mock('../../spa/utils/PerformanceUtils.js', () => ({
  PerformanceMonitor: { logAPICall: jest.fn() }
}));

jest.mock('../../spa/modules/OfflineManager.js', () => ({
  offlineManager: {
    isOffline: false,
    queueMutation: jest.fn(),
    getTranslation: (key) => key
  }
}));

import { makeApiRequest } from '../../spa/api/api-core.js';
import { setSelectedScoutYear } from '../../spa/modules/scout-year/ScoutYearContext.js';

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('currentOrganizationId', '12');
  localStorage.setItem('jwtToken', 'token');
  global.fetch = jest.fn(() => Promise.resolve({
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: () => Promise.resolve({ success: true, data: [] })
  }));
});

test('reads are allowed while consulting an archive, and carry the year', async () => {
  setSelectedScoutYear({ id: 4, label: '2024-2025', status: 'closed' });

  await makeApiRequest('v1/participants');

  expect(global.fetch).toHaveBeenCalledTimes(1);
  const [, config] = global.fetch.mock.calls[0];
  expect(config.headers['x-scout-year-id']).toBe('4');
});

test.each(['POST', 'PUT', 'PATCH', 'DELETE'])('%s is refused in an archive', async (method) => {
  setSelectedScoutYear({ id: 4, label: '2024-2025', status: 'closed' });

  await expect(makeApiRequest('v1/participants', { method, body: { name: 'x' } }))
    .rejects.toMatchObject({ status: 403, isArchiveReadOnly: true });

  // Refused before anything left the browser.
  expect(global.fetch).not.toHaveBeenCalled();
});

test('writes go through normally on the current year', async () => {
  await makeApiRequest('v1/participants', { method: 'POST', body: { name: 'x' } });

  expect(global.fetch).toHaveBeenCalledTimes(1);
  const [, config] = global.fetch.mock.calls[0];
  expect(config.method).toBe('POST');
  expect(config.headers['x-scout-year-id']).toBeUndefined();
});
