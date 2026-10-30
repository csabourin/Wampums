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

import { getActivities } from '../../spa/api/api-activities.js';
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
