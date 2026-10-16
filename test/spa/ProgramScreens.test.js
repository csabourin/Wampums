/**
 * @jest-environment jsdom
 */

/**
 * The program screens (groups, honours, badges, the upcoming meeting and the
 * reports), held to CLAUDE.md §7.
 *
 * A list that did not load must not read as an empty one: no groups, no badge
 * to approve, no meeting coming up. Each screen shows the way back, says it is
 * loading, and turns a failed load into an alert with a retry. A report the
 * person left behind, or replaced with another, must not draw over what they
 * look at now.
 *
 * @module test/spa/ProgramScreens
 */

import axe from 'axe-core';

jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn(),
}));
jest.mock('../../spa/config.js', () => ({
  CONFIG: { DEFAULT_LANG: 'fr', CACHE_DURATION: {}, FEATURES: {}, UI: {} },
  getStorageKey: (key) => key,
}));
jest.mock('../../spa/indexedDB.js', () => ({
  getCachedData: jest.fn(),
  deleteCachedData: jest.fn(),
  setCachedData: jest.fn(),
}));
jest.mock('../../spa/modules/OfflineManager.js', () => ({
  offlineManager: {
    campMode: false,
    isOffline: false,
    isDatePrepared: () => false,
    getPreparedActivityForDate: () => null,
  },
}));
jest.mock('../../spa/utils/DialogUtils.js', () => ({
  alert: jest.fn(),
  confirm: jest.fn(),
  confirmDestructive: jest.fn(),
}));
jest.mock('../../spa/utils/PrintUtils.js', () => ({
  openPrintWindow: jest.fn(),
  setPrintContent: jest.fn(),
}));
jest.mock('../../spa/utils/ExportUtils.js', () => ({ exportToCSV: jest.fn() }));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  canViewGroups: () => true,
  canViewBadges: jest.fn(() => true),
  canManageBadges: jest.fn(() => true),
  canApproveBadges: jest.fn(() => true),
  canViewReports: () => true,
  isParent: jest.fn(() => false),
}));

// ajax-functions re-exports the endpoint functions: both resolve to one set of mocks.
jest.mock('../../spa/ajax-functions.js', () => {
  const fns = {};
  [
    'getGroups', 'addGroup', 'removeGroup',
    'getHonorsAndParticipants', 'awardHonor',
    'getBadgeProgress', 'saveBadgeProgress', 'getCurrentStars', 'fetchParticipant', 'getBadgeSystemSettings',
    'getReunionDates', 'getReunionPreparation', 'getParticipants', 'getBadgeSummary', 'getAttendance',
    'getHealthReport', 'getAllergiesReport', 'getMedicationReport', 'getVaccineReport', 'getLeaveAloneReport',
    'getMediaAuthorizationReport', 'getMissingDocumentsReport', 'getAttendanceReport', 'getHonorsReport',
    'getPointsReport', 'getParticipantProgressReport', 'getParticipantAgeReport', 'getFormStructure',
    'getFormSubmissions', 'getFormTypes', 'getFinanceReport',
  ].forEach((name) => { fns[name] = jest.fn(); });
  return fns;
});
jest.mock('../../spa/api/api-endpoints.js', () => {
  const fns = {};
  [
    'updateHonor', 'deleteHonor', 'markMeetingActivitiesProcessed',
    'getBadgeTrackerSummary', 'approveBadge', 'rejectBadge', 'markBadgeDelivered', 'markBadgesDeliveredBulk',
    'saveBadgeProgress', 'getUnprocessedAchievements', 'getAttendance', 'getAttendanceDates',
  ].forEach((name) => { fns[name] = jest.fn(); });
  return fns;
});

import * as ajax from '../../spa/ajax-functions.js';
import * as endpoints from '../../spa/api/api-endpoints.js';
import { isParent } from '../../spa/utils/PermissionUtils.js';
import { ManageGroups } from '../../spa/modules/groups/ManageGroups.js';
import { ManageHonors } from '../../spa/modules/honors/ManageHonors.js';
import { BadgeForm } from '../../spa/modules/badges/BadgeForm.js';
import { BadgeTracker } from '../../spa/modules/badges/BadgeTracker.js';
import { UpcomingMeeting } from '../../spa/modules/meetings/UpcomingMeeting.js';
import { Reports } from '../../spa/modules/reports/Reports.js';
import { releaseAllScrollLocks } from '../../spa/utils/ScrollLockUtils.js';

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom does no layout, so contrast cannot be computed here.
  rules: { 'color-contrast': { enabled: false } },
};
const HOSTILE = '<img src=x onerror=alert(1)>';
const FUTURE_MEETING = '2099-01-07';

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });
const page = () => document.getElementById('app');
const makeApp = () => ({ lang: 'fr', showMessage: jest.fn(), router: { navigate: jest.fn() } });
const alertText = () => page().querySelector('[role="alert"]:not(:empty)')?.textContent.trim();

