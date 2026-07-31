/**
 * @jest-environment jsdom
 *
 * User stories: manage honors page (spa/manage_honors.js).
 *
 * Implements: US-HON-001, US-HON-002, US-HON-003, US-HON-008, US-HON-009,
 *             US-HON-010, US-HON-011, US-HON-012, US-HON-013, US-HON-014
 *
 * NOTE: one acceptance of US-HON-002 (optimistic marking is visible before the
 * server responds) is EXPECTED TO FAIL against current code: the pending honor
 * stores participant_id as a DOM string while participants carry numeric ids,
 * and processHonors compares with === (spa/manage_honors.js:138 vs :469).
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
    CACHE_DURATION: { SHORT: 60000, MEDIUM: 300000 },
    UI: {}
  },
  getStorageKey: (key) => key
}));

jest.mock('../../spa/app.js', () => {
  const enJson = require('../../lang/en.json');
  return {
    app: { lang: 'en', userPermissions: ['honors.view', 'honors.create'] },
    translate: (key) => enJson[key] || key
  };
});

jest.mock('../../spa/ajax-functions.js', () => ({
  getHonorsAndParticipants: jest.fn(),
  awardHonor: jest.fn()
}));

jest.mock('../../spa/api/api-endpoints.js', () => ({
  updateHonor: jest.fn(async () => ({ success: true })),
  deleteHonor: jest.fn(async () => ({ success: true }))
}));

jest.mock('../../spa/utils/DialogUtils.js', () => ({
  confirmDestructive: jest.fn(async () => true)
}));

jest.mock('../../spa/modules/OfflineManager.js', () => ({
  offlineManager: {
    campMode: false,
    isOffline: false,
    isDatePrepared: jest.fn(() => false),
    getPreparedActivityForDate: jest.fn(() => null)
  }
}));

const ajax = require('../../spa/ajax-functions.js');
const { updateHonor, deleteHonor } = require('../../spa/api/api-endpoints.js');
const { confirmDestructive } = require('../../spa/utils/DialogUtils.js');
const { offlineManager } = require('../../spa/modules/OfflineManager.js');
const { setCachedData, getCachedData } = require('../../spa/indexedDB.js');
const { getTodayISO } = require('../../spa/utils/DateUtils.js');
const { ManageHonors } = require('../../spa/manage_honors.js');
const { tr, deferred, flushPromises, i18nGaps } = require('./helpers/story-helpers');

const TODAY = getTodayISO();

function isoDaysFromToday(offset) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toLocaleDateString('en-CA');
}

const PAST = isoDaysFromToday(-7);
const MINUTES_5_AGO = new Date(Date.now() - 5 * 60 * 1000).toISOString();
const MINUTES_20_AGO = new Date(Date.now() - 20 * 60 * 1000).toISOString();

const PARTICIPANTS = [
  { participant_id: 1, first_name: 'Alex', last_name: 'River', group_id: 5, group_name: 'Wolves' },
  { participant_id: 2, first_name: 'Sam', last_name: 'Stone', group_id: 5, group_name: 'Wolves' }
];

function makeAppStub() {
  return {
    lang: 'en',
    showMessage: jest.fn(),
    router: { navigate: jest.fn() }
  };
}

/**
 * Fixture keyed by requested date: today has one fresh honor for Alex; the
 * past date has one old honor for Alex.
 */
function seedHonorsData({ todayHonorCreatedAt = MINUTES_5_AGO } = {}) {
  ajax.getHonorsAndParticipants.mockImplementation(async () => ({
    success: true,
    data: {
      participants: PARTICIPANTS,
      honors: [
        { id: 42, participant_id: 1, date: TODAY, reason: 'Helped set up', created_at: todayHonorCreatedAt },
        { id: 50, participant_id: 1, date: PAST, reason: 'Old deed', created_at: MINUTES_20_AGO }
      ],
      availableDates: [TODAY, PAST]
    }
  }));
  ajax.awardHonor.mockResolvedValue({ success: true, data: { results: [] } });
}

async function initPage() {
  const appStub = makeAppStub();
  const page = new ManageHonors(appStub);
  await page.init();
  await flushPromises();
  return { page, appStub };
}

