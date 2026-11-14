/** @jest-environment jsdom */
jest.mock('../../spa/utils/DebugUtils.js', () => ({ debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn() }));
jest.mock('../../spa/config/offline-reads.js', () => ({ OFFLINE_READS: { BASELINE_MIN_INTERVAL_MS: 900000, BASELINE_MAX_CAMPS: 2, SIGNED_IN_EVENT: 'wampums:signedIn' } }));
jest.mock('../../spa/indexedDB.js', () => ({ pruneOfflineCache: jest.fn(() => Promise.resolve(0)) }));
jest.mock('../../spa/api/api-tasks.js', () => ({ getMyTasks: jest.fn() }));
jest.mock('../../spa/api/api-endpoints.js', () => ({ getNextMeetingInfo: jest.fn(), getParentContactList: jest.fn() }));
jest.mock('../../spa/api/api-volunteer-space.js', () => ({ getVolunteerSpace: jest.fn(), getVolunteerSpaceCamp: jest.fn() }));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  hasPermission: jest.fn(), hasAnyPermission: jest.fn(), hasOrganizationScope: jest.fn(),
}));
jest.mock('../../spa/utils/OfflineCacheKeys.js', () => ({ buildScopedCacheKey: jest.fn(() => '|scope:user:leader-1|org:1') }));
jest.mock('../../spa/modules/scout-year/ScoutYearContext.js', () => ({ isArchiveMode: jest.fn(() => false) }));

const { OfflineBaseline } = require('../../spa/modules/offline/OfflineBaseline.js');
const { pruneOfflineCache } = require('../../spa/indexedDB.js');
const { getMyTasks } = require('../../spa/api/api-tasks.js');
const { getNextMeetingInfo, getParentContactList } = require('../../spa/api/api-endpoints.js');
const { getVolunteerSpace, getVolunteerSpaceCamp } = require('../../spa/api/api-volunteer-space.js');
const { hasPermission, hasAnyPermission, hasOrganizationScope } = require('../../spa/utils/PermissionUtils.js');
const { isArchiveMode } = require('../../spa/modules/scout-year/ScoutYearContext.js');

const online = (value) => Object.defineProperty(navigator, 'onLine', { configurable: true, value });
let granted;

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  localStorage.setItem('jwtToken', 'session');
  localStorage.setItem('userId', 'leader-1');
  online(true);
  granted = new Set(['tasks.view', 'meetings.view', 'reports.view', 'volunteer_space.view']);
  hasPermission.mockImplementation((key) => granted.has(key));
  hasAnyPermission.mockImplementation((...keys) => keys.some((key) => granted.has(key)));
  hasOrganizationScope.mockReturnValue(true);
  isArchiveMode.mockReturnValue(false);
  getMyTasks.mockResolvedValue({ success: true, data: [] });
  getNextMeetingInfo.mockResolvedValue({ success: true, data: {} });
  getParentContactList.mockResolvedValue({ success: true, contacts: [] });
  getVolunteerSpace.mockResolvedValue({ success: true, data: { camps: [{ activity_id: 4 }, { activity_id: 9 }, { activity_id: 12 }] } });
  getVolunteerSpaceCamp.mockResolvedValue({ success: true });
});

test('a signed-in leader online gets tasks, the next meeting, parent contacts and volunteer camps prepared, read fresh', async () => {
  const prepared = await new OfflineBaseline().refresh();

  expect(prepared).toEqual(['tasks', 'next_meeting', 'parent_contacts', 'volunteer_space']);
  expect(getMyTasks).toHaveBeenCalledWith({ forceRefresh: true });
  expect(getNextMeetingInfo).toHaveBeenCalledWith({ forceRefresh: true });
  expect(getParentContactList).toHaveBeenCalledWith({ forceRefresh: true });
  expect(getVolunteerSpaceCamp.mock.calls).toEqual([[4], [9]]);
});

test('a parent without unit reports is never sent the contact list read the server would refuse', async () => {
  granted = new Set(['meetings.view']);
  hasOrganizationScope.mockReturnValue(false);

  expect(await new OfflineBaseline().refresh()).toEqual(['next_meeting']);
  expect(getParentContactList).not.toHaveBeenCalled();
  expect(getMyTasks).not.toHaveBeenCalled();
});

test('nothing is read offline, signed out, or while an archived year is shown', async () => {
  online(false);
  expect(await new OfflineBaseline().refresh()).toBeNull();
  online(true);
  localStorage.removeItem('jwtToken');
  expect(await new OfflineBaseline().refresh()).toBeNull();
  localStorage.setItem('jwtToken', 'session');
  isArchiveMode.mockReturnValue(true);
  expect(await new OfflineBaseline().refresh()).toBeNull();
  expect(getMyTasks).not.toHaveBeenCalled();
});

test('a complete preparation is not repeated within the interval, unless forced by a sign-in', async () => {
  let now = 0;
  const baseline = new OfflineBaseline({ now: () => now });
  await baseline.refresh();
  now = 60000;
  expect(await baseline.refresh()).toBeNull();
  expect(getMyTasks).toHaveBeenCalledTimes(1);
  await baseline.refresh({ force: true });
  expect(getMyTasks).toHaveBeenCalledTimes(2);
  now = 60000 + 900000;
  await baseline.refresh();
  expect(getMyTasks).toHaveBeenCalledTimes(3);
});

test('a failed read is retried at the next wake rather than waiting for the interval', async () => {
  const baseline = new OfflineBaseline({ now: () => 0 });
  getNextMeetingInfo.mockRejectedValueOnce(new Error('network'));
  expect(await baseline.refresh()).toEqual(['tasks', 'parent_contacts', 'volunteer_space']);
  expect(await baseline.refresh()).toEqual(['tasks', 'next_meeting', 'parent_contacts', 'volunteer_space']);
});

test('coming back online prepares again and old copies are pruned at start', async () => {
  const baseline = new OfflineBaseline({ now: () => 0 });
  baseline.start();
  await Promise.resolve();
  expect(pruneOfflineCache).toHaveBeenCalledTimes(1);
  await baseline.task;
  expect(getMyTasks).toHaveBeenCalledTimes(1);
  baseline.lastRun.clear();
  window.dispatchEvent(new Event('online'));
  await baseline.task;
  expect(getMyTasks).toHaveBeenCalledTimes(2);
  baseline.stop();
});

test('signing in prepares at once, even right after a previous preparation', async () => {
  const baseline = new OfflineBaseline({ now: () => 0 });
  baseline.start();
  await baseline.task;
  window.dispatchEvent(new CustomEvent('wampums:signedIn'));
  await baseline.task;
  expect(getMyTasks).toHaveBeenCalledTimes(2);
  baseline.stop();
});
