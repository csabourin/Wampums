/**
 * @jest-environment jsdom
 *
 * During a camp the dashboard follows the camp day, decided by dates only:
 * giving points leads all day, attendance is the morning roll call, the card
 * says which day of the camp it is and what is on now and next, and the camp's
 * own pages are a tap away. Welcoming a new child and the meetings screen leave
 * "now". Medication is promoted by dates, never by an activity's name.
 */

import axe from 'axe-core';

const mockPermissions = new Set();
let mockIsParent = false;
const mockAdminPanel = false;

// Keys stand for their text, except the two templates whose placeholders the tests read.
const mockTemplates = {
  dashboard_camp_day_label: '{camp} — day {day} of {count}',
  dashboard_camp_led_by: 'led by {leader}',
};
jest.mock('../../spa/app.js', () => ({
  translate: (key) => mockTemplates[key] || key,
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

jest.mock('../../spa/api/api-programme.js', () => ({ getDayProgramme: jest.fn(() => Promise.resolve({ data: null })) }));
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
  getTodayISO: jest.fn(() => '2026-07-14'),
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
let mockOrganizationScope = true;
jest.mock('../../spa/modules/camp-readiness/UpcomingCamps.js', () => ({
  loadUpcomingCamps: jest.fn(() => Promise.resolve([])),
  upcomingCampsMarkup: jest.fn(() => ''),
  canSeeTeamReadiness: jest.fn(() => mockPermissions.has('meetings.view') && mockOrganizationScope),
  campReadinessHref: (camp) => (Number(camp?.id) > 0
    ? `/camp-readiness/${Number(camp.id)}` : `/camp-readiness/activity-${Number(camp?.activity_id)}`),
}));

import { Dashboard } from '../../spa/modules/dashboard/Dashboard.js';
import {
  getAttendance,
  getHonors,
  getNextMeetingInfo,
  getMedicationDistributions,
} from '../../spa/api/api-endpoints.js';
import { getActivities } from '../../spa/api/api-activities.js';
import { getDayProgramme } from '../../spa/api/api-programme.js';
import { offlineManager as mockOfflineManager } from '../../spa/modules/OfflineManager.js';

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  rules: { 'color-contrast': { enabled: false } },
};

const TODAY = '2026-07-14';
const LEADER_PERMISSIONS = [
  'attendance.view', 'attendance.manage', 'points.manage', 'honors.view', 'incidents.manage',
  'meetings.view', 'activities.view', 'participants.view', 'participants.walk_in', 'tasks.view',
  'medication.view',
];

/** Day 2 of a three-day planned camp, with the day's schedule. */
const campProgramme = (overrides = {}) => ({
  meeting_id: 41,
  kind: 'camp',
  date: TODAY,
  title: 'Camp du lac Bleu',
  day_number: 2,
  day_count: 3,
  activities: [
    { id: 1, time: '09:00', duration_minutes: 90, name: 'Grand jeu', leader: 'Ada Lovelace', material: '' },
    { id: 2, time: '10:30', duration_minutes: 60, name: 'Baignade', leader: 'Léa Tremblay', material: '' },
  ],
  ...overrides,
});

/** Set the clock to a time of day on TODAY, faking only Date. */
function atTime(hours, minutes = 0) {
  jest.useFakeTimers({
    now: new Date(2026, 6, 14, hours, minutes),
    doNotFake: [
      'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
      'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask',
    ],
  });
}

/** @returns {Promise<Dashboard>} Drawn, with its background lookups landed */
async function openDashboard() {
  const dashboard = new Dashboard({ userRoles: ['leader'], showMessage: jest.fn() });
  dashboard.organizationSettings = {};
  dashboard.isLoading = false;
  dashboard.render();
  await dashboard.refreshDashboardCounters();
  return dashboard;
}

const primaryAction = () => document.querySelector('.dashboard-v2__hero-card-link');
const nowActions = () => Array.from(document.querySelectorAll('.dashboard-v2__hero-action'))
  .map((link) => link.getAttribute('href'));
const campSection = () => document.querySelector('section[aria-labelledby="moment-camp"]');
const campShortcuts = () => Array.from(campSection()?.querySelectorAll('a') || [])
  .map((link) => link.getAttribute('href'));

beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main>';
  mockPermissions.clear();
  LEADER_PERMISSIONS.forEach((permission) => mockPermissions.add(permission));
  mockIsParent = false;
  mockOrganizationScope = true;
  Object.keys(mockOfflineManager).forEach((key) => delete mockOfflineManager[key]);
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  getNextMeetingInfo.mockResolvedValue({ data: null });
  getAttendance.mockResolvedValue({ data: [] });
  getHonors.mockResolvedValue({ data: { participants: [], honors: [], availableDates: [] } });
  getActivities.mockResolvedValue({ data: [] });
  getMedicationDistributions.mockResolvedValue({ data: { distributions: [] } });
  getDayProgramme.mockResolvedValue({ data: campProgramme() });
});

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

