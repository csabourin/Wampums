/** @jest-environment jsdom */
jest.mock('../../spa/config.js', () => ({ CONFIG: {}, getStorageKey: (key) => key }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({ debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn() }));
jest.mock('../../spa/config/offline-reads.js', () => ({
  OFFLINE_READS: {
    BASELINE_MIN_INTERVAL_MS: 900000,
    BASELINE_ENTRY_MAX_AGE_MS: 1800000,
    BASELINE_CONCURRENCY: 2,
    BASELINE_START_DELAY_MS: 3000,
    BASELINE_MAX_CAMPS: 2,
    BASELINE_ACTIVITY_LOOKAHEAD_DAYS: 30,
    BASELINE_MAX_ACTIVITIES: 2,
    BASELINE_DAYS_AHEAD: 3,
    SIGNED_IN_EVENT: 'wampums:signedIn',
  },
}));
jest.mock('../../spa/indexedDB.js', () => ({
  pruneOfflineCache: jest.fn(() => Promise.resolve(0)),
  getCachedConfirmedAt: jest.fn(() => Promise.resolve(null)),
}));
jest.mock('../../spa/api/api-core.js', () => ({ API: { get: jest.fn(), getNoCache: jest.fn() } }));
jest.mock('../../spa/api/api-tasks.js', () => ({ getMyTasks: jest.fn() }));
jest.mock('../../spa/api/api-endpoints.js', () => ({
  getAttendance: jest.fn(), getAttendanceDates: jest.fn(), getAttendanceReport: jest.fn(),
  getBadgeTrackerSummary: jest.fn(), getGroups: jest.fn(), getGuests: jest.fn(), getHonors: jest.fn(), getHonorsReport: jest.fn(),
  getNextMeetingInfo: jest.fn(), getParentContactList: jest.fn(), getParentDashboard: jest.fn(),
  getParticipants: jest.fn(), getPointsReport: jest.fn(),
  fetchHealthReport: jest.fn(), fetchAllergiesReport: jest.fn(), fetchMedicationReport: jest.fn(),
}));
jest.mock('../../spa/api/api-member-profile.js', () => ({ getCampContacts: jest.fn() }));
jest.mock('../../spa/api/api-camp-rosters.js', () => ({ getCampRoster: jest.fn() }));
jest.mock('../../spa/api/api-activities.js', () => ({ getActivities: jest.fn() }));
jest.mock('../../spa/api/api-action-roster.js', () => ({ getActionRoster: jest.fn() }));
jest.mock('../../spa/api/api-programme.js', () => ({ getDayProgramme: jest.fn() }));
jest.mock('../../spa/api/api-carpools.js', () => ({ getCarpoolOffers: jest.fn() }));
jest.mock('../../spa/api/api-camp-readiness.js', () => ({ getUpcomingCamps: jest.fn() }));
jest.mock('../../spa/api/api-camp-material.js', () => ({ getCampMaterialList: jest.fn() }));
jest.mock('../../spa/api/api-personal-equipment.js', () => ({ getPersonalEquipmentTasks: jest.fn() }));
jest.mock('../../spa/api/api-volunteer-space.js', () => ({ getVolunteerSpace: jest.fn(), getVolunteerSpaceCamp: jest.fn() }));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  hasPermission: jest.fn(), hasAnyPermission: jest.fn(), hasOrganizationScope: jest.fn(), holdsFamilyRole: jest.fn(),
}));
jest.mock('../../spa/utils/OfflineCacheKeys.js', () => ({ buildScopedCacheKey: jest.fn(() => '|scope:user:leader-1|org:1') }));
jest.mock('../../spa/utils/OfflineReadRegistry.js', () => ({ listOfflineReads: jest.fn(() => []) }));
jest.mock('../../spa/modules/scout-year/ScoutYearContext.js', () => ({ isArchiveMode: jest.fn(() => false) }));

const { OfflineBaseline, upcomingActivities, preparedDays } = require('../../spa/modules/offline/OfflineBaseline.js');
const { pruneOfflineCache, getCachedConfirmedAt } = require('../../spa/indexedDB.js');
const { API } = require('../../spa/api/api-core.js');
const { getMyTasks } = require('../../spa/api/api-tasks.js');
const endpoints = require('../../spa/api/api-endpoints.js');
const { getActivities } = require('../../spa/api/api-activities.js');
const { getActionRoster } = require('../../spa/api/api-action-roster.js');
const { getDayProgramme } = require('../../spa/api/api-programme.js');
const { getCarpoolOffers } = require('../../spa/api/api-carpools.js');
const { getUpcomingCamps } = require('../../spa/api/api-camp-readiness.js');
const { getCampMaterialList } = require('../../spa/api/api-camp-material.js');
const { getPersonalEquipmentTasks } = require('../../spa/api/api-personal-equipment.js');
const { getVolunteerSpace, getVolunteerSpaceCamp } = require('../../spa/api/api-volunteer-space.js');
const { getCampContacts } = require('../../spa/api/api-member-profile.js');
const { getCampRoster } = require('../../spa/api/api-camp-rosters.js');
const permissions = require('../../spa/utils/PermissionUtils.js');
const { listOfflineReads } = require('../../spa/utils/OfflineReadRegistry.js');
const { isArchiveMode } = require('../../spa/modules/scout-year/ScoutYearContext.js');