/** @returns {Promise<Array>} axe violations in the document */
async function violations(root = document.body) {
  return (await axe.run(root, AXE_OPTIONS)).violations;
}

/** @returns {{promise: Promise, resolve: Function}} A promise the test settles */
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main>';
  jest.clearAllMocks();
  isParent.mockReturnValue(false);
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  document.querySelectorAll('.modal-overlay').forEach((overlay) => overlay.remove());
  releaseAllScrollLocks();
});

describe('groups', () => {
  const loaded = () => ajax.getGroups.mockResolvedValue({ success: true, data: [{ id: 4, name: HOSTILE, member_count: 2 }] });

  test('the list says it is loading, with the way back, then shows each name as text', async () => {
    const answer = deferred();
    ajax.getGroups.mockReturnValue(answer.promise);
    const done = new ManageGroups(makeApp()).init();

    expect(page().querySelector('a').getAttribute('href')).toBe('/dashboard');
    expect(page().querySelector('[role="status"]').textContent).toBe('loading');

    answer.resolve({ success: true, data: [{ id: 4, name: HOSTILE, member_count: 2 }] });
    await done;
    expect(page().querySelector('a').getAttribute('href')).toBe('/dashboard');
    expect(page().querySelector('tbody td').textContent).toBe(HOSTILE);
    expect(page().querySelector('tbody img')).toBeNull();
    expect(await violations()).toEqual([]);
  });

  test('a refused list is an error with a retry, not "no groups"', async () => {
    ajax.getGroups.mockResolvedValueOnce({ success: false });
    await new ManageGroups(makeApp()).init();

    expect(alertText()).toBe('error_loading_manage_groups');
    expect(page().textContent).not.toContain('no_groups_found');

    loaded();
    page().querySelector('#page-retry').click();
    await flush();
    expect(page().querySelector('tbody td').textContent).toBe(HOSTILE);
  });

  test('a missing name is said next to the field, and goes as the name changes', async () => {
    loaded();
    await new ManageGroups(makeApp()).init();

    page().querySelector('#add-group-form button[type="submit"]').click();
    await flush();
    const input = page().querySelector('#group_name');
    const error = document.getElementById(input.getAttribute('aria-describedby'));
    expect(error.textContent).toBe('group_name_required');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(ajax.addGroup).not.toHaveBeenCalled();

    input.value = 'Loups';
    input.dispatchEvent(new Event('input'));
    expect(error.textContent).toBe('');
  });

  test('a group added is announced even if the list then fails to reload', async () => {
    loaded();
    const app = makeApp();
    await new ManageGroups(app).init();
    ajax.addGroup.mockResolvedValue({ success: true });
    ajax.getGroups.mockRejectedValueOnce(new Error('offline'));

    page().querySelector('#group_name').value = 'Loups';
    page().querySelector('#add-group-form button[type="submit"]').click();
    await flush();
    await flush();

    expect(ajax.addGroup).toHaveBeenCalledWith('Loups');
    expect(app.showMessage).toHaveBeenCalledWith('group_added_successfully', 'success');
    expect(app.showMessage).not.toHaveBeenCalledWith(expect.anything(), 'error');
    expect(alertText()).toBe('error_loading_manage_groups');
  });

  test('a refused addition says so, and nothing claims it was added', async () => {
    loaded();
    const app = makeApp();
    await new ManageGroups(app).init();
    ajax.addGroup.mockRejectedValue(Object.assign(new Error('no'), { status: 403 }));

    page().querySelector('#group_name').value = 'Loups';
    page().querySelector('#add-group-form button[type="submit"]').click();
    await flush();

    expect(app.showMessage).toHaveBeenCalledWith(expect.any(String), 'error');
    expect(app.showMessage).not.toHaveBeenCalledWith('group_added_successfully', 'success');
  });
});

describe('honours', () => {
  const honours = { success: true, data: { participants: [], honors: [], availableDates: [] } };

  test('a failed load is an error with a retry, under the way back', async () => {
    ajax.getHonorsAndParticipants.mockRejectedValueOnce(new Error('offline'));
    await new ManageHonors(makeApp()).init();

    expect(page().querySelector('a').getAttribute('href')).toBe('/dashboard');
    expect(page().querySelector('h1').textContent).toBe('manage_honors');
    expect(alertText()).toBe('error_loading_honors');
    expect(await violations()).toEqual([]);

    ajax.getHonorsAndParticipants.mockResolvedValue(honours);
    page().querySelector('#page-retry').click();
    await flush();
    expect(page().querySelector('[role="alert"]:not(:empty)')).toBeNull();
    expect(page().querySelector('h1').textContent).toBe('manage_honors');
  });

  test('an answer arriving after the person left draws nothing', async () => {
    const answer = deferred();
    ajax.getHonorsAndParticipants.mockReturnValue(answer.promise);
    const screen = new ManageHonors(makeApp());
    const done = screen.init();
    screen.destroy();
    page().textContent = 'next screen';

    answer.resolve(honours);
    await done;
    expect(page().textContent).toBe('next screen');
  });
});

