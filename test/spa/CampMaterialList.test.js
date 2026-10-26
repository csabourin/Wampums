/** @jest-environment jsdom */

/**
 * The collective material list of a camp.
 *
 * Held here: it says it is loading, with the way back first; each article
 * shows once with its total and the activities that need it; with the
 * inventory, each says in words whether it is reserved, to reserve or
 * missing; without it, no inventory column is shown; free-text material is
 * listed apart as not added up; equipment reserved but listed by no activity
 * is pointed out; names from people are shown as text; a failed load offers
 * a retry and never reads as an empty list, and a camp of another unit says
 * it cannot be found; an empty list says what would fill it; print and
 * export carry the same content; a late answer never draws over the next
 * screen; and the screen meets WCAG A/AA.
 *
 * @module test/spa/CampMaterialList
 */
import axe from 'axe-core';

jest.mock('../../spa/config.js', () => ({
  CONFIG: {},
  getStorageKey: (key) => key,
}));
// Keys with placeholders keep them, so what fills them shows on screen.
const mockTemplates = {
  camp_material_use: '{day} · {activity}: {quantity}',
  camp_material_missing_count: '{count} short',
  camp_material_reserve_item: '{name}: {count}',
  equipment_quantity_with_unit: '{quantity} {unit}',
};
jest.mock('../../spa/app.js', () => ({ translate: (key) => mockTemplates[key] || key }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({ debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn() }));
jest.mock('../../spa/api/api-camp-material.js', () => ({ getCampMaterialList: jest.fn(), reserveCampMaterial: jest.fn() }));
jest.mock('../../spa/utils/ExportUtils.js', () => ({ exportToCSV: jest.fn() }));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({ hasAllPermissions: jest.fn(), isDemoUser: jest.fn() }));
jest.mock('../../spa/utils/PrintUtils.js', () => ({
  REPORT_PRINT_STYLES: 'body {}',
  openPrintWindow: jest.fn(),
  setPrintContent: jest.fn(),
}));

const { CampMaterialList } = require('../../spa/modules/camp-material/CampMaterialList.js');
const api = require('../../spa/api/api-camp-material.js');
const { exportToCSV } = require('../../spa/utils/ExportUtils.js');
const { openPrintWindow, setPrintContent } = require('../../spa/utils/PrintUtils.js');
const { hasAllPermissions, isDemoUser } = require('../../spa/utils/PermissionUtils.js');
const { closeAllModals } = require('../../spa/utils/ModalUtils.js');

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom does no layout, so contrast cannot be computed here.
  rules: { 'color-contrast': { enabled: false } },
};
const HOSTILE = '<img src=x onerror=alert(1)>';
const CAMP_ID = 42;

/** @returns {Object} A three-day camp with articles, free text and an unlisted reservation */
function list(overrides = {}) {
  return {
    camp: { id: CAMP_ID, theme: 'Camp d\'automne', meeting_kind: 'camp', date_from: '2026-11-13', date_to: '2026-11-15' },
    inventory_compared: true,
    items: [
      {
        key: 'a3', catalog_item_id: 3, equipment_item_id: 11, name: 'Tente 4 places', category: 'camping',
        unit_of_measure: 'each', archived: false, quantity: 4,
        uses: [{ activity_id: 1, name: 'Montage', day_offset: 0, quantity: 3 }, { activity_id: 2, name: HOSTILE, day_offset: 1, quantity: 1 }],
        inventory: { status: 'missing', reserved: 2, free: 0, missing: 2 },
      },
      {
        key: 'e12', catalog_item_id: null, equipment_item_id: 12, name: 'Lanternes', category: 'camping',
        unit_of_measure: 'each', archived: false, quantity: 2,
        uses: [{ activity_id: 2, name: 'Veillée', day_offset: 1, quantity: 2 }],
        inventory: { status: 'reserved', reserved: 2, free: 1, missing: 0 },
      },
      {
        key: 'a6', catalog_item_id: 6, equipment_item_id: null, name: HOSTILE, category: 'kitchen',
        unit_of_measure: 'each', archived: true, quantity: 3,
        uses: [{ activity_id: 3, name: 'Repas', day_offset: 1, quantity: 3 }],
        inventory: { status: 'not_in_inventory' },
      },
    ],
    free_text: [{ activity_id: 1, name: 'Montage', day_offset: 0, start_time: null, material: `Maillets ${HOSTILE}` }],
    unlisted_reservations: [{ equipment_item_id: 20, name: 'Bâche', category: 'camping', reserved: 1 }],
    ...overrides,
  };
}

