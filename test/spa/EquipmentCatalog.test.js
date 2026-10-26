/** @jest-environment jsdom */

/**
 * The unit's equipment catalogue screen.
 *
 * Held here: it says it is loading, then lists the articles with their
 * category, unit and use; names from people are shown as text; a failed load
 * offers a retry and never reads as an empty catalogue; an empty catalogue
 * says what would fill it; an article is created with the fields chosen and
 * saved once however often Save is pressed; a duplicate name is explained on
 * the name field; archiving and restoring are offered and reported; a demo
 * account is offered no change; a late answer never draws over the next
 * screen; and the screen and its form meet WCAG A/AA, with Escape closing the
 * form and returning focus.
 *
 * @module test/spa/EquipmentCatalog
 */
import axe from 'axe-core';

jest.mock('../../spa/config.js', () => ({
  CONFIG: { EQUIPMENT_CATALOG: { NAME_MAX_LENGTH: 150, QUANTITY_MAX: 99999, ITEMS_MAX: 50 } },
  getStorageKey: (key) => key,
}));
jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({ debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn() }));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({ hasPermission: jest.fn(), isDemoUser: jest.fn(() => false) }));
jest.mock('../../spa/api/api-equipment-catalog.js', () => ({
  getEquipmentCatalog: jest.fn(),
  createCatalogItem: jest.fn(),
  updateCatalogItem: jest.fn(),
  getLinkableEquipment: jest.fn(),
}));

const { EquipmentCatalog } = require('../../spa/modules/equipment-catalog/EquipmentCatalog.js');
const api = require('../../spa/api/api-equipment-catalog.js');
const { hasPermission, isDemoUser } = require('../../spa/utils/PermissionUtils.js');
const { closeAllModals } = require('../../spa/utils/ModalUtils.js');

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom does no layout, so contrast cannot be computed here.
  rules: { 'color-contrast': { enabled: false } },
};
const HOSTILE = '<img src=x onerror=alert(1)>';
const TENT = {
  id: 3, name: HOSTILE, category: 'camping', unit_of_measure: 'each',
  equipment_item_id: 9, equipment_name: '<b>Tentes du local</b>', archived: false, usage_count: 2,
};
const ROPE = { id: 4, name: 'Corde', category: 'tools', unit_of_measure: 'm', equipment_item_id: null, equipment_name: null, archived: true, usage_count: 1 };

let app;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** @returns {Promise<EquipmentCatalog>} The screen, loaded */
async function openScreen() {
  const screen = new EquipmentCatalog(app);
  await screen.init();
  return screen;
}

/** @returns {Promise<HTMLFormElement>} The article form, opened from the toolbar */
async function openCreateForm() {
  document.getElementById('equipment-catalog-create').click();
  await settle();
  return document.getElementById('equipment-catalog-form');
}

/** @param {HTMLFormElement} form */
function submit(form) {
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

beforeEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = '<main id="app"></main>';
  hasPermission.mockImplementation((key) => key === 'inventory.view');
  isDemoUser.mockReturnValue(false);
  api.getEquipmentCatalog.mockResolvedValue({ data: [TENT] });
  api.getLinkableEquipment.mockResolvedValue({ data: { equipment: [{ id: 9, name: 'Tentes du local' }, { id: 10, name: 'Réchaud' }] } });
  api.createCatalogItem.mockResolvedValue({ success: true });
  api.updateCatalogItem.mockResolvedValue({ success: true });
  app = { lang: 'fr', showMessage: jest.fn() };
});
afterEach(() => closeAllModals());

test('the screen says it is loading before the catalogue arrives', async () => {
  let resolve;
  api.getEquipmentCatalog.mockReturnValue(new Promise((done) => {resolve = done;}));
  const pending = new EquipmentCatalog(app).init();
  expect(document.querySelector('#app [role="status"]').textContent).toBe('loading');
  expect(document.querySelector('#app .back-link, #app a')).not.toBeNull();
  resolve({ data: [] });
  await pending;
});

test('articles are listed with their category, unit, inventory item and use, names shown as text', async () => {
  await openScreen();
  const card = document.querySelector('.equipment-catalog__item');
  expect(card.querySelector('h2').textContent).toBe(HOSTILE);
  expect(document.querySelector('#app img, #app b')).toBeNull();
  expect(card.textContent).toContain('equipment_category_camping');
  expect(card.textContent).toContain('equipment_unit_each');
  expect(card.textContent).toContain('<b>Tentes du local</b>');
  expect(card.textContent).toContain('equipment_catalog_used_other');
});

test('a failed load offers a retry and is never shown as an empty catalogue', async () => {
  api.getEquipmentCatalog.mockRejectedValueOnce(new Error('offline'));
  await openScreen();
  expect(document.querySelector('[role="alert"]').textContent).toBe('equipment_catalog_load_failed');
  expect(document.querySelector('.empty-state')).toBeNull();
  document.getElementById('equipment-catalog-retry').click();
  await settle();
  expect(document.querySelector('.equipment-catalog__item h2').textContent).toBe(HOSTILE);
});

test('an empty catalogue says what would fill it', async () => {
  api.getEquipmentCatalog.mockResolvedValue({ data: [] });
  await openScreen();
  expect(document.querySelector('.empty-state').textContent).toBe('equipment_catalog_empty');
});

