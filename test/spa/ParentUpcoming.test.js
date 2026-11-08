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
jest.mock('../../spa/api/api-personal-equipment.js', () => ({ getPersonalEquipmentTasks: jest.fn() }));
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
const { getPersonalEquipmentTasks } = require('../../spa/api/api-personal-equipment.js');
const { buildUpcomingEvents, renderUpcomingSection, packingListFor } = require('../../spa/modules/dashboard/ParentUpcoming.js');
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

  test('a planned day linked to a camp is listed once, as the camp, leaving room for the next event', () => {
    const events = buildUpcomingEvents({
      nextMeeting: { ...MEETING, date: '2026-11-14', activity_id: 2 },
      activities: [
        activity(2, '2026-11-14', { is_camp: true }),
        activity(3, '2026-11-20'),
        activity(4, '2026-11-27'),
      ],
      today: TODAY,
    });

    expect(events.map((event) => event.key)).toEqual(['activity:2', 'activity:3', 'activity:4']);
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

describe('the next meeting\'s hours', () => {
  const { meetingHours } = require('../../spa/modules/dashboard/ParentUpcoming.js');

  test('come from the evening\'s schedule, not hours copied from older unit settings', () => {
    const meeting = { ...MEETING, start_time: '19:00', end_time: '21:00', activities: [
      { time: '18:45', duration: '00:15' },
      { time: '19:00', duration: '01:45' },
      { time: '', duration: '00:10' },
    ] };
    expect(meetingHours(meeting)).toEqual({ activity_start_time: '18:45', activity_end_time: '20:45' });

    const [event] = buildUpcomingEvents({ nextMeeting: meeting, today: TODAY });
    document.body.innerHTML = renderUpcomingSection([event], { lang: 'fr', failed: false, calendarLink: false });
    expect(document.querySelector('.parent-upcoming__when').textContent).toMatch(/18[:h]\s?45/);
    expect(document.querySelector('.parent-upcoming__when').textContent).not.toMatch(/19[:h]\s?00/);
  });

  test('fall back to the meeting\'s own hours when nothing is scheduled yet', () => {
    expect(meetingHours({ ...MEETING, activities: [] }))
      .toEqual({ activity_start_time: '18:30', activity_end_time: '20:00' });
    expect(meetingHours({ start_time: null, end_time: null })).toEqual({ activity_start_time: '', activity_end_time: '' });
  });
});

describe('packing lists beside their event', () => {
  const events = () => buildUpcomingEvents({
    nextMeeting: { ...MEETING, id: 77 },
    activities: [activity(2, '2026-11-14', { is_camp: true }), activity(3, '2026-11-20')],
    today: TODAY,
  });
  const byKey = (key) => events().find((event) => event.key === key);

  test('an outing\'s own list, a camp\'s list through its planned day, and a meeting\'s list each find their event', () => {
    expect(packingListFor(byKey('activity:3'), [{ meeting_id: 'activity-3' }])).toBe('activity-3');
    expect(packingListFor(byKey('activity:2'), [{ meeting_id: 81, activity_id: 2 }])).toBe(81);
    expect(packingListFor(byKey('meeting:2026-11-10'), [{ meeting_id: 77, activity_id: null }])).toBe(77);
  });

  test('another event\'s list is never offered', () => {
    expect(packingListFor(byKey('activity:3'), [{ meeting_id: 'activity-2' }, { meeting_id: 81, activity_id: 2 }])).toBeNull();
    expect(packingListFor(byKey('meeting:2026-11-10'), [{ meeting_id: 'activity-3' }])).toBeNull();
  });

  test('the link sits on its event and names it to screen readers', () => {
    document.body.innerHTML = `<main id="app">${renderUpcomingSection(events(), {
      lang: 'en', failed: false, calendarLink: false, packingLists: [{ meeting_id: 'activity-3' }],
    })}</main>`;

    const links = [...document.querySelectorAll('.parent-upcoming__packing')];
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('/personal-equipment/activity-3');
    expect(links[0].closest('.parent-upcoming__item').querySelector('h3').textContent).toBe('Outing 3');
    expect(links[0].querySelector('.visually-hidden').textContent).toContain('Outing 3');
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

  test('a family whose children have no published list sees no packing button at all', async () => {
    mockPermissions = new Set(['personal_equipment.view']);
    getNextMeetingInfo.mockResolvedValue({ success: true, data: null });
    getActivities.mockResolvedValue([activity(3, '2026-11-20')]);
    getPersonalEquipmentTasks.mockResolvedValue({ success: true, data: [] });
    const page = await renderDashboard();

    expect(document.querySelector('a[href^="/personal-equipment"]')).toBeNull();
    page.destroy();
  });

  test('a published list for an upcoming outing is offered on that outing, not as a page-wide button', async () => {
    mockPermissions = new Set(['personal_equipment.view']);
    getNextMeetingInfo.mockResolvedValue({ success: true, data: null });
    getActivities.mockResolvedValue([activity(3, '2026-11-20')]);
    getPersonalEquipmentTasks.mockResolvedValue({ success: true, data: [
      { meeting_id: 'activity-3', participant_id: 4, date: '2026-11-20', title: 'Outing 3', item_keys: [] },
    ] });
    const page = await renderDashboard();

    const links = [...document.querySelectorAll('a[href^="/personal-equipment"]')];
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/personal-equipment/activity-3']);
    expect(links[0].closest('.parent-upcoming')).not.toBeNull();
    page.destroy();
  });
});
