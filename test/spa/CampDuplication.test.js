/**
 * @jest-environment jsdom
 */

/**
 * Reusing an earlier camp (#1256), from the camp schedule.
 *
 * Held here: the dialog says it is loading, then lists the unit's earlier
 * camps; each part is offered only when it can be copied and says why when
 * it cannot (no right, already filled here, nothing in the earlier camp, an
 * earlier camp too long for this one); choosing nothing is explained and sends
 * nothing; the copy is sent once with what was ticked; the result says what
 * was copied, left out and reassigned; a refusal reads as a refusal; a failed
 * load offers a retry; names are shown as text; and the dialog meets WCAG A/AA
 * and keeps focus inside it.
 *
 * @module test/spa/CampDuplication
 */

import axe from 'axe-core';
jest.mock('../../spa/modules/camp-review/CampReviewLessons.js', () => ({ CampReviewLessons: jest.fn().mockImplementation(() => ({ init: jest.fn(), destroy: jest.fn() })) }));

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn(),
}));

jest.mock('../../spa/app.js', () => ({
  // Keys stand for their text; the one naming a camp keeps its placeholders, so the name shows.
  translate: (key) => (key === 'camp_duplicate_source_option' ? '{name} — {date} ({days})' : key),
}));

jest.mock('../../spa/config.js', () => ({
  CONFIG: {},
  getStorageKey: (key) => key,
}));

jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  hasAllPermissions: jest.fn(() => true), hasPermission: jest.fn(() => true),
  hasOrganizationScope: jest.fn(() => true),
}));

jest.mock('../../spa/utils/DialogUtils.js', () => ({
  hasActiveDialog: () => false,
}));

jest.mock('../../spa/api/api-yearly-planner.js', () => ({
  getCampDuplication: jest.fn(),
  duplicateCamp: jest.fn(),
}));

const api = require('../../spa/api/api-yearly-planner.js');
const { hasAllPermissions, hasOrganizationScope } = require('../../spa/utils/PermissionUtils.js');
const { closeAllModals } = require('../../spa/utils/ModalUtils.js');
const { CampDuplication } = require('../../spa/modules/yearly-planner/CampDuplication.js');

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom does no layout, so contrast cannot be computed here.
  rules: { 'color-contrast': { enabled: false } },
};

const MEETING_ID = 7;
const EMPTY = { schedule: 0, packing_list: 0, lots: 0, tasks: 0 };

/** @returns {Object} A three-day camp being prepared, and two earlier camps */
function duplication() {
  return {
    target: { id: MEETING_ID, theme: 'Camp d’hiver', meeting_date: '2027-02-12', span_days: 3, is_cancelled: false, counts: { ...EMPTY } },
    sources: [
      {
        id: 41, theme: 'Camp d’hiver 2026', meeting_date: '2026-02-13', span_days: 3, fits_schedule: true,
        counts: { schedule: 9, packing_list: 14, lots: 2, tasks: 3 },
      },
      {
        id: 40, theme: 'Grand camp', meeting_date: '2025-07-04', span_days: 6, fits_schedule: false,
        counts: { schedule: 20, packing_list: 0, lots: 1, tasks: 0 },
      },
    ],
  };
}

/** @returns {Promise<void>} Let pending promises settle */
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** @returns {HTMLElement} The dialog */
function dialog() {
  return document.querySelector('#yp-camp-duplicate');
}

/** @returns {HTMLInputElement} The checkbox of one part */
function part(name) {
  return dialog().querySelector(`#yp-camp-duplicate-part-${name}`);
}

/** @returns {string} The reason given under a part, or '' */
function reason(name) {
  return dialog().querySelector(`#yp-camp-duplicate-part-${name}-reason`)?.textContent.trim() || '';
}

/** @returns {HTMLButtonElement} The Copy button, in the footer */
function submitButton() {
  return dialog().querySelector('button[type="submit"][form="yp-camp-duplicate-form"]');
}

let app;
let onDone;

/** @returns {Promise<CampDuplication>} The open dialog */
async function openDialog() {
  const view = new CampDuplication(app, { meetingId: MEETING_ID, lang: 'fr', onDone });
  await view.open();
  await flush();
  return view;
}

