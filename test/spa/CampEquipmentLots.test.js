/** @jest-environment jsdom */
import axe from 'axe-core';
jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/config.js', () => ({ CONFIG: {}, getStorageKey: (key) => key }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({ debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn() }));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({ hasAllPermissions: jest.fn(), isDemoUser: jest.fn() }));
jest.mock('../../spa/api/api-camp-lots.js', () => ({ getCampLots: jest.fn(), getCampLotOptions: jest.fn(), saveCampLot: jest.fn(), changeCampLotStatus: jest.fn() }));
jest.mock('../../spa/modules/camp-lots/CampLotOffline.js', () => ({ getLotSnapshot: jest.fn(), pendingLotChanges: jest.fn(), overlayLotChanges: jest.requireActual('../../spa/modules/camp-lots/CampLotOffline.js').overlayLotChanges }));
jest.mock('../../spa/modules/offline/OfflineAssets.js', () => ({ verifyOfflineAssets: jest.fn() }));
const { CampEquipmentLots } = require('../../spa/modules/camp-lots/CampEquipmentLots.js');
const api = require('../../spa/api/api-camp-lots.js');
const { getLotSnapshot, pendingLotChanges } = require('../../spa/modules/camp-lots/CampLotOffline.js');
const { verifyOfflineAssets } = require('../../spa/modules/offline/OfflineAssets.js');
const { hasAllPermissions, isDemoUser } = require('../../spa/utils/PermissionUtils.js');
const { closeAllModals } = require('../../spa/utils/ModalUtils.js');
const USER = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const lot = { id: 3, meeting_id: 7, name: '<img src=x onerror=alert(1)>', camp_name: 'Autumn camp', status: 'to_prepare', version: 1,
  items: [{ key: 'a1', name: '<b>Tent</b>', quantity: 2, unit_of_measure: 'each' }],
  roles: [{ role: 'prepare', user_id: USER, name: '<b>Ada</b>', due_date: '2026-11-14' }],
  history: [{ status: 'to_prepare', changed_by_name: 'Ada', changed_at: '2026-10-28T10:00:00Z' }] };
const AXE = { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, rules: { 'color-contrast': { enabled: false } } };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
let app; let screens;
const screen = async (options = {}) => { const page = new CampEquipmentLots(app, { meetingId: 7, ...options }); screens.push(page); await page.init(); return page; };
beforeEach(() => {
  jest.clearAllMocks(); screens = [];
  document.body.innerHTML = '<main id="app"></main>';
  localStorage.clear(); localStorage.setItem('userId', USER); localStorage.setItem('currentOrganizationId', '1');
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  crypto.randomUUID ||= () => '00000000-0000-4000-8000-000000000003';
  hasAllPermissions.mockReturnValue(false); isDemoUser.mockReturnValue(false);
  api.getCampLots.mockResolvedValue({ data: [lot] });
  api.getCampLotOptions.mockResolvedValue({ data: { members: [{ id: USER, full_name: 'Ada' }], items: [{ key: 'a1', catalog_item_id: 1, name: 'Tent', quantity: 4, allocated: 2, unit_of_measure: 'each' }] } });
  api.saveCampLot.mockResolvedValue({ success: true }); api.changeCampLotStatus.mockResolvedValue({ success: true });
  getLotSnapshot.mockResolvedValue({ preparedAt: Date.now() }); pendingLotChanges.mockResolvedValue([]); verifyOfflineAssets.mockResolvedValue(true);
  app = { lang: 'fr', showMessage: jest.fn() };
});
afterEach(() => { screens.forEach((page) => page.destroy()); closeAllModals(); delete navigator.onLine; });

