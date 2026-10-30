/**
 * @jest-environment jsdom
 */

/**
 * The sheet a leader opens on one date of the yearly planner.
 *
 * Held here: it shows that date's theme, place, period and series; someone
 * who may only look sees the fields disabled and no write action; Save sends
 * exactly the fields the sheet shows; the buttons hand the right date, series
 * or camp to the planner; text written by leaders is shown as text; and the
 * sheet meets WCAG A/AA.
 *
 * @module test/spa/MeetingSheet
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

const { openMeetingSheet } = require('../../spa/modules/yearly-planner/MeetingSheet.js');
const { closeAllModals } = require('../../spa/utils/ModalUtils.js');

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom does no layout, so contrast cannot be computed here.
  rules: { 'color-contrast': { enabled: false } },
};

const PLAN = { periods: [{ id: 3, title: 'Automne' }, { id: 4, title: 'Hiver' }] };

/**
 * @param {Object} [overrides] - Chip fields to change
 * @returns {Object} One planned date
 */
function chip(overrides = {}) {
  return {
    date: '2026-10-20',
    meetingId: 9,
    theme: 'La jungle',
    location: 'Local scout',
    periodId: 3,
    isCancelled: false,
    spanDays: 1,
    series: [{ id: 'series-1', label: 'Badge Cuisine', occurrence: 2, total: 4 }],
    ...overrides,
  };
}

/**
 * @param {Object} [chipOverrides] - Chip fields to change
 * @param {Object} [options] - Sheet options to change
 * @returns {{callbacks: Object, overlay: HTMLElement}} The open sheet and its callbacks
 */
function open(chipOverrides = {}, options = {}) {
  const callbacks = {
    onSave: jest.fn(),
    onDelete: jest.fn(),
    onOpenPrep: jest.fn(),
    onUnlinkActivity: jest.fn(),
    onRemoveSeries: jest.fn(),
    onEditSeries: jest.fn(),
    onOpenSchedule: jest.fn(),
  };
  const modal = openMeetingSheet({ chip: chip(chipOverrides), plan: PLAN, lang: 'fr', canManage: true, ...callbacks, ...options });
  return { callbacks, overlay: modal.overlay };
}

/**
 * @param {string} selector - Element inside the open sheet
 * @returns {HTMLElement|null} It
 */
function sheet(selector) {
  return document.querySelector(`#yp-meeting-sheet ${selector}`);
}

beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main>';
});

afterEach(() => {
  closeAllModals();
});

test('shows the date\'s theme, place, period and series', () => {
  open();

  expect(sheet('#yp-sheet-theme').value).toBe('La jungle');
  expect(sheet('#yp-sheet-location').value).toBe('Local scout');
  expect(sheet('#yp-sheet-period').value).toBe('3');
  expect(sheet('.yp-sheet__series').textContent).toContain('Badge Cuisine');
  expect(sheet('.yp-sheet__series strong').textContent).toBe('2 / 4');
});

test('Save sends exactly the fields the sheet shows, then closes it', () => {
  const { callbacks } = open();

  sheet('#yp-sheet-theme').value = 'Les loups';
  sheet('#yp-sheet-period').value = '';
  sheet('#yp-sheet-cancelled').checked = true;
  sheet('#yp-sheet-save').click();

  expect(callbacks.onSave).toHaveBeenCalledWith({
    theme: 'Les loups', location: 'Local scout', is_cancelled: true, period_id: null,
  });
  expect(document.querySelector('#yp-meeting-sheet')).toBeNull();
});

test('without periods in the plan, Save leaves the date\'s period alone', () => {
  const { callbacks } = open({}, { plan: { periods: [] } });

  sheet('#yp-sheet-save').click();

  expect(callbacks.onSave.mock.calls[0][0]).not.toHaveProperty('period_id');
});

test('someone who may only look sees the fields disabled and no write action', () => {
  open({}, { canManage: false });

  ['#yp-sheet-theme', '#yp-sheet-location', '#yp-sheet-period', '#yp-sheet-cancelled']
    .forEach((selector) => expect(sheet(selector).disabled).toBe(true));
  expect(sheet('#yp-sheet-save')).toBeNull();
  expect(sheet('#yp-sheet-delete')).toBeNull();
  expect(sheet('.yp-sheet-series-remove')).toBeNull();
  expect(sheet('#yp-sheet-prep')).not.toBeNull();
});

test('the buttons hand the planner the right date, series or camp', () => {
  let { callbacks } = open();
  sheet('#yp-sheet-prep').click();
  expect(callbacks.onOpenPrep).toHaveBeenCalledWith('2026-10-20');

  ({ callbacks } = open());
  sheet('.yp-sheet-series-edit').click();
  expect(callbacks.onEditSeries).toHaveBeenCalledWith(expect.objectContaining({ id: 'series-1' }));

  ({ callbacks } = open());
  sheet('.yp-sheet-series-remove').click();
  expect(callbacks.onRemoveSeries).toHaveBeenCalledWith(expect.objectContaining({ id: 'series-1' }));

  ({ callbacks } = open({ spanDays: 3, spanEndDate: '2026-10-22' }));
  sheet('#yp-sheet-schedule').click();
  expect(callbacks.onOpenSchedule).toHaveBeenCalledWith(expect.objectContaining({ meetingId: 9, spanDays: 3 }));
});

