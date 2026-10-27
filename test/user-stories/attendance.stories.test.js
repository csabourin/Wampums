/**
 * @jest-environment jsdom
 *
 * User stories: attendance page (spa/modules/attendance/Attendance.js) with the real IndexedDB
 * layer (fake-indexeddb) and real date/cache-parsing logic.
 *
 * Implements: US-ATT-001, US-ATT-002, US-ATT-004, US-ATT-005, US-ATT-006,
 *             US-ATT-007, US-ATT-008, US-ATT-009, US-ATT-010, US-ATT-011,
 *             US-ATT-012, US-ATT-017, US-ATT-018, US-ATT-019, US-ATT-020,
 *             US-ATT-021, US-NAV-002
 */

'use strict';

require('fake-indexeddb/auto');
const { IDBFactory } = require('fake-indexeddb');
const axe = require('axe-core');

jest.mock('../../spa/api/api-action-roster.js', () => ({
  getActionRoster: jest.fn(async (date) => {
    const { getActivities } = require('../../spa/api/api-activities.js');
    const { offlineManager } = require('../../spa/modules/OfflineManager.js');
    const prepared = offlineManager.getPreparedActivityForDate(date);
    const activities = (await getActivities()).map((activity) => ({ ...activity,
      start_date: activity.activity_start_date || activity.activity_date,
      end_date: activity.activity_end_date || activity.activity_date,
      requires_permission: false, signed_participant_ids: [],
    }));
    if (!activities.length && offlineManager.campMode && prepared?.dates?.length) {
      activities.push({ id: 5, name: 'Prepared camp', start_date: prepared.dates[0],
        end_date: prepared.dates[prepared.dates.length - 1], requires_permission: false, signed_participant_ids: [] });
    }
    return { data: { activities, attendance: [] } };
  }),
  markActivityDeparture: jest.fn(() => Promise.resolve({ success: true })),
}));


jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugWarn: jest.fn(),
  debugError: jest.fn(),
  debugInfo: jest.fn()
}));

jest.mock('../../spa/config.js', () => ({
  CONFIG: {
    API_BASE_URL: 'http://localhost:3000',
    CACHE_DURATION: { SHORT: 60000, MEDIUM: 300000, LONG: 3600000, CAMP_MODE: 86400000 },
    UI: {}
  },
  getStorageKey: (key) => key
}));

jest.mock('../../spa/app.js', () => {
  const enJson = require('../../lang/en.json');
  return {
    app: {
      lang: 'en',
      userPermissions: ['attendance.view', 'attendance.manage']
    },
    translate: (key) => enJson[key] || key
  };
});

jest.mock('../../spa/ajax-functions.js', () => ({
  getParticipants: jest.fn(),
  getAttendance: jest.fn(),
  updateAttendance: jest.fn(),
  getAttendanceDates: jest.fn(),
  saveGuest: jest.fn(),
  getGuestsByDate: jest.fn(),
  getApiUrl: jest.fn((path) => `http://localhost:3000/api/${path}`),
  getAuthHeader: jest.fn(() => ({ Authorization: 'Bearer test' })),
  getCurrentOrganizationId: jest.fn(() => 1)
}));

jest.mock('../../spa/modules/OfflineManager.js', () => ({
  offlineManager: {
    campMode: false,
    isOffline: false,
    isDatePrepared: jest.fn(() => false),
    getPreparedActivityForDate: jest.fn(() => null),
    queueMutation: jest.fn(async () => {})
  }
}));

jest.mock('../../spa/api/api-activities.js', () => ({
  getActivities: jest.fn(async () => [])
}));

const ajax = require('../../spa/ajax-functions.js');
const { app: mockGlobalApp } = require('../../spa/app.js');
const { getActivities } = require('../../spa/api/api-activities.js');
const { setCachedData, getCachedData } = require('../../spa/indexedDB.js');
const { formatDate, getTodayISO } = require('../../spa/utils/DateUtils.js');
const { Attendance } = require('../../spa/modules/attendance/Attendance.js');
const { ActionRoster } = require('../../spa/components/ActionRoster.js');
const {
  tr,
  flushPromises,
  buildParticipants,
  i18nGaps
} = require('./helpers/story-helpers');

function isoDaysFromToday(offset) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toLocaleDateString('en-CA');
}

const TODAY = getTodayISO();
const YESTERDAY = isoDaysFromToday(-1);
const TOMORROW = isoDaysFromToday(1);

function makeAppStub() {
  return {
    lang: 'en',
    showMessage: jest.fn(),
    router: { navigate: jest.fn() }
  };
}

/**
 * Two groups: Wolves (Zed = first leader, Bob) and Bears (Cam, Dana).
 */