test('the card shows names as text, quantities, dated duties and confirmed history', async () => {
  await screen();
  expect(document.querySelector('h2').textContent).toBe(lot.name);
  expect(document.querySelector('#app img, #app b')).toBeNull();
  expect(document.getElementById('app').textContent).toContain('novembre');
  expect(document.getElementById('app').textContent).toContain('camp_lots_ready');
  expect(document.getElementById('camp-lots-create')).toBeNull();
  expect((await axe.run(document.getElementById('app'), AXE)).violations).toEqual([]);
});
test('a helper sees only their lots and the action belonging to their duty', async () => {
  api.getCampLots.mockResolvedValue({ data: [{ ...lot, roles: [...lot.roles, { role: 'transport', user_id: OTHER, name: 'Other', due_date: '2026-11-14' }] }] });
  await screen({ ownOnly: true });
  expect(api.getCampLots).toHaveBeenCalledWith(7, true);
  expect(document.querySelector('[data-lot-state]')).toBeNull();
  expect(document.getElementById('camp-lots-create')).toBeNull();
  expect(document.querySelector('a[href="/tasks"]').getAttribute('href')).toBe('/tasks');
});
test('a single preparer can mark their own lot loaded', async () => {
  await screen({ ownOnly: true });
  document.querySelector('[data-lot-state="loaded"]').click(); await settle(); await settle();
  expect(api.changeCampLotStatus).toHaveBeenCalledWith(lot, 'loaded', true);
  expect(app.showMessage).toHaveBeenCalledWith('camp_lot_saved', 'success');
});
test('queued progress stays labelled pending through a reload and is absent from confirmed history', async () => {
  pendingLotChanges.mockResolvedValue([{ lotId: 3, meeting_id: 7, status: 'loaded', expected_version: 1, mutation_id: 'receipt' }]);
  await screen({ ownOnly: true });
  expect(document.querySelector('.camp-lots__state').textContent).toContain('camp_lot_pending');
  expect(document.querySelector('details').textContent).not.toContain('camp_lot_loaded');
  document.querySelector('[data-lot-state="returned"]').click(); await settle();
  expect(api.changeCampLotStatus).toHaveBeenCalledWith(expect.objectContaining({ status: 'loaded', version: 2, previousMutationId: 'receipt' }), 'returned', true);
});
test('a queued response never reports a server-confirmed save', async () => {
  api.changeCampLotStatus.mockResolvedValue({ queued: true });
  await screen({ ownOnly: true }); document.querySelector('[data-lot-state]').click(); await settle();
  expect(app.showMessage).toHaveBeenCalledWith('camp_lot_queued', 'info');
  expect(app.showMessage).not.toHaveBeenCalledWith('camp_lot_saved', 'success');
});
test('a refusal during replay stays visible after the page refreshes', async () => {
  await screen();
  window.dispatchEvent(new CustomEvent('offlineMutationRejected', { detail: { kind: 'camp_lots' } })); await settle();
  expect(document.querySelector('[role="alert"]').textContent).toBe('camp_lot_sync_refused');
});
test('unprepared offline access is an explicit refusal with retry, never an empty list', async () => {
  api.getCampLots.mockRejectedValue(Object.assign(new Error('private details'), { code: 'camp_lot_not_prepared' }));
  await screen();
  expect(document.querySelector('[role="alert"]').textContent).toBe('camp_lot_not_prepared');
  expect(document.getElementById('camp-lots-retry')).not.toBeNull();
  expect(document.querySelector('.empty-state')).toBeNull();
});
test('empty lots explain how to fill the list', async () => {
  api.getCampLots.mockResolvedValue({ data: [] }); await screen();
  expect(document.querySelector('.empty-state').textContent).toBe('camp_lots_empty');
});
test('the combined editor saves the selected quantities and the required preparer only once', async () => {
  hasAllPermissions.mockReturnValue(true); await screen();
  document.getElementById('camp-lots-create').click(); await settle();
  const form = document.getElementById('camp-lot-form');
  form.elements.lot_name.value = 'Tents'; form.elements.prepare.value = USER;
  form.elements.pick_0.checked = true; form.elements.pick_0.dispatchEvent(new Event('input', { bubbles: true }));
  form.elements.quantity_0.value = '2';
  const submit = () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  submit(); submit(); await settle();
  expect(api.saveCampLot).toHaveBeenCalledTimes(1);
  expect(api.saveCampLot).toHaveBeenCalledWith(7, { name: 'Tents', creation_key: expect.any(String), items: [{ catalog_item_id: 1, quantity: 2 }], roles: [{ role: 'prepare', user_id: USER }] }, null);
  expect(document.getElementById('camp-lot-editor')).toBeNull();
});
test('a failed save retains the lot name and selected articles for correction', async () => {
  hasAllPermissions.mockReturnValue(true); api.saveCampLot.mockRejectedValue(new Error('database details'));
  await screen(); document.querySelector('[data-lot-edit]').click(); await settle();
  const form = document.getElementById('camp-lot-form'); form.elements.lot_name.value = 'My tents';
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await settle();
  expect(form.elements.lot_name.value).toBe('My tents'); expect(form.elements.pick_0.checked).toBe(true);
  expect(document.getElementById('camp-lot-form-error').textContent).toBe('camp_lot_save_failed');
  expect(document.querySelector('[form="camp-lot-form"][type="submit"]').disabled).toBe(false);
});
test('the editor is accessible, traps focus and returns focus to its opener', async () => {
  hasAllPermissions.mockReturnValue(true); await screen();
  const opener = document.getElementById('camp-lots-create'); opener.focus(); opener.click(); await settle();
  const dialog = document.querySelector('[role="dialog"]');
  expect(dialog.contains(document.activeElement)).toBe(true);
  expect((await axe.run(dialog, AXE)).violations).toEqual([]);
  document.querySelector('[form="camp-lot-form"][type="submit"]').focus();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  expect(dialog.contains(document.activeElement)).toBe(true);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(document.activeElement).toBe(opener);
});
test('offline managers can change states but cannot open a content editor', async () => {
  hasAllPermissions.mockReturnValue(true); Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  await screen(); expect(document.getElementById('camp-lots-create').disabled).toBe(true);
  expect(document.querySelector('[data-lot-edit]').disabled).toBe(true);
  expect(document.querySelector('[data-lot-state]').disabled).toBe(false);
});
test('a late response cannot redraw a different page or unit', async () => {
  let resolve; api.getCampLots.mockReturnValue(new Promise((done) => { resolve = done; }));
  const page = new CampEquipmentLots(app, { meetingId: 7 }); screens.push(page); const pending = page.init();
  localStorage.setItem('currentOrganizationId', '2'); document.getElementById('app').textContent = 'Another unit';
  resolve({ data: [lot] }); await pending; expect(document.getElementById('app').textContent).toBe('Another unit');
});