test('at camp, giving points is the primary action and the card says which day of the camp it is', async () => {
  atTime(9, 30);
  const dashboard = await openDashboard();

  expect(getDayProgramme).toHaveBeenCalledWith(TODAY);
  expect(primaryAction().getAttribute('href')).toBe('/managePoints');
  expect(primaryAction().textContent).toContain('tile_manage_points');
  expect(document.querySelector('.dashboard-v2__hero-eyebrow').textContent)
    .toContain('Camp du lac Bleu — day 2 of 3');
  dashboard.destroy();
});

test('at camp, welcoming a new child and the meetings screen are not offered as things to do now', async () => {
  atTime(9, 30);
  const dashboard = await openDashboard();

  const now = [primaryAction().getAttribute('href'), ...nowActions()];
  expect(now).not.toContain('/walk-in-children');
  expect(now).not.toContain('/reunions');
  expect(now).toEqual(expect.arrayContaining(['/manageHonors', '/incident-reports/new']));
  dashboard.destroy();
});

test('the morning roll call is offered beside points until today\'s attendance is taken', async () => {
  atTime(8, 0);
  let dashboard = await openDashboard();
  expect(primaryAction().getAttribute('href')).toBe('/managePoints');
  expect(nowActions()).toContain('/attendance');
  dashboard.destroy();

  getAttendance.mockResolvedValue({ data: [{ participant_id: 1, status: 'present' }] });
  dashboard = await openDashboard();
  expect(getAttendance).toHaveBeenCalledWith(TODAY);
  expect(nowActions()).not.toContain('/attendance');
  expect(primaryAction().getAttribute('href')).toBe('/managePoints');
  dashboard.destroy();
});

test('attendance is a morning roll call: in the afternoon it leaves "now" even if not taken', async () => {
  atTime(14, 0);
  const dashboard = await openDashboard();

  expect(nowActions()).not.toContain('/attendance');
  expect(primaryAction().getAttribute('href')).toBe('/managePoints');
  dashboard.destroy();
});

test('the card shows the activity on now and the next one, with who leads each', async () => {
  atTime(9, 30);
  const dashboard = await openDashboard();

  const schedule = document.querySelector('.dashboard-v2__camp-schedule').textContent.replace(/\s+/g, ' ');
  expect(schedule).toContain('dashboard_camp_now Grand jeu · led by Ada Lovelace');
  expect(schedule).toContain('dashboard_camp_next 10:30 Baignade');
  dashboard.destroy();
});

test('before the day starts, the card names the first activity coming up', async () => {
  atTime(7, 0);
  const dashboard = await openDashboard();

  const schedule = document.querySelector('.dashboard-v2__camp-schedule').textContent.replace(/\s+/g, ' ');
  expect(schedule).not.toContain('dashboard_camp_now');
  expect(schedule).toContain('dashboard_camp_next 09:00 Grand jeu');
  dashboard.destroy();
});

