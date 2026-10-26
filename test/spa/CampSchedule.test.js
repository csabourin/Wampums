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
 * planner is told when something changed; catalogue articles are chosen with
 * a quantity, checked before sending, and left alone when the catalogue
 * cannot be loaded; and the dialog meets WCAG A/AA.
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

jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  hasPermission: jest.fn(() => false),
}));

jest.mock('../../spa/api/api-equipment-catalog.js', () => ({
  getMaterialOptions: jest.fn(),
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
const catalogApi = require('../../spa/api/api-equipment-catalog.js');
const { confirmDestructive } = require('../../spa/utils/DialogUtils.js');
const { closeAllModals } = require('../../spa/utils/ModalUtils.js');
const { CampSchedule } = require('../../spa/modules/yearly-planner/CampSchedule.js');

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom does no layout, so contrast cannot be computed here.
  rules: { 'color-contrast': { enabled: false } },
};

const MEETING_ID = 7;

/** What the unit has or may use: active catalogue articles and inventory. */
const CHOICES = {
  articles: [
    { id: 3, name: 'Tente <b>4</b>', category: 'camping', unit_of_measure: 'each' },
    { id: 5, name: 'Corde', category: 'tools', unit_of_measure: 'm' },
    { id: 6, name: 'Réchaud', category: 'kitchen', unit_of_measure: 'each' },
  ],
  equipment: [{ id: 9, name: 'Ballon de soccer', category: 'sports', unit_of_measure: 'each' }],
};

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
          {
            id: 11, day_offset: 0, name: 'Accueil', start_time: '18:45:00', duration_minutes: 15, responsable: 'Akela', material: null,
            material_items: [{ catalog_item_id: 3, quantity: 2, name: 'Tente <b>4</b>', category: 'camping', unit_of_measure: 'each', archived: false }],
          },
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
  catalogApi.getMaterialOptions.mockReset();
  catalogApi.getMaterialOptions.mockResolvedValue({ success: true, data: CHOICES });
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

describe('catalogue articles', () => {
  /**
   * @param {HTMLElement} field - The material fieldset
   * @param {string} key - What to add: a5 is article 5, e9 inventory item 9
   */
  function addArticle(field, key) {
    field.querySelector('[data-item-select]').value = key;
    field.querySelector('[data-add-item]').click();
  }

  test('a line shows its articles with quantity and unit, names as text', async () => {
    await openSchedule(false);

    const card = dialog().querySelector('.yp-schedule-card');
    expect(card.querySelector('.material-items__summary').textContent).toContain('Tente <b>4</b>');
    expect(card.querySelector('.material-items__summary b')).toBeNull();
    expect(card.textContent).toContain('equipment_quantity_with_unit');
    expect(catalogApi.getMaterialOptions).not.toHaveBeenCalled();
  });

  test('articles chosen while adding a line are sent with their quantities', async () => {
    await openSchedule();
    const form = openAddForm();
    const field = form.querySelector('fieldset.material-items');

    addArticle(field, 'a5');
    expect(document.activeElement).toBe(field.querySelector('[data-quantity-for="a5"]'));
    document.activeElement.value = '12,5';
    addArticle(field, 'a6');
    addArticle(field, 'a3');
    field.querySelector('[data-remove-item="a6"]').click();
    expect(field.querySelector('[data-quantity-for="a5"]').value).toBe('12,5');
    document.getElementById('yp-schedule-new-name').value = 'Pionniérisme';
    form.requestSubmit();
    await flush();

    expect(api.addMeetingActivity).toHaveBeenCalledWith(MEETING_ID, expect.objectContaining({
      name: 'Pionniérisme',
      material_items: [{ catalog_item_id: 5, quantity: 12.5 }, { catalog_item_id: 3, quantity: 1 }],
    }));
  });

  test('a quantity that cannot be read is explained next to it and nothing is sent', async () => {
    await openSchedule();
    const form = openAddForm();
    const field = form.querySelector('fieldset.material-items');
    addArticle(field, 'a5');
    const quantity = field.querySelector('[data-quantity-for="a5"]');
    quantity.value = '0';
    document.getElementById('yp-schedule-new-name').value = 'Pionniérisme';

    form.requestSubmit();
    await flush();

    const error = field.querySelector('.field-error');
    expect(api.addMeetingActivity).not.toHaveBeenCalled();
    expect(error.hidden).toBe(false);
    expect(error.getAttribute('role')).toBe('alert');
    expect(quantity.getAttribute('aria-invalid')).toBe('true');
    expect(quantity.getAttribute('aria-describedby')).toBe(error.id);
    expect(document.activeElement).toBe(quantity);

    quantity.value = '3';
    quantity.dispatchEvent(new Event('input', { bubbles: true }));
    expect(error.hidden).toBe(true);
    expect(quantity.hasAttribute('aria-invalid')).toBe(false);
  });

  test('editing a line keeps its articles and sends the quantities changed', async () => {
    await openSchedule();
    dialog().querySelector('[data-edit-activity="11"]').click();
    const card = dialog().querySelector('[data-activity-id="11"]');
    const field = card.querySelector('fieldset.material-items');
    expect(field.querySelector('[data-item-select] option[value="a3"]')).toBeNull();

    field.querySelector('[data-quantity-for="a3"]').value = '4';
    card.querySelector('[data-save-activity="11"]').click();
    await flush();

    expect(api.updateMeetingActivity).toHaveBeenCalledWith(11, expect.objectContaining({
      material_items: [{ catalog_item_id: 3, quantity: 4 }],
    }));
  });

  test('when the catalogue cannot be loaded, a line keeps its articles and a save leaves them alone', async () => {
    catalogApi.getMaterialOptions.mockRejectedValue(new Error('offline'));
    await openSchedule();
    dialog().querySelector('[data-edit-activity="11"]').click();
    const card = dialog().querySelector('[data-activity-id="11"]');

    expect(card.querySelector('.material-items').textContent).toContain('Tente <b>4</b>');
    expect(card.querySelector('.material-items').textContent).toContain('equipment_catalog_unavailable');
    expect(card.querySelector('[data-quantity-for]')).toBeNull();
    card.querySelector('[data-save-activity="11"]').click();
    await flush();

    expect(api.updateMeetingActivity).toHaveBeenCalledTimes(1);
    expect(api.updateMeetingActivity.mock.calls[0][1]).not.toHaveProperty('material_items');
  });

  test('having nothing to choose from is pointed out in the add form, not on every line', async () => {
    catalogApi.getMaterialOptions.mockResolvedValue({ success: true, data: { articles: [], equipment: [] } });
    const empty = schedule();
    empty.days[0].activities[0].material_items = [];
    api.getMeetingSchedule.mockResolvedValue({ success: true, data: empty });
    await openSchedule();
    dialog().querySelector('#yp-schedule-quick').click();

    expect(dialog().querySelector('[data-activity-id="11"] .material-items')).toBeNull();
    dialog().querySelector('#yp-schedule-quick').click();
    const form = openAddForm();
    expect(form.querySelector('.material-items').textContent).toContain('equipment_catalog_empty_short');
    expect(form.querySelector('[data-item-select]')).toBeNull();
  });

  test('inventory the unit has or may borrow is offered beside the catalogue and sent as such', async () => {
    await openSchedule();
    const form = openAddForm();
    const field = form.querySelector('fieldset.material-items');
    const groups = [...field.querySelectorAll('optgroup')].map((group) => group.label);
    expect(groups).toEqual(['equipment_catalog_group_articles', 'equipment_catalog_group_inventory']);

    addArticle(field, 'e9');
    field.querySelector('[data-quantity-for="e9"]').value = '2';
    document.getElementById('yp-schedule-new-name').value = 'Soccer';
    form.requestSubmit();
    await flush();

    expect(api.addMeetingActivity).toHaveBeenCalledWith(MEETING_ID, expect.objectContaining({
      material_items: [{ equipment_item_id: 9, quantity: 2 }],
    }));
  });

  test('the article picker meets WCAG A/AA', async () => {
    await openSchedule();
    const form = openAddForm();
    addArticle(form.querySelector('fieldset.material-items'), 'a5');

    const results = await axe.run(document.querySelector('#yp-schedule-activity'), AXE_OPTIONS);

    expect(results.violations).toEqual([]);
  });
});
