/**
 * @jest-environment jsdom
 *
 * On a meeting day the dashboard's primary action follows the evening:
 * attendance, then points once attendance is taken, honors once the meeting
 * is over, and the meetings screen once honors are awarded. The other "now"
 * actions stay offered beside it.
 */

import axe from 'axe-core';

const mockPermissions = new Set();
let mockIsParent = false;
const mockAdminPanel = false;

jest.mock('../../spa/app.js', () => ({
  translate: (key) => key,
}));

jest.mock('../../spa/config.js', () => ({
  CONFIG: {
    ROLES: {
      DISTRICT: 'district',
      UNIT_ADMIN: 'unitadmin',
      ADMINISTRATION: 'administration',
      DEMO_ADMIN: 'demoadmin',
      FINANCE: 'finance',
      LEADER: 'leader',
      PARENT: 'parent',
      DEMO_PARENT: 'demoparent',
    },
  },
}));

jest.mock('../../spa/ajax-functions.js', () => ({
  CONFIG: { ROLES: {} },
  getParticipants: jest.fn(),
  getGroups: jest.fn(),
  getCurrentOrganizationId: jest.fn(),
  getOrganizationSettings: jest.fn(),
}));

jest.mock('../../spa/api/api-endpoints.js', () => ({
  getAttendanceDates: jest.fn(),
  getAttendance: jest.fn(),
  getNextMeetingInfo: jest.fn(),
  getHonors: jest.fn(),
  getPermissionSlips: jest.fn(),
  getMedicationDistributions: jest.fn(),
}));

jest.mock('../../spa/api/api-activities.js', () => ({ getActivities: jest.fn() }));
jest.mock('../../spa/indexedDB.js', () => ({
  getCachedData: jest.fn(),
  setCachedData: jest.fn(),
  clearActivityRelatedCaches: jest.fn(),
}));
jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
}));
jest.mock('../../spa/utils/DOMUtils.js', () => ({
  setContent: (element, html) => { element.innerHTML = html; },
  loadStylesheet: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../spa/utils/SkeletonUtils.js', () => ({
  skeletonDashboard: jest.fn(() => '<section class="dashboard-page loading-state" aria-busy="true">loading</section>'),
}));
jest.mock('../../spa/utils/DateUtils.js', () => ({
  getTodayISO: jest.fn(() => '2026-08-02'),
  formatDate: jest.fn((value) => value),
}));
jest.mock('../../spa/utils/ParticipantRoleUtils.js', () => ({
  normalizeParticipantList: (participants) => participants,
}));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  hasPermission: jest.fn((permission) => mockPermissions.has(permission)),
  hasAnyPermission: jest.fn((...permissions) => permissions.some((permission) => mockPermissions.has(permission))),
  canAccessAdminPanel: jest.fn(() => mockAdminPanel),
  canAccessParentTools: jest.fn(() => mockIsParent),
  canCreateOrganization: jest.fn(() => false),
  canSwitchUnits: jest.fn(() => false),
  canViewCarpools: jest.fn(() => false),
  canFollowPermissionSlips: jest.fn(() => !mockIsParent
    && ['activities.view', 'participants.view', 'groups.view'].every((permission) => mockPermissions.has(permission))),
  isParent: jest.fn(() => mockIsParent),
  holdsFamilyRole: jest.fn(() => mockIsParent),
}));
jest.mock('../../spa/utils/DashboardCacheManager.js', () => ({
  DashboardCacheManager: { preloadCachedData: jest.fn() },
}));
jest.mock('../../spa/modules/modals/CarpoolQuickAccessModal.js', () => ({ CarpoolQuickAccessModal: jest.fn() }));
jest.mock('../../spa/utils/DashboardPreferences.js', () => ({
  applyPalette: jest.fn(),
  getDashboardPrefs: jest.fn(() => ({ hiddenTiles: [], collapsedToolGroups: [] })),
  setCollapsedToolGroups: jest.fn(),
}));
jest.mock('../../spa/modules/CommandPalette.js', () => ({
  CommandPalette: jest.fn().mockImplementation(() => ({
    attachGlobalShortcut: jest.fn(),
    setTiles: jest.fn(),
    detach: jest.fn(),
  })),
}));
jest.mock('../../spa/modules/OfflineManager.js', () => ({ offlineManager: {} }));