let app;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** @returns {Promise<CampMaterialList>} The screen, loaded */
async function openScreen(meetingId = CAMP_ID) {
  const screen = new CampMaterialList(app, { meetingId });
  await screen.init();
  return screen;
}

/** @param {string} text @returns {HTMLTableRowElement|undefined} The body row naming it */
function rowFor(text) {
  return [...document.querySelectorAll('tbody tr')].find((row) => row.textContent.includes(text));
}

beforeEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = '<main id="app"></main>';
  app = { showMessage: jest.fn(), lang: 'fr' };
  closeAllModals();
  hasAllPermissions.mockImplementation((...keys) => keys.every((key) => ['inventory.view', 'inventory.reserve'].includes(key)));
  isDemoUser.mockReturnValue(false);
  api.getCampMaterialList.mockResolvedValue({ success: true, data: list() });
});

test('it says it is loading, with the way back above the title', async () => {
  api.getCampMaterialList.mockReturnValue(new Promise(() => {}));
  const screen = new CampMaterialList(app, { meetingId: CAMP_ID });
  screen.init();
  await settle();
  const page = document.querySelector('.camp-material');
  expect(page.getAttribute('aria-busy')).toBe('true');
  expect(page.querySelector('[role="status"]').textContent).toBe('loading');
  expect(page.firstElementChild.matches('a, nav, .back-link, [class*="back"]')).toBe(true);
  expect(page.querySelector('h1').textContent).toBe('camp_material_title');
});

test('the list is loaded fresh for the camp named in the address', async () => {
  await openScreen();
  expect(api.getCampMaterialList).toHaveBeenCalledWith(CAMP_ID, { forceRefresh: true });
});

test('each article shows once, with its total and every activity needing it', async () => {
  await openScreen();
  const tent = rowFor('Tente 4 places');
  expect(tent.querySelector('[data-label="camp_material_total"]').textContent).toBe('4 equipment_unit_each');
  const uses = [...tent.querySelectorAll('.camp-material__uses li')].map((item) => item.textContent);
  expect(uses).toEqual([expect.stringMatching(/Montage: 3 equipment_unit_each$/), expect.stringContaining(`${HOSTILE}: 1`)]);
  expect(document.querySelectorAll('tbody tr')).toHaveLength(3);
  expect([...document.querySelectorAll('.camp-material__group h3')].map((h) => h.textContent))
    .toEqual(['equipment_category_camping', 'equipment_category_kitchen']);
});

test('with the inventory, each article says in words where it stands', async () => {
  await openScreen();
  expect(rowFor('Tente 4 places').querySelector('.camp-material__status').textContent)
    .toBe('camp_material_status_missing (2 short)');
  expect(rowFor('Lanternes').querySelector('.camp-material__status').textContent).toBe('camp_material_status_reserved');
  expect(rowFor('Repas').querySelector('.camp-material__status').textContent).toBe('camp_material_status_not_in_inventory');
  expect(rowFor('Tente 4 places').querySelector('[data-label="camp_material_reserved"]').textContent).toBe('2');
  const summary = [...document.querySelectorAll('.camp-material__summary li')].map((item) => item.textContent);
  expect(summary).toEqual(['camp_material_summary_reserved', 'camp_material_summary_missing']);
});