describe('badge form', () => {
  const settings = {
    data: { templates: [{ id: 1, name: 'Kaa', section: 'general', level_count: 3 }], territoires: [] },
  };

  test('shows the child\'s name as text, under the way back', async () => {
    ajax.getBadgeSystemSettings.mockResolvedValue(settings);
    ajax.fetchParticipant.mockResolvedValue({ participant: { id: 5, first_name: HOSTILE, last_name: 'Roy' } });
    ajax.getBadgeProgress.mockResolvedValue({ data: [] });
    await new BadgeForm(makeApp()).init(5);

    expect(page().firstElementChild.matches('a, .back-link, nav')).toBe(true);
    expect(page().querySelector('h2').textContent).toBe(`${HOSTILE} Roy`);
    expect(page().querySelector('h2 img')).toBeNull();
    expect(page().querySelector('#print-view-btn').className).toBe('button button--secondary');
  });

  test('without the badge list the form is an error with a retry, not a form with nothing to pick', async () => {
    ajax.getBadgeSystemSettings.mockRejectedValueOnce(new Error('offline'));
    await new BadgeForm(makeApp()).init(5);

    expect(alertText()).toBe('error_loading_badge_form');
    expect(page().querySelector('#badge-form')).toBeNull();
    expect(await violations()).toEqual([]);

    ajax.getBadgeSystemSettings.mockResolvedValue(settings);
    ajax.fetchParticipant.mockResolvedValue({ participant: { id: 5, first_name: 'Léa', last_name: 'Roy' } });
    ajax.getBadgeProgress.mockResolvedValue({ data: [] });
    page().querySelector('#page-retry').click();
    await flush();
    expect(ajax.fetchParticipant).toHaveBeenLastCalledWith(5);
    expect(page().querySelector('#badge-form')).not.toBeNull();
  });
});

describe('badge tracker', () => {
  const summary = {
    success: true,
    data: { badges: [], templates: [], participants: [{ id: 1, first_name: HOSTILE, last_name: 'Roy' }], stats: {} },
  };

  test('says it is loading, then a failed load is an error with a retry, not an empty tracker', async () => {
    const answer = deferred();
    endpoints.getUnprocessedAchievements.mockResolvedValue({ data: [] });
    endpoints.getBadgeTrackerSummary.mockReturnValueOnce(answer.promise);
    const app = makeApp();
    const done = new BadgeTracker(app).init();
    await flush();

    expect(page().querySelector('a').getAttribute('href')).toBe('/dashboard');
    expect(page().querySelector('[role="status"]').textContent).toBe('loading');

    answer.resolve({ success: false });
    await done;
    expect(alertText()).toBe('error_loading_data');
    expect(page().querySelector('h1').textContent).toBe('tile_badge_tracker');
    expect(app.showMessage).not.toHaveBeenCalled();
    expect(await violations()).toEqual([]);

    endpoints.getBadgeTrackerSummary.mockResolvedValue(summary);
    page().querySelector('#page-retry').click();
    await flush();
    await flush();
    expect(page().querySelector('[role="alert"]:not(:empty)')).toBeNull();
    expect(page().textContent).toContain(HOSTILE);
    expect(page().querySelector('.badge-tracker img')).toBeNull();
  });

  test('inside a tab it shows only the state: the tab already has the way back and the title', async () => {
    document.body.innerHTML = '<main id="app"><h1>host</h1><div id="tab-panel"></div></main>';
    endpoints.getUnprocessedAchievements.mockResolvedValue({ data: [] });
    endpoints.getBadgeTrackerSummary.mockRejectedValue(new Error('offline'));
    await new BadgeTracker(makeApp(), { embedded: true, containerId: 'tab-panel' }).init();

    const panel = document.getElementById('tab-panel');
    expect(panel.querySelector('[role="alert"]').textContent).toBe('error_loading_data');
    expect(panel.querySelector('h1, a')).toBeNull();
  });
});