import { Dashboard } from '../../spa/modules/dashboard/Dashboard.js';
import {
  getAttendance,
  getHonors,
  getNextMeetingInfo,
} from '../../spa/api/api-endpoints.js';

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  rules: { 'color-contrast': { enabled: false } },
};

const TODAY = '2026-08-02';
const LEADER_PERMISSIONS = [
  'attendance.view', 'attendance.manage', 'points.manage', 'honors.view',
  'meetings.view', 'activities.view', 'participants.view',
];

const todaysMeeting = (overrides = {}) => ({
  date: TODAY,
  start_time: '18:30',
  end_time: '20:00',
  endroit: 'Local',
  activities: [],
  ...overrides,
});

/** Set the clock to a time of day on the meeting date, faking only Date. */
function atTime(hours, minutes = 0) {
  jest.useFakeTimers({
    now: new Date(2026, 7, 2, hours, minutes),
    doNotFake: [
      'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
      'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask',
    ],
  });
}

/**
 * Draw the dashboard, then let its background lookups land.
 * @returns {Promise<Dashboard>}
 */
async function openDashboard() {
  const dashboard = new Dashboard({ userRoles: ['leader'], showMessage: jest.fn() });
  dashboard.organizationSettings = {};
  dashboard.isLoading = false;
  dashboard.render();
  await dashboard.refreshDashboardCounters();
  return dashboard;
}

const primaryAction = () => document.querySelector('.dashboard-v2__hero-card-link');
const otherActions = () => Array.from(document.querySelectorAll('.dashboard-v2__hero-action'))
  .map((link) => link.getAttribute('href'));

beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main>';
  mockPermissions.clear();
  LEADER_PERMISSIONS.forEach((permission) => mockPermissions.add(permission));
  mockIsParent = false;
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  getNextMeetingInfo.mockResolvedValue({ data: todaysMeeting() });
  getAttendance.mockResolvedValue({ data: [] });
  getHonors.mockResolvedValue({ data: { participants: [], honors: [], availableDates: [] } });
});

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

test('before attendance is taken, taking attendance is the primary action', async () => {
  atTime(18, 45);
  const dashboard = await openDashboard();

  expect(primaryAction().getAttribute('href')).toBe('/attendance');
  dashboard.destroy();
});

test('once attendance is taken, giving points becomes the primary action', async () => {
  atTime(18, 45);
  getAttendance.mockResolvedValue({ data: [{ participant_id: 1, status: 'present' }] });

  const dashboard = await openDashboard();

  expect(getAttendance).toHaveBeenCalledWith(TODAY);
  expect(primaryAction().getAttribute('href')).toBe('/managePoints');
  expect(primaryAction().textContent).toContain('tile_manage_points');
  expect(otherActions()).toEqual(expect.arrayContaining([
    '/attendance', '/manageHonors', '/reunions',
  ]));
  dashboard.destroy();
});

test('once the meeting is over, awarding honors becomes the primary action', async () => {
  atTime(20, 15);
  getAttendance.mockResolvedValue({ data: [{ participant_id: 1, status: 'present' }] });

  const dashboard = await openDashboard();

  expect(primaryAction().getAttribute('href')).toBe('/manageHonors');
  expect(otherActions()).toEqual(expect.arrayContaining([
    '/attendance', '/managePoints', '/reunions',
  ]));
  dashboard.destroy();
});

