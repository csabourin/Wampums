/** @jest-environment jsdom */
jest.mock('../../spa/utils/DebugUtils.js', () => ({ debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn() }));
jest.mock('../../spa/config.js', () => ({ CONFIG: { API_BASE_URL: 'https://unit.example.test', CACHE_DURATION: { MEDIUM: 1000 } } }));
jest.mock('../../spa/api/api-helpers.js', () => ({
  getCurrentOrganizationId: jest.fn(() => 1),
  getCurrentUserId: jest.fn(() => 'user'),
  getAuthHeader: () => {
    const token = globalThis.localStorage.getItem('jwtToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
  },
}));
jest.mock('../../spa/indexedDB.js', () => ({
  setCachedData: jest.fn(), getCachedData: jest.fn(() => Promise.resolve(null)),
  getCachedDataIgnoreExpiration: jest.fn(() => Promise.resolve(null)), clearCachedApiPaths: jest.fn(),
}));
jest.mock('../../spa/utils/PerformanceUtils.js', () => ({ PerformanceMonitor: { logAPICall: jest.fn() } }));
jest.mock('../../spa/modules/OfflineManager.js', () => ({
  offlineManager: { isOffline: false, hasPendingPoints: jest.fn(() => Promise.resolve(false)), hasPendingAttendance: jest.fn(() => Promise.resolve(false)), hasPendingEquipmentLoans: jest.fn(() => Promise.resolve(false)), queueMutation: jest.fn(), getTranslation: (key) => key },
}));
jest.mock('../../spa/modules/scout-year/ScoutYearContext.js', () => ({ isArchiveMode: () => false, getSelectedScoutYearId: () => null }));
jest.mock('../../spa/modules/live-sync/LiveDataSync.js', () => ({ isLiveSyncActive: () => false }));
jest.mock('../../spa/utils/ClientCleanupUtils.js', () => ({
  clearAllClientData: jest.fn(() => {
    globalThis.localStorage.removeItem('jwtToken');
    return Promise.resolve();
  }),
}));

import { API } from '../../spa/api/api-core.js';
import { clearAllClientData } from '../../spa/utils/ClientCleanupUtils.js';

const unauthorized = () => ({
  ok: false,
  status: 401,
  statusText: 'Unauthorized',
  headers: { get: () => 'application/json' },
  json: () => Promise.resolve({ success: false, message: 'Authentication required' }),
});
const ok = (data) => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: () => Promise.resolve({ success: true, data }) });

/** jsdom reports an attempted page change (the redirect to /login) as not implemented. */
function navigationAttempts(consoleError) {
  return consoleError.mock.calls.filter((args) => String(args[0]?.message || args[0]).includes('navigation'));
}

/** Let pending promise callbacks (the request leaving, the cleanup import) run. */
async function settle() {
  for (let step = 0; step < 10; step++) {
    // eslint-disable-next-line no-await-in-loop -- each tick lets one more callback run
    await Promise.resolve();
  }
}

let consoleError;

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  window.history.pushState({}, '', '/dashboard');
  global.fetch = jest.fn();
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

test('a refusal for an earlier session leaves the person now signed in alone', async () => {
  localStorage.setItem('jwtToken', 'session-a');
  let answerA;
  global.fetch.mockImplementationOnce(() => new Promise((resolve) => { answerA = resolve; }));
  const requestA = API.post('v1/points', { points: 1 });
  await settle();
  expect(global.fetch).toHaveBeenCalledTimes(1);

  localStorage.setItem('jwtToken', 'session-b');
  answerA(unauthorized());

  await expect(requestA).rejects.toMatchObject({ status: 401 });
  expect(localStorage.getItem('jwtToken')).toBe('session-b');
  expect(clearAllClientData).not.toHaveBeenCalled();
  expect(navigationAttempts(consoleError)).toHaveLength(0);
});

test('a refusal for the current session still signs the person out and sends them to sign in', async () => {
  localStorage.setItem('jwtToken', 'session-a');
  global.fetch.mockResolvedValueOnce(unauthorized());

  await expect(API.post('v1/points', { points: 1 })).rejects.toMatchObject({ status: 401 });

  expect(clearAllClientData).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem('jwtToken')).toBeNull();
  expect(navigationAttempts(consoleError)).toHaveLength(1);
});

test('someone who signs in while the old session is being cleared is not sent back to sign in', async () => {
  localStorage.setItem('jwtToken', 'session-a');
  clearAllClientData.mockImplementationOnce(() => {
    localStorage.removeItem('jwtToken');
    // The new person signs in before the asynchronous cleanup finishes.
    localStorage.setItem('jwtToken', 'session-b');
    return Promise.resolve();
  });
  global.fetch.mockResolvedValueOnce(unauthorized());

  await expect(API.post('v1/points', { points: 1 })).rejects.toMatchObject({ status: 401 });

  expect(localStorage.getItem('jwtToken')).toBe('session-b');
  expect(navigationAttempts(consoleError)).toHaveLength(0);
});

test('reads still in flight for the previous session are abandoned when another session starts', async () => {
  localStorage.setItem('jwtToken', 'session-a');
  let readA;
  global.fetch.mockImplementationOnce((_url, config) => new Promise((resolve, reject) => {
    readA = config;
    config.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  }));
  const pendingRead = API.getNoCache('v1/participants');
  await settle();

  localStorage.setItem('jwtToken', 'session-b');
  global.fetch.mockResolvedValueOnce(ok(['session-b']));
  const readB = await API.getNoCache('v1/participants');

  expect(readA.signal.aborted).toBe(true);
  await expect(pendingRead).rejects.toMatchObject({ name: 'AbortError' });
  expect(readB.data).toEqual(['session-b']);
  expect(localStorage.getItem('jwtToken')).toBe('session-b');
});

test('signing in does not abandon reads started before anyone was signed in', async () => {
  let publicRead;
  let answerPublic;
  global.fetch.mockImplementationOnce((_url, config) => new Promise((resolve) => {
    publicRead = config;
    answerPublic = resolve;
  }));
  const pendingRead = API.getNoCache('v1/public/organization-settings');
  await settle();

  localStorage.setItem('jwtToken', 'session-a');
  global.fetch.mockResolvedValueOnce(ok([]));
  await API.getNoCache('v1/participants');
  answerPublic(ok({ name: 'Unit' }));

  expect(publicRead.signal.aborted).toBe(false);
  expect((await pendingRead).data).toEqual({ name: 'Unit' });
});

test('a file still downloading for the previous session is abandoned when another session starts', async () => {
  localStorage.setItem('jwtToken', 'session-a');
  let download;
  global.fetch.mockImplementationOnce((_url, config) => new Promise((resolve, reject) => {
    download = config;
    config.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  }));
  const pendingFile = API.getFile('v1/camp-plans/camps/12/versions/1/pdf');
  await settle();

  localStorage.setItem('jwtToken', 'session-b');
  global.fetch.mockResolvedValueOnce(ok([]));
  await API.getNoCache('v1/participants');

  expect(download.signal.aborted).toBe(true);
  await expect(pendingFile).rejects.toMatchObject({ name: 'AbortError' });
});