function row(participantId) {
  return document.querySelector(`.honors-table__row[data-participant-id="${participantId}"]`);
}

beforeEach(() => {
  global.indexedDB = new IDBFactory();
  document.body.innerHTML = '<div id="app"></div>';
  jest.clearAllMocks();
  offlineManager.campMode = false;
  offlineManager.isDatePrepared.mockReturnValue(false);
  offlineManager.getPreparedActivityForDate.mockReturnValue(null);
});

afterEach(() => {
  // Modals append to document.body outside #app
  document.body.innerHTML = '';
});

describe('US-HON-001 — Tonight\'s honor board', () => {
  it('marks today\'s honoree, shows the reason and cumulative counts, leaves others selectable', async () => {
    seedHonorsData();
    await initPage();

    const alexRow = row(1);
    expect(alexRow.classList.contains('selected')).toBe(true);
    const alexCheckbox = alexRow.querySelector('input[type="checkbox"]');
    expect(alexCheckbox.checked).toBe(true);
    expect(alexCheckbox.disabled).toBe(true);
    expect(alexRow.textContent).toContain('Helped set up');
    // Total honors counts every honor dated on or before today (2 for Alex)
    expect(alexRow.querySelector('.honors-table__cell--count').textContent).toContain('2');

    const samRow = row(2);
    expect(samRow.classList.contains('selected')).toBe(false);
    const samCheckbox = samRow.querySelector('input[type="checkbox"]');
    expect(samCheckbox.checked).toBe(false);
    expect(samCheckbox.disabled).toBe(false);
  });
});

describe('US-HON-002 — Award honors with a reason for each kid', () => {
  it('refuses to award with nothing selected', async () => {
    seedHonorsData();
    const { page, appStub } = await initPage();

    await page.awardHonor();

    expect(appStub.showMessage).toHaveBeenCalledWith(tr('select_individuals'), 'error');
  });

  it('requires a reason before moving on', async () => {
    seedHonorsData();
    const { appStub } = await initPage();

    row(2).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document.getElementById('awardHonorButton').dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const form = document.getElementById('honor-reason-form');
    expect(form).not.toBeNull();
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(appStub.showMessage).toHaveBeenCalledWith(tr('honor_reason_required'), 'error');
    expect(document.getElementById('honor-reason-modal')).not.toBeNull();
    expect(ajax.awardHonor).not.toHaveBeenCalled();
  });

  it('marks the kid as honored before the server responds (optimistic)', async () => {
    seedHonorsData();
    const pending = deferred();
    ajax.awardHonor.mockReturnValue(pending.promise);
    await initPage();

    row(2).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document.getElementById('awardHonorButton').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document.getElementById('honor-reason-input').value = 'Cooked dinner';
    document.getElementById('honor-reason-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    // The user must see the row honored while the request is in flight.
    // KNOWN DEFECT: string participantId vs numeric participant_id makes this fail.
    const samRow = row(2);
    expect(samRow.classList.contains('selected')).toBe(true);
    expect(samRow.querySelector('input[type="checkbox"]').checked).toBe(true);

    pending.resolve({ success: true, data: { results: [] } });
    await flushPromises();
  });

  it('sends the award with date and reason, merges returned ids, and toasts', async () => {
    seedHonorsData();
    ajax.awardHonor.mockResolvedValue({
      success: true,
      data: { results: [{ participantId: '2', action: 'awarded', honorId: 77 }] }
    });
    const { page, appStub } = await initPage();

    row(2).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document.getElementById('awardHonorButton').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document.getElementById('honor-reason-input').value = 'Cooked dinner';
    document.getElementById('honor-reason-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(ajax.awardHonor).toHaveBeenCalledWith([
      { participantId: '2', date: TODAY, reason: 'Cooked dinner' }
    ]);
    expect(appStub.showMessage).toHaveBeenCalledWith(tr('honors_awarded_successfully'), 'success');

    const optimistic = page.allHonors.find((h) => h.participant_id === '2' && h.date === TODAY);
    expect(optimistic.id).toBe(77);
  });

  it('cancelling the modal resets the pending queue', async () => {
    seedHonorsData();
    const { page } = await initPage();

    row(2).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document.getElementById('awardHonorButton').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document.getElementById('cancel-honors').dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(document.getElementById('honor-reason-modal')).toBeNull();
    expect(page.pendingHonors).toEqual([]);
    expect(ajax.awardHonor).not.toHaveBeenCalled();
  });
});

