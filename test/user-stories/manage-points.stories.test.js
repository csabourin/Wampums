/**
 * @jest-environment jsdom
 *
 * User stories: manage points page (spa/manage_points.js) driving the real
 * PointsStore and the real IndexedDB layer (fake-indexeddb).
 *
 * Implements: US-PTS-001, US-PTS-002, US-PTS-003, US-PTS-005, US-PTS-006,
 *             US-PTS-010, US-PTS-011, US-PTS-012, US-PTS-019, US-NAV-001
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
    UI: {}
  },
  getStorageKey: (key) => key
}));

jest.mock('../../spa/app.js', () => {
  const enJson = require('../../lang/en.json');
  return {
    app: {
      lang: 'en',
      userPermissions: ['points.view', 'points.manage', 'attendance.view']
    },
    translate: (key) => enJson[key] || key
  };
});

jest.mock('../../spa/ajax-functions.js', () => ({
  getParticipants: jest.fn(),
  getGroups: jest.fn(),
  getAttendance: jest.fn(),
  updatePoints: jest.fn(),
  getAuthHeader: jest.fn(() => ({ Authorization: 'Bearer test' })),
  getCurrentOrganizationId: jest.fn(() => 1),
  getApiUrl: jest.fn((path) => `http://localhost:3000/api/${path}`),
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

const ajax = require('../../spa/ajax-functions.js');
const { app: mockGlobalApp } = require('../../spa/app.js');
const { offlineManager } = require('../../spa/modules/OfflineManager.js');
const { getCachedData } = require('../../spa/indexedDB.js');
const { ManagePoints } = require('../../spa/manage_points.js');
const {
  tr,
  deferred,
  flushPromises,
  buildParticipants,
  buildGroups,
  i18nGaps
} = require('./helpers/story-helpers');

const GROUP_ID = 1;

function makeAppStub() {
  return {
    lang: 'en',
    showMessage: jest.fn(),
    router: { navigate: jest.fn() }
  };
}

/**
 * Standard fixture: group 1 "Wolves" (kids 1, 2), kid 3 unassigned.
 */
function seedStandardData() {
  const participants = buildParticipants([
    { id: 1, first_name: 'Alex', last_name: 'River', group_id: GROUP_ID, total_points: 10 },
    { id: 2, first_name: 'Sam', last_name: 'Stone', group_id: GROUP_ID, total_points: 5 },
    { id: 3, first_name: 'Zoe', last_name: 'Free', group_id: null, total_points: 2 }
  ]);
  const groups = buildGroups([{ id: GROUP_ID, name: 'Wolves', total_points: 20 }]);

  ajax.getParticipants.mockResolvedValue({ success: true, data: participants });
  ajax.getGroups.mockResolvedValue({ success: true, data: groups });
  ajax.getAttendance.mockResolvedValue({ success: true, data: [] });
  ajax.updatePoints.mockResolvedValue({ success: true, data: { updates: [] } });
  return { participants, groups };
}

async function initPage() {
  const appStub = makeAppStub();
  const page = new ManagePoints(appStub);
  await page.init();
  await flushPromises();
  return { page, appStub };
}

function participantTotalText(id) {
  return document.getElementById(`name-points-${id}`).textContent;
}

