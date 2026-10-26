/**
 * @jest-environment jsdom
 */

/**
 * The unit's material on a regular meeting's agenda.
 *
 * Held here: each activity offers the unit's catalogue articles and the
 * inventory it has or may borrow, in a dialog named after the activity; what
 * is applied is kept on the activity, shown under its row, counted on its
 * button and handed to the page to save; cancelling changes nothing; an
 * invalid quantity keeps the dialog open; names show as text; without the
 * list of choices nothing can be changed; the dialog meets WCAG A/AA and
 * returns focus on Escape.
 *
 * @module test/spa/ActivityManagerMaterial
 */

import axe from 'axe-core';

jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({ debugLog: jest.fn(), debugWarn: jest.fn(), debugError: jest.fn() }));
jest.mock('../../spa/utils/meetingSections.js', () => ({ getSectionActivityTemplates: jest.fn(() => []) }));

import { ActivityManager } from '../../spa/modules/meetings/ActivityManager.js';
import { closeAllModals } from '../../spa/utils/ModalUtils.js';

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom does no layout, so contrast cannot be computed here.
  rules: { 'color-contrast': { enabled: false } },
};
const HOSTILE = '<img src=x onerror=alert(1)>';
const CHOICES = {
  articles: [{ id: 3, name: 'Cônes', category: 'sports', unit_of_measure: 'each' }],
  equipment: [{ id: 9, name: HOSTILE, category: 'games', unit_of_measure: 'each' }],
};

let manager;
let changes;

/**
 * Draw an agenda of one activity, wired as the preparation page wires it.
 * @param {Object|null|undefined} choices - setMaterialChoices argument; undefined leaves it off
 * @param {Object[]} [materialItems] - What the activity lists
 * @returns {HTMLElement} The agenda
 */
function renderAgenda(choices, materialItems = []) {
  document.body.innerHTML = '<main><h1>Meeting</h1><form id="reunion-form"><div id="activities-list"></div></form></main>';
  window.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };
  manager = new ActivityManager({ lang: 'fr' }, [{ full_name: 'Akela' }], [{ id: 1, activity: 'Jeu de cônes' }]);
  if (choices !== undefined) {
    manager.setMaterialChoices(choices, false);
  }
  manager.setSelectedActivities([{
    id: 41, activity: 'Jeu de cônes', time: '19:00', duration: '00:20', responsable: 'Akela',
    materiel: '', material_items: materialItems, position: 0,
  }]);
  manager.renderActivitiesTable();
  const list = document.getElementById('activities-list');
  list.addEventListener('click', (event) => {
    const button = event.target.closest('.material-items-btn');
    if (button) {
      manager.openMaterialItems(button);
    }
  });
  changes = jest.fn();
  document.getElementById('reunion-form').addEventListener('activitieschange', changes);
  return list;
}

/** @returns {HTMLElement} The material dialog */
function dialog() {
  return document.getElementById('activity-material-items');
}

/** @param {string} key - a3, e9… */
function choose(key) {
  const field = dialog().querySelector('fieldset.material-items');
  field.querySelector('[data-item-select]').value = key;
  field.querySelector('[data-add-item]').click();
}

/** Apply the dialog. */
function apply() {
  document.getElementById('activity-material-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

afterEach(() => closeAllModals());

test('without the material offer, an activity shows no material button', () => {
  const list = renderAgenda(undefined);
  expect(list.querySelector('.material-items-btn')).toBeNull();
});

test('an activity takes the unit\'s articles and inventory, kept on it, shown under it and saved', () => {
  const list = renderAgenda(CHOICES);
  const button = list.querySelector('.material-items-btn');
  expect(button.getAttribute('aria-label')).toBe('equipment_catalog_items_legend — Jeu de cônes');
  button.click();

  expect(dialog().querySelector('.modal-title, h2').textContent).toContain('equipment_catalog_items_for');
  choose('a3');
  dialog().querySelector('[data-quantity-for="a3"]').value = '8';
  choose('e9');
  apply();

  expect(dialog()).toBeNull();
  expect(manager.getSelectedActivitiesFromDOM()[0].material_items).toEqual([
    expect.objectContaining({ catalog_item_id: 3, equipment_item_id: null, quantity: 8, name: 'Cônes' }),
    expect.objectContaining({ catalog_item_id: null, equipment_item_id: 9, quantity: 1, name: HOSTILE }),
  ]);
  const summary = list.querySelector('.activity-material-summary');
  expect(summary.classList.contains('hidden')).toBe(false);
  expect(summary.textContent).toContain('Cônes');
  expect(summary.textContent).toContain(HOSTILE);
  expect(list.querySelector('img')).toBeNull();
  expect(changes).toHaveBeenCalledTimes(1);
});

test('cancelling changes nothing', () => {
  const list = renderAgenda(CHOICES, [{ catalog_item_id: 3, equipment_item_id: null, quantity: 2, name: 'Cônes', unit_of_measure: 'each' }]);
  list.querySelector('.material-items-btn').click();
  dialog().querySelector('[data-remove-item="a3"]').click();
  dialog().querySelector('[data-modal-close]').click();

  expect(manager.getSelectedActivitiesFromDOM()[0].material_items).toHaveLength(1);
  expect(changes).not.toHaveBeenCalled();
});

test('a quantity that cannot be read keeps the dialog open and is explained next to it', () => {
  const list = renderAgenda(CHOICES);
  list.querySelector('.material-items-btn').click();
  choose('a3');
  const quantity = dialog().querySelector('[data-quantity-for="a3"]');
  quantity.value = 'beaucoup';
  apply();

  expect(dialog()).not.toBeNull();
  expect(quantity.getAttribute('aria-invalid')).toBe('true');
  expect(document.activeElement).toBe(quantity);
  expect(changes).not.toHaveBeenCalled();
});

test('when the unit\'s material could not be loaded, what is listed is shown and cannot be changed', () => {
  const list = renderAgenda(null, [{ catalog_item_id: 3, equipment_item_id: null, quantity: 2, name: 'Cônes', unit_of_measure: 'each' }]);
  list.querySelector('.material-items-btn').click();

  expect(dialog().textContent).toContain('equipment_catalog_unavailable');
  expect(dialog().querySelector('[data-quantity-for], [type="submit"]')).toBeNull();
});

test('the material dialog meets WCAG A/AA and returns focus on Escape', async () => {
  const list = renderAgenda(CHOICES);
  const button = list.querySelector('.material-items-btn');
  button.focus();
  button.click();
  choose('a3');

  expect((await axe.run(dialog(), AXE_OPTIONS)).violations).toEqual([]);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(dialog()).toBeNull();
  expect(document.activeElement).toBe(button);
});
