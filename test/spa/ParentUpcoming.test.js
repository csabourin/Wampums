/**
 * @jest-environment jsdom
 *
 * "Coming up" on the parent dashboard: a family sees when and where the next
 * meeting and outings take place without opening another page.
 */

import axe from 'axe-core';

jest.mock('../../spa/ajax-functions.js', () => ({
  getPublicOrganizationSettings: jest.fn(() => Promise.resolve({ success: true, data: {} })),
  fetchParticipants: jest.fn(() => Promise.resolve([])),
  getCurrentOrganizationId: jest.fn(() => 7),
}));
jest.mock('../../spa/api/api-endpoints.js', () => ({
  declinePermissionSlip: jest.fn(),
  getNextMeetingInfo: jest.fn(),
  getPermissionSlips: jest.fn(),
  signPermissionSlip: jest.fn(),
}));
jest.mock('../../spa/api/api-activities.js', () => ({ getActivities: jest.fn() }));
jest.mock('../../spa/api/api-volunteers.js', () => ({ getVolunteerShifts: jest.fn() }));
jest.mock('../../spa/api/api-scout-years.js', () => ({
  getFormsNeedingReview: jest.fn(() => Promise.resolve([])),
  getAuthorizationsPendingSignature: jest.fn(() => Promise.resolve([])),
  confirmFormReview: jest.fn(() => Promise.resolve({})),
}));
jest.mock('../../spa/api/api-core.js', () => ({ buildApiUrl: (path) => path }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn(),
}));
jest.mock('../../spa/app.js', () => ({
  translate: (key) => key,
  registerPushSubscription: jest.fn(),
}));
jest.mock('../../spa/functions.js', () => ({}));
jest.mock('../../spa/config.js', () => ({
  CONFIG: { DEFAULT_LANG: 'en', DEFAULT_CURRENCY: 'CAD' },
  getStorageKey: (key) => key,
}));
jest.mock('../../spa/utils/DOMUtils.js', () => ({
  ...jest.requireActual('../../spa/utils/DOMUtils.js'),
  loadStylesheet: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../spa/utils/DateUtils.js', () => ({
  ...jest.requireActual('../../spa/utils/DateUtils.js'),
  getTodayISO: () => '2026-11-08',
}));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  isParent: () => true,
  hasPermission: (key) => mockPermissions.has(key),
  canViewBadges: () => false,
  canApproveBadges: () => false,
  canViewReports: () => false,
  canViewActivities: () => mockCanViewActivities,
  canViewCarpools: () => false,
}));

let mockCanViewActivities = true;
let mockPermissions = new Set();

const { getNextMeetingInfo } = require('../../spa/api/api-endpoints.js');
const { getActivities } = require('../../spa/api/api-activities.js');
const { getVolunteerShifts } = require('../../spa/api/api-volunteers.js');
const { buildUpcomingEvents, renderUpcomingSection } = require('../../spa/modules/dashboard/ParentUpcoming.js');
const { ParentDashboard } = require('../../spa/modules/dashboard/ParentDashboard.js');

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  rules: { 'color-contrast': { enabled: false } },
};

const TODAY = '2026-11-08';
const MEETING = { date: '2026-11-10', start_time: '18:30', end_time: '20:00', location: 'Sous-sol de l’église', is_cancelled: false };

/**
 * An activity as `/v1/activities` returns it.
 *
 * @param {number} id - Activity id
 * @param {string} start - Start date
 * @param {Object} [overrides] - Other fields
 * @returns {Object} Activity
 */
function activity(id, start, overrides = {}) {
  return {
    id,
    name: `Outing ${id}`,
    activity_start_date: start,
    activity_end_date: start,
    activity_start_time: '09:00',
    activity_end_time: '16:00',
    meeting_location_going: 'Parc de la Gatineau',
    is_active: true,
    ...overrides,
  };
}

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

beforeEach(() => {
  jest.clearAllMocks();
  mockCanViewActivities = true;
  mockPermissions = new Set();
});

describe('what is coming up', () => {
  test('the next meeting and the coming activities, soonest first, three at most', () => {
    const events = buildUpcomingEvents({
      nextMeeting: MEETING,
      activities: [
        activity(1, '2026-12-08'),
        activity(2, '2026-11-14', { is_camp: true, activity_end_date: '2026-11-16' }),
        activity(3, '2026-11-01'),
        activity(4, '2026-11-20'),
      ],
      today: TODAY,
    });

    expect(events.map((event) => [event.kind, event.date])).toEqual([
      ['meeting', '2026-11-10'],
      ['camp', '2026-11-14'],
      ['activity', '2026-11-20'],
    ]);
  });

  test('an activity under way still shows; a cancelled meeting does not', () => {
    const events = buildUpcomingEvents({
      nextMeeting: { ...MEETING, is_cancelled: true },
      activities: [activity(5, '2026-11-06', { activity_end_date: '2026-11-09' })],
      today: TODAY,
    });

    expect(events.map((event) => event.key)).toEqual(['activity:5']);
  });
});