test('without an end time, the meeting ends after its start time plus its duration', async () => {
  getNextMeetingInfo.mockResolvedValue({
    data: todaysMeeting({ end_time: null, start_time: '18:30', duration_minutes: 90 }),
  });

  atTime(19, 59);
  let dashboard = await openDashboard();
  expect(primaryAction().getAttribute('href')).toBe('/attendance');
  dashboard.destroy();

  atTime(20, 0);
  dashboard = await openDashboard();
  expect(primaryAction().getAttribute('href')).toBe('/manageHonors');
  dashboard.destroy();
});

test('a meeting crossing midnight is not over before it starts', async () => {
  getNextMeetingInfo.mockResolvedValue({
    data: todaysMeeting({ start_time: '23:30', end_time: '00:30' }),
  });
  getAttendance.mockResolvedValue({ data: [{ participant_id: 1, status: 'present' }] });
  atTime(18, 0);

  const dashboard = await openDashboard();

  expect(primaryAction().getAttribute('href')).toBe('/managePoints');
  dashboard.destroy();
});

test('without any time, the meeting ends with its last planned activity', async () => {
  getNextMeetingInfo.mockResolvedValue({
    data: todaysMeeting({
      end_time: null,
      start_time: null,
      activities: [
        { time: '18:30', duration: '00:45' },
        { time: '19:15', duration: '00:30' },
      ],
    }),
  });
  atTime(19, 50);

  const dashboard = await openDashboard();

  expect(primaryAction().getAttribute('href')).toBe('/manageHonors');
  dashboard.destroy();
});

test('once honors are awarded today, the meetings screen becomes the primary action', async () => {
  atTime(20, 30);
  getAttendance.mockResolvedValue({ data: [{ participant_id: 1, status: 'present' }] });
  getHonors.mockResolvedValue({ data: { participants: [], honors: [], availableDates: [TODAY] } });

  const dashboard = await openDashboard();

  expect(primaryAction().getAttribute('href')).toBe('/reunions');
  expect(primaryAction().textContent).toContain('tile_meetings');
  expect(primaryAction().textContent).toContain('dashboard_primary_action');
  expect(otherActions()).toEqual(expect.arrayContaining([
    '/attendance', '/managePoints', '/manageHonors',
  ]));
  const results = await axe.run(document.getElementById('app'), AXE_OPTIONS);
  expect(results.violations).toEqual([]);
  dashboard.destroy();
});

test('honors awarded on an earlier date do not end today\'s meeting', async () => {
  atTime(18, 45);
  getAttendance.mockResolvedValue({ data: [{ participant_id: 1, status: 'present' }] });
  getHonors.mockResolvedValue({ data: { participants: [], honors: [], availableDates: ['2026-07-26'] } });

  const dashboard = await openDashboard();

  expect(primaryAction().getAttribute('href')).toBe('/managePoints');
  dashboard.destroy();
});

test('on a day without a meeting, attendance stays the primary action', async () => {
  atTime(21, 0);
  getNextMeetingInfo.mockResolvedValue({ data: todaysMeeting({ date: '2026-08-09' }) });
  getAttendance.mockResolvedValue({ data: [{ participant_id: 1, status: 'present' }] });

  const dashboard = await openDashboard();

  expect(getAttendance).not.toHaveBeenCalled();
  expect(getHonors).not.toHaveBeenCalled();
  expect(primaryAction().getAttribute('href')).toBe('/attendance');
  dashboard.destroy();
});

test('a failed attendance lookup leaves attendance as the primary action', async () => {
  atTime(18, 45);
  getAttendance.mockRejectedValue(new Error('offline'));

  const dashboard = await openDashboard();

  expect(primaryAction().getAttribute('href')).toBe('/attendance');
  dashboard.destroy();
});

test('someone who cannot see honors is not asked for them', async () => {
  atTime(20, 30);
  mockPermissions.delete('honors.view');

  const dashboard = await openDashboard();

  expect(getHonors).not.toHaveBeenCalled();
  expect(primaryAction().getAttribute('href')).toBe('/manageHonors');
  dashboard.destroy();
});