test('only a camp spanning several days offers its schedule', () => {
  open();

  expect(sheet('#yp-sheet-schedule')).toBeNull();
});

test('a linked activity shows its consent and transport, with links to their pages', () => {
  open({ activityId: 5, consent: { signed: 3, total: 8 }, carpool: { offers: 2 } });

  const status = sheet('.yp-sheet__status');
  expect(status.textContent).toContain('3/8');
  expect(status.querySelector('a[href="/carpool/5"]')).not.toBeNull();
  expect(sheet('#yp-sheet-unlink')).not.toBeNull();
});

test('text written by leaders is shown as text', () => {
  const hostile = '<img src=x onerror=alert(1)>';
  open({ theme: hostile, series: [{ id: 'series-1', label: hostile, occurrence: 1, total: 1 }] }, {
    plan: { periods: [{ id: 3, title: hostile }] },
  });

  expect(document.querySelector('#yp-meeting-sheet img')).toBeNull();
  expect(sheet('#yp-sheet-theme').value).toBe(hostile);
  expect(sheet('.yp-sheet__series li span').textContent).toContain(hostile);
  expect(sheet('#yp-sheet-period option[value="3"]').textContent.trim()).toBe(hostile);
});

test('the sheet meets WCAG A/AA', async () => {
  open({ activityId: 5, consent: { signed: 3, total: 8 }, carpool: { offers: 2 } });

  const results = await axe.run(document.querySelector('#yp-meeting-sheet'), AXE_OPTIONS);

  expect(results.violations).toEqual([]);
});

describe('a camp\'s dates', () => {
  const CAMP = { date: '2027-02-05', spanDays: 3, spanEndDate: '2027-02-07', activityId: 21, series: [] };

  test('someone who may edit activities sees the camp\'s first and last days, labelled', async () => {
    const { overlay } = open(CAMP, { canEditDates: true });

    expect(sheet('#yp-sheet-start').value).toBe('2027-02-05');
    expect(sheet('#yp-sheet-end').value).toBe('2027-02-07');
    expect(sheet('.yp-sheet__dates legend').textContent).toContain('yearly_planner_camp_dates');
    expect((await axe.run(overlay, AXE_OPTIONS)).violations).toEqual([]);
  });

  test('without the right to edit activities, or without a linked activity, no date is offered', () => {
    open(CAMP);
    expect(sheet('#yp-sheet-start')).toBeNull();
    closeAllModals();
    open({ ...CAMP, activityId: null }, { canEditDates: true });
    expect(sheet('#yp-sheet-start')).toBeNull();
  });

  test('moved dates travel with the save', () => {
    const { callbacks } = open(CAMP, { canEditDates: true });

    sheet('#yp-sheet-start').value = '2027-02-12';
    sheet('#yp-sheet-end').value = '2027-02-14';
    sheet('#yp-sheet-save').click();

    expect(callbacks.onSave.mock.calls[0][0].dates).toEqual({ start: '2027-02-12', end: '2027-02-14' });
  });

  test('unchanged dates are not sent', () => {
    const { callbacks } = open(CAMP, { canEditDates: true });
    sheet('#yp-sheet-save').click();
    expect(callbacks.onSave.mock.calls[0][0]).not.toHaveProperty('dates');
  });

  test('a camp of more than a month, such as a mistyped year, is refused in the sheet, which stays open', () => {
    const { callbacks } = open(CAMP, { canEditDates: true });

    sheet('#yp-sheet-end').value = '2028-02-07';
    sheet('#yp-sheet-save').click();

    expect(callbacks.onSave).not.toHaveBeenCalled();
    const message = sheet('#yp-sheet-dates-error');
    expect(message.hidden).toBe(false);
    expect(message.getAttribute('role')).toBe('alert');
    expect(message.textContent).toBe('activity_too_long');
    expect(sheet('#yp-sheet-end').getAttribute('aria-invalid')).toBe('true');
    expect(sheet('#yp-sheet-end').getAttribute('aria-describedby')).toBe('yp-sheet-dates-error');
    expect(document.activeElement).toBe(sheet('#yp-sheet-end'));
  });

  test('an end before the start is refused the same way', () => {
    const { callbacks } = open(CAMP, { canEditDates: true });
    sheet('#yp-sheet-end').value = '2027-02-01';
    sheet('#yp-sheet-save').click();
    expect(callbacks.onSave).not.toHaveBeenCalled();
    expect(sheet('#yp-sheet-dates-error').textContent).toBe('activity_form_end_before_start');
  });
});