describe('upcoming meeting', () => {
  test('meeting dates that did not load are an error with a retry, not "no meeting coming up"', async () => {
    ajax.getReunionDates.mockRejectedValueOnce(new Error('offline'));
    ajax.getParticipants.mockResolvedValue({ data: [] });
    const app = makeApp();
    await new UpcomingMeeting(app).init();

    expect(page().querySelector('a').getAttribute('href')).toBe('/dashboard');
    expect(alertText()).toBe('error_loading_upcoming_meeting');
    expect(page().textContent).not.toContain('no_upcoming_meeting');
    expect(app.showMessage).not.toHaveBeenCalled();
    expect(await violations()).toEqual([]);

    ajax.getReunionDates.mockResolvedValue({ data: [{ date: FUTURE_MEETING }] });
    ajax.getReunionPreparation.mockResolvedValue({ data: { meeting: { endroit: HOSTILE, activities: [] } } });
    page().querySelector('#upcoming-meeting-retry').click();
    await flush();
    await flush();
    expect(page().querySelector('[role="alert"]:not(:empty)')).toBeNull();
    expect(page().textContent).toContain(HOSTILE);
  });

  test('inside the meetings tab the error has no title of its own', async () => {
    document.body.innerHTML = '<main id="app"><h1>host</h1><div id="tab-panel"></div></main>';
    ajax.getReunionDates.mockRejectedValue(new Error('offline'));
    ajax.getParticipants.mockResolvedValue({ data: [] });
    await new UpcomingMeeting(makeApp(), { embedded: true, containerId: 'tab-panel' }).init();

    const panel = document.getElementById('tab-panel');
    expect(panel.querySelector('[role="alert"]').textContent).toBe('error_loading_upcoming_meeting');
    expect(panel.querySelector('h1, a')).toBeNull();
  });
});

describe('reports', () => {
  const reportContent = () => document.getElementById('report-content');
  const openReports = async () => {
    ajax.getFormTypes.mockResolvedValue({ data: [] });
    const reports = new Reports(makeApp());
    await reports.init();
    return reports;
  };

  test('a report says it is loading, and a failed one is an alert with a retry', async () => {
    const reports = await openReports();
    const answer = deferred();
    ajax.getAllergiesReport.mockReturnValueOnce(answer.promise);
    const done = reports.loadReport('allergies');

    expect(reportContent().querySelector('[role="status"]').textContent).toBe('loading_report');
    expect(reportContent().getAttribute('aria-live')).toBeNull();

    answer.resolve(Promise.reject(Object.assign(new Error('down'), { status: 500 })));
    await done;
    expect(reportContent().querySelector('[role="alert"]')).not.toBeNull();
    expect(await violations()).toEqual([]);

    ajax.getAllergiesReport.mockResolvedValue({ data: [] });
    reportContent().querySelector('#report-retry').click();
    await flush();
    expect(ajax.getAllergiesReport).toHaveBeenCalledTimes(2);
    expect(document.querySelectorAll('.modal-overlay')).toHaveLength(1);
    expect(reportContent().querySelector('[role="alert"]')).toBeNull();
  });

  test('a report replaced by another before it answered does not draw over it', async () => {
    const reports = await openReports();
    const slow = deferred();
    ajax.getAllergiesReport.mockReturnValueOnce(slow.promise);
    const first = reports.loadReport('allergies');
    ajax.getParticipantAgeReport.mockResolvedValue({ data: [{ first_name: 'Léa', last_name: 'Roy' }] });
    await reports.loadReport('participant-age');
    const shown = reportContent().innerHTML;

    const exported = reports.currentReportData;

    slow.resolve({ data: [{ first_name: 'Old', last_name: 'Report', allergies: 'x' }] });
    await first;
    expect(reportContent().innerHTML).toBe(shown);
    // Export CSV reads what the report on screen loaded, not the late one.
    expect(reports.currentReportData).toBe(exported);
    expect(reports.currentReportType).toBe('participant-age');
  });

  test('an unknown report is said in the person\'s language', async () => {
    const reports = await openReports();
    await reports.loadReport('nonexistent');
    expect(reportContent().textContent.trim()).toBe('report_unknown_type');
  });

  test('form types that did not load are said next to their selector', async () => {
    ajax.getFormTypes.mockRejectedValue(new Error('offline'));
    await new Reports(makeApp()).init();
    expect(document.getElementById('form-type-error').textContent).toBe('error_loading_form_types');
  });

  test('a parent\'s view of their child\'s progress has the way back and a title', async () => {
    isParent.mockReturnValue(true);
    window.history.replaceState({}, '', '/reports?participantId=5');
    ajax.getParticipantProgressReport.mockResolvedValue({ data: { progress: null } });
    await new Reports(makeApp()).init();

    expect(page().querySelector('a').getAttribute('href')).toBe('/parent-dashboard');
    expect(page().querySelector('h1').textContent).toBe('participant_progress_report_title');
    expect(await violations()).toEqual([]);
  });
});