function standardParticipants() {
  return buildParticipants([
    { id: 1, first_name: 'Bob', last_name: 'Low', group_id: 1, group_name: 'Wolves' },
    { id: 2, first_name: 'Zed', last_name: 'Lead', group_id: 1, group_name: 'Wolves', first_leader: true },
    { id: 3, first_name: 'Cam', last_name: 'Mid', group_id: 2, group_name: 'Bears' },
    { id: 4, first_name: 'Dana', last_name: 'End', group_id: 2, group_name: 'Bears' }
  ]);
}

function seedStandardData({ attendanceToday = [] } = {}) {
  ajax.getAttendanceDates.mockResolvedValue({ success: true, data: [TODAY] });
  ajax.getParticipants.mockResolvedValue({ success: true, data: standardParticipants() });
  ajax.getAttendance.mockImplementation(async () => ({ success: true, data: attendanceToday }));
  ajax.getGuestsByDate.mockResolvedValue({ success: true, data: [] });
  ajax.updateAttendance.mockResolvedValue({ success: true });
  ajax.saveGuest.mockResolvedValue({ success: true });
  getActivities.mockResolvedValue([]);
}

// Pages listen on window; destroy them so one test's page cannot react to the next test's events.
const openedPages = [];

async function initPage() {
  const appStub = makeAppStub();
  const page = new Attendance(appStub);
  openedPages.push(page);
  await page.init();
  await flushPromises();
  return { page, appStub };
}

function statusChip(participantId) {
  return document
    .querySelector(`.participant-row[data-participant-id="${participantId}"] .participant-status`)
    .textContent.trim();
}

function setOnline(value) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value });
}

beforeEach(() => {
  global.indexedDB = new IDBFactory();
  document.body.innerHTML = '<div id="app"></div>';
  jest.clearAllMocks();
  setOnline(true);
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ success: true, data: {} }) }));
  mockGlobalApp.userPermissions = ['attendance.view', 'attendance.manage'];
});

afterEach(() => {
  openedPages.splice(0).forEach((page) => page.destroy());
});

test('attendance and activity roster start together and the page waits for both', async () => {
  seedStandardData();
  let finishRoster;
  const page = new Attendance(makeAppStub());
  openedPages.push(page);
  const attendanceLoad = jest.spyOn(page, 'preloadAttendanceData');
  const rosterLoad = jest.spyOn(page.roster, 'load').mockImplementation(() => new Promise((resolve) => {
    finishRoster = resolve;
  }));

  const loading = page.init();
  expect(rosterLoad).toHaveBeenCalledWith(TODAY);
  expect(attendanceLoad).toHaveBeenCalled();
  await attendanceLoad.mock.results[0].value;
  expect(ajax.getParticipants).toHaveBeenCalled();
  expect(document.querySelector('.participant-row[data-participant-id="1"]')).toBeNull();

  finishRoster();
  await loading;
  expect(document.querySelector('.participant-row[data-participant-id="1"]')).not.toBeNull();
});

test('a late attendance error cannot replace a screen opened after navigation', async () => {
  seedStandardData();
  let failRoster;
  const page = new Attendance(makeAppStub());
  openedPages.push(page);
  jest.spyOn(page.roster, 'load').mockImplementation(() => new Promise((_resolve, reject) => {
    failRoster = reject;
  }));
  const loading = page.init();
  page.destroy();
  document.getElementById('app').innerHTML = '<h1>Next screen</h1>';
  failRoster(new Error('Connection lost'));
  await loading;
  expect(document.querySelector('#app h1').textContent).toBe('Next screen');
});

test('changing dates starts both reads together and waits for both before carrying attendance', async () => {
  const page = new Attendance(makeAppStub());
  openedPages.push(page);
  let finishAttendance;
  let finishRoster;
  const attendanceLoad = jest.spyOn(page, 'fetchData').mockImplementation(() => new Promise((resolve) => {
    finishAttendance = resolve;
  }));
  const rosterLoad = jest.spyOn(ActionRoster.prototype, 'load').mockImplementation(() => new Promise((resolve) => {
    finishRoster = resolve;
  }));
  const carry = jest.spyOn(page, 'autoCarryForward').mockResolvedValue();
  jest.spyOn(page, 'detectActivityContext').mockResolvedValue();

  const loading = page.loadDate(YESTERDAY);
  expect(attendanceLoad).toHaveBeenCalledWith(true);
  expect(rosterLoad).toHaveBeenCalledWith(YESTERDAY);
  finishAttendance();
  await flushPromises();
  expect(carry).not.toHaveBeenCalled();
  finishRoster();
  await loading;
  expect(carry).toHaveBeenCalledTimes(1);
  rosterLoad.mockRestore();
});

