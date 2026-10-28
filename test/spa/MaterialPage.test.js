/** @jest-environment jsdom */
import axe from 'axe-core';
const mockPermissions = new Set();
jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({ debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn() }));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  hasPermission: (key) => mockPermissions.has(key),
  hasAnyPermission: (...keys) => keys.some((key) => mockPermissions.has(key)),
  canAccessAdminPanel: () => false,
}));
jest.mock('../../spa/api/api-helpers.js', () => ({ getCurrentOrganizationId: () => 8 }));
function mockScreen(label) {
  return class {
    constructor(app, options) { this.options = options; }
    init() { document.getElementById(this.options.containerId).textContent = label; }
  };
}
jest.mock('../../spa/modules/resources/Inventory.js', () => ({ Inventory: mockScreen('stock') }));
jest.mock('../../spa/modules/equipment-catalog/EquipmentCatalog.js', () => ({ EquipmentCatalog: mockScreen('articles') }));
import { TABBED_PAGES, MERGED_ROUTE_REDIRECTS } from '../../spa/config/tabbed-pages.js';
import { TabbedPage } from '../../spa/modules/TabbedPage.js';
import { mergeMaterialArticles } from '../../spa/modules/equipment-catalog/materialArticles.js';
import { renderOwnershipFields, bindOwnershipFields, readOwnershipFields, equipmentOwnerLabel } from '../../spa/modules/material/OwnershipField.js';
let page;
beforeEach(() => { document.body.innerHTML = '<main id="app"></main>'; window.history.replaceState(null, '', '/material'); mockPermissions.clear(); });
afterEach(() => page?.destroy());
async function open() { page = new TabbedPage({}, TABBED_PAGES.material); await page.init(); }

test('one material page opens stock first and keyboard navigation reaches all articles', async () => {
  mockPermissions.add('inventory.view'); mockPermissions.add('equipment_catalog.manage');
  await open();
  expect(document.querySelectorAll('h1')).toHaveLength(1);
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  expect(tabs.map((tab) => tab.textContent.trim())).toEqual(['material_tab_stock', 'material_tab_articles']);
  expect(tabs[0].getAttribute('aria-selected')).toBe('true');
  tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(tabs[1].getAttribute('aria-selected')).toBe('true');
  expect(window.location.search).toBe('?tab=articles');
  expect((await axe.run(document.getElementById('app'), { rules: { 'color-contrast': { enabled: false } } })).violations).toEqual([]);
});
test.each([['inventory.view', 'stock'], ['equipment_catalog.manage', 'articles']])('only an authorized tab is shown to %s', async (permission, content) => {
  mockPermissions.add(permission); await open();
  expect(document.querySelectorAll('[role="tab"]')).toHaveLength(1);
  expect(document.querySelector('[role="tabpanel"]').textContent.trim()).toBe(content);
});
test('saved links to the former pages select the corresponding material tab', () => {
  expect(MERGED_ROUTE_REDIRECTS['/inventory']).toBe('/material?tab=stock');
  expect(MERGED_ROUTE_REDIRECTS['/equipment-catalog']).toBe('/material?tab=articles');
});
test('all articles shows linked stock once and includes equipment with no catalogue entry', () => {
  const stock = [{ id: 2, name: 'Pot', owner_type: 'group' }, { id: 9, name: 'Tent', quantity_total: 0 }];
  const rows = mergeMaterialArticles([{ id: 4, name: 'Pot', equipment_item_id: 2 }, { id: 7, name: 'Rope' }], stock);
  expect(rows.map((row) => row.name)).toEqual(['Pot', 'Rope', 'Tent']);
  expect(rows[0].stock).toBe(stock[0]); expect(rows[2]).toMatchObject({ inventory_only: true, stock: { quantity_total: 0 } });
});
test('ownership labels distinguish true group ownership, units and unspecified historic records', () => {
  expect(equipmentOwnerLabel({ owner_type: 'group', owner_local_group_name: 'Scout group' })).toBe('Scout group');
  expect(equipmentOwnerLabel({ owner_type: 'unit', organization_id: 8 })).toBe('material_owner_self');
  expect(equipmentOwnerLabel({ owner_type: 'unit', organization_id: 9, owner_organization_name: 'Other pack' })).toBe('Other pack');
  expect(equipmentOwnerLabel({ organization_id: 8 })).toBe('material_owner_unknown');
});
test('changing a historic owner to the group preserves a single record and hides unit sharing choices', async () => {
  document.getElementById('app').innerHTML = `<form>${renderOwnershipFields('test', [{ id: 3, name: '<script>unsafe</script>' }], { organization_id: 8 })}<fieldset class="equipment-visibility"><input name="equipment_visibility" type="radio" value="unit" aria-label="Unit sharing"></fieldset></form>`;
  const form = document.querySelector('form'); bindOwnershipFields(form);
  expect(readOwnershipFields(form)).toEqual({ owner_type: null, owner_local_group_id: null });
  const type = form.elements.namedItem('material_owner_type'); type.value = 'group'; type.dispatchEvent(new Event('change'));
  expect(readOwnershipFields(form)).toEqual({ owner_type: 'group', owner_local_group_id: 3 });
  expect(form.querySelector('.equipment-visibility').hidden).toBe(true);
  expect(form.querySelector('script')).toBeNull();
  expect((await axe.run(document.getElementById('app'), { rules: { 'color-contrast': { enabled: false } } })).violations).toEqual([]);
});