test('names in the camp schedule are shown as text, never as markup', async () => {
  atTime(9, 30);
  getDayProgramme.mockResolvedValue({
    data: campProgramme({
      title: '<img src=x onerror=alert(1)>',
      activities: [{ id: 1, time: '09:00', duration_minutes: 90, name: '<b>Jeu</b>', leader: '$& <i>x</i>', material: '' }],
    }),
  });
  const dashboard = await openDashboard();

  const hero = document.querySelector('.dashboard-v2__hero-card');
  expect(hero.querySelector('img, b, i:not(.fa-solid)')).toBeNull();
  expect(hero.textContent).toContain('<img src=x onerror=alert(1)>');
  expect(hero.textContent).toContain('<b>Jeu</b>');
  expect(hero.textContent).toContain('$& <i>x</i>');
  dashboard.destroy();
});

test('the camp\'s pages are offered as shortcuts, each behind its own permission', async () => {
  atTime(14, 0);
  let dashboard = await openDashboard();
  expect(campShortcuts()).toEqual(['/camp-readiness/41', '/camp-site/41', '/my-camp-lots/41', '/attendance']);
  dashboard.destroy();

  mockPermissions.delete('meetings.view');
  mockPermissions.delete('tasks.view');
  mockPermissions.delete('attendance.manage');
  getActivities.mockResolvedValue({
    data: [{
      id: 7, name: 'Camp du lac Bleu', is_camp: true, linked_year_plan_meeting_id: 41,
      activity_start_date: '2026-07-13', activity_end_date: '2026-07-15',
    }],
  });
  dashboard = await openDashboard();
  expect(getDayProgramme).toHaveBeenCalledTimes(1);
  expect(campSection()).toBeNull();
  dashboard.destroy();
});

test('a camp recorded only as an activity is recognised by its dates and opens its overview by activity', async () => {
  atTime(14, 0);
  getDayProgramme.mockResolvedValue({ data: null });
  getActivities.mockResolvedValue({
    data: [{ id: 7, name: 'Camp d\'été', is_camp: true, activity_start_date: '2026-07-12', activity_end_date: '2026-07-18' }],
  });
  const dashboard = await openDashboard();

  expect(primaryAction().getAttribute('href')).toBe('/managePoints');
  expect(document.querySelector('.dashboard-v2__hero-eyebrow').textContent).toContain('Camp d\'été — day 3 of 7');
  expect(document.querySelector('.dashboard-v2__camp-schedule').textContent).toContain('dashboard_camp_schedule_none');
  expect(campShortcuts()).toEqual(['/camp-readiness/activity-7', '/attendance']);
  dashboard.destroy();
});

test('an activity named "camp" but not marked as one does not turn the dashboard into camp mode', async () => {
  atTime(14, 0);
  getDayProgramme.mockResolvedValue({ data: null });
  getActivities.mockResolvedValue({
    data: [{ id: 8, name: 'Camp de jour', is_camp: false, activity_start_date: TODAY, activity_end_date: TODAY }],
  });
  const dashboard = await openDashboard();

  expect(campSection()).toBeNull();
  expect(primaryAction().getAttribute('href')).toBe('/attendance');
  dashboard.destroy();
});

test('offline, a camp whose schedule is not on this device says so instead of showing a meeting', async () => {
  atTime(9, 30);
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  getDayProgramme.mockRejectedValue(new Error('offline'));
  getNextMeetingInfo.mockResolvedValue({ data: { date: TODAY, start_time: '18:30', end_time: '20:00', activities: [] } });
  getActivities.mockResolvedValue({
    data: [{ id: 7, name: 'Camp du lac Bleu', is_camp: true, linked_year_plan_meeting_id: 41,
      activity_start_date: '2026-07-13', activity_end_date: '2026-07-15' }],
  });
  const dashboard = await openDashboard();

  expect(primaryAction().getAttribute('href')).toBe('/managePoints');
  expect(document.querySelector('.dashboard-v2__camp-schedule').textContent).toContain('dashboard_camp_schedule_unavailable');
  expect(document.body.textContent).not.toContain('dashboard_next_meeting_eyebrow');
  // Pages that need the network are not offered offline; the lots are, and the
  // morning roll call (where departures are marked too) stays in "now".
  expect(campShortcuts()).toEqual(['/my-camp-lots/41']);
  expect(nowActions()).toContain('/attendance');
  dashboard.destroy();
});