test('a failed date change keeps the visible date and its activity eligibility', async () => {
  seedStandardData();
  const { page, appStub } = await initPage();
  const previousRoster = page.roster;
  previousRoster.activities = [{ id: 7, requires_permission: true, signed_participant_ids: [1] }];
  previousRoster.activityId = 7;
  const previousParticipants = page.participants;
  jest.spyOn(page, 'fetchData').mockRejectedValue(new Error('Attendance unavailable'));
  const rosterLoad = jest.spyOn(ActionRoster.prototype, 'load').mockImplementation(function (date) {
    this.date = date;
    this.activities = [{ id: 8, requires_permission: true, signed_participant_ids: [2] }];
    this.activityId = 8;
    return Promise.resolve();
  });

  await page.loadDate(YESTERDAY);
  expect(page.currentDate).toBe(TODAY);
  expect(page.roster).toBe(previousRoster);
  expect(page.roster.includes(1)).toBe(true);
  expect(page.roster.includes(2)).toBe(false);
  expect(page.participants).toBe(previousParticipants);
  expect(appStub.showMessage).toHaveBeenCalledWith(tr('error_loading_attendance'), 'error');
  rosterLoad.mockRestore();
});

describe('US-ATT-001 — See my unit grouped, with honest statuses', () => {
  it('keeps the full year visible with a compact localized date and labels its search', async () => {
    seedStandardData();
    await initPage();
    const option = document.querySelector('#dateSelect option:checked');
    expect(option.textContent.trim()).toBe(formatDate(option.value, 'en', {
      weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
    }));
    expect(document.querySelector('label[for="attendance-search"]')).not.toBeNull();
  });
  it('shows a skeleton while loading', () => {
    const page = new Attendance(makeAppStub());
    page.renderSkeleton();
    expect(document.querySelector('.attendance-container.skeleton')).not.toBeNull();
  });

  it('groups participants, leaders first, and never fakes a status', async () => {
    seedStandardData({ attendanceToday: [{ participant_id: 1, status: 'present' }] });
    await initPage();

    const cards = document.querySelectorAll('.group-card');
    expect(cards).toHaveLength(2);

    // Bears sorts before Wolves alphabetically
    expect(cards[0].querySelector('.group-header').textContent).toBe('Bears');

    // Zed (first leader) renders before Bob inside Wolves
    const wolvesRows = cards[1].querySelectorAll('.participant-row');
    expect(wolvesRows[0].dataset.participantId).toBe('2');

    expect(statusChip(1)).toBe(tr('present'));
    expect(statusChip(2)).toBe(tr('unmarked'));
    expect(statusChip(3)).toBe(tr('unmarked'));
  });
});

describe('US-ATT-002 — Mark one kid present instantly', () => {
  it('flips the chip optimistically, persists, toasts and rewrites the cache', async () => {
    seedStandardData();
    const { page, appStub } = await initPage();

    document.querySelector('.participant-row[data-participant-id="3"]')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(page.selectedParticipant).not.toBeNull();

    await page.updateStatus('present');
    await flushPromises();

    expect(statusChip(3)).toBe(tr('present'));
    expect(ajax.updateAttendance).toHaveBeenCalledWith('3', 'present', TODAY, null);
    expect(appStub.showMessage).toHaveBeenCalledWith(tr('attendance_updated'), 'success');

    const cached = await getCachedData(`attendance_${TODAY}`);
    expect(cached.attendanceData['3']).toBe('present');
  });

  it('tells me when nothing is selected', async () => {
    seedStandardData();
    const { page, appStub } = await initPage();

    await page.updateStatus('present');

    expect(appStub.showMessage).toHaveBeenCalledWith(tr('no_selection'), 'error');
    expect(ajax.updateAttendance).not.toHaveBeenCalled();
  });
});

describe('US-ATT-004 — Mark a whole group at once, partial failures roll back individually', () => {
  it('keeps successful members and reverts only the failed one', async () => {
    seedStandardData();
    ajax.updateAttendance.mockImplementation(async (participantId) => (
      String(participantId) === '1' ? { success: false } : { success: true }
    ));

    const { page, appStub } = await initPage();
    const wolvesHeader = document.querySelector('.group-header[data-group-id="1"]');
    wolvesHeader.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(page.selectedGroup).toBe('1');

    await page.updateStatus('present');
    await flushPromises();

    expect(statusChip(2)).toBe(tr('present'));
    expect(statusChip(1)).toBe(tr('unmarked'));
    expect(appStub.showMessage).toHaveBeenCalledWith(tr('error_updating_group_attendance'), 'error');
  });
});

describe('US-ATT-005 — A failed save never leaves a phantom status', () => {
  it('restores the exact previous status and shows the server\'s message', async () => {
    seedStandardData({ attendanceToday: [{ participant_id: 3, status: 'late' }] });
    ajax.updateAttendance.mockRejectedValue(new Error('nope'));

    const { page, appStub } = await initPage();
    page.toggleIndividualSelection(document.querySelector('.participant-row[data-participant-id="3"]'));

    await page.updateStatus('absent');
    await flushPromises();

    expect(statusChip(3)).toBe(tr('late'));
    expect(page.attendanceData['3']).toBe('late');
    // Explained in the page's language; the server's own text is not shown.
    expect(appStub.showMessage).toHaveBeenCalledWith(tr('error_updating_attendance'), 'error');
    expect(appStub.showMessage).not.toHaveBeenCalledWith('nope', 'error');
  });
});

