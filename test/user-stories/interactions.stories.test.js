/**
 * @jest-environment jsdom
 *
 * Cross-module interaction stories: attendance ↔ points ↔ honors ↔ activities
 * ↔ offline, driven through the real page classes, the real PointsStore and
 * the real IndexedDB layer (fake-indexeddb).
 *
 * Implements: US-INT-001, US-INT-002, US-INT-003, US-INT-004, US-INT-005,
 *             US-INT-006, US-INT-007, US-INT-008
 * Catalog: test/user-stories/CATALOG.md
 *
 * Server-side halves of these stories are asserted in the backend-*.stories
 * suites (US-ATT-003, US-PTS-013, US-HON-004/007, US-ACT-006).
 */

'use strict';

require('fake-indexeddb/auto');
const { IDBFactory } = require('fake-indexeddb');

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
    UI: { SYNC_TIMEOUT: 1 }
  },
  getStorageKey: (key) => key
}));

jest.mock('../../spa/app.js', () => {
  const enJson = require('../../lang/en.json');
  return {
    app: {
      lang: 'en',
      userPermissions: ['points.view', 'points.manage', 'attendance.view', 'attendance.manage']
    },
    translate: (key) => enJson[key] || key
  };
});

jest.mock('../../spa/ajax-functions.js', () => ({
  // shared by both pages
  getParticipants: jest.fn(),
  getAttendance: jest.fn(),
  // manage_points
  getGroups: jest.fn(),
  updatePoints: jest.fn(),
  // attendance
  updateAttendance: jest.fn(),
  getAttendanceDates: jest.fn(),
  saveGuest: jest.fn(),
  getGuestsByDate: jest.fn(),
  // plumbing
  getApiUrl: jest.fn((path) => `http://localhost:3000/api/${path}`),
  getAuthHeader: jest.fn(() => ({ Authorization: 'Bearer test' })),
  getCurrentOrganizationId: jest.fn(() => 1),
  CONFIG: { CACHE_DURATION: { SHORT: 60000, MEDIUM: 300000 } },
  API: { getNoCache: jest.fn() }
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
const { offlineManager } = require('../../spa/modules/OfflineManager.js');
const { getActivities } = require('../../spa/api/api-activities.js');
const {
  setCachedData,
  getCachedData,
  saveOfflineData,
  clearPointsRelatedCaches
} = require('../../spa/indexedDB.js');
const { getTodayISO } = require('../../spa/utils/DateUtils.js');
const { ManagePoints } = require('../../spa/manage_points.js');
const { Attendance } = require('../../spa/attendance.js');
const { PointsStore } = require('../../spa/modules/points/PointsStore.js');
const {
  tr,
  deferred,
  flushPromises,
  buildParticipants,
  buildGroups
} = require('./helpers/story-helpers');

const TODAY = getTodayISO();
const GROUP_ID = 1;

function isoDaysFromToday(offset) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toLocaleDateString('en-CA');
}

function makeAppStub() {
  return { lang: 'en', showMessage: jest.fn(), router: { navigate: jest.fn() } };
}

function pointsParticipants({ alexTotal = 10, samTotal = 5 } = {}) {
  return buildParticipants([
    { id: 1, first_name: 'Alex', last_name: 'River', group_id: GROUP_ID, group_name: 'Wolves', total_points: alexTotal },
    { id: 2, first_name: 'Sam', last_name: 'Stone', group_id: GROUP_ID, group_name: 'Wolves', total_points: samTotal }
  ]);
}

function seedPointsMocks({ alexTotal = 10, samTotal = 5, attendanceToday = [] } = {}) {
  ajax.getParticipants.mockResolvedValue({ success: true, data: pointsParticipants({ alexTotal, samTotal }) });
  ajax.getGroups.mockResolvedValue({ success: true, data: buildGroups([{ id: GROUP_ID, name: 'Wolves', total_points: 20 }]) });
  ajax.getAttendance.mockResolvedValue({ success: true, data: attendanceToday });
  ajax.updatePoints.mockResolvedValue({ success: true, data: { updates: [] } });
}

async function initPointsPage() {
  const appStub = makeAppStub();
  const page = new ManagePoints(appStub);
  await page.init();
  await flushPromises();
  return { page, appStub };
}

function participantTotalText(id) {
  return document.getElementById(`name-points-${id}`).textContent;
}

function selectParticipant(id) {
  document.querySelector(`.list-item[data-participant-id="${id}"]`)
    .dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function selectGroup(id) {
  document.querySelector(`.group-header[data-group-id="${id}"]`)
    .dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function clickPointButton(points) {
  document.querySelector(`.point-btn[data-points="${points}"]`)
    .dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function setOnline(value) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value });
}

beforeEach(() => {
  global.indexedDB = new IDBFactory();
  localStorage.clear();
  document.body.innerHTML = '<div id="app"></div>';
  jest.clearAllMocks();
  setOnline(true);
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ success: true, data: {} }) }));
});

