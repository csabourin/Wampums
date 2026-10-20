/** @jest-environment jsdom */
import axe from 'axe-core';

const mockPermissions = new Set();
let mockAdminPanel = true;

jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({ debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn() }));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  hasPermission: jest.fn((permission) => mockPermissions.has(permission)),
  hasAnyPermission: jest.fn((...permissions) => permissions.some((permission) => mockPermissions.has(permission))),
  canAccessAdminPanel: jest.fn(() => mockAdminPanel),
}));

/** Stand-in for each tab's screen: says which one mounted, and with which options. */
function mockScreen(name) {
  return class {
    constructor(app, options) { this.options = options; }
    init() {
      document.getElementById(this.options.containerId).textContent = `${name}:${this.options.view || ''}`;
    }
  };
}
jest.mock('../../spa/modules/roles/RoleManagement.js', () => ({ RoleManagement: mockScreen('catalog-or-assignment') }));
jest.mock('../../spa/modules/roles/RolePermissionMatrix.js', () => ({ RolePermissionMatrix: mockScreen('matrix') }));
jest.mock('../../spa/modules/forms/FormPermissions.js', () => ({ FormPermissionsManager: mockScreen('forms') }));

import { TABBED_PAGES, MERGED_ROUTE_REDIRECTS, hasVisibleTab } from '../../spa/config/tabbed-pages.js';
import { TabbedPage } from '../../spa/modules/TabbedPage.js';

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  rules: { 'color-contrast': { enabled: false } },
};
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const ALL = ['users.view', 'users.assign_roles', 'roles.view', 'roles.manage', 'forms.manage'];

let page;
async function openRolesPage(url = '/roles') {
  window.history.replaceState(null, '', url);
  page = new TabbedPage({}, TABBED_PAGES.roles);
  await page.init();
  await flush();
  return page;
}
const tabs = () => [...document.querySelectorAll('[role="tab"]')];
const panelText = () => document.querySelector('[role="tabpanel"]').textContent.trim();

beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main>';
  mockPermissions.clear();
  ALL.forEach((permission) => mockPermissions.add(permission));
  mockAdminPanel = true;
});
afterEach(() => { page?.destroy(); page = null; });

test('the former role and form pages lead to their tab of "Rôles et permissions"', () => {
  expect(MERGED_ROUTE_REDIRECTS['/role-management']).toBe('/roles?tab=attribution');
  expect(MERGED_ROUTE_REDIRECTS['/roles/permissions']).toBe('/roles?tab=permissions');
  expect(MERGED_ROUTE_REDIRECTS['/form-permissions']).toBe('/roles?tab=formulaires');
});

test('an administrator sees the three tabs under one heading, assignment first', async () => {
  await openRolesPage();
  expect(document.querySelector('h1').textContent).toBe('page_roles_title');
  expect(tabs().map((tab) => tab.textContent.trim())).toEqual(['tab_roles_assign', 'tab_roles_permissions', 'tab_roles_forms']);
  expect(tabs()[0].getAttribute('aria-selected')).toBe('true');
  expect(panelText()).toBe('catalog-or-assignment:users');
  expect((await axe.run(document.getElementById('app'), AXE_OPTIONS)).violations).toEqual([]);
});

test('someone who may change roles edits the matrix in the permissions tab', async () => {
  await openRolesPage('/roles?tab=permissions');
  expect(panelText()).toBe('matrix:roles');
});

test('someone who may only view roles reads the catalog in the permissions tab', async () => {
  mockPermissions.clear();
  mockPermissions.add('roles.view');
  await openRolesPage('/roles?tab=permissions');
  expect(tabs().map((tab) => tab.dataset.tab)).toEqual(['permissions']);
  expect(panelText()).toBe('catalog-or-assignment:roles');
});

test('the arrow keys move between tabs and the URL follows', async () => {
  await openRolesPage();
  tabs()[0].focus();
  tabs()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  await flush(); await flush();
  expect(document.activeElement).toBe(tabs()[1]);
  expect(window.location.search).toBe('?tab=permissions');
  tabs()[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  await flush(); await flush();
  expect(panelText()).toBe('forms:');
});

test('each tab keeps the permission its endpoints require', () => {
  const visibleWith = (permissions, adminPanel = true) => {
    mockPermissions.clear();
    permissions.forEach((permission) => mockPermissions.add(permission));
    mockAdminPanel = adminPanel;
    return TABBED_PAGES.roles.tabs.filter((tab) => tab.gate()).map((tab) => tab.key);
  };
  expect(visibleWith(['users.assign_roles'])).toEqual([]);
  expect(visibleWith(['users.view', 'users.assign_roles'])).toEqual(['attribution']);
  expect(visibleWith(['roles.manage'])).toEqual(['permissions']);
  expect(visibleWith(['forms.manage'])).toEqual(['formulaires']);
  expect(visibleWith(['forms.manage'], false)).toEqual([]);
  expect(hasVisibleTab('roles')).toBe(false);
});