test('without the inventory, no inventory column or summary is shown', async () => {
  api.getCampMaterialList.mockResolvedValue({ data: list({
    inventory_compared: false,
    unlisted_reservations: null,
    items: list().items.map(({ inventory: _inventory, ...item }) => item),
  }) });
  await openScreen();
  const headers = [...document.querySelectorAll('thead th')].map((th) => th.textContent);
  expect(headers).not.toContain('camp_material_status');
  expect(document.querySelector('.camp-material__summary')).toBeNull();
  expect(document.querySelector('.camp-material__unlisted')).toBeNull();
});

test('free-text material is listed apart, marked as not added up', async () => {
  await openScreen();
  const section = document.querySelector('.camp-material__free-text');
  expect(section.querySelector('h2').textContent).toBe('camp_material_free_text_title');
  expect(section.querySelector('.camp-material__free-material').textContent).toBe(`Maillets ${HOSTILE}`);
});

test('equipment reserved for the camp but listed by no activity is pointed out', async () => {
  await openScreen();
  expect(document.querySelector('.camp-material__unlisted h2').textContent).toBe('camp_material_unlisted_title');
  expect(document.querySelectorAll('.camp-material__unlisted li')).toHaveLength(1);
});

test('names written by people are shown as text, never as markup', async () => {
  await openScreen();
  expect(document.querySelector('#app img')).toBeNull();
  expect(rowFor('Repas').textContent).toContain(HOSTILE);
});

test('an article no longer offered in the catalogue says so', async () => {
  await openScreen();
  expect(rowFor('Repas').querySelector('.camp-material__archived').textContent).toBe('camp_material_archived');
});

test('an empty list says what would fill it and offers nothing to print', async () => {
  api.getCampMaterialList.mockResolvedValue({ data: list({ items: [], free_text: [], unlisted_reservations: [] }) });
  await openScreen();
  expect(document.querySelector('.empty-state').textContent).toBe('camp_material_empty');
  expect(document.getElementById('camp-material-print')).toBeNull();
  expect(document.getElementById('camp-material-export')).toBeNull();
});

test('a failed load is an alert with a retry, not an empty list', async () => {
  api.getCampMaterialList.mockRejectedValueOnce(Object.assign(new Error('offline'), { status: 0 }));
  await openScreen();
  expect(document.querySelector('[role="alert"]').textContent).toBe('error_loading_data');
  expect(document.querySelector('.empty-state')).toBeNull();
  document.getElementById('camp-material-retry').click();
  await settle();
  expect(api.getCampMaterialList).toHaveBeenCalledTimes(2);
  expect(rowFor('Lanternes')).toBeDefined();
});

test('a camp the unit does not have says it cannot be found', async () => {
  api.getCampMaterialList.mockRejectedValueOnce(Object.assign(new Error('not found'), { status: 404 }));
  await openScreen();
  expect(document.querySelector('[role="alert"]').textContent).toBe('camp_material_not_found');
  expect(document.getElementById('camp-material-retry')).toBeNull();
});

test('a malformed address is not sent to the server', async () => {
  await openScreen(Number('abc'));
  expect(api.getCampMaterialList).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alert"]')).not.toBeNull();
});

test('an answer arriving after the person left draws nothing', async () => {
  let resolve;
  api.getCampMaterialList.mockReturnValue(new Promise((done) => { resolve = done; }));
  const screen = new CampMaterialList(app, { meetingId: CAMP_ID });
  const loading = screen.init();
  screen.destroy();
  document.getElementById('app').textContent = 'next screen';
  resolve({ data: list() });
  await loading;
  expect(document.getElementById('app').textContent).toBe('next screen');
});

