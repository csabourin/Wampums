/** @jest-environment jsdom */
require('fake-indexeddb/auto');
const { IDBFactory } = require('fake-indexeddb');
const axe = require('axe-core');

jest.mock('../../spa/config.js', () => ({ CONFIG: { CACHE_DURATION: { CAMP_MODE: 86400000 } } }));

jest.mock('../../spa/app.js', () => ({ translate: (key) => require('../../lang/en.json')[key] || key }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({ debugLog: jest.fn(), debugWarn: jest.fn(), debugError: jest.fn() }));
jest.mock('../../spa/api/api-action-roster.js', () => ({ getActionRoster: jest.fn() }));

const { ActionRoster } = require('../../spa/components/ActionRoster.js');
const { getActionRoster } = require('../../spa/api/api-action-roster.js');
const { setCachedData, saveOfflineData } = require('../../spa/indexedDB.js');
const { setContent } = require('../../spa/utils/DOMUtils.js');

const DATE = '2026-07-15';
const CAMP = { id: 5, name: '<Camp des Érables>', start_date: DATE, end_date: '2026-07-20', requires_permission: true, signed_participant_ids: [1, 2] };
const snapshot = () => ({ activities: [CAMP], attendance: [], meeting_dates: [] });
const online = (value) => Object.defineProperty(navigator, 'onLine', { configurable: true, value });

beforeEach(() => {
  global.indexedDB = new IDBFactory();
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('userId', 'leader-1');
  localStorage.setItem('currentOrganizationId', '1');
  online(true);
  jest.clearAllMocks();
  getActionRoster.mockResolvedValue({ data: snapshot() });
  document.body.innerHTML = '<main id="app"></main>';
});

test('attendance shows signed participants even before they arrive', async () => {
  const roster = new ActionRoster('attendance');
  await roster.load(DATE);
  roster.setAttendance({ 1: 'absent', 2: 'departed' });
  expect(roster.includes(1)).toBe(true);
  expect(roster.includes(2)).toBe(true);
  expect(roster.includes(3)).toBe(false);
});

test.each(['points', 'honors'])('%s excludes absences, departures and unsigned participants once attendance is taken', async (screen) => {
  const data = snapshot();
  data.attendance = [
    { participant_id: 1, date: DATE, status: 'present', is_on_site: true },
    { participant_id: 2, date: DATE, status: 'late', is_on_site: false },
    { participant_id: 3, date: DATE, status: 'present' },
  ];
  getActionRoster.mockResolvedValue({ data });
  const roster = new ActionRoster(screen);
  await roster.load(DATE);
  expect([1, 2, 3, 4].filter((id) => roster.includes(id))).toEqual([1]);
  roster.setAttendance({ 1: 'absent', 2: 'late' });
  expect([1, 2].filter((id) => roster.includes(id))).toEqual([2]);
});

test('an activity without permission requests includes the whole unit before attendance', async () => {
  getActionRoster.mockResolvedValue({ data: { ...snapshot(), activities: [{ ...CAMP, requires_permission: false }] } });
  const roster = new ActionRoster('points');
  await roster.load(DATE);
  expect(roster.includes(99)).toBe(true);
  roster.setAttendance({ 1: 'present', 2: 'excused' });
  expect(roster.includes(2)).toBe(false);
  expect(roster.includes(99)).toBe(false);
});

test('a planned meeting defaults to the whole unit in attendance even when an activity overlaps', async () => {
  getActionRoster.mockResolvedValue({ data: { ...snapshot(), meeting_dates: [DATE] } });
  const roster = new ActionRoster('attendance');
  await roster.load(DATE);
  expect(roster.activity).toBeNull();
  expect(roster.includes(99)).toBe(true);
});

test('showing everyone is an explicit exception carried to the award request', async () => {
  const roster = new ActionRoster('points');
  await roster.load(DATE);
  setContent(document.getElementById('app'), roster.render());
  const onChange = jest.fn();
  roster.attach(onChange);
  const checkbox = document.querySelector('input[type=checkbox]');
  checkbox.checked = true;
  checkbox.dispatchEvent(new Event('change'));
  expect(roster.includes(99)).toBe(true);
  expect(roster.awardContext()).toEqual({ date: DATE, activity_id: 5, include_all: true });
  expect(onChange).toHaveBeenCalledTimes(1);
  roster.destroy();
});

test('the activity selection follows navigation while the exception must be chosen again', async () => {
  const roster = new ActionRoster('attendance');
  await roster.load(DATE);
  setContent(document.getElementById('app'), roster.render());
  roster.attach(() => {});
  const select = document.querySelector('select');
  select.value = '';
  select.dispatchEvent(new Event('change'));
  const points = new ActionRoster('points');
  await points.load(DATE);
  expect(points.activity).toBeNull();
  expect(points.showAll).toBe(false);
  roster.destroy();
});

test('a prepared camp keeps signed authorizations and unsent departures after reopening offline', async () => {
  await setCachedData(`action_roster_${DATE}`, snapshot(), -1);
  await setCachedData(`attendance_${DATE}`, { attendanceData: { 1: 'present', 2: 'present' } }, -1);
  await saveOfflineData('POST', {
    url: 'http://localhost/api/v1/attendance/departure', body: JSON.stringify({ participant_id: 2, date: DATE }),
    userId: 'leader-1', organizationId: '1',
  });
  online(false);
  const roster = new ActionRoster('honors');
  await roster.load(DATE);
  expect(roster.includes(1)).toBe(true);
  expect(roster.includes(2)).toBe(false);
  expect(roster.includes(3)).toBe(false);
  expect(getActionRoster).not.toHaveBeenCalled();
});

test('another account outbox cannot change the current roster', async () => {
  await saveOfflineData('POST', {
    url: 'http://localhost/api/v1/attendance', body: JSON.stringify({ participant_id: 1, date: DATE, status: 'absent' }),
    userId: 'another-leader', organizationId: '1',
  });
  const roster = new ActionRoster('points');
  await roster.load(DATE);
  expect(roster.includes(1)).toBe(true);
});

test('an unavailable roster fails instead of silently offering the whole unit', async () => {
  getActionRoster.mockRejectedValue(new Error('Unavailable'));
  await expect(new ActionRoster('points').load(DATE)).rejects.toThrow('Unavailable');
});

test('the shared controls are labelled, escaped and accessible', async () => {
  const roster = new ActionRoster('attendance');
  await roster.load(DATE);
  setContent(document.getElementById('app'), roster.render());
  expect(document.querySelector('option[value="5"]').textContent).toBe(CAMP.name);
  expect(document.querySelector('camp')).toBeNull();
  const result = await axe.run(document.getElementById('app'), { rules: { 'color-contrast': { enabled: false } } });
  expect(result.violations).toEqual([]);
});


test('a prepared camp stays selected when a second activity overlaps its dates', async () => {
  const { offlineManager } = require('../../spa/modules/OfflineManager.js');
  getActionRoster.mockResolvedValue({ data: { ...snapshot(), activities: [CAMP, { ...CAMP, id: 6, name: 'Park games' }] } });
  offlineManager.campMode = true;
  offlineManager.activeActivityId = CAMP.id;
  try {
    const roster = new ActionRoster('attendance');
    await roster.load(DATE);
    expect(roster.activityId).toBe(CAMP.id);
    expect(roster.includes(3)).toBe(false);
  } finally {
    offlineManager.campMode = false;
    offlineManager.activeActivityId = null;
  }
});


test('a prepared roster survives a network failure while the browser still reports online', async () => {
  await setCachedData(`action_roster_${DATE}`, snapshot(), -1);
  getActionRoster.mockRejectedValue(Object.assign(new Error('Radio unavailable'), { isNetworkError: true }));
  const roster = new ActionRoster('points');
  await roster.load(DATE);
  expect(roster.activityId).toBe(CAMP.id);
  expect(roster.includes(3)).toBe(false);
});