const online = (value) => Object.defineProperty(navigator, 'onLine', { configurable: true, value });
const isoInDays = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const LEADER = ['tasks.view', 'meetings.view', 'reports.view', 'volunteer_space.view', 'participants.view',
  'groups.view', 'attendance.view', 'points.view', 'honors.view', 'badges.view', 'activities.view',
  'carpools.view', 'personal_equipment.view'];
let granted;

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  localStorage.setItem('jwtToken', 'session');
  localStorage.setItem('userId', 'leader-1');
  online(true);
  granted = new Set(LEADER);
  permissions.hasPermission.mockImplementation((key) => granted.has(key));
  permissions.hasAnyPermission.mockImplementation((...keys) => keys.some((key) => granted.has(key)));
  permissions.hasOrganizationScope.mockReturnValue(true);
  permissions.holdsFamilyRole.mockReturnValue(false);
  isArchiveMode.mockReturnValue(false);
  listOfflineReads.mockReturnValue([]);
  getCachedConfirmedAt.mockResolvedValue(null);
  [getMyTasks, getPersonalEquipmentTasks, getActionRoster, getDayProgramme, getCampContacts, getCampRoster, getCarpoolOffers, getCampMaterialList, getVolunteerSpaceCamp,
    API.get, API.getNoCache, ...Object.values(endpoints)].forEach((fn) => fn.mockResolvedValue({ success: true, data: [] }));
  getActivities.mockResolvedValue([
    { id: 1, date_debut: isoInDays(3), date_fin: isoInDays(3), activity_start_date: isoInDays(3), activity_end_date: isoInDays(3) },
    { id: 2, activity_start_date: isoInDays(60), activity_end_date: isoInDays(60) },
    { id: 3, activity_start_date: isoInDays(-10), activity_end_date: isoInDays(-9) },
  ]);
  getUpcomingCamps.mockResolvedValue({ success: true, data: [{ id: 41 }, { id: 42 }, { id: 43 }] });
  getVolunteerSpace.mockResolvedValue({ success: true, data: { camps: [{ activity_id: 4 }, { activity_id: 9 }, { activity_id: 12 }] } });
});

test('a leader online gets every main screen prepared without opening it', async () => {
  const prepared = await new OfflineBaseline().refresh();

  expect(prepared).toEqual(['tasks', 'next_meeting', 'parent_contacts', 'participants', 'groups', 'attendance',
    'days', 'points', 'honors', 'badges', 'reports', 'activities_and_carpools', 'camp_material', 'personal_equipment', 'volunteer_space']);
  expect(getMyTasks).toHaveBeenCalledWith({ forceRefresh: true });
  expect(endpoints.getNextMeetingInfo).toHaveBeenCalledWith({ forceRefresh: true });
  expect(endpoints.getParentContactList).toHaveBeenCalledWith({ forceRefresh: true });
  expect(API.getNoCache).toHaveBeenCalledWith('v1/points');
  expect(endpoints.getAttendanceDates).toHaveBeenCalled();
  expect(endpoints.getHonors).toHaveBeenCalled();
  expect(endpoints.getPointsReport).toHaveBeenCalled();
  // Carpools of the coming activities only, never past or distant ones.
  expect(getCarpoolOffers.mock.calls).toEqual([[1]]);
  expect(getCampMaterialList.mock.calls).toEqual([[41, { forceRefresh: true }], [42, { forceRefresh: true }]]);
  expect(getVolunteerSpaceCamp.mock.calls).toEqual([[4], [9]]);
  // At camp without signal: consented contacts, team health and the unit's health reports.
  expect(getCampContacts.mock.calls).toEqual([[4], [9]]);
  expect(getCampRoster.mock.calls).toEqual([[41], [42]]);
  expect(endpoints.fetchHealthReport).toHaveBeenCalled();
  expect(endpoints.fetchAllergiesReport).toHaveBeenCalled();
  expect(endpoints.fetchMedicationReport).toHaveBeenCalled();
});

test('a parent gets their own dashboard, and is never sent reads the server would refuse', async () => {
  granted = new Set(['participants.view', 'meetings.view']);
  permissions.hasOrganizationScope.mockReturnValue(false);
  permissions.holdsFamilyRole.mockReturnValue(true);

  expect(await new OfflineBaseline().refresh()).toEqual(['next_meeting', 'parent_dashboard', 'participants', 'days']);
  // A parent's day is the programme only: no roster, attendance or honors.
  expect(getActionRoster).not.toHaveBeenCalled();
  expect(endpoints.getAttendance).not.toHaveBeenCalled();
  expect(endpoints.getParentContactList).not.toHaveBeenCalled();
  expect(endpoints.getPointsReport).not.toHaveBeenCalled();
  expect(getUpcomingCamps).not.toHaveBeenCalled();
});

