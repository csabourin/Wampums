/**
 * @jest-environment jsdom
 */

/**
 * The equipment screens moved out of the spa/ root, held to CLAUDE.md §7: a
 * loading state; a failed load shown as an alert with a retry, never as no
 * equipment; names shown as text; and a write the server accepted never
 * reported as failed because the reload after it did not arrive.
 *
 * @module test/spa/ResourceScreens
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
  CONFIG: { DEFAULT_LANG: 'fr', DEFAULT_CURRENCY: 'CAD', CACHE_DURATION: {}, PHOTO_UPLOAD: {}, UI: {} },
  getStorageKey: (key) => key,
}));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  canViewInventory: () => true,
  hasPermission: () => true,
}));
jest.mock('../../spa/indexedDB.js', () => ({ deleteCachedData: jest.fn() }));
jest.mock('../../spa/utils/DialogUtils.js', () => ({ confirmDestructive: jest.fn() }));
jest.mock('../../spa/ajax-functions.js', () => ({ getCurrentOrganizationId: () => '1' }));
jest.mock('../../spa/api/api-endpoints.js', () => ({
  getEquipmentInventory: jest.fn(),
  getEquipmentPhotoUrl: jest.fn(),
  saveEquipmentItem: jest.fn(),
  updateEquipmentItem: jest.fn(),
  uploadEquipmentPhoto: jest.fn(),
  deleteEquipmentPhoto: jest.fn(),
  deleteEquipmentItem: jest.fn(),
  getEquipmentReservations: jest.fn(),
  saveBulkReservations: jest.fn(),
  updateEquipmentReservation: jest.fn(),
  saveEquipmentReservation: jest.fn(),
  getActivities: jest.fn(),
  getResourceDashboard: jest.fn(),
}));

import * as api from '../../spa/api/api-endpoints.js';
import { Inventory } from '../../spa/modules/resources/Inventory.js';
import { MaterialManagement } from '../../spa/modules/resources/MaterialManagement.js';
import { ResourceDashboard } from '../../spa/modules/resources/ResourceDashboard.js';

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom does no layout, so contrast cannot be computed here.
  rules: { 'color-contrast': { enabled: false } },
};
const HOSTILE = '<img src=x onerror=alert(1)>';
const EQUIPMENT = { success: true, data: { equipment: [{ id: 7, name: HOSTILE, category: HOSTILE, quantity_total: 2, quantity_available: 2 }] } };
const RESERVATIONS = { success: true, data: { reservations: [{ id: 4, equipment_id: 7, equipment_name: HOSTILE, reserved_quantity: 1, status: 'reserved', organization_id: 1, date_from: '2026-11-01', date_to: '2026-11-02' }] } };

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });
const page = () => document.getElementById('app');
const makeApp = () => ({ lang: 'fr', showMessage: jest.fn(), router: { navigate: jest.fn() } });

/** @returns {Promise<Array>} axe violations inside #app */
async function violations() {
  return (await axe.run(page(), AXE_OPTIONS)).violations;
}

function loadAll() {
  api.getEquipmentInventory.mockResolvedValue(EQUIPMENT);
  api.getEquipmentReservations.mockResolvedValue(RESERVATIONS);
  api.getActivities.mockResolvedValue({ success: true, data: { activities: [] } });
  api.getResourceDashboard.mockResolvedValue({ success: true, data: { reservations: [] } });
}

const SCREENS = [
  ['inventory', Inventory, 'inventory_title'],
  ['material management', MaterialManagement, 'material_management_title'],
  ['resource dashboard', ResourceDashboard, 'resource_dashboard_title'],
];

beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main>';
  jest.clearAllMocks();
});

describe.each(SCREENS)('%s', (_name, Screen, titleKey) => {
  test('says it is loading, with the way back, until the equipment arrives', async () => {
    loadAll();
    let resolve;
    api.getEquipmentInventory.mockReturnValue(new Promise((done) => { resolve = done; }));
    const done = new Screen(makeApp()).init();

    expect(page().querySelector('a').getAttribute('href')).toBe('/dashboard');
    expect(page().querySelector('h1').textContent).toBe(titleKey);
    expect(page().querySelector('[aria-busy="true"] [role="status"]')).not.toBeNull();
    resolve(EQUIPMENT);
    await done;
  });

  test('shows equipment names as text and passes axe', async () => {
    loadAll();
    await new Screen(makeApp()).init();

    expect(page().querySelector('img[src="x"]')).toBeNull();
    expect(page().textContent).toContain(HOSTILE);
    expect(await violations()).toEqual([]);
  });

  test('equipment that did not load is an error with a retry, never an empty list', async () => {
    loadAll();
    api.getEquipmentInventory.mockRejectedValueOnce(new Error('offline'));
    await new Screen(makeApp()).init();

    expect(page().textContent).not.toContain('no_data_available');
    expect(page().querySelector('h1').textContent).toBe(titleKey);
    expect(page().querySelector('[role="alert"]').textContent).toBe('error_loading_data');

    page().querySelector('#page-retry').click();
    await flush();
    expect(page().textContent).toContain(HOSTILE);
  });

  test('a reload that fails after a write keeps the equipment shown and says so', async () => {
    loadAll();
    const app = makeApp();
    const screen = new Screen(app);
    await screen.init();
    api.getEquipmentInventory.mockRejectedValueOnce(new Error('offline'));

    await screen.reload();

    expect(screen.equipment).toHaveLength(1);
    expect(app.showMessage).toHaveBeenCalledWith('error_loading_data', 'error');
    expect(page().textContent).toContain(HOSTILE);
  });
});

describe('a reservation\'s status', () => {
  test('a change the server accepted is reported as done even when the reload after it fails', async () => {
    loadAll();
    const app = makeApp();
    const screen = new MaterialManagement(app);
    await screen.init();
    api.updateEquipmentReservation.mockResolvedValue({ success: true });
    api.getEquipmentReservations.mockRejectedValueOnce(new Error('offline'));

    await screen.handleReservationAction(4, 'picked_up');

    const messages = app.showMessage.mock.calls.map(([message]) => message);
    expect(messages).toContain('reservation_status_updated');
    expect(messages).not.toContain('reservation_status_update_failed');
  });

  test('a refused change says it was refused', async () => {
    loadAll();
    const app = makeApp();
    const screen = new MaterialManagement(app);
    await screen.init();
    api.updateEquipmentReservation.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }));

    await screen.handleReservationAction(4, 'picked_up');

    expect(app.showMessage).toHaveBeenCalledWith('api_error_forbidden', 'error');
  });
});