describe('US-INT-001 — Marking attendance changes point totals with no stale jump', () => {
  it('after the attendance mutation invalidates points caches, the points page shows fresh totals', async () => {
    // 1. The points page has cached pre-attendance totals (Alex = 10)
    seedPointsMocks({ alexTotal: 10 });
    await initPointsPage();
    expect(participantTotalText(1)).toBe('10');
    expect(await getCachedData('manage_points_data')).not.toBeNull();

    // 2. Attendance mutation path invalidates points caches — this is the
    //    contract updateAttendance() executes after POST /v1/attendance
    //    (spa/api/api-endpoints.js), whose server side inserts point rows
    //    (asserted in US-ATT-003).
    await clearPointsRelatedCaches();
    expect(await getCachedData('manage_points_data')).toBeNull();
    expect(await getCachedData('participants')).toBeNull();

    // 3. Reopening the points page fetches fresh totals (Alex = 11 after +1)
    seedPointsMocks({ alexTotal: 11 });
    document.body.innerHTML = '<div id="app"></div>';
    await initPointsPage();

    expect(participantTotalText(1)).toBe('11');
  });
});

describe('US-INT-002 — UI and server agree on who a group award skips', () => {
  const ATTENDANCE_FIXTURE = [
    { participant_id: 1, status: 'present' },
    { participant_id: 2, status: 'absent' }
  ];

  /** The server's rule (routes/points.js): present/late only, when any attendance exists */
  function serverEligible(memberIds, attendanceRows) {
    if (attendanceRows.length === 0) {
      return { eligible: memberIds, skipped: [] };
    }
    const ok = new Set(attendanceRows
      .filter((row) => row.status === 'present' || row.status === 'late')
      .map((row) => row.participant_id));
    return {
      eligible: memberIds.filter((id) => ok.has(id)),
      skipped: memberIds.filter((id) => !ok.has(id))
    };
  }

  it('the optimistic skip set equals the server skip set for the same attendance', async () => {
    seedPointsMocks({ attendanceToday: ATTENDANCE_FIXTURE });
    const { page } = await initPointsPage();

    const ui = page.getEligibleGroupMemberIds(GROUP_ID);
    const server = serverEligible([1, 2], ATTENDANCE_FIXTURE);

    expect(ui.eligible).toEqual(server.eligible);
    expect(ui.skipped).toEqual(server.skipped);
  });

  it('after the server confirms, both screens end on the server\'s exact totals', async () => {
    seedPointsMocks({ attendanceToday: ATTENDANCE_FIXTURE });
    const pending = deferred();
    ajax.updatePoints.mockReturnValue(pending.promise);
    const { page } = await initPointsPage();

    selectGroup(GROUP_ID);
    clickPointButton(3);
    expect(participantTotalText(1)).toBe('13');
    expect(participantTotalText(2)).toBe('5');

    // Server response mirrors routes/points.js: skipped member's total unchanged
    pending.resolve({
      success: true,
      data: {
        updates: [{
          type: 'group',
          id: GROUP_ID,
          totalPoints: 23,
          memberIds: [1],
          skippedCount: 1,
          skippedParticipants: [2],
          memberTotals: [
            { id: 1, totalPoints: 13 },
            { id: 2, totalPoints: 5 }
          ]
        }]
      }
    });
    await flushPromises();

    expect(participantTotalText(1)).toBe('13');
    expect(participantTotalText(2)).toBe('5');
    expect(page.store.getGroupTotal(GROUP_ID)).toBe(23);
    expect(page.store.hasPendingDeltas()).toBe(false);
  });
});

describe('US-INT-003 — Honors move the scoreboard', () => {
  it('honor mutations clear the points caches so the next points read is fresh', async () => {
    // The award/delete honor client functions call clearPointsRelatedCaches()
    // (spa/api/api-endpoints.js); the honor's point rows are server-side
    // (US-HON-004 / US-HON-007).
    await setCachedData('manage_points_data', { participants: [], groups: [] });
    await setCachedData('points_report', { rows: [] });
    await setCachedData('dashboard_groups', []);

    await clearPointsRelatedCaches();

    expect(await getCachedData('manage_points_data')).toBeNull();
    expect(await getCachedData('points_report')).toBeNull();
    expect(await getCachedData('dashboard_groups')).toBeNull();
  });
});

