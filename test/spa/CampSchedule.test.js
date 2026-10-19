/**
 * @jest-environment jsdom
 */

/**
 * The day-by-day programme of a camp, edited from the yearly planner.
 *
 * Held here: the dialog says it is loading, then shows one day at a time;
 * someone who may only look sees no editing control; adding an activity
 * checks its name next to the field, suggests the time after the previous
 * one, and saves once however often Save is pressed; a refusal reads as a
 * refusal; a declined deletion changes nothing; names are shown as text; the
 * planner is told when something changed; and the dialog meets WCAG A/AA.
 *
 * @module test/spa/CampSchedule
 */

import axe from 'axe-core';

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn(),
}));

jest.mock('../../spa/app.js', () => ({
  translate: (key) => key,
}));

jest.mock('../../spa/config.js', () => ({
  CONFIG: {},
  getStorageKey: (key) => key,
}));

jest.mock('../../spa/utils/DialogUtils.js', () => ({
  confirmDestructive: jest.fn(),
  hasActiveDialog: () => false,
}));

jest.mock('../../spa/api/api-yearly-planner.js', () => ({
  getMeetingSchedule: jest.fn(),
  updateMeetingDay: jest.fn(),
  addMeetingActivity: jest.fn(),
  updateMeetingActivity: jest.fn(),
  deleteMeetingActivity: jest.fn(),
  copyMeetingSchedule: jest.fn(),
}));

const api = require('../../spa/api/api-yearly-planner.js');
const { confirmDestructive } = require('../../spa/utils/DialogUtils.js');
const { closeAllModals } = require('../../spa/utils/ModalUtils.js');
const { CampSchedule } = require('../../spa/modules/yearly-planner/CampSchedule.js');

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom does no layout, so contrast cannot be computed here.
  rules: { 'color-contrast': { enabled: false } },
};

const MEETING_ID = 7;

/** @returns {Object} A two-day camp with a programme on its first day */
function schedule() {
  return {
    days: [
      {
        day_offset: 0,
        date: '2026-11-06',
        title: 'Arrivée',
        notes: '',
        activities: [
          { id: 11, day_offset: 0, name: 'Accueil', start_time: '18:45:00', duration_minutes: 15, responsable: 'Akela', material: null },
        ],
      },
      { day_offset: 1, date: '2026-11-07', title: '', notes: '', activities: [] },
    ],
    copy_sources: [],
  };
}

/** @returns {Promise<void>} Let pending promises settle */
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** @returns {HTMLElement} The schedule dialog */
function dialog() {
  return document.querySelector('#yp-camp-schedule');
}

let app;

/**
 * @param {boolean} canManage - Whether the person may edit the plan
 * @param {Function} [onChanged] - Told when something changed
 * @returns {Promise<CampSchedule>} The open editor
 */
async function openSchedule(canManage = true, onChanged = jest.fn()) {
  const editor = new CampSchedule(app, { chip: { meetingId: MEETING_ID }, lang: 'fr', canManage, onChanged });
  await editor.open();
  await flush();
  return editor;
}

/** @returns {HTMLFormElement} The add-activity form, opened from the toolbar */
function openAddForm() {
  dialog().querySelector('.yp-schedule__toolbar [data-add-position]').click();
  return document.getElementById('yp-schedule-new-form');
}

beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main>';
  app = { showMessage: jest.fn() };
  Object.values(api).forEach((fn) => fn.mockReset());
  api.getMeetingSchedule.mockResolvedValue({ success: true, data: schedule() });
  confirmDestructive.mockReset();
});

afterEach(() => {
  closeAllModals();
});