describe('US-HON-003 — A failed award rolls the board back', () => {
  it('refetches away the optimistic state and explains the failure', async () => {
    seedHonorsData();
    ajax.awardHonor.mockResolvedValue({ success: false, message: 'Server exploded' });
    const { appStub } = await initPage();

    row(2).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document.getElementById('awardHonorButton').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document.getElementById('honor-reason-input').value = 'Cooked dinner';
    document.getElementById('honor-reason-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(appStub.showMessage).toHaveBeenCalledWith(
      `${tr('error_awarding_honor')}: Server exploded`,
      'error'
    );
    // Board refetched: Sam is not honored
    expect(ajax.getHonorsAndParticipants.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(row(2).classList.contains('selected')).toBe(false);
  });
});

describe('US-HON-008 — Undo window for fresh honors', () => {
  it('offers undo with the remaining minutes inside the 10-minute window', async () => {
    seedHonorsData({ todayHonorCreatedAt: MINUTES_5_AGO });
    const { appStub } = await initPage();

    const undoItem = document.querySelector('.honor-actions__item--undo[data-honor-id="42"]');
    expect(undoItem).not.toBeNull();
    expect(undoItem.textContent).toContain('5min');

    undoItem.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();

    expect(deleteHonor).toHaveBeenCalledWith(42);
    expect(confirmDestructive).not.toHaveBeenCalled();
    expect(appStub.showMessage).toHaveBeenCalledWith(tr('honor_undone_successfully'), 'success');
  });

  it('hides undo after the window; delete stays behind a confirmation', async () => {
    seedHonorsData({ todayHonorCreatedAt: MINUTES_20_AGO });
    await initPage();

    expect(document.querySelector('.honor-actions__item--undo')).toBeNull();

    confirmDestructive.mockResolvedValueOnce(false);
    document.querySelector('.honor-actions__item[data-action="delete"][data-honor-id="42"]')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();

    expect(confirmDestructive).toHaveBeenCalled();
    expect(deleteHonor).not.toHaveBeenCalled();
  });

  it('confirming the delete removes the honor', async () => {
    seedHonorsData({ todayHonorCreatedAt: MINUTES_20_AGO });
    const { appStub } = await initPage();

    document.querySelector('.honor-actions__item[data-action="delete"][data-honor-id="42"]')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();

    expect(deleteHonor).toHaveBeenCalledWith(42);
    expect(appStub.showMessage).toHaveBeenCalledWith(tr('honor_deleted_successfully'), 'success');
  });
});

describe('US-HON-009 / US-HON-011 — The past is read-only, each day stands alone', () => {
  it('on a past date only honored kids are listed and awarding is disabled', async () => {
    seedHonorsData();
    const { page } = await initPage();

    await page.onDateChange(PAST);
    await flushPromises();

    expect(ajax.getHonorsAndParticipants).toHaveBeenLastCalledWith(PAST);
    expect(document.getElementById('awardHonorButton').disabled).toBe(true);

    // Alex has an honor on PAST → visible; Sam has none → hidden
    expect(row(1)).not.toBeNull();
    expect(row(2)).toBeNull();

    // Rows on a past date cannot be toggled
    const checkbox = row(1).querySelector('input[type="checkbox"]');
    expect(checkbox.disabled).toBe(true);
    row(1).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(checkbox.checked).toBe(true); // unchanged (honored stays checked)
  });
});

describe('US-HON-010 — Sort the board my way', () => {
  it('sorts by honor count ascending then descending', async () => {
    seedHonorsData();
    const { page } = await initPage();

    page.sortItems('honors');
    let ids = [...document.querySelectorAll('.honors-table__row')].map((r) => r.dataset.participantId);
    expect(ids).toEqual(['2', '1']); // Sam (0 honors) before Alex (2)

    page.sortItems('honors');
    ids = [...document.querySelectorAll('.honors-table__row')].map((r) => r.dataset.participantId);
    expect(ids).toEqual(['1', '2']);
  });
});

describe('US-HON-012 — Edit an honor\'s reason or date from its menu', () => {
  it('requires a non-empty reason and PATCHes the new one', async () => {
    seedHonorsData();
    const { page, appStub } = await initPage();

    await page.showEditReasonModal(42);
    const input = document.getElementById('edit-reason-input');
    input.value = '   ';
    document.getElementById('edit-reason-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();
    expect(appStub.showMessage).toHaveBeenCalledWith(tr('honor_reason_required'), 'error');
    expect(updateHonor).not.toHaveBeenCalled();

    input.value = 'Better reason';
    document.getElementById('edit-reason-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(updateHonor).toHaveBeenCalledWith(42, { reason: 'Better reason' });
    expect(appStub.showMessage).toHaveBeenCalledWith(tr('honor_updated_successfully'), 'success');
  });

  it('PATCHes a new date from the change-date modal', async () => {
    seedHonorsData();
    const { page, appStub } = await initPage();

    await page.showEditDateModal(42);
    document.getElementById('edit-date-input').value = PAST;
    document.getElementById('edit-date-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(updateHonor).toHaveBeenCalledWith(42, { date: PAST });
    expect(appStub.showMessage).toHaveBeenCalledWith(tr('honor_date_updated_successfully'), 'success');
  });
});

describe('US-HON-013 — Honors caches don\'t go stale', () => {
  it('clears every honors cache key for the current date', async () => {
    seedHonorsData();
    const { page } = await initPage();

    const keys = ['v1/honors', `v1/honors?date=${TODAY}`, 'v1/honors/history', 'recent_honors'];
    await Promise.all(keys.map((key) => setCachedData(key, { stale: true })));

    await page.clearHonorsCaches();

    const survivors = await Promise.all(keys.map((key) => getCachedData(key)));
    expect(survivors).toEqual([null, null, null, null]);
  });
});

describe('US-HON-014 — Camp-prepared honors work offline', () => {
  it('feeds the page from camp caches without any network fetch', async () => {
    offlineManager.campMode = true;
    offlineManager.getPreparedActivityForDate.mockReturnValue({ dates: [TODAY, isoDaysFromToday(1)] });

    await setCachedData('honors_all', [
      { id: 42, participant_id: 1, date: TODAY, reason: 'Camp deed', created_at: MINUTES_5_AGO }
    ]);
    await setCachedData('participants_v2', PARTICIPANTS.map((p) => ({
      id: p.participant_id,
      first_name: p.first_name,
      last_name: p.last_name,
      group_id: p.group_id,
      group_name: p.group_name
    })));

    ajax.getHonorsAndParticipants.mockResolvedValue({ success: true, data: {} });
    const { page } = await initPage();

    expect(ajax.getHonorsAndParticipants).not.toHaveBeenCalled();
    expect(page.allParticipants).toHaveLength(2);
    expect(page.allHonors[0].reason).toBe('Camp deed');
    expect(page.availableDates).toContain(TODAY);
    expect(row(1).classList.contains('selected')).toBe(true);
  });
});

describe('US-I18N-001 — honors strings exist in both languages', () => {
  it('en.json and fr.json both contain every honors-flow key', () => {
    const keys = [
      'manage_honors', 'select_date', 'name', 'number_of_honors', 'last_honor_date',
      'award_honor', 'select_individuals', 'honor_reason_prompt', 'honor_reason_label',
      'honor_reason_required', 'honors_awarded_successfully', 'error_awarding_honor',
      'edit_reason', 'change_date', 'undo', 'delete', 'cancel', 'save', 'next', 'submit',
      'honor_updated_successfully', 'honor_date_updated_successfully',
      'honor_undone_successfully', 'honor_deleted_successfully', 'confirm_delete_honor',
      'error_updating_honor', 'error_undoing_honor', 'error_deleting_honor',
      'no_honors_on_this_date', 'error_loading_honors', 'actions', 'of'
    ];
    expect(i18nGaps(keys)).toEqual({ missingEn: [], missingFr: [] });
  });
});