describe('US-INT-004 — A new camp lights up attendance', () => {
  it('with a camp covering today, the page shows the banner and runs carry-forward', async () => {
    const YESTERDAY = isoDaysFromToday(-1);
    const TOMORROW = isoDaysFromToday(1);

    ajax.getAttendanceDates.mockResolvedValue({ success: true, data: [TODAY, YESTERDAY] });
    ajax.getParticipants.mockResolvedValue({
      success: true,
      data: buildParticipants([
        { id: 1, first_name: 'Alex', last_name: 'River', group_id: 1, group_name: 'Wolves' }
      ])
    });
    ajax.getGuestsByDate.mockResolvedValue({ success: true, data: [] });
    ajax.getAttendance.mockImplementation(async (date) => ({
      success: true,
      data: date === YESTERDAY ? [{ participant_id: 1, status: 'present' }] : []
    }));
    getActivities.mockResolvedValue([{
      id: 9,
      name: 'Summer Camp',
      activity_start_date: YESTERDAY,
      activity_end_date: TOMORROW
    }]);

    const appStub = makeAppStub();
    const page = new Attendance(appStub);
    await page.init();
    await flushPromises();

    const banner = document.querySelector('.camp-banner');
    expect(banner).not.toBeNull();
    expect(banner.textContent).toContain('Summer Camp');
    expect(banner.textContent).toContain(tr('camp_day_of', { day: 2, total: 3 }));

    expect(page.attendanceData).toEqual({ 1: 'present' });
    const carryCall = global.fetch.mock.calls.find(([url]) => url.includes('carry-forward'));
    expect(carryCall).toBeDefined();
  });
});

describe('US-INT-005 — Rapid-fire clicks with slow, out-of-order responses', () => {
  it('serializes batches and keeps the displayed total consistent throughout', async () => {
    seedPointsMocks();
    const first = deferred();
    const second = deferred();
    ajax.updatePoints
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const { page } = await initPointsPage();
    const observed = [];
    page.store.subscribe(() => observed.push(page.store.getParticipantTotal(1)));

    selectParticipant(1);
    clickPointButton(3);   // batch 1 → in flight
    clickPointButton(1);   // queued
    clickPointButton(-1);  // queued

    expect(participantTotalText(1)).toBe('13');
    expect(ajax.updatePoints).toHaveBeenCalledTimes(1);

    // Server confirms batch 1 (absolute total 13)
    first.resolve({ success: true, data: { updates: [{ type: 'participant', id: 1, totalPoints: 13 }] } });
    await flushPromises();

    // Queued clicks flushed as ONE second batch
    expect(ajax.updatePoints).toHaveBeenCalledTimes(2);
    expect(ajax.updatePoints.mock.calls[1][0]).toHaveLength(2);
    expect(participantTotalText(1)).toBe('13');

    second.resolve({ success: true, data: { updates: [{ type: 'participant', id: 1, totalPoints: 13 }] } });
    await flushPromises();

    expect(participantTotalText(1)).toBe('13');
    expect(page.store.hasPendingDeltas()).toBe(false);

    // The displayed total never rolled back below the confirmed base (10)
    observed.forEach((value) => expect(value).toBeGreaterThanOrEqual(10));
  });
});

describe('US-INT-006 — Going offline mid-action loses nothing', () => {
  it('queues the mutation, survives an offline reload from cache, and replays on reconnect', async () => {
    // 1. Award +5 while the network is dying: TypeError → queue + fold
    seedPointsMocks({ alexTotal: 10 });
    ajax.updatePoints.mockRejectedValue(new TypeError('Failed to fetch'));
    const { page } = await initPointsPage();

    selectParticipant(1);
    clickPointButton(5);
    await flushPromises();

    expect(offlineManager.queueMutation).toHaveBeenCalledTimes(1);
    const [queuedUrl, queuedOptions] = offlineManager.queueMutation.mock.calls[0];
    expect(participantTotalText(1)).toBe('15');
    expect(page.store.hasPendingDeltas()).toBe(false);

    const cached = await getCachedData('manage_points_data');
    expect(cached.participants.find((p) => String(p.id) === '1').total_points).toBe(15);

    // 2. "Reload" while offline: a fresh page instance boots from the cache
    setOnline(false);
    ajax.getParticipants.mockRejectedValue(new TypeError('Failed to fetch'));
    document.body.innerHTML = '<div id="app"></div>';
    const reloaded = new ManagePoints(makeAppStub());
    await reloaded.init();
    await flushPromises();

    expect(participantTotalText(1)).toBe('15');

    // 3. Reconnect: the queued mutation replays through the real OfflineManager
    setOnline(true);
    const { OfflineManager: RealOfflineManager } = jest.requireActual('../../spa/modules/OfflineManager.js');
    await saveOfflineData('POST', {
      url: queuedUrl,
      headers: queuedOptions.headers,
      body: queuedOptions.body
    });
    localStorage.setItem('jwtToken', 'fresh-token');
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ success: true })
    });

    await new RealOfflineManager().replayPendingMutations();

    const replayCall = global.fetch.mock.calls.find(([url]) => url.includes('v1/points'));
    expect(replayCall).toBeDefined();
    expect(JSON.parse(replayCall[1].body)[0]).toMatchObject({ type: 'individual', id: '1', points: 5 });
  });
});