function clickPointButton(points) {
  const button = document.querySelector(`.point-btn[data-points="${points}"]`);
  button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function selectParticipant(id) {
  document.querySelector(`.list-item[data-participant-id="${id}"]`)
    .dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function selectGroup(id) {
  document.querySelector(`.group-header[data-group-id="${id}"]`)
    .dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

beforeEach(() => {
  global.indexedDB = new IDBFactory();
  document.body.innerHTML = '<div id="app"></div>';
  jest.clearAllMocks();
  mockGlobalApp.userPermissions = ['points.view', 'points.manage', 'attendance.view'];
});

describe('US-PTS-001 — See group and member totals at a glance', () => {
  it('renders group total, member totals, member-sum footer and the unassigned section', async () => {
    seedStandardData();
    await initPage();

    const header = document.querySelector(`.group-header[data-group-id="${GROUP_ID}"] .group-header__points`);
    expect(header.textContent).toContain(`${tr('group_points')}: 20`);

    expect(participantTotalText(1)).toBe('10');
    expect(participantTotalText(2)).toBe('5');

    const footer = document.getElementById(`group-points-${GROUP_ID}`);
    expect(footer.textContent).toContain(`${tr('total_points')}: 15`);

    expect(document.body.textContent).toContain(tr('unassigned_participants'));
    expect(participantTotalText(3)).toBe('2');
  });
});

describe('US-PTS-002 — +5 shows instantly and sticks after the server confirms', () => {
  it('shows 15 before the response and still 15 after the absolute total arrives', async () => {
    seedStandardData();
    const pending = deferred();
    ajax.updatePoints.mockReturnValue(pending.promise);

    const { page } = await initPage();
    selectParticipant(1);
    clickPointButton(5);

    // Optimistic: DOM updated from the store before the server answers
    expect(participantTotalText(1)).toBe('15');
    expect(page.store.hasPendingDeltas()).toBe(true);

    pending.resolve({ success: true, data: { updates: [{ type: 'participant', id: 1, totalPoints: 15 }] } });
    await flushPromises();

    expect(participantTotalText(1)).toBe('15');
    expect(page.store.hasPendingDeltas()).toBe(false);

    expect(ajax.updatePoints).toHaveBeenCalledTimes(1);
    const payloads = ajax.updatePoints.mock.calls[0][0];
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({ type: 'individual', id: '1', points: 5 });
    expect(payloads[0].date).toBeUndefined();
  });
});

describe('US-PTS-003 — Group award skips kids who aren\'t here', () => {
  it('credits present/late members only, tells me who was skipped, and dates the payload', async () => {
    seedStandardData();
    ajax.getAttendance.mockResolvedValue({
      success: true,
      data: [
        { participant_id: 1, status: 'present' },
        { participant_id: 2, status: 'absent' }
      ]
    });

    const { appStub } = await initPage();
    selectGroup(GROUP_ID);
    clickPointButton(3);

    // Alex (present) gains, Sam (absent) does not, the group header gains
    expect(participantTotalText(1)).toBe('13');
    expect(participantTotalText(2)).toBe('5');
    const header = document.querySelector(`.group-header[data-group-id="${GROUP_ID}"] .group-header__points`);
    expect(header.textContent).toContain('23');

    expect(appStub.showMessage).toHaveBeenCalledWith(
      tr('points_skipped_absent_participants', { count: 1 }),
      'info'
    );

    await flushPromises();
    const payload = ajax.updatePoints.mock.calls[0][0][0];
    expect(payload.type).toBe('group');
    expect(payload.date).toBeDefined();
  });

  it('credits everyone when no attendance was taken today', async () => {
    seedStandardData();
    ajax.getAttendance.mockResolvedValue({ success: true, data: [] });

    const { appStub } = await initPage();
    selectGroup(GROUP_ID);
    clickPointButton(3);

    expect(participantTotalText(1)).toBe('13');
    expect(participantTotalText(2)).toBe('8');
    expect(appStub.showMessage).not.toHaveBeenCalledWith(expect.anything(), 'info');
  });
});

describe('US-PTS-005 — A rejected award undoes itself exactly', () => {
  it('rolls the display back to the pre-click totals and explains the failure', async () => {
    seedStandardData();
    ajax.updatePoints.mockRejectedValue(new Error('boom'));

    const { appStub } = await initPage();
    selectParticipant(1);
    clickPointButton(5);
    expect(participantTotalText(1)).toBe('15');

    await flushPromises();

    expect(participantTotalText(1)).toBe('10');
    expect(appStub.showMessage).toHaveBeenCalledWith(
      expect.stringContaining(tr('error_updating_points')),
      'error'
    );
    expect(appStub.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('boom'),
      'error'
    );
  });
});

describe('US-PTS-006 — Scoring keeps working with no signal', () => {
  it('folds a queued batch into the base and persists it to the shared cache', async () => {
    seedStandardData();
    ajax.updatePoints.mockResolvedValue({ success: true, queued: true });

    const { page } = await initPage();
    selectParticipant(1);
    clickPointButton(5);
    await flushPromises();

    expect(participantTotalText(1)).toBe('15');
    expect(page.store.hasPendingDeltas()).toBe(false);

    // What a reload would read: the cache holds the folded totals
    const cached = await getCachedData('manage_points_data');
    const cachedAlex = cached.participants.find((p) => String(p.id) === '1');
    expect(cachedAlex.total_points).toBe(15);
  });

  it('queues via the OfflineManager when the network drops mid-request', async () => {
    seedStandardData();
    ajax.updatePoints.mockRejectedValue(new TypeError('Failed to fetch'));

    const { page } = await initPage();
    selectParticipant(1);
    clickPointButton(5);
    await flushPromises();

    expect(offlineManager.queueMutation).toHaveBeenCalledTimes(1);
    const [url, options] = offlineManager.queueMutation.mock.calls[0];
    expect(url).toContain('v1/points');
    expect(JSON.parse(options.body)[0]).toMatchObject({ type: 'individual', id: '1', points: 5 });

    expect(participantTotalText(1)).toBe('15');
    expect(page.store.hasPendingDeltas()).toBe(false);
  });
});

describe('US-PTS-010 — Sort by name, group, or points', () => {
  it('renders a flat list ordered by points, reversing on the second tap', async () => {
    seedStandardData();
    await initPage();

    document.querySelector('.sort-btn[data-sort="points"]')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));

    let totals = [...document.querySelectorAll('.participant-points')].map((el) => Number(el.textContent));
    expect(totals).toEqual([2, 5, 10]);

    document.querySelector('.sort-btn[data-sort="points"]')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    totals = [...document.querySelectorAll('.participant-points')].map((el) => Number(el.textContent));
    expect(totals).toEqual([10, 5, 2]);
  });

  it('the group filter hides non-matching rows and headers', async () => {
    seedStandardData();
    await initPage();

    const dropdown = document.getElementById('group-filter');
    dropdown.value = String(GROUP_ID);
    dropdown.dispatchEvent(new Event('change', { bubbles: true }));

    const unassignedRow = document.querySelector('.list-item[data-participant-id="3"]');
    expect(unassignedRow.style.display).toBe('none');
    const groupRow = document.querySelector('.list-item[data-participant-id="1"]');
    expect(groupRow.style.display).toBe('');
  });
});

describe('US-PTS-011 — I\'m told when nothing is selected', () => {
  it('shows a translated error and sends nothing', async () => {
    seedStandardData();
    const { appStub } = await initPage();

    clickPointButton(1);

    expect(appStub.showMessage).toHaveBeenCalledWith(tr('please_select_group_or_individual'), 'error');
    expect(ajax.updatePoints).not.toHaveBeenCalled();
  });
});

describe('US-PTS-012 — Old cache formats still load', () => {
  it('normalizes the raw {data: {...}} API shape and the legacy names shape', async () => {
    seedStandardData();
    const { page } = await initPage();

    const fromApiShape = page.normalizePointsData({
      data: {
        participants: [{ id: 1, first_name: 'Alex', last_name: 'River', total_points: '7' }],
        groups: [{ id: 1, name: 'Wolves', total_points: '9' }]
      }
    });
    expect(fromApiShape.groups[0].total_points).toBe(9);
    expect(fromApiShape.participants[0].id).toBe(1);

    const fromNamesShape = page.normalizePointsData({
      names: [{ id: 2, first_name: 'Sam', last_name: 'Stone' }],
      groups: []
    });
    expect(fromNamesShape.participants).toHaveLength(1);
  });
});

describe('US-PTS-019 — My selection survives re-renders', () => {
  it('keeps the selected row highlighted after a re-render and toggles off on re-click', async () => {
    seedStandardData();
    const { page } = await initPage();

    selectParticipant(1);
    expect(document.querySelector('.list-item[data-participant-id="1"]').classList.contains('selected')).toBe(true);

    page.renderList();
    expect(document.querySelector('.list-item[data-participant-id="1"]').classList.contains('selected')).toBe(true);

    selectParticipant(1);
    expect(document.querySelector('.list-item[data-participant-id="1"]').classList.contains('selected')).toBe(false);
  });
});

describe('US-NAV-001 — No points permission, no points page', () => {
  it('redirects to the dashboard without fetching anything', async () => {
    seedStandardData();
    mockGlobalApp.userPermissions = ['attendance.view'];

    const appStub = makeAppStub();
    const page = new ManagePoints(appStub);
    await page.init();

    expect(appStub.router.navigate).toHaveBeenCalledWith('/dashboard');
    expect(ajax.getParticipants).not.toHaveBeenCalled();
  });
});

describe('US-I18N-001 — manage-points strings exist in both languages', () => {
  it('en.json and fr.json both contain every key used by this page', () => {
    const keys = [
      'back', 'manage_points', 'sort_by_name', 'sort_by_group', 'sort_by_points',
      'filter_by_group', 'all_groups', 'group_points', 'total_points',
      'please_select_group_or_individual', 'cannot_assign_points_to_no_group',
      'points_skipped_absent_participants', 'error_updating_points',
      'error_loading_manage_points', 'error'
    ];
    expect(i18nGaps(keys)).toEqual({ missingEn: [], missingFr: [] });
  });
});