describe('US-ATT-006 — One tap marks everyone still unmarked as present', () => {
  it('shows the translated count, persists each unmarked kid, then disappears', async () => {
    seedStandardData({
      attendanceToday: [
        { participant_id: 1, status: 'present' },
        { participant_id: 2, status: 'late' }
      ]
    });
    const { page } = await initPage();

    const button = document.getElementById('mark-remaining-present');
    expect(button.textContent.trim()).toBe(tr('mark_remaining_present', { count: 2 }));

    await page.markAllRemainingPresent();
    await flushPromises();

    expect(ajax.updateAttendance).toHaveBeenCalledTimes(2);
    expect(ajax.updateAttendance).toHaveBeenCalledWith(3, 'present', TODAY, null);
    expect(ajax.updateAttendance).toHaveBeenCalledWith(4, 'present', TODAY, null);
    expect(statusChip(3)).toBe(tr('present'));
    expect(document.getElementById('mark-remaining-present')).toBeNull();
  });

  it('reverts the kids whose save failed', async () => {
    seedStandardData({ attendanceToday: [{ participant_id: 1, status: 'present' }] });
    ajax.updateAttendance.mockImplementation(async (participantId) => (
      participantId === 4 ? { success: false } : { success: true }
    ));

    const { page, appStub } = await initPage();
    await page.markAllRemainingPresent();
    await flushPromises();

    expect(statusChip(3)).toBe(tr('present'));
    expect(statusChip(4)).toBe(tr('unmarked'));
    expect(appStub.showMessage).toHaveBeenCalledWith(tr('error_updating_attendance'), 'error');
  });
});

function seedCampContext({ day1Attendance }) {
  seedStandardData();
  ajax.getAttendanceDates.mockResolvedValue({ success: true, data: [TODAY, YESTERDAY] });
  getActivities.mockResolvedValue([{
    id: 9,
    name: 'Summer Camp',
    activity_start_date: YESTERDAY,
    activity_end_date: TOMORROW
  }]);
  ajax.getAttendance.mockImplementation(async (date) => ({
    success: true,
    data: date === YESTERDAY ? day1Attendance : []
  }));
}

describe('US-ATT-007 — Carry-forward on day 2 of camp', () => {
  const DAY1 = [
    { participant_id: 1, status: 'present' },
    { participant_id: 2, status: 'present' },
    { participant_id: 3, status: 'late' },
    { participant_id: 4, status: 'absent' }
  ];

  it('pre-fills present/late from day 1, keeps absences unmarked, toasts, and syncs to the server', async () => {
    seedCampContext({ day1Attendance: DAY1 });
    const { page, appStub } = await initPage();

    expect(page.attendanceData).toEqual({ 1: 'present', 2: 'present', 3: 'late' });
    expect(statusChip(1)).toBe(tr('present'));
    expect(statusChip(3)).toBe(tr('late'));
    expect(statusChip(4)).toBe(tr('unmarked'));

    expect(appStub.showMessage).toHaveBeenCalledWith(
      tr('attendance_carried_forward', { count: 3, date: formatDate(YESTERDAY, 'en') }),
      'info'
    );

    const carryCall = global.fetch.mock.calls.find(([url]) => url.includes('v1/attendance/carry-forward'));
    expect(carryCall).toBeDefined();
    expect(JSON.parse(carryCall[1].body)).toEqual({ fromDate: YESTERDAY, toDate: TODAY });
  });

  it('does not carry forward when today already has attendance', async () => {
    seedCampContext({ day1Attendance: DAY1 });
    ajax.getAttendance.mockImplementation(async (date) => ({
      success: true,
      data: date === YESTERDAY ? DAY1 : [{ participant_id: 1, status: 'absent' }]
    }));

    const { page, appStub } = await initPage();

    expect(page.attendanceData).toEqual({ 1: 'absent' });
    expect(appStub.showMessage).not.toHaveBeenCalled();
  });
});

describe('US-ATT-008 — Carry-forward still works with no signal', () => {
  it('pre-fills from the cached previous day without any network carry-forward call', async () => {
    seedCampContext({ day1Attendance: [] });
    setOnline(false);

    await setCachedData(`attendance_${YESTERDAY}`, {
      participants: standardParticipants(),
      attendanceData: { 1: 'present', 4: 'absent' },
      guests: [],
      groups: []
    });

    const { page } = await initPage();

    expect(page.attendanceData).toEqual({ 1: 'present' });
    const carryCall = global.fetch.mock.calls.find(([url]) => url.includes('carry-forward'));
    expect(carryCall).toBeUndefined();
  });
});