test('export downloads the articles, then the free-text material', async () => {
  await openScreen();
  document.getElementById('camp-material-export').click();
  const [rows, columns, filename] = exportToCSV.mock.calls[0];
  expect(rows.map((row) => row.name)).toEqual(['Tente 4 places', 'Lanternes', HOSTILE, `Maillets ${HOSTILE}`, 'Bâche']);
  // Reserved for the camp though no activity lists it: still on the packing list.
  expect(rows[4]).toMatchObject({ quantity: 1, status: 'camp_material_status_reserved' });
  expect(rows[0]).toMatchObject({ quantity: 4, status: 'camp_material_status_missing (2 short)' });
  expect(columns.map((column) => column.key)).toEqual(['category', 'name', 'quantity', 'unit', 'uses', 'status']);
  expect(filename).toBe('camp_material_file_name-2026-11-13');
});

test('print opens its own window with the list, names escaped', async () => {
  const printWindow = { focus: jest.fn(), print: jest.fn() };
  openPrintWindow.mockReturnValue(printWindow);
  await openScreen();
  document.getElementById('camp-material-print').click();
  const [target, html] = setPrintContent.mock.calls[0];
  expect(target).toBe(printWindow);
  expect(html).toContain('Tente 4 places');
  expect(html).toContain('camp_material_free_text_title');
  expect(html).not.toContain('<img');
  expect(printWindow.print).toHaveBeenCalled();
});

test('a blocked print window is explained', async () => {
  openPrintWindow.mockReturnValue(null);
  await openScreen();
  document.getElementById('camp-material-print').click();
  expect(app.showMessage).toHaveBeenCalledWith('popup_blocked', 'error');
  expect(setPrintContent).not.toHaveBeenCalled();
});

test('the list, the empty state and the error state meet WCAG A/AA', async () => {
  await openScreen();
  expect((await axe.run(document.getElementById('app'), AXE_OPTIONS)).violations).toEqual([]);

  api.getCampMaterialList.mockResolvedValue({ data: list({ items: [], free_text: [], unlisted_reservations: [] }) });
  await openScreen();
  expect((await axe.run(document.getElementById('app'), AXE_OPTIONS)).violations).toEqual([]);

  api.getCampMaterialList.mockRejectedValue(new Error('offline'));
  await openScreen();
  expect((await axe.run(document.getElementById('app'), AXE_OPTIONS)).violations).toEqual([]);
});

test('the table regions can be reached with the keyboard', async () => {
  await openScreen();
  const regions = [...document.querySelectorAll('.table-container[role="region"]')];
  expect(regions.length).toBe(2);
  regions.forEach((region) => {
    expect(region.getAttribute('tabindex')).toBe('0');
    expect(document.getElementById(region.getAttribute('aria-labelledby'))).not.toBeNull();
  });
  const buttons = [...document.querySelectorAll('.camp-material__actions button')];
  expect(buttons.map((button) => button.textContent.trim())).toEqual(['print', 'export_csv']);
});

