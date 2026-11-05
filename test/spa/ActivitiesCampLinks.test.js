/**
 * @jest-environment jsdom
 *
 * On the activities calendar, every camp opens its team overview (an outing of
 * several days is not a camp unless it says so), and the offline check appears
 * only while this device would prepare the activity.
 */
import axe from 'axe-core';

const mockPermissions = new Set();
let mockOrganizationScope = true;

jest.mock('../../spa/config.js', () => ({ CONFIG: {}, getStorageKey: (key) => key }));
jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({ debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn() }));
jest.mock('../../spa/api/api-activities.js', () => ({ getActivities: jest.fn(), deleteActivity: jest.fn() }));
jest.mock('../../spa/api/api-camp-readiness.js', () => ({ getUpcomingCamps: jest.fn() }));
jest.mock('../../spa/indexedDB.js', () => ({ clearActivityRelatedCaches: jest.fn() }));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  hasPermission: jest.fn((key) => mockPermissions.has(key)),
  hasOrganizationScope: jest.fn(() => mockOrganizationScope),
  canViewActivities: jest.fn(() => true),
  canFollowPermissionSlips: jest.fn(() => false),
}));
jest.mock('../../spa/modules/activities/ActivityFormModal.js', () => ({ openActivityFormModal: jest.fn() }));
jest.mock('../../spa/modules/activities/ActivityDeleteDialog.js', () => ({ confirmActivityDeletion: jest.fn() }));
// The window itself is tested with CampPreparation; here, only camps before 2027 are within it.
jest.mock('../../spa/modules/offline/CampPreparation.js', () => ({
  campPreparation: { prepareNow: jest.fn() },
  isCampPreparationWindow: jest.fn((start) => start < '2027-01-01'),
}));
jest.mock('../../spa/modules/offline/CampReadiness.js', () => ({
  renderCampReadiness: (id) => `<p role="status" data-camp-status="${id}">camp_device_incomplete</p>`,
}));

import { getActivities, deleteActivity } from '../../spa/api/api-activities.js';
import { clearActivityRelatedCaches } from '../../spa/indexedDB.js';
import { openActivityFormModal } from '../../spa/modules/activities/ActivityFormModal.js';
import { Activities } from '../../spa/modules/activities/Activities.js';

const activity = (fields) => ({
  name: 'Activity', activity_start_time: '18:00', activity_end_time: '14:00',
  meeting_location_going: 'Local', meeting_time_going: '18:00', departure_time_going: '18:30', ...fields,
});
const ACTIVITIES = [
  activity({ id: 1, name: 'Camp de la Toussaint', activity_start_date: '2026-10-30', activity_end_date: '2026-11-01', is_camp: true }),
  activity({ id: 2, name: 'Camp d\'hiver', activity_start_date: '2027-02-12', activity_end_date: '2027-02-14',
    linked_year_plan_meeting_id: 40, linked_year_plan_meeting_kind: 'camp' }),
  activity({ id: 3, name: 'Sortie canot', activity_start_date: '2026-11-29', activity_end_date: '2026-11-29' }),
  activity({ id: 4, name: 'Expédition vélo', activity_start_date: '2026-11-01', activity_end_date: '2026-11-02' }),
];

let screen;
const card = (id) => document.querySelector(`.activity-card[data-activity-id="${id}"]`);

beforeEach(async () => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: new Date(2026, 9, 30, 12), doNotFake: ['setTimeout', 'queueMicrotask', 'nextTick', 'setImmediate'] });
  document.body.innerHTML = '<main id="app"></main>';
  mockPermissions.clear();
  mockPermissions.add('meetings.view');
  mockOrganizationScope = true;
  getActivities.mockResolvedValue(ACTIVITIES);
  screen = new Activities({ lang: 'fr', showMessage: jest.fn(), router: { navigate: jest.fn() } });
  await screen.init();
});

afterEach(() => {
  screen.destroy();
  jest.useRealTimers();
});

test('a camp created as an activity opens its team overview by its activity', () => {
  expect(card(1).querySelector('a[href="/camp-readiness/activity-1"]').textContent).toContain('camp_readiness_title');
});

test('a camp the year plan schedules opens its planned camp\'s overview', () => {
  expect(card(2).querySelector('a[href="/camp-readiness/40"]')).not.toBeNull();
});

test('an outing of several days that is not a camp has no camp overview, though its device check stays', () => {
  expect(card(4).querySelector('a[href^="/camp-readiness"]')).toBeNull();
  expect(card(4).querySelector('.prepare-offline-btn')).not.toBeNull();
});

test('a one-day outing has no camp overview or offline check', () => {
  expect(card(3).querySelector('a[href^="/camp-readiness"]')).toBeNull();
  expect(card(3).querySelector('.prepare-offline-btn')).toBeNull();
});

test('only the camp this device would prepare now offers the offline check, not one months away', async () => {
  expect(card(1).querySelector('.prepare-offline-btn')).not.toBeNull();
  expect(card(1).querySelector('[data-camp-status]')).not.toBeNull();
  expect(card(2).querySelector('.prepare-offline-btn')).toBeNull();
  expect(card(2).querySelector('[data-camp-status]')).toBeNull();
  expect(document.querySelectorAll('.prepare-offline-btn')).toHaveLength(2);
  expect((await axe.run(document.getElementById('app'), {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
    rules: { 'color-contrast': { enabled: false } },
  })).violations).toEqual([]);
});