describe('the section', () => {
  test('names, places and dates come from people and are shown as text', () => {
    document.body.innerHTML = `<main id="app">${renderUpcomingSection(buildUpcomingEvents({
      activities: [activity(6, '2026-11-14', { name: '<img src=x onerror=alert(1)>', meeting_location_going: '<b>Lac</b>' })],
      today: TODAY,
    }), { lang: 'en', failed: false, calendarLink: true })}</main>`;

    const item = document.querySelector('.parent-upcoming__item');
    expect(item.querySelector('img, b')).toBeNull();
    expect(item.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(item.textContent).toContain('<b>Lac</b>');
  });

  test('nothing planned says what would fill it, never that the load failed', () => {
    document.body.innerHTML = `<main id="app">${renderUpcomingSection([], { lang: 'en', failed: false, calendarLink: true })}</main>`;

    expect(document.querySelector('.parent-upcoming__empty').textContent).toBe('parent_upcoming_empty');
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  test('has no WCAG A/AA violations, with a meeting, a camp and the calendar link', async () => {
    document.body.innerHTML = `<main id="app">${renderUpcomingSection(buildUpcomingEvents({
      nextMeeting: MEETING,
      activities: [activity(2, '2026-11-14', { is_camp: true })],
      today: TODAY,
    }), { lang: 'fr', failed: false, calendarLink: true })}</main>`;

    expect(document.querySelector('a[href="/account-info#calendar-feed"]').textContent).toBe('parent_upcoming_calendar');
    const results = await axe.run(document.getElementById('app'), AXE_OPTIONS);
    expect(results.violations).toEqual([]);
  });
});

describe('on the parent dashboard', () => {
  /**
   * Render the dashboard of a family with one child and nothing to do.
   *
   * @returns {Promise<ParentDashboard>} The page
   */
  async function renderDashboard() {
    document.body.innerHTML = '<div id="app"></div>';
    const page = new ParentDashboard({ organizationSettings: {}, showMessage: jest.fn(), language: 'en' });
    page.fetchParticipants = jest.fn(() => { page.participants = [{ id: 4, first_name: 'Ada', last_name: 'Lovelace' }]; });
    page.fetchFormFormats = jest.fn(() => { page.formFormats = {}; page.formMeta = {}; });
    page.fetchParticipantStatements = jest.fn();
    page.fetchPermissionSlips = jest.fn();
    page.checkAndShowLinkParticipantsDialog = jest.fn();
    await page.init();
    return page;
  }

  test('comes right after the family\'s tasks, with the next meeting first', async () => {
    getNextMeetingInfo.mockResolvedValue({ success: true, data: MEETING });
    getActivities.mockResolvedValue([activity(1, '2026-11-14')]);
    const page = await renderDashboard();

    const tasks = document.querySelector('.family-tasks');
    const upcoming = document.querySelector('.parent-upcoming');
    expect(tasks.compareDocumentPosition(upcoming) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect([...upcoming.querySelectorAll('.parent-upcoming__kind')].map((kind) => kind.textContent))
      .toEqual(['parent_upcoming_kind_meeting', 'parent_upcoming_kind_activity']);
    expect(upcoming.querySelector('.parent-upcoming__place').textContent).toContain('Sous-sol de l’église');
    page.destroy();
  });

  test('a failed load says so with a retry, and the retry shows the events', async () => {
    getNextMeetingInfo.mockRejectedValueOnce(Object.assign(new Error('offline'), { status: 0 }));
    getActivities.mockResolvedValue([]);
    const page = await renderDashboard();

    const alert = document.querySelector('.parent-upcoming [role="alert"]');
    expect(alert.textContent).toContain('parent_upcoming_failed');
    expect(document.querySelector('.parent-upcoming__empty')).toBeNull();

    getNextMeetingInfo.mockResolvedValue({ success: true, data: MEETING });
    document.getElementById('parent-upcoming-retry').click();
    await flush();

    expect(document.querySelectorAll('.parent-upcoming__item')).toHaveLength(1);
    expect(document.activeElement).toBe(document.getElementById('parent-upcoming-title'));
    page.destroy();
  });

  test('is absent for an account that cannot read activities, and nothing is asked', async () => {
    mockCanViewActivities = false;
    const page = await renderDashboard();

    expect(document.querySelector('.parent-upcoming')).toBeNull();
    expect(getNextMeetingInfo).not.toHaveBeenCalled();
    page.destroy();
  });

  test('a parent who may volunteer is invited below what is coming up, and led to the shifts', async () => {
    mockPermissions = new Set(['volunteers.view', 'volunteer_space.view']);
    getNextMeetingInfo.mockResolvedValue({ success: true, data: null });
    getActivities.mockResolvedValue([]);
    getVolunteerShifts.mockResolvedValue({ success: true, data: [{ id: 1, slots: 2, taken: 0, mine: false }] });
    const page = await renderDashboard();

    const upcoming = document.querySelector('.parent-upcoming');
    const volunteering = document.querySelector('.parent-volunteering');
    expect(upcoming.compareDocumentPosition(volunteering) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(volunteering.querySelector('a[href="/volunteers"]')).not.toBeNull();
    page.destroy();
  });

  test('a parent without volunteering rights is not asked about shifts', async () => {
    getNextMeetingInfo.mockResolvedValue({ success: true, data: null });
    getActivities.mockResolvedValue([]);
    const page = await renderDashboard();

    expect(getVolunteerShifts).not.toHaveBeenCalled();
    expect(document.querySelector('.parent-volunteering')).toBeNull();
    page.destroy();
  });
});