beforeEach(() => {
  document.body.innerHTML = '<main id="app"><button type="button" id="opener">open</button></main>';
  document.getElementById('opener').focus();
  app = { showMessage: jest.fn() };
  onDone = jest.fn();
  Object.values(api).forEach((fn) => fn.mockReset());
  api.getCampDuplication.mockResolvedValue({ success: true, data: duplication() });
  hasAllPermissions.mockReset();
  hasAllPermissions.mockImplementation(() => true);
  hasOrganizationScope.mockReset();
  hasOrganizationScope.mockImplementation(() => true);
});

afterEach(() => {
  closeAllModals();
});

describe('choosing what to reuse', () => {
  test('says it is loading, then lists the earlier camps, the latest first, with everything it holds ticked', async () => {
    let release;
    api.getCampDuplication.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    const view = new CampDuplication(app, { meetingId: MEETING_ID, lang: 'fr', onDone });
    const opening = view.open();
    expect(dialog().querySelector('[role="status"]').textContent).toBe('loading');

    release({ success: true, data: duplication() });
    await opening;

    const options = [...dialog().querySelectorAll('#yp-camp-duplicate-source option')];
    expect(options.map((option) => option.value)).toEqual(['41', '40']);
    expect(options[0].textContent).toContain('Camp d’hiver 2026');
    expect(['schedule', 'packing_list', 'lots', 'tasks'].map((name) => part(name).checked)).toEqual([true, true, true, true]);
    expect(dialog().querySelector('label[for="yp-camp-duplicate-part-lots"]').textContent).toContain('camp_duplicate_count_lots');
  });

  test('a part the earlier camp lacks, or whose schedule would not fit, is not offered and says why', async () => {
    await openDialog();
    const select = dialog().querySelector('#yp-camp-duplicate-source');
    select.value = '40';
    select.dispatchEvent(new Event('change'));

    expect(part('schedule').disabled).toBe(true);
    expect(reason('schedule')).toBe('camp_duplicate_reason_too_long');
    expect(part('schedule').getAttribute('aria-describedby')).toBe('yp-camp-duplicate-part-schedule-reason');
    expect(part('packing_list').disabled).toBe(true);
    expect(reason('packing_list')).toBe('camp_duplicate_reason_source_empty');
    expect(part('lots').disabled).toBe(false);
    expect(document.activeElement.id).toBe('yp-camp-duplicate-source');
  });

  test('a part already filled in this camp is not offered and says so', async () => {
    const data = duplication();
    data.target.counts.tasks = 2;
    api.getCampDuplication.mockResolvedValue({ success: true, data });
    await openDialog();

    expect(part('tasks').disabled).toBe(true);
    expect(reason('tasks')).toBe('camp_duplicate_reason_filled_tasks');
  });

  test('a part the person may not manage is not offered and says why', async () => {
    hasAllPermissions.mockImplementation((...keys) => !keys.includes('camp_lots.manage'));
    await openDialog();

    expect(part('lots').disabled).toBe(true);
    expect(reason('lots')).toBe('camp_duplicate_reason_permission');
    expect(part('tasks').disabled).toBe(false);
  });

  test('a role scoped to its own children is not offered the packing list, as on its own screen', async () => {
    hasOrganizationScope.mockImplementation(() => false);
    await openDialog();

    expect(part('packing_list').disabled).toBe(true);
    expect(reason('packing_list')).toBe('camp_duplicate_reason_permission');
    expect(part('schedule').disabled).toBe(false);
  });

  test('with no earlier camp to reuse, says what would fill the list', async () => {
    api.getCampDuplication.mockResolvedValue({ success: true, data: { ...duplication(), sources: [] } });
    await openDialog();

    expect(dialog().querySelector('.empty-state').textContent).toBe('camp_duplicate_empty');
    expect(submitButton()).toBeNull();
  });

  test('a failed load is explained and can be retried', async () => {
    api.getCampDuplication.mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 500 }));
    await openDialog();

    expect(dialog().querySelector('[role="alert"]').textContent).toBe('camp_duplicate_load_failed');
    dialog().querySelector('#yp-camp-duplicate-retry').click();
    await flush();
    expect(dialog().querySelectorAll('#yp-camp-duplicate-source option')).toHaveLength(2);
  });

  test('camp names are shown as text', async () => {
    const data = duplication();
    data.sources[0].theme = '<img src=x onerror=alert(1)>';
    api.getCampDuplication.mockResolvedValue({ success: true, data });
    await openDialog();

    expect(dialog().querySelector('img')).toBeNull();
    expect(dialog().querySelector('#yp-camp-duplicate-source option').textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

describe('copying', () => {
  test('choosing nothing is explained beside the choices and nothing is sent', async () => {
    await openDialog();
    ['schedule', 'packing_list', 'lots', 'tasks'].forEach((name) => { part(name).checked = false; });

    submitButton().click();
    await flush();

    const error = dialog().querySelector('#yp-camp-duplicate-parts-error');
    expect(error.hidden).toBe(false);
    expect(error.getAttribute('role')).toBe('alert');
    expect(error.textContent).toBe('camp_duplicate_parts_required');
    expect(dialog().querySelector('#yp-camp-duplicate-parts').getAttribute('aria-describedby')).toBe(error.id);
    expect(api.duplicateCamp).not.toHaveBeenCalled();

    part('tasks').checked = true;
    part('tasks').dispatchEvent(new Event('change'));
    expect(error.hidden).toBe(true);
  });

  test('sends what was ticked once, however often Copy is pressed, then says what was copied and left out', async () => {
    let release;
    api.duplicateCamp.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    await openDialog();
    part('packing_list').checked = false;

    submitButton().click();
    submitButton().click();
    await flush();
    expect(api.duplicateCamp).toHaveBeenCalledTimes(1);
    expect(api.duplicateCamp).toHaveBeenCalledWith(MEETING_ID, { source_meeting_id: 41, parts: ['schedule', 'lots', 'tasks'] });

    release({
      success: true,
      data: {
        copied: { schedule_days: 3, schedule_activities: 6, lots: 1, tasks: 3 },
        skipped_lots: ['<b>Cuisine</b>'],
        reassigned_tasks: 2,
      },
    });
    await flush();

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(app.showMessage).toHaveBeenCalledWith('camp_duplicate_done', 'success');
    const result = dialog().querySelector('#yp-camp-duplicate-result');
    expect(document.activeElement).toBe(result);
    expect(dialog().textContent).toContain('camp_duplicate_result_schedule');
    expect(dialog().textContent).not.toContain('camp_duplicate_result_packing_list');
    expect(dialog().textContent).toContain('camp_duplicate_lots_skipped');
    expect(dialog().querySelector('b')).toBeNull();
    expect(dialog().textContent).toContain('<b>Cuisine</b>');
    expect(dialog().textContent).toContain('camp_duplicate_reassigned');

    dialog().querySelector('.modal-footer [data-modal-close]').click();
    expect(dialog()).toBeNull();
  });

  test('a refusal is explained in the dialog and nothing is reported as copied', async () => {
    api.duplicateCamp.mockRejectedValueOnce(Object.assign(new Error('Conflict'), {
      status: 409, message: 'camp_duplicate_target_not_empty',
    }));
    await openDialog();

    submitButton().click();
    await flush();

    const failure = dialog().querySelector('#yp-camp-duplicate-error');
    expect(failure.hidden).toBe(false);
    expect(failure.textContent).not.toBe('');
    expect(onDone).not.toHaveBeenCalled();
    expect(app.showMessage).not.toHaveBeenCalledWith('camp_duplicate_done', 'success');
  });
});

describe('accessibility', () => {
  test('the dialog meets WCAG A/AA with parts offered and parts unavailable', async () => {
    const data = duplication();
    data.target.counts.lots = 1;
    api.getCampDuplication.mockResolvedValue({ success: true, data });
    await openDialog();

    const results = await axe.run(dialog(), AXE_OPTIONS);
    expect(results.violations).toEqual([]);
  });

  test('focus starts inside the dialog, Tab stays in it, and Escape returns focus to the opener', async () => {
    await openDialog();
    expect(dialog().contains(document.activeElement)).toBe(true);

    const focusable = [...dialog().querySelectorAll('button:not([disabled]), select, input:not([disabled])')];
    focusable[focusable.length - 1].focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(dialog().contains(document.activeElement)).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(dialog()).toBeNull();
    expect(document.activeElement.id).toBe('opener');
  });
});