describe('US-ATT-009 — I can see which camp day I\'m on', () => {
  it('shows the activity name and translated day label during a camp', async () => {
    seedCampContext({ day1Attendance: [] });
    await initPage();

    const banner = document.querySelector('.camp-banner');
    expect(banner).not.toBeNull();
    expect(banner.textContent).toContain('Summer Camp');
    expect(banner.textContent).toContain(tr('camp_day_of', { day: 2, total: 3 }));
  });

  it('renders no banner outside any activity', async () => {
    seedStandardData();
    await initPage();
    expect(document.querySelector('.camp-banner')).toBeNull();
  });
});

describe('US-ATT-010 — Switching dates shows that day\'s data', () => {
  it('lists dates newest first with today selected, and refetches on change', async () => {
    const PAST = isoDaysFromToday(-7);
    seedStandardData();
    ajax.getAttendanceDates.mockResolvedValue({ success: true, data: [PAST] });

    const { page } = await initPage();

    // Today was added and sorted to the front even though the API omitted it
    expect(page.availableDates[0]).toBe(TODAY);
    expect(page.currentDate).toBe(TODAY);
    const options = [...document.querySelectorAll('#dateSelect option')].map((o) => o.value);
    expect(options).toEqual([TODAY, PAST]);

    ajax.getAttendance.mockClear();
    await page.changeDate(PAST);
    await flushPromises();

    expect(ajax.getAttendance).toHaveBeenCalledWith(PAST);
    expect(document.getElementById('dateSelect').value).toBe(PAST);
  });
});

describe('US-ATT-011 — Add a visiting guest', () => {
  it('requires a name', async () => {
    seedStandardData();
    const { page, appStub } = await initPage();

    document.getElementById('guestName').value = '   ';
    await page.addGuest();

    expect(appStub.showMessage).toHaveBeenCalledWith(tr('guest_name_required'), 'error');
    expect(ajax.saveGuest).not.toHaveBeenCalled();
  });

  it('saves the guest on today\'s date and shows them in the list', async () => {
    seedStandardData();
    const { page, appStub } = await initPage();

    document.getElementById('guestName').value = 'Visiting Vic';
    document.getElementById('guestEmail').value = 'vic@example.com';
    await page.addGuest();

    expect(ajax.saveGuest).toHaveBeenCalledWith({
      name: 'Visiting Vic',
      email: 'vic@example.com',
      attendance_date: TODAY
    });
    expect(document.getElementById('guestList').textContent).toContain('Visiting Vic');
    expect(document.getElementById('guestName').value).toBe('');
    expect(appStub.showMessage).toHaveBeenCalledWith(tr('guest_added_successfully'), 'success');
  });
});