describe('reserving what is missing', () => {
  /** @returns {Object} The list with tents partly free and stoves free */
  function reservable() {
    const base = list();
    base.items[0] = { ...base.items[0], name: `Tente ${HOSTILE}`, inventory: { status: 'missing', reserved: 2, free: 1, missing: 1, to_reserve: 1 } };
    base.items.push({
      key: 'e30', catalog_item_id: null, equipment_item_id: 30, name: 'Réchauds', category: 'kitchen',
      unit_of_measure: 'each', archived: false, quantity: 3,
      uses: [{ activity_id: 3, name: 'Repas', day_offset: 1, quantity: 3 }],
      inventory: { status: 'available', reserved: 0, free: 5, missing: 0, to_reserve: 3 },
    });
    return base;
  }
  const dialog = () => document.getElementById('camp-material-reserve-dialog');
  const confirmButton = () => dialog().querySelector('button[type="submit"]');

  beforeEach(() => {
    api.getCampMaterialList.mockResolvedValue({ data: reservable() });
    api.reserveCampMaterial.mockResolvedValue({ success: true, data: { count: 2 } });
  });

  test('the button is offered only when something can be reserved', async () => {
    api.getCampMaterialList.mockResolvedValue({ data: list() });
    await openScreen();
    expect(document.getElementById('camp-material-reserve')).toBeNull();
  });

  test.each([
    ['without the reservation right', () => hasAllPermissions.mockReturnValue(false)],
    ['for a demo account', () => isDemoUser.mockReturnValue(true)],
  ])('it is not offered %s', async (_label, arrange) => {
    arrange();
    await openScreen();
    expect(document.getElementById('camp-material-reserve')).toBeNull();
  });

  test('the dialog says what will be reserved, and that the rest stays missing', async () => {
    await openScreen();
    document.getElementById('camp-material-reserve').click();
    const items = [...dialog().querySelectorAll('.camp-material__reserve-list li')].map((item) => item.textContent);
    expect(items).toEqual([`Tente ${HOSTILE}: 1`, 'Réchauds: 3']);
    expect(dialog().textContent).toContain('camp_material_reserve_partial');
    expect(dialog().querySelector('img')).toBeNull();
    expect(api.reserveCampMaterial).not.toHaveBeenCalled();
  });

  test('cancelling reserves nothing and gives focus back to the button', async () => {
    await openScreen();
    const opener = document.getElementById('camp-material-reserve');
    opener.focus();
    opener.click();
    dialog().querySelector('[data-modal-close]').click();
    expect(dialog()).toBeNull();
    expect(api.reserveCampMaterial).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(opener);
  });

  test('Escape closes the dialog without reserving', async () => {
    await openScreen();
    document.getElementById('camp-material-reserve').click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(dialog()).toBeNull();
    expect(api.reserveCampMaterial).not.toHaveBeenCalled();
  });

  test('confirming reserves exactly what was shown, once, then reloads the list', async () => {
    await openScreen();
    document.getElementById('camp-material-reserve').click();
    confirmButton().click();
    confirmButton().click();
    await settle();
    await settle();
    expect(api.reserveCampMaterial).toHaveBeenCalledTimes(1);
    expect(api.reserveCampMaterial).toHaveBeenCalledWith(CAMP_ID, [
      { equipment_item_id: 11, quantity: 1 },
      { equipment_item_id: 30, quantity: 3 },
    ]);
    expect(app.showMessage).toHaveBeenCalledWith('camp_material_reserve_done', 'success');
    expect(dialog()).toBeNull();
    expect(api.getCampMaterialList).toHaveBeenCalledTimes(2);
    expect(api.getCampMaterialList).toHaveBeenLastCalledWith(CAMP_ID, { forceRefresh: true });
  });

  test('a stale count is explained, nothing reads as reserved, and the list is reloaded', async () => {
    api.reserveCampMaterial.mockRejectedValue(Object.assign(new Error('camp_material_reservation_stale'), { status: 409 }));
    await openScreen();
    document.getElementById('camp-material-reserve').click();
    confirmButton().click();
    await settle();
    await settle();
    expect(app.showMessage).toHaveBeenCalledWith(expect.any(String), 'error');
    expect(app.showMessage).not.toHaveBeenCalledWith(expect.anything(), 'success');
    expect(dialog()).toBeNull();
    expect(api.getCampMaterialList).toHaveBeenCalledTimes(2);
  });

  test('another failure keeps the dialog open to try again', async () => {
    api.reserveCampMaterial.mockRejectedValue(Object.assign(new Error('offline'), { code: 'online_required' }));
    await openScreen();
    document.getElementById('camp-material-reserve').click();
    confirmButton().click();
    await settle();
    expect(app.showMessage).toHaveBeenCalledWith(expect.any(String), 'error');
    expect(dialog()).not.toBeNull();
    expect(confirmButton().disabled).toBe(false);
  });

  test('the dialog meets WCAG A/AA', async () => {
    await openScreen();
    document.getElementById('camp-material-reserve').click();
    expect((await axe.run(document.body, AXE_OPTIONS)).violations).toEqual([]);
  });
});