test('every screen the person used is kept ready, including screens the catalogue does not name', async () => {
  granted = new Set();
  listOfflineReads.mockReturnValue([
    { endpoint: 'v1/menus', params: { camp: 7 }, cacheKey: 'v1/menus?camp=7', cacheDuration: 300000 },
    { endpoint: 'v1/carpools/activity/9', params: {}, cacheKey: 'v1/carpools/activity/9' },
  ]);
  getCachedConfirmedAt.mockImplementation((key) => Promise.resolve(key === 'v1/carpools/activity/9' ? Date.now() : null));

  const prepared = await new OfflineBaseline().refresh();

  // The carpool copy was just confirmed; only the menus are read again.
  expect(prepared).toEqual(['v1/menus']);
  expect(API.get).toHaveBeenCalledWith('v1/menus', { camp: 7 }, {
    cacheKey: 'v1/menus?camp=7', cacheDuration: 300000, forceRefresh: true, offlineReplay: true,
  });
});

test('a read the server refuses is not asked again this session; one that failed for want of a network is', async () => {
  granted = new Set(['tasks.view', 'groups.view']);
  let now = 0;
  const baseline = new OfflineBaseline({ now: () => now });
  getMyTasks.mockRejectedValueOnce(Object.assign(new Error('refused'), { status: 403 }));
  endpoints.getGroups.mockRejectedValueOnce(Object.assign(new Error('offline'), { isNetworkError: true }));

  expect(await baseline.refresh()).toEqual([]);
  now = 1000;
  // The network failure lets the next wake run at once, without the interval.
  expect(await baseline.refresh()).toEqual(['groups']);
  expect(getMyTasks).toHaveBeenCalledTimes(1);
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

test('wakes are throttled, reads repeat once their copy is old, and a sign-in reads everything again', async () => {
  granted = new Set(['tasks.view']);
  let now = 0;
  const baseline = new OfflineBaseline({ now: () => now });
  await baseline.refresh();
  now = 60000;
  expect(await baseline.refresh()).toBeNull();
  now = 60000 + 900000;
  // Past the wake interval but the tasks copy is still young: nothing to read.
  expect(await baseline.refresh()).toEqual([]);
  expect(getMyTasks).toHaveBeenCalledTimes(1);
  await baseline.refresh({ force: true });
  expect(getMyTasks).toHaveBeenCalledTimes(2);
});

test('preparation starts shortly after launch, on reconnection and on sign-in, and prunes old copies', async () => {
  jest.useFakeTimers();
  granted = new Set(['tasks.view']);
  const baseline = new OfflineBaseline({ now: () => Date.now() });
  try {
    baseline.start();
    expect(pruneOfflineCache).toHaveBeenCalledTimes(1);
    expect(getMyTasks).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(3000);
    await baseline.task;
    expect(getMyTasks).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new CustomEvent('wampums:signedIn'));
    await baseline.task;
    expect(getMyTasks).toHaveBeenCalledTimes(2);
  } finally {
    baseline.stop();
    jest.useRealTimers();
  }
});

test('only activities that have not ended and start within the lookahead are kept, nearest first', () => {
  const now = new Date('2026-11-14T12:00:00');
  const list = [
    { id: 'later', activity_start_date: '2026-11-30', activity_end_date: '2026-11-30' },
    { id: 'soon', activity_start_date: '2026-11-16', activity_end_date: '2026-11-17' },
    { id: 'past', activity_start_date: '2026-11-01', activity_end_date: '2026-11-02' },
    { id: 'far', activity_start_date: '2027-02-01', activity_end_date: '2027-02-01' },
  ];
  expect(upcomingActivities(list, now).map((activity) => activity.id)).toEqual(['soon', 'later']);
});


test('the roster, attendance, honors and programme of today, the next days and the next meeting are prepared', async () => {
  granted = new Set(['attendance.view', 'honors.view', 'meetings.view']);
  endpoints.getNextMeetingInfo.mockResolvedValue({ success: true, data: { date: '2099-01-09' } });

  await new OfflineBaseline().refresh();

  const days = getActionRoster.mock.calls.map(([day]) => day);
  expect(days).toHaveLength(5);
  expect(days[4]).toBe('2099-01-09');
  expect(endpoints.getAttendance.mock.calls.map(([day]) => day)).toEqual(expect.arrayContaining(days));
  expect(endpoints.getGuests).toHaveBeenCalledTimes(5);
  expect(endpoints.getHonors.mock.calls.map(([day]) => day)).toEqual(expect.arrayContaining(days));
  expect(getDayProgramme).toHaveBeenCalledTimes(5);
});

test('prepared days run from today through the next three, plus a later next meeting, without repeats', () => {
  const now = new Date('2026-11-14T20:00:00');
  expect(preparedDays('2026-11-20', now)).toEqual(['2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17', '2026-11-20']);
  expect(preparedDays('2026-11-15', now)).toEqual(['2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17']);
  expect(preparedDays(null, now)).toHaveLength(4);
});