describe('US-ATT-011b — Someone not on the list: a new child or an adult visitor', () => {
  const permissions = mockGlobalApp.userPermissions;
  afterEach(() => { mockGlobalApp.userPermissions = permissions; });

  it('offers to welcome a new child onto the roster, returning to attendance afterwards', async () => {
    mockGlobalApp.userPermissions = [...permissions, 'participants.walk_in'];
    seedStandardData();
    await initPage();

    const link = document.querySelector('a[href="/walk-in-children?from=attendance"]');
    expect(link.textContent.trim()).toBe(tr('tile_walk_in_children'));
    expect(link.closest('.guest-entry__option').querySelector('h3').textContent).toBe(tr('attendance_guest_youth_title'));
  });

  it('does not offer to welcome a child to someone who may not add one', async () => {
    seedStandardData();
    await initPage();

    expect(document.querySelector('a[href^="/walk-in-children"]')).toBeNull();
    expect(document.getElementById('attendance-guest-form')).not.toBeNull();
  });

  it('notes an adult visitor for the date on screen, from labelled fields and a submit button', async () => {
    seedStandardData();
    const { appStub } = await initPage();

    expect(document.getElementById('attendance-guest-hint').textContent)
      .toContain(formatDate(TODAY, 'en'));
    document.getElementById('guestName').value = 'Ada Lovelace';
    document.getElementById('attendance-guest-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(ajax.saveGuest).toHaveBeenCalledWith({ name: 'Ada Lovelace', email: '', attendance_date: TODAY });
    expect(appStub.showMessage).toHaveBeenCalledWith(tr('guest_added_successfully'), 'success');
    expect(document.getElementById('guestList').textContent).toContain('Ada Lovelace');
  });

  it('an empty name marks the field and keeps focus on it', async () => {
    seedStandardData();
    const { page } = await initPage();

    await page.addGuest();
    const name = document.getElementById('guestName');
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(name);
    name.value = 'A';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    expect(name.hasAttribute('aria-invalid')).toBe(false);
  });

  it('a visitor kept on the device while offline is not reported as saved', async () => {
    seedStandardData();
    ajax.saveGuest.mockResolvedValue({ success: true, queued: true });
    const { page, appStub } = await initPage();

    document.getElementById('guestName').value = 'Léa Tremblay';
    await page.addGuest();

    expect(appStub.showMessage).toHaveBeenCalledWith(tr('attendance_guest_queued'), 'info');
    expect(appStub.showMessage).not.toHaveBeenCalledWith(tr('guest_added_successfully'), 'success');
  });

  it('a visitor name is shown as text, and the section has no WCAG A/AA violations', async () => {
    mockGlobalApp.userPermissions = [...permissions, 'participants.walk_in'];
    seedStandardData();
    ajax.getGuestsByDate.mockResolvedValue({ success: true, data: [
      { name: '<img src=x onerror=alert(1)>', email: null, attendance_date: TODAY },
    ] });
    await initPage();

    const section = document.querySelector('.guest-entry');
    expect(section.querySelector('img')).toBeNull();
    expect(section.textContent).toContain('<img src=x onerror=alert(1)>');
    const results = await axe.run(section, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });
});

describe('US-ATT-012 — Find a kid by typing their name', () => {
  it('filters the list after the debounce and drops empty groups', async () => {
    seedStandardData();
    await initPage();

    jest.useFakeTimers();
    try {
      const search = document.getElementById('attendance-search');
      search.value = 'cam';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      jest.advanceTimersByTime(300);

      const rows = document.querySelectorAll('.participant-row');
      expect(rows).toHaveLength(1);
      expect(rows[0].dataset.participantId).toBe('3');
      expect(document.querySelectorAll('.group-card')).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('US-ATT-017 — Camp date math never explodes', () => {
  const page = () => new Attendance({ lang: 'en' });

  it('enumerates an inclusive 3-day range from local components', () => {
    expect(page().enumerateDateRange('2026-07-14', '2026-07-16'))
      .toEqual(['2026-07-14', '2026-07-15', '2026-07-16']);
  });

  it('collapses a runaway range (> 31 days) to its start date', () => {
    expect(page().enumerateDateRange('2026-07-01', '2026-09-15')).toEqual(['2026-07-01']);
  });

  it('collapses invalid input to the start date', () => {
    expect(page().enumerateDateRange('garbage', '2026-07-16')).toEqual(['garbage']);
  });

  it('does not set a camp context when the selected date is outside its safe fallback', async () => {
    const attendance = page();
    attendance.currentDate = '2026-08-15';
    getActivities.mockResolvedValue([{
      id: 9,
      name: 'Long Camp',
      activity_start_date: '2026-07-01',
      activity_end_date: '2026-08-15'
    }]);

    await attendance.detectActivityContext();

    expect(attendance.activeActivity).toBeNull();
  });
});

describe('US-ATT-018 / US-I18N-001 — attendance strings exist in both languages', () => {
  it('en.json and fr.json both contain every attendance-flow key', () => {
    const keys = [
      'present', 'absent', 'late', 'excused', 'unmarked',
      'attendance_updated', 'error_updating_attendance', 'group_attendance_updated',
      'error_updating_group_attendance', 'attendance_carried_forward', 'camp_day_of',
      'mark_remaining_present', 'no_selection', 'add_guest', 'guest_name',
      'guest_email_optional', 'add_guest_button', 'guest_name_required',
      'guest_added_successfully', 'error_saving_guest', 'error_loading_attendance',
      'first_leader', 'second_leader', 'no_email', 'search', 'back', 'error'
    ];
    expect(i18nGaps(keys)).toEqual({ missingEn: [], missingFr: [] });
  });
});

describe('US-ATT-019 — Old cached data still loads after an app update', () => {
  const page = () => new Attendance({ lang: 'en' });

  it('parses the {data: ...} wrapper with an attendance array (camp prep shape)', () => {
    const entry = page().parseAttendanceCacheEntry({
      data: {
        participants: standardParticipants(),
        attendanceData: [
          { participant_id: 1, attendance_status: 'present' },
          { participant_id: 2, status: 'late' }
        ],
        groups: [{ id: 1, name: 'Wolves' }]
      }
    });
    expect(entry.attendanceMap).toEqual({ 1: 'present', 2: 'late' });
    // Raw group rows are rebuilt into the grouped render structure
    expect(entry.groups[0].participants).toBeDefined();
  });

  it('parses the flat map shape and preserves pre-grouped groups', () => {
    const grouped = [{ id: 1, name: 'Wolves', participants: [] }];
    const entry = page().parseAttendanceCacheEntry({
      participants: [],
      attendanceMap: { 5: 'excused' },
      guests: [{ name: 'Vic' }],
      groups: grouped
    });
    expect(entry.attendanceMap).toEqual({ 5: 'excused' });
    expect(entry.groups).toEqual(grouped);
    expect(entry.guests).toHaveLength(1);
  });
});

describe('US-ATT-020 — Navigating away mid-load never paints over the next page', () => {
  it('render() is a no-op once the attendance container is gone', async () => {
    seedStandardData();
    const { page } = await initPage();

    document.body.innerHTML = '<div id="app"><p>next page</p></div>';
    page.render();

    expect(document.body.textContent).toContain('next page');
    expect(document.querySelector('.attendance-container')).toBeNull();
  });

  it('a failed initial load renders the translated error page', async () => {
    seedStandardData();
    ajax.getAttendanceDates.mockRejectedValue(new Error('down'));

    await initPage();

    expect(document.body.textContent).toContain(tr('error_loading_attendance'));
  });
});

describe('US-ATT-021 — A status saved offline and refused on replay does not stay on screen', () => {
  const refuse = (kind) => window.dispatchEvent(new CustomEvent('offlineMutationRejected', {
    detail: { url: 'http://localhost:3000/api/v1/attendance', method: 'POST', kind, mutationId: 'm-1', status: 403 },
  }));

  async function markPresentOffline() {
    seedStandardData();
    ajax.updateAttendance.mockResolvedValue({ success: true, queued: true });
    const opened = await initPage();
    document.querySelector('.participant-row[data-participant-id="3"]')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await opened.page.updateStatus('present');
    await flushPromises();
    expect(statusChip(3)).toBe(tr('present'));
    return opened;
  }

  it('reloads the date from the server, which never recorded the status', async () => {
    const { page } = await markPresentOffline();
    const loadsBefore = ajax.getAttendance.mock.calls.length;
    const reload = jest.spyOn(page, 'reloadAfterRejectedChange');

    refuse('attendance');
    await reload.mock.results[0].value;

    expect(ajax.getAttendance.mock.calls.length).toBeGreaterThan(loadsBefore);
    expect(statusChip(3)).toBe(tr('unmarked'));
    expect(await getCachedData(`attendance_${TODAY}`)).not.toEqual(
      expect.objectContaining({ attendanceData: expect.objectContaining({ 3: 'present' }) }),
    );
  });

  it('on a camp day, the reload only reads: it does not carry the refused statuses forward again', async () => {
    seedCampContext({ day1Attendance: [{ participant_id: 1, status: 'present' }] });
    const { page } = await initPage();
    expect(statusChip(1)).toBe(tr('present'));
    const carryCalls = () => global.fetch.mock.calls.filter(([url]) => url.includes('v1/attendance/carry-forward')).length;
    const carriedBefore = carryCalls();
    const reload = jest.spyOn(page, 'reloadAfterRejectedChange');

    refuse('attendance');
    await reload.mock.results[0].value;

    expect(carryCalls()).toBe(carriedBefore);
    expect(statusChip(1)).toBe(tr('unmarked'));
  });

  it('ignores a refused change of another kind', async () => {
    await markPresentOffline();
    const loadsBefore = ajax.getAttendance.mock.calls.length;

    refuse('medication');
    await flushPromises();

    expect(ajax.getAttendance.mock.calls.length).toBe(loadsBefore);
    expect(statusChip(3)).toBe(tr('present'));
  });

  it('does nothing once the person has left the page', async () => {
    const { page } = await markPresentOffline();
    const loadsBefore = ajax.getAttendance.mock.calls.length;
    page.destroy();

    refuse('attendance');
    await flushPromises();

    expect(ajax.getAttendance.mock.calls.length).toBe(loadsBefore);
  });
});

describe('US-NAV-002 — No attendance permission, no attendance page', () => {
  it('redirects to the dashboard without fetching anything', async () => {
    seedStandardData();
    mockGlobalApp.userPermissions = [];

    const appStub = makeAppStub();
    const page = new Attendance(appStub);
    await page.init();

    expect(appStub.router.navigate).toHaveBeenCalledWith('/dashboard');
    expect(ajax.getAttendanceDates).not.toHaveBeenCalled();
  });
});

describe('US-ATT-A11Y — The page says what it is, in every state', () => {
  const pageTitle = () => document.querySelectorAll('#app h1');

  it('opens with a back link, then the page title, while loading', () => {
    const page = new Attendance(makeAppStub());
    page.renderSkeleton();

    const first = document.querySelector('#app').firstElementChild;
    expect(first.tagName).toBe('A');
    expect(first.getAttribute('href')).toBe('/dashboard');
    expect(pageTitle()).toHaveLength(1);
    expect(pageTitle()[0].textContent).toBe(tr('attendance_page_title'));
  });

  it('keeps one page title once the unit is loaded', async () => {
    seedStandardData();
    await initPage();

    expect(pageTitle()).toHaveLength(1);
    expect(pageTitle()[0].textContent).toBe(tr('attendance_page_title'));
    expect(document.querySelector('#app').firstElementChild.getAttribute('href')).toBe('/dashboard');
  });

  it('explains a failed load in the page, with a way back and a retry that loads again', async () => {
    seedStandardData();
    ajax.getAttendanceDates.mockRejectedValueOnce(new Error('offline'));
    ajax.getParticipants.mockRejectedValueOnce(new Error('offline'));
    await initPage();

    expect(pageTitle()[0].textContent).toBe(tr('attendance_page_title'));
    expect(document.querySelector('[role="alert"]').textContent).toBe(tr('error_loading_attendance'));
    expect(document.querySelector('#app').firstElementChild.getAttribute('href')).toBe('/dashboard');

    document.getElementById('attendance-retry').click();
    // The reload goes through IndexedDB: wait for its outcome, not a fixed number of ticks.
    for (let tick = 0; tick < 50 && document.querySelectorAll('.group-card:not(.skeleton)').length === 0; tick += 1) {
      // eslint-disable-next-line no-await-in-loop -- polls until the page is drawn
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.querySelectorAll('.group-card')).toHaveLength(2);
  });
});


test('marking the remaining participants present only touches the signed roster', async () => {
  seedStandardData();
  const { getActionRoster } = require('../../spa/api/api-action-roster.js');
  getActionRoster.mockResolvedValueOnce({ data: {
    activities: [{ id: 5, name: 'Camp des Érables', start_date: TODAY, end_date: TODAY, requires_permission: true, signed_participant_ids: [1] }],
    attendance: [],
  } });
  const { page } = await initPage();
  expect(document.querySelector('.participant-row[data-participant-id="2"]')).toBeNull();
  await page.markAllRemainingPresent();
  expect(ajax.updateAttendance).toHaveBeenCalledTimes(1);
  expect(ajax.updateAttendance).toHaveBeenCalledWith(1, 'present', TODAY, null);
});

test('an offline departure is written to the shared cache for points and honors', async () => {
  seedStandardData({ attendanceToday: [{ participant_id: 1, status: 'present' }] });
  const { markActivityDeparture } = require('../../spa/api/api-action-roster.js');
  markActivityDeparture.mockResolvedValueOnce({ success: true, queued: true });
  const { page } = await initPage();
  await page.updateIndividualStatus(1, 'departed');
  expect(markActivityDeparture).toHaveBeenCalledWith(1, TODAY);
  expect((await getCachedData(`attendance_${TODAY}`)).attendanceData[1]).toBe('departed');
  expect(statusChip(1)).toBe(tr('departed'));
});

test('a group departure keeps successful saves when another departure is refused', async () => {
  seedStandardData({ attendanceToday: [{ participant_id: 1, status: 'present' }, { participant_id: 2, status: 'late' }] });
  const { markActivityDeparture } = require('../../spa/api/api-action-roster.js');
  markActivityDeparture.mockResolvedValueOnce({ success: true }).mockRejectedValueOnce(new Error('refused'));
  const { page } = await initPage();
  await page.updateGroupStatus(1, 'departed');
  expect(statusChip(1)).toBe(tr('departed'));
  expect(statusChip(2)).toBe(tr('late'));
  const cached = await getCachedData(`attendance_${TODAY}`);
  expect(cached.attendanceData).toMatchObject({ 1: 'departed', 2: 'late' });
});


test('a departure remains the latest camp attendance source instead of reviving an older presence', async () => {
  await setCachedData(`attendance_${YESTERDAY}`, { attendanceData: { 1: 'present' } }, 60000);
  await setCachedData(`attendance_${TODAY}`, { attendanceData: { 1: 'departed' } }, 60000);
  const page = new Attendance(makeAppStub());
  const source = await page.findCarryForwardSourceOffline([YESTERDAY, TODAY]);
  expect(source).toEqual({ date: TODAY, attendance: { 1: 'departed' } });
  page.destroy();
});

test('the online camp carry-forward excludes a participant who already left', async () => {
  ajax.getAttendance.mockResolvedValue({ success: true, data: [{ participant_id: 1, status: 'present', is_on_site: false }] });
  const page = new Attendance(makeAppStub());
  const source = await page.findCarryForwardSourceOnline([YESTERDAY]);
  expect(source.attendance[1]).toBe('departed');
  page.destroy();
});

test('a planned meeting keeps the whole attendance roster without carrying an overlapping camp', async () => {
  seedStandardData();
  getActivities.mockResolvedValue([{ id: 5, name: 'Camp des Érables', activity_start_date: YESTERDAY, activity_end_date: TOMORROW }]);
  const { getActionRoster } = require('../../spa/api/api-action-roster.js');
  getActionRoster.mockResolvedValueOnce({ data: {
    activities: [{ id: 5, name: 'Camp des Érables', start_date: YESTERDAY, end_date: TOMORROW, requires_permission: true, signed_participant_ids: [1] }],
    attendance: [], meeting_dates: [TODAY],
  } });
  const { page } = await initPage();
  expect(page.activeActivity).toBeNull();
  expect(document.querySelectorAll('.participant-row')).toHaveLength(4);
  expect(global.fetch.mock.calls.some(([url]) => String(url).includes('carry-forward'))).toBe(false);
});