describe('US-INT-007 — Every failure path restores the exact pre-action state', () => {
  it('points: display AND cache match the pre-click state after a server rejection', async () => {
    seedPointsMocks({ alexTotal: 10 });
    ajax.updatePoints.mockRejectedValue(new Error('rejected'));
    const { appStub } = await initPointsPage();

    const cachedBefore = await getCachedData('manage_points_data');

    selectParticipant(1);
    clickPointButton(5);
    expect(participantTotalText(1)).toBe('15');
    await flushPromises();

    expect(participantTotalText(1)).toBe('10');
    const cachedAfter = await getCachedData('manage_points_data');
    expect(cachedAfter.participants.find((p) => String(p.id) === '1').total_points)
      .toBe(cachedBefore.participants.find((p) => String(p.id) === '1').total_points);
    expect(appStub.showMessage).toHaveBeenCalledWith(expect.stringContaining('rejected'), 'error');
  });

  it('attendance: the chip and the data map match the pre-tap state after a failure', async () => {
    ajax.getAttendanceDates.mockResolvedValue({ success: true, data: [TODAY] });
    ajax.getParticipants.mockResolvedValue({
      success: true,
      data: buildParticipants([
        { id: 1, first_name: 'Alex', last_name: 'River', group_id: 1, group_name: 'Wolves' }
      ])
    });
    ajax.getAttendance.mockResolvedValue({ success: true, data: [{ participant_id: 1, status: 'late' }] });
    ajax.getGuestsByDate.mockResolvedValue({ success: true, data: [] });
    ajax.updateAttendance.mockRejectedValue(new Error('rejected'));
    getActivities.mockResolvedValue([]);

    const appStub = makeAppStub();
    const page = new Attendance(appStub);
    await page.init();
    await flushPromises();

    page.toggleIndividualSelection(document.querySelector('.participant-row[data-participant-id="1"]'));
    await page.updateStatus('absent');
    await flushPromises();

    expect(page.attendanceData['1']).toBe('late');
    expect(document.querySelector('.participant-status').textContent.trim()).toBe(tr('late'));
    expect(appStub.showMessage).toHaveBeenCalledWith('rejected', 'error');
  });
});

describe('US-INT-008 — Leaving and returning to a page doesn\'t double anything', () => {
  it('points: after navigating away and back, one click sends exactly one payload', async () => {
    seedPointsMocks();
    await initPointsPage();

    // Navigate away (router replaces the DOM) and back (fresh instance)
    document.body.innerHTML = '<div id="app"></div>';
    await initPointsPage();

    ajax.updatePoints.mockClear();
    ajax.updatePoints.mockResolvedValue({ success: true, data: { updates: [] } });
    selectParticipant(1);
    clickPointButton(1);
    await flushPromises();

    expect(ajax.updatePoints).toHaveBeenCalledTimes(1);
    expect(ajax.updatePoints.mock.calls[0][0]).toHaveLength(1);
  });

  it('attendance: re-attaching listeners does not double date-change handling', async () => {
    const PAST = isoDaysFromToday(-7);
    ajax.getAttendanceDates.mockResolvedValue({ success: true, data: [TODAY, PAST] });
    ajax.getParticipants.mockResolvedValue({
      success: true,
      data: buildParticipants([
        { id: 1, first_name: 'Alex', last_name: 'River', group_id: 1, group_name: 'Wolves' }
      ])
    });
    ajax.getAttendance.mockResolvedValue({ success: true, data: [] });
    ajax.getGuestsByDate.mockResolvedValue({ success: true, data: [] });
    getActivities.mockResolvedValue([]);

    const page = new Attendance(makeAppStub());
    await page.init();
    await flushPromises();

    // A second attach (e.g. after a re-render) must not stack listeners
    page.attachEventListeners();

    ajax.getAttendance.mockClear();
    const dateSelect = document.getElementById('dateSelect');
    dateSelect.value = PAST;
    dateSelect.dispatchEvent(new Event('change', { bubbles: true }));
    await flushPromises();

    const pastFetches = ajax.getAttendance.mock.calls.filter(([date]) => date === PAST);
    expect(pastFetches).toHaveLength(1);
  });
});
