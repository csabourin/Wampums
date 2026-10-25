/**
 * @jest-environment jsdom
 */

/**
 * Picking equipment to reserve: a long list a leader can search, filter by
 * category and sort, each item with its category in the reader's language,
 * what is free for the dates chosen, and a small photo that opens large.
 *
 * @module test/spa/MaterialPicker
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
  CONFIG: { DEFAULT_LANG: 'fr', CACHE_DURATION: {}, UI: {} },
  getStorageKey: (key) => key,
}));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({ hasPermission: () => true }));
jest.mock('../../spa/indexedDB.js', () => ({ deleteCachedData: jest.fn() }));
jest.mock('../../spa/utils/DialogUtils.js', () => ({ confirmDestructive: jest.fn(), hasActiveDialog: () => false }));
jest.mock('../../spa/ajax-functions.js', () => ({ getCurrentOrganizationId: () => '1' }));
jest.mock('../../spa/api/api-endpoints.js', () => ({
  getEquipmentInventory: jest.fn(),
  getEquipmentPhotoUrl: jest.fn(),
  getEquipmentReservations: jest.fn(),
  saveBulkReservations: jest.fn(),
  updateEquipmentReservation: jest.fn(),
  getActivities: jest.fn(),
}));

import * as api from '../../spa/api/api-endpoints.js';
import { closeAllModals } from '../../spa/utils/ModalUtils.js';
import { MaterialManagement } from '../../spa/modules/resources/MaterialManagement.js';

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom does no layout, so contrast cannot be computed here.
  rules: { 'color-contrast': { enabled: false } },
};
const HOSTILE = '<img src=x onerror=alert(1)>';
const TODAY = new Date().toLocaleDateString('en-CA');

const EQUIPMENT = [
  { id: 1, name: 'Boîtes à savon', category: 'games', quantity_total: 3, loaned_quantity: 0 },
  { id: 2, name: 'Cuisinières', category: 'kitchen', quantity_total: 2, loaned_quantity: 0, photo_url: 'https://cdn.example/stove.webp' },
  { id: 3, name: 'Cerceaux', category: 'games', quantity_total: 12, loaned_quantity: 2 },
  { id: 4, name: 'Passoires', category: 'kitchen', quantity_total: 9, loaned_quantity: 0 },
  { id: 5, name: HOSTILE, category: 'other', quantity_total: 1, loaned_quantity: 0 },
];
// Both stoves are spoken for today by another outing.
const RESERVATIONS = [
  { id: 9, equipment_id: 2, equipment_name: 'Cuisinières', reserved_quantity: 2, status: 'reserved', date_from: TODAY, date_to: TODAY, reserved_for: 'Sortie' },
];

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });
const page = () => document.getElementById('app');
const names = () => [...page().querySelectorAll('#material-equipment-list .equipment-name')].map((node) => node.textContent);

async function openScreen() {
  const screen = new MaterialManagement({ lang: 'fr', showMessage: jest.fn() });
  await screen.init();
  return screen;
}

function type(id, value, event = 'input') {
  const field = document.getElementById(id);
  field.value = value;
  field.dispatchEvent(new Event(event, { bubbles: true }));
}

beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main>';
  jest.clearAllMocks();
  api.getEquipmentInventory.mockResolvedValue({ data: { equipment: EQUIPMENT.map((item) => ({ ...item })) } });
  api.getEquipmentReservations.mockResolvedValue({ data: { reservations: RESERVATIONS } });
  api.getActivities.mockResolvedValue({ data: { activities: [] } });
  api.getEquipmentPhotoUrl.mockResolvedValue({ data: { photo_url: 'https://cdn.example/stove-fresh.webp' } });
});

afterEach(() => closeAllModals());

test('items are grouped under their category, named in the reader\'s language', async () => {
  await openScreen();

  const headings = [...page().querySelectorAll('.material-category-group h3')].map((node) => node.textContent);
  expect(headings).toEqual(['equipment_category_games', 'equipment_category_kitchen', 'equipment_category_other']);
  expect(page().textContent).not.toMatch(/\bgames\b|\bkitchen\b/);
});

test('the search ignores case and accents, and says how many items it shows', async () => {
  await openScreen();
  type('material-search', 'CUISINIERE');

  expect(names()).toEqual(['Cuisinières']);
  expect(page().querySelector('#material-result-count').textContent).toBe('material_result_count');
  expect(document.getElementById('material-search').getAttribute('aria-describedby')).toBe('material-result-count');

  type('material-search', 'trampoline');
  expect(names()).toEqual([]);
  expect(page().textContent).toContain('material_no_match');
});

test('a category filter and a sort by name narrow and order the list', async () => {
  await openScreen();
  type('material-category-filter', 'games', 'change');
  expect(names()).toEqual(['Boîtes à savon', 'Cerceaux']);

  type('material-category-filter', 'all', 'change');
  type('material-sort', 'name', 'change');
  expect(page().querySelectorAll('.material-category-group')).toHaveLength(0);
  expect(names()).toEqual(['Boîtes à savon', 'Cerceaux', 'Cuisinières', HOSTILE, 'Passoires'].sort((a, b) => a.localeCompare(b, 'fr')));
});

// What the server counts free for the dates asked (reservations and loans).
const FREE_TODAY = { 1: 3, 2: 0, 3: 10, 4: 9, 5: 1 };

function inventoryFor(params = {}) {
  return {
    data: {
      equipment: EQUIPMENT.map((item) => ({
        ...item,
        available_for_dates: params.date_from === TODAY ? FREE_TODAY[item.id] : item.quantity_total,
      })),
    },
  };
}

test('what is free for the chosen dates is what the server counts for those dates', async () => {
  api.getEquipmentInventory.mockImplementation((params) => Promise.resolve(inventoryFor(params)));
  await openScreen();

  expect(api.getEquipmentInventory).toHaveBeenCalledWith({ date_from: TODAY, date_to: TODAY });
  const hoops = page().querySelector('[data-equipment-id="3"]');
  expect(hoops.querySelector('.equipment-available').textContent).toBe('material_available_for_dates');
  document.getElementById('material-select-3').click();
  expect(document.getElementById('material-quantity-3').getAttribute('max')).toBe('10');
  const stoves = page().querySelector('[data-equipment-id="2"]');
  expect(stoves.querySelector('.equipment-available').textContent).toBe('material_none_available');
  expect(stoves.querySelector('.equipment-selector').disabled).toBe(true);

  // Another day, the stoves are free again.
  type('reservationDateFrom', '2099-01-01', 'change');
  type('reservationDateTo', '2099-01-02', 'change');
  await flush();
  expect(api.getEquipmentInventory).toHaveBeenLastCalledWith({ date_from: '2099-01-01', date_to: '2099-01-02' });
  expect(page().querySelector('[data-equipment-id="2"] .equipment-selector').disabled).toBe(false);
  expect(document.getElementById('material-quantity-3').getAttribute('max')).toBe('12');
});

test('until the server has counted new dates, reservations sent as timestamps still hold their days', async () => {
  api.getEquipmentReservations.mockResolvedValue({ data: { reservations: [
    { ...RESERVATIONS[0], date_from: '2099-01-01T00:00:00.000Z', date_to: '2099-01-02T00:00:00.000Z' },
  ] } });
  await openScreen();
  api.getEquipmentInventory.mockReturnValue(new Promise(() => {}));

  // Ending the day the reservation starts.
  type('reservationDateFrom', '2098-12-31', 'change');
  type('reservationDateTo', '2099-01-01', 'change');
  await flush();

  expect(page().querySelector('[data-equipment-id="2"] .equipment-selector').disabled).toBe(true);
});

test('an answer for dates no longer chosen does not replace the count for the new ones', async () => {
  await openScreen();
  let answerOld;
  api.getEquipmentInventory
    .mockReturnValueOnce(new Promise((resolve) => { answerOld = resolve; }))
    .mockImplementation((params) => Promise.resolve(inventoryFor(params)));

  type('reservationDateFrom', '2099-01-01', 'change');
  type('reservationDateFrom', TODAY, 'change');
  await flush();
  answerOld(inventoryFor({ date_from: '2099-01-01' }));
  await flush();

  expect(page().querySelector('[data-equipment-id="2"] .equipment-selector').disabled).toBe(true);
});

test('going back to the dates already counted drops the answer still on its way for other dates', async () => {
  api.getEquipmentInventory.mockImplementation((params) => Promise.resolve(inventoryFor(params)));
  await openScreen();
  let answerOther;
  api.getEquipmentInventory.mockReturnValueOnce(new Promise((resolve) => { answerOther = resolve; }));

  type('reservationDateFrom', '2098-12-31', 'change');
  type('reservationDateFrom', TODAY, 'change');
  answerOther(inventoryFor({ date_from: '2098-12-31' }));
  await flush();

  document.getElementById('material-select-3').click();
  expect(document.getElementById('material-quantity-3').getAttribute('max')).toBe('10');
});

test('choosing an item keeps focus on it, counts it, and keeps what was typed in the form', async () => {
  await openScreen();
  type('reservedFor', 'Camp d\'hiver');
  type('material-search', 'cerceaux');

  const box = document.getElementById('material-select-3');
  box.focus();
  box.checked = true;
  box.dispatchEvent(new Event('change', { bubbles: true }));

  expect(document.activeElement.id).toBe('material-select-3');
  expect(document.getElementById('material-quantity-3')).not.toBeNull();
  expect(document.getElementById('material-reserve-submit').disabled).toBe(false);
  expect(document.getElementById('material-selected-count').getAttribute('role')).toBe('status');

  type('reservationDateFrom', '2099-01-01', 'change');
  expect(document.getElementById('reservedFor').value).toBe('Camp d\'hiver');
  expect(document.getElementById('material-search').value).toBe('cerceaux');
});

test('the reservation sends the items chosen with the name and dates typed', async () => {
  api.saveBulkReservations.mockResolvedValue({ success: true });
  await openScreen();
  type('reservationDateFrom', '2099-01-01', 'change');
  type('reservationDateTo', '2099-01-02', 'change');
  type('reservedFor', 'Camp d\'hiver');
  const box = document.getElementById('material-select-3');
  box.checked = true;
  box.dispatchEvent(new Event('change', { bubbles: true }));
  type('material-quantity-3', '4', 'change');

  document.getElementById('bulkReservationForm').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  await flush();

  expect(api.saveBulkReservations).toHaveBeenCalledWith({
    reserved_for: 'Camp d\'hiver',
    notes: '',
    items: [{ equipment_id: 3, quantity: 4 }],
    date_from: '2099-01-01',
    date_to: '2099-01-02',
  });
});

test('pressing Reserve twice while the first request is on its way reserves once', async () => {
  let answer;
  api.saveBulkReservations.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
  await openScreen();
  document.getElementById('material-select-3').click();
  const form = document.getElementById('bulkReservationForm');

  form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  expect(document.getElementById('material-reserve-submit').disabled).toBe(true);
  form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  answer({ success: true });
  await flush();

  expect(api.saveBulkReservations).toHaveBeenCalledTimes(1);
});

test('changing the activity while Reserve is on its way does not let it be sent again', async () => {
  api.getActivities.mockResolvedValue({ data: { activities: [
    { id: 12, name: 'Camp d\'hiver', activity_start_date: '2099-01-10', activity_end_date: '2099-01-12' },
  ] } });
  let answer;
  api.saveBulkReservations.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
  await openScreen();
  document.getElementById('material-select-3').click();
  document.getElementById('bulkReservationForm').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));

  type('activitySelect', '12', 'change');
  expect(document.getElementById('material-reserve-submit').disabled).toBe(true);
  document.getElementById('bulkReservationForm').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  answer({ success: true });
  await flush();

  expect(api.saveBulkReservations).toHaveBeenCalledTimes(1);
});

test('a small photo opens large, with a fresh address, and closes back onto its button', async () => {
  await openScreen();
  const thumb = page().querySelector('[data-photo-equipment="2"]');
  expect(thumb.getAttribute('aria-label')).toBe('material_view_photo');
  expect(thumb.querySelector('img').getAttribute('alt')).toBe('');
  expect(page().querySelector('[data-equipment-id="1"] .material-thumb--empty')).not.toBeNull();

  thumb.focus();
  thumb.click();
  await flush();

  const image = document.getElementById('material-photo-img');
  expect(api.getEquipmentPhotoUrl).toHaveBeenCalledWith(2);
  expect(image.getAttribute('src')).toBe('https://cdn.example/stove-fresh.webp');
  expect(image.getAttribute('alt')).toBe('material_photo_alt');
  expect(await axe.run(document.querySelector('#material-photo-modal'), AXE_OPTIONS)).toMatchObject({ violations: [] });

  document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await flush();
  expect(document.getElementById('material-photo-modal')).toBeNull();
  expect(document.activeElement).toBe(thumb);
});

test('names from people show as text, and the picker passes axe', async () => {
  await openScreen();

  expect(page().querySelector('#material-equipment-list img[src="x"]')).toBeNull();
  expect(names()).toContain(HOSTILE);
  expect((await axe.run(page(), AXE_OPTIONS)).violations).toEqual([]);
});