describe('reading the camp', () => {
  test('says it is loading, then shows the first day with its programme', async () => {
    let release;
    api.getMeetingSchedule.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    const editor = new CampSchedule(app, { chip: { meetingId: MEETING_ID }, lang: 'fr', canManage: true });

    const opening = editor.open();
    expect(dialog().querySelector('[role="status"]').textContent.trim()).toBe('loading');

    release({ success: true, data: schedule() });
    await opening;

    const days = [...dialog().querySelectorAll('[data-day-offset]')];
    expect(days.map((day) => day.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
    expect(dialog().querySelector('.yp-schedule-card').textContent).toContain('Accueil');
  });

  test('choosing another day shows that day', async () => {
    await openSchedule();

    dialog().querySelector('[data-day-offset="1"]').click();

    expect(dialog().querySelector('[data-day-offset="1"]').getAttribute('aria-pressed')).toBe('true');
    expect(dialog().querySelector('.empty-state').textContent).toContain('no_activities_scheduled');
  });

  test('someone who may only look sees the programme and no editing control', async () => {
    await openSchedule(false);

    expect(dialog().querySelector('#yp-schedule-save-day')).toBeNull();
    expect(dialog().querySelector('[data-add-position]')).toBeNull();
    expect(dialog().querySelector('[data-delete-activity]')).toBeNull();
    expect(dialog().querySelector('#yp-schedule-title').disabled).toBe(true);
  });

  test('names written by leaders are shown as text', async () => {
    const hostile = schedule();
    hostile.days[0].activities[0].name = '<img src=x onerror=alert(1)>';
    hostile.days[0].activities[0].responsable = '<b>Akela</b>';
    api.getMeetingSchedule.mockResolvedValue({ success: true, data: hostile });

    await openSchedule();

    expect(dialog().querySelector('.yp-schedule-card img')).toBeNull();
    expect(dialog().querySelector('.yp-schedule-card b')).toBeNull();
    expect(dialog().querySelector('.yp-schedule-card strong').textContent).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('adding an activity', () => {
  test('without a name, the error is shown and announced next to the field, and nothing is sent', async () => {
    await openSchedule();
    const form = openAddForm();

    form.requestSubmit();
    await flush();

    const name = document.getElementById('yp-schedule-new-name');
    const error = document.getElementById('yp-schedule-new-name-error');
    expect(api.addMeetingActivity).not.toHaveBeenCalled();
    expect(error.hidden).toBe(false);
    expect(error.getAttribute('role')).toBe('alert');
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(name.getAttribute('aria-describedby')).toBe(error.id);
    expect(document.activeElement).toBe(name);

    name.value = 'J';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    expect(error.hidden).toBe(true);
    expect(name.hasAttribute('aria-invalid')).toBe(false);
  });

  test('suggests the time after the previous activity, and saves once however often Save is pressed', async () => {
    let finish;
    api.addMeetingActivity.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const onChanged = jest.fn();
    await openSchedule(true, onChanged);
    const form = openAddForm();

    expect(document.getElementById('yp-schedule-new-time').value).toBe('19:00');
    document.getElementById('yp-schedule-new-name').value = 'Jeu de la tanière';
    document.getElementById('yp-schedule-new-duration').value = '25';
    form.requestSubmit();
    form.requestSubmit();
    await flush();

    expect(api.addMeetingActivity).toHaveBeenCalledTimes(1);
    expect(document.getElementById('yp-schedule-create').disabled).toBe(true);
    expect(api.addMeetingActivity).toHaveBeenCalledWith(MEETING_ID, expect.objectContaining({
      day_offset: 0, sort_order: 1, start_time: '19:00', name: 'Jeu de la tanière', duration_minutes: 25,
    }));

    finish({ success: true });
    await flush();
    expect(document.getElementById('yp-schedule-new-form')).toBeNull();
    expect(api.getMeetingSchedule).toHaveBeenCalledTimes(2);

    dialog().querySelector('[data-modal-close]').click();
    expect(onChanged).toHaveBeenCalled();
  });

  test('a refusal is explained as a refusal, not as a generic failure', async () => {
    api.addMeetingActivity.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }));
    await openSchedule();
    const form = openAddForm();

    document.getElementById('yp-schedule-new-name').value = 'Jeu';
    form.requestSubmit();
    await flush();

    const [message, type] = app.showMessage.mock.calls.at(-1);
    expect(type).toBe('error');
    expect(message).not.toBe('yearly_planner_error_saving');
    expect(document.getElementById('yp-schedule-new-form')).not.toBeNull();
  });

  test('the add form meets WCAG A/AA', async () => {
    await openSchedule();
    openAddForm();

    const results = await axe.run(document.querySelector('#yp-schedule-activity'), AXE_OPTIONS);

    expect(results.violations).toEqual([]);
  });
});

test('declining a deletion removes nothing', async () => {
  confirmDestructive.mockResolvedValue(false);
  await openSchedule();

  dialog().querySelector('[data-delete-activity="11"]').click();
  await flush();

  expect(api.deleteMeetingActivity).not.toHaveBeenCalled();
});

test('the schedule dialog meets WCAG A/AA', async () => {
  await openSchedule();

  const results = await axe.run(dialog(), AXE_OPTIONS);

  expect(results.violations).toEqual([]);
});