test('without meetings.view, or for a family account, no team overview is offered', async () => {
  screen.destroy();
  mockPermissions.clear();
  screen = new Activities({ lang: 'fr', showMessage: jest.fn(), router: { navigate: jest.fn() } });
  await screen.init();
  expect(document.querySelector('a[href^="/camp-readiness"]')).toBeNull();
  screen.destroy();
  mockPermissions.add('meetings.view');
  mockOrganizationScope = false;
  screen = new Activities({ lang: 'fr', showMessage: jest.fn(), router: { navigate: jest.fn() } });
  await screen.init();
  expect(document.querySelector('a[href^="/camp-readiness"]')).toBeNull();
  expect(document.querySelector('.prepare-offline-btn')).toBeNull();
});

/** A response held until the person has navigated away or asked to retry. */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const NEXT_PAGE = '<h1>Messages</h1><button id="next-page-action">Read message</button>';
const showNextPage = () => {
  screen.destroy();
  document.getElementById('app').innerHTML = NEXT_PAGE;
  document.getElementById('next-page-action').focus();
};

test.each(['resolve', 'reject'])('leaving while activities load preserves the next screen when the old request %ss', async (outcome) => {
  screen.destroy();
  const pending = deferred();
  getActivities.mockReturnValueOnce(pending.promise);
  screen = new Activities({ showMessage: jest.fn(), router: { navigate: jest.fn() } });
  const done = screen.init();
  expect(document.querySelector('[role="status"]')).not.toBeNull();
  expect(document.querySelector('#app a').getAttribute('href')).toBe('/dashboard');
  showNextPage();
  if (outcome === 'resolve') {pending.resolve(ACTIVITIES);} else {pending.reject(new Error('Late failure'));}
  await done;
  expect(document.getElementById('app').innerHTML).toBe(NEXT_PAGE);
  expect(document.activeElement.id).toBe('next-page-action');
  expect(screen.app.showMessage).not.toHaveBeenCalled();
  expect(screen.activities).toEqual([]);
});

test('a failed load shows a translated alert and a working retry instead of an empty calendar', async () => {
  getActivities.mockRejectedValueOnce(Object.assign(new Error('<img src=x onerror=alert(1)>'), { status: 403 }));
  await screen.refreshActivities(true);
  expect(document.querySelector('[role="alert"]').textContent).toBe('api_error_forbidden');
  expect(document.querySelector('.empty-state')).toBeNull();
  expect(document.querySelector('#app img')).toBeNull();
  expect((await axe.run(document.getElementById('app'), {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
    rules: { 'color-contrast': { enabled: false } },
  })).violations).toEqual([]);
  const retry = document.getElementById('activities-retry');
  expect(retry.textContent).toBe('retry');
  retry.click();
  await settle();
  expect(getActivities).toHaveBeenLastCalledWith({ forceRefresh: true });
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(card(1)).not.toBeNull();
});

test('leaving during a retry also preserves the next screen', async () => {
  getActivities.mockRejectedValueOnce(new Error('offline'));
  await screen.refreshActivities();
  const pending = deferred();
  getActivities.mockReturnValueOnce(pending.promise);
  document.getElementById('activities-retry').click();
  showNextPage();
  pending.resolve(ACTIVITIES);
  await settle();
  expect(document.getElementById('app').innerHTML).toBe(NEXT_PAGE);
});

test('a saved activity cannot redraw a page visited while the refreshed list loads', async () => {
  screen.showActivityModal(ACTIVITIES[0]);
  const { onSaved } = openActivityFormModal.mock.calls[0][1];
  const pending = deferred();
  getActivities.mockReturnValueOnce(pending.promise);
  const done = onSaved();
  showNextPage();
  pending.resolve(ACTIVITIES);
  await done;
  expect(document.getElementById('app').innerHTML).toBe(NEXT_PAGE);
});

test('a completed deletion still clears caches but does not redraw or notify another page', async () => {
  const pending = deferred();
  deleteActivity.mockReturnValueOnce(pending.promise);
  const done = screen.deleteActivity(1);
  showNextPage();
  pending.resolve({ data: {} });
  await done;
  expect(clearActivityRelatedCaches).toHaveBeenCalled();
  expect(screen.app.showMessage).not.toHaveBeenCalled();
  expect(document.getElementById('app').innerHTML).toBe(NEXT_PAGE);
});

test('activity names remain text when they contain markup', async () => {
  getActivities.mockResolvedValueOnce([activity({ id: 99, name: '<img src=x onerror=alert(1)>', activity_start_date: '2026-11-04', activity_end_date: '2026-11-04' })]);
  await screen.refreshActivities(true);
  expect(card(99).querySelector('h3').textContent).toBe('<img src=x onerror=alert(1)>');
  expect(card(99).querySelector('img')).toBeNull();
});