test('a new article is saved once with the fields chosen, then the list is reloaded', async () => {
  await openScreen();
  const form = await openCreateForm();
  form.elements.catalog_name.value = '  Réchaud deux feux ';
  form.elements.catalog_category.value = 'kitchen';
  form.elements.catalog_unit.value = 'each';
  form.elements.catalog_equipment.value = '10';
  submit(form);
  submit(form);
  await settle();
  expect(api.createCatalogItem).toHaveBeenCalledTimes(1);
  expect(api.createCatalogItem).toHaveBeenCalledWith({
    name: 'Réchaud deux feux', category: 'kitchen', unit_of_measure: 'each', equipment_item_id: 10,
  });
  expect(app.showMessage).toHaveBeenCalledWith('equipment_catalog_saved', 'success');
  expect(api.getEquipmentCatalog).toHaveBeenLastCalledWith({ includeArchived: false, forceRefresh: true });
  expect(document.getElementById('equipment-catalog-form')).toBeNull();
});

test('without the inventory right, no inventory link is offered or sent', async () => {
  hasPermission.mockReturnValue(false);
  await openScreen();
  const form = await openCreateForm();
  expect(form.elements.namedItem('catalog_equipment')).toBeNull();
  expect(api.getLinkableEquipment).not.toHaveBeenCalled();
  form.elements.catalog_name.value = 'Bâche';
  submit(form);
  await settle();
  expect(api.createCatalogItem.mock.calls[0][0]).not.toHaveProperty('equipment_item_id');
});

test('a missing name is explained on its field without sending anything', async () => {
  await openScreen();
  const form = await openCreateForm();
  submit(form);
  await settle();
  const name = form.elements.catalog_name;
  expect(api.createCatalogItem).not.toHaveBeenCalled();
  expect(name.getAttribute('aria-invalid')).toBe('true');
  expect(document.getElementById(name.getAttribute('aria-describedby')).textContent).toBe('equipment_catalog_name_required');
  name.value = 'Bâche';
  name.dispatchEvent(new Event('input', { bubbles: true }));
  expect(name.hasAttribute('aria-invalid')).toBe(false);
});

test('a duplicate name is explained on the name field and the form stays open with what was typed', async () => {
  api.createCatalogItem.mockRejectedValue(Object.assign(new Error('conflict'), {
    status: 409, errors: [{ path: 'name', msg: 'equipment_catalog_duplicate_name' }],
  }));
  await openScreen();
  const form = await openCreateForm();
  form.elements.catalog_name.value = 'Tente';
  submit(form);
  await settle();
  const name = form.elements.catalog_name;
  expect(name.value).toBe('Tente');
  expect(name.getAttribute('aria-invalid')).toBe('true');
  expect(document.getElementById('equipment-catalog-form-error').hidden).toBe(false);
  expect(app.showMessage).not.toHaveBeenCalledWith('equipment_catalog_saved', 'success');
});

test('an article can be archived, and an archived one restored', async () => {
  api.getEquipmentCatalog.mockResolvedValue({ data: [TENT, ROPE] });
  await openScreen();
  document.querySelector('[data-catalog-archive="3"]').click();
  await settle();
  expect(api.updateCatalogItem).toHaveBeenCalledWith(3, { archived: true });
  expect(app.showMessage).toHaveBeenCalledWith('equipment_catalog_archived_done', 'success');
  document.querySelector('[data-catalog-archive="4"]').click();
  await settle();
  expect(api.updateCatalogItem).toHaveBeenCalledWith(4, { archived: false });
  expect(app.showMessage).toHaveBeenCalledWith('equipment_catalog_restored', 'success');
  expect(document.querySelector('[data-catalog-edit="4"]')).toBeNull();
});

test('archived articles are fetched only when asked for', async () => {
  await openScreen();
  const toggle = document.getElementById('equipment-catalog-archived');
  expect(toggle.getAttribute('aria-pressed')).toBe('false');
  toggle.click();
  await settle();
  expect(api.getEquipmentCatalog).toHaveBeenLastCalledWith({ includeArchived: true, forceRefresh: true });
  expect(document.getElementById('equipment-catalog-archived').getAttribute('aria-pressed')).toBe('true');
});

test('a refused change reads as a refusal', async () => {
  api.updateCatalogItem.mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }));
  await openScreen();
  document.querySelector('[data-catalog-archive="3"]').click();
  await settle();
  expect(app.showMessage).toHaveBeenCalledWith(expect.any(String), 'error');
  expect(app.showMessage).not.toHaveBeenCalledWith('equipment_catalog_archived_done', 'success');
});

test('a demo account is offered no change', async () => {
  isDemoUser.mockReturnValue(true);
  await openScreen();
  expect(document.getElementById('equipment-catalog-create')).toBeNull();
  expect(document.querySelector('[data-catalog-edit], [data-catalog-archive]')).toBeNull();
});

test('a late response never redraws the screen after navigation', async () => {
  let resolve;
  api.getEquipmentCatalog.mockReturnValue(new Promise((done) => {resolve = done;}));
  const screen = new EquipmentCatalog(app);
  const pending = screen.init();
  screen.destroy();
  document.getElementById('app').textContent = 'Next screen';
  resolve({ data: [TENT] });
  await pending;
  expect(document.getElementById('app').textContent).toBe('Next screen');
});

test('the catalogue and its form have no WCAG A/AA violations, and Escape returns focus', async () => {
  api.getEquipmentCatalog.mockResolvedValue({ data: [TENT, ROPE] });
  await openScreen();
  expect((await axe.run(document.getElementById('app'), AXE_OPTIONS)).violations).toEqual([]);
  const opener = document.getElementById('equipment-catalog-create');
  opener.focus();
  await openCreateForm();
  const dialog = document.querySelector('.modal-dialog');
  expect(dialog.contains(document.activeElement)).toBe(true);
  expect((await axe.run(dialog, AXE_OPTIONS)).violations).toEqual([]);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await settle();
  expect(document.getElementById('equipment-catalog-form')).toBeNull();
  expect(document.activeElement).toBe(opener);
});