test('offline with nothing cached, the camp prepared on this device for today still sets the camp day', async () => {
  atTime(14, 0);
  getDayProgramme.mockRejectedValue(new Error('offline'));
  getActivities.mockRejectedValue(new Error('offline'));
  Object.assign(mockOfflineManager, {
    campMode: true,
    isDatePrepared: (date) => date === TODAY,
    getPreparedActivityForDate: () => ({ id: 7, activityId: 7, startDate: '2026-07-14', endDate: '2026-07-16' }),
  });
  const dashboard = await openDashboard();

  expect(primaryAction().getAttribute('href')).toBe('/managePoints');
  expect(document.querySelector('.dashboard-v2__hero-eyebrow').textContent).toContain('camp_readiness_camp — day 1 of 3');
  dashboard.destroy();
});

test('at camp, a dose due soon puts giving medication first', async () => {
  atTime(9, 30);
  getMedicationDistributions.mockResolvedValue({
    data: { distributions: [{ scheduled_for: new Date(2026, 6, 14, 10, 0).toISOString(), status: 'scheduled' }] },
  });
  const dashboard = await openDashboard();

  expect(primaryAction().getAttribute('href')).toBe('/medication-dispensing');
  expect(nowActions()).toContain('/managePoints');
  dashboard.destroy();
});

test('medication priority follows an activity\'s dates, not its name', async () => {
  atTime(9, 30);
  getDayProgramme.mockResolvedValue({ data: null });
  getMedicationDistributions.mockResolvedValue({
    data: { distributions: [{ scheduled_for: new Date(2026, 6, 14, 10, 0).toISOString(), status: 'scheduled' }] },
  });
  // Named like an outing, but not today: no promotion.
  getActivities.mockResolvedValue({
    data: [{ id: 3, name: 'Sortie au musée', activity_start_date: '2026-07-20', activity_end_date: '2026-07-20',
      activity_start_time: '09:00', activity_end_time: '16:00' }],
  });
  let dashboard = await openDashboard();
  expect(primaryAction().getAttribute('href')).not.toBe('/medication-dispensing');
  dashboard.destroy();

  // Under way now, whatever its name: promoted.
  getActivities.mockResolvedValue({
    data: [{ id: 4, name: 'Journée au parc', activity_start_date: TODAY, activity_end_date: TODAY,
      activity_start_time: '09:00', activity_end_time: '16:00' }],
  });
  dashboard = await openDashboard();
  expect(primaryAction().getAttribute('href')).toBe('/medication-dispensing');
  dashboard.destroy();
});

test('outside a camp, the meeting day is unchanged', async () => {
  atTime(18, 45);
  getDayProgramme.mockResolvedValue({ data: { ...campProgramme(), kind: 'regular', day_number: 1, day_count: 1 } });
  getNextMeetingInfo.mockResolvedValue({ data: { date: TODAY, start_time: '18:30', end_time: '20:00', activities: [] } });
  const dashboard = await openDashboard();

  expect(campSection()).toBeNull();
  expect(primaryAction().getAttribute('href')).toBe('/attendance');
  expect(nowActions()).toEqual(expect.arrayContaining(['/walk-in-children', '/reunions']));
  dashboard.destroy();
});

test('the camp dashboard has no accessibility violations and its shortcuts are reachable by keyboard', async () => {
  atTime(8, 0);
  const dashboard = await openDashboard();

  const results = await axe.run(document.getElementById('app'), AXE_OPTIONS);
  expect(results.violations).toEqual([]);
  const heading = document.getElementById('moment-camp');
  expect(heading.tagName).toBe('H2');
  campSection().querySelectorAll('a').forEach((link) => {
    expect(link.getAttribute('href')).toBeTruthy();
    expect(link.textContent.trim()).not.toBe('');
    expect(link.tabIndex).toBe(0);
  });
  dashboard.destroy();
});
