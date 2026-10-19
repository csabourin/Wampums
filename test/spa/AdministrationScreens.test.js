/**
 * @jest-environment jsdom
 */

/**
 * Administration screens moved out of the spa/ root, held to CLAUDE.md §7:
 * the way back and the page's own title in every state, a loading state, a
 * failed load shown as an alert with a retry (never as "no forms", "no
 * users" or "no results"), and a refused action read as a refusal. Screens
 * drawn as a tab of the district page show only the state, not a second
 * back link and title.
 *
 * @module test/spa/AdministrationScreens
 */

import axe from 'axe-core';

jest.mock('../../spa/app.js', () => ({
  app: { loadTranslation: jest.fn().mockResolvedValue() },
  translate: (key) => key,
}));
jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn(),
}));
jest.mock('../../spa/config.js', () => ({ CONFIG: { CACHE_DURATION: {} }, getStorageKey: (key) => key }));
jest.mock('../../spa/utils/DOMUtils.js', () => ({
  ...jest.requireActual('../../spa/utils/DOMUtils.js'),
  // jsdom fires no load event for a stylesheet; the page's styles are not what is tested.
  loadStylesheet: jest.fn().mockResolvedValue(),
}));
jest.mock('../../spa/api/api-core.js', () => ({ API: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() } }));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  hasPermission: () => true,
  canViewRoles: () => true,
  canAssignRoles: () => true,
  canAccessAdminPanel: () => true,
  canCreateOrganization: () => true,
  canManageUsers: () => true,
  canViewUsers: () => true,
  canSendCommunications: () => false,
}));
jest.mock('../../spa/indexedDB.js', () => ({
  deleteCachedData: jest.fn(),
  getCachedData: jest.fn(),
  setCachedData: jest.fn(),
}));
jest.mock('../../spa/utils/DialogUtils.js', () => ({ confirmDestructive: jest.fn() }));
jest.mock('../../spa/utils/StorageUtils.js', () => ({ setStorageMultiple: jest.fn() }));
jest.mock('../../spa/utils/RoleValidationUtils.js', () => ({
  buildRoleBundleIndex: () => ({}),
  calculatePermissionGaps: () => ({ missing: [] }),
  detectRoleConflicts: () => ({ hasConflict: false, conflicts: [] }),
  getLocalGroupEligibleRoles: () => [],
}));
jest.mock('../../spa/api/api-members.js', () => ({ setUserMembershipStatus: jest.fn() }));
jest.mock('../../spa/api/api-endpoints.js', () => ({
  getUsers: jest.fn(),
  getRoleCatalog: jest.fn(),
  getUserRoleAssignments: jest.fn(),
  updateUserRolesV1: jest.fn(),
  clearUserCaches: jest.fn(),
}));
jest.mock('../../spa/ajax-functions.js', () => ({
  CONFIG: { CACHE_DURATION: {} },
  clearUserCaches: jest.fn(),
  getCurrentOrganizationId: () => '1',
  getRoleAuditLog: jest.fn(),
  getRoleBundles: jest.fn(),
  getRolePermissions: jest.fn(),
  getUserOrganizations: jest.fn(),
  getUsers: jest.fn(),
  getUserRoleAssignments: jest.fn(),
  updateUserRoleBundles: jest.fn(),
  updateUserRolesV1: jest.fn(),
  getRoleCatalog: jest.fn(),
  approveUser: jest.fn(),
  getSubscribers: jest.fn(),
  sendNotification: jest.fn(),
  importSISC: jest.fn(),
  createOrganization: jest.fn(),
  getOrganizationFormFormats: jest.fn(),
}));
jest.mock('../../spa/dynamicFormHandler.js', () => ({
  DynamicFormHandler: jest.fn().mockImplementation(() => ({
    init: jest.fn().mockResolvedValue(),
    getFormData: () => ({ name: 'Meute' }),
  })),
}));

import { API } from '../../spa/api/api-core.js';
import * as ajax from '../../spa/ajax-functions.js';
import { getCachedData } from '../../spa/indexedDB.js';
import { FormBuilder } from '../../spa/modules/forms/FormBuilder.js';
import { initFormPermissions } from '../../spa/modules/forms/FormPermissions.js';
import { RoleManagement } from '../../spa/modules/roles/RoleManagement.js';
import { DistrictManagement } from '../../spa/modules/district/DistrictManagement.js';
import { Admin } from '../../spa/modules/admin/Admin.js';
import { CreateOrganization } from '../../spa/modules/organizations/CreateOrganization.js';

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom does no layout, so contrast cannot be computed here.
  rules: { 'color-contrast': { enabled: false } },
};
const HOSTILE = '<img src=x onerror=alert(1)>';
const FORBIDDEN = Object.assign(new Error('Forbidden'), { status: 403 });

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });
const page = () => document.getElementById('app');
const makeApp = () => ({
  lang: 'fr',
  showMessage: jest.fn(),
  router: { navigate: jest.fn() },
  translate: (key) => key,
  organizationId: '1',
});

/** @returns {Promise<Array>} axe violations inside #app */
async function violations() {
  return (await axe.run(page(), AXE_OPTIONS)).violations;
}

/** A failed load: way back, the page's title, an alert and a retry. */
function expectErrorPage(title, href = '/dashboard') {
  expect(page().querySelector('a').getAttribute('href')).toBe(href);
  expect(page().querySelector('h1').textContent).toBe(title);
  expect(page().querySelector('[role="alert"]')).not.toBeNull();
  expect(page().querySelector('#page-retry')).not.toBeNull();
}

beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main>';
  jest.clearAllMocks();
});

describe('form builder', () => {
  test('forms that did not load are an error with a retry, never "no forms"', async () => {
    API.get.mockRejectedValueOnce(new Error('offline'));
    const screen = new FormBuilder(makeApp());
    await screen.init();

    expectErrorPage('form_builder_title');
    screen.destroy();
  });

  test('loaded, it lists the unit\'s forms and passes axe', async () => {
    API.get.mockImplementation((endpoint) => Promise.resolve({
      success: true,
      data: endpoint.endsWith('form-formats') ? [{ id: 1, form_type: 'fiche_sante', form_structure: { fields: [] } }] : [],
    }));
    const screen = new FormBuilder(makeApp());
    await screen.init();

    expect(page().querySelector('h1').textContent).toBe('form_builder_title');
    expect(await violations()).toEqual([]);
    screen.destroy();
  });
});

describe('form permissions', () => {
  test('permissions that did not load keep the page title and offer a retry; the router can tear the page down', async () => {
    API.get.mockRejectedValueOnce(new Error('offline'));
    const screen = await initFormPermissions(makeApp());

    expect(typeof screen.destroy).toBe('function');
    expectErrorPage('form_permissions_management');
    expect(page().querySelector('[role="alert"]').textContent).toBe('error_loading_form_permissions');
  });
});

describe('role management', () => {
  test('roles that did not load keep the page title and offer a retry', async () => {
    API.get.mockRejectedValue(new Error('offline'));
    const api = jest.requireMock('../../spa/api/api-endpoints.js');
    api.getRoleCatalog.mockRejectedValue(new Error('offline'));
    const screen = new RoleManagement(makeApp());
    await screen.init();

    expectErrorPage('role_management');
  });
});

describe('district management', () => {
  const ROLES = { success: true, data: [] };

  test('with nothing cached, a failed load is an error with a retry, not "no results"', async () => {
    getCachedData.mockResolvedValue(null);
    ajax.getUserOrganizations.mockResolvedValue({ success: true, data: [{ id: 1, name: 'Unité' }] });
    ajax.getRoleBundles.mockResolvedValue(ROLES);
    ajax.getUsers.mockRejectedValue(new Error('offline'));
    const screen = new DistrictManagement(makeApp());
    await screen.init();

    expect(page().textContent).not.toContain('district_management_no_results');
    expect(page().querySelector('[role="alert"]').textContent).toBe('district_management_load_error');
    expect(page().querySelector('#dm-load-retry')).not.toBeNull();
    screen.destroy();
  });

  test('with members cached, a failed refresh keeps them shown', async () => {
    getCachedData.mockResolvedValue({
      users: [{ id: 'u1', full_name: HOSTILE, email: 'a@example.org', roles: [] }],
      roles: [], rolePermissions: {}, organizationId: 1, organizations: [{ id: 1, name: 'Unité' }],
      lastSyncedAt: Date.now(),
    });
    ajax.getUserOrganizations.mockResolvedValue({ success: true, data: [{ id: 1, name: 'Unité' }] });
    ajax.getRoleBundles.mockResolvedValue(ROLES);
    ajax.getUsers.mockRejectedValue(new Error('offline'));
    const screen = new DistrictManagement(makeApp());
    await screen.init();

    expect(page().textContent).toContain(HOSTILE);
    expect(page().querySelector('img[src="x"]')).toBeNull();
    expect(page().querySelector('#dm-load-retry')).toBeNull();
    screen.destroy();
  });
});

describe('admin panel', () => {
  test('users that did not load are an alert with a retry in the table, not "no users"', async () => {
    ajax.getUsers.mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ success: true, data: [{ id: 'u1', email: 'a@example.org', full_name: HOSTILE, roles: [], is_verified: true }] });
    ajax.getRoleCatalog.mockResolvedValue({ success: true, data: [] });
    const screen = new Admin(makeApp());
    await screen.init();

    expect(page().textContent).not.toContain('no_users_found');
    expect(page().querySelector('#users-table [role="alert"]').textContent).toBe('error_loading_data');

    page().querySelector('#admin-users-retry').click();
    await flush();
    expect(page().querySelector('#users-table').textContent).toContain(HOSTILE);
    expect(page().querySelector('#users-table img[src="x"]')).toBeNull();
  });

  test('says "verified" in words, styles its links as buttons and passes axe', async () => {
    ajax.getUsers.mockResolvedValue({ success: true, data: [{ id: 'u1', email: 'a@example.org', full_name: 'Ana', roles: [], is_verified: false }] });
    ajax.getRoleCatalog.mockResolvedValue({ success: true, data: [] });
    await new Admin(makeApp()).init();

    expect(page().querySelector('#users-table .sr-only').textContent).toBe('no');
    expect(page().querySelector('a[href="/form-builder"]').className).toBe('button button--secondary');
    expect(page().querySelector('a[href="/form-builder"]').getAttribute('style')).toBeNull();
    expect(await violations()).toEqual([]);
  });

  test('as a tab of the district page, its loading state adds no second way back or title', async () => {
    let resolve;
    ajax.getUsers.mockReturnValue(new Promise((done) => { resolve = done; }));
    ajax.getRoleCatalog.mockResolvedValue({ success: true, data: [] });
    page().innerHTML = '<div id="tab-panel"></div>';
    const screen = new Admin(makeApp(), { embedded: true, containerId: 'tab-panel' });
    const done = screen.init();
    await flush();

    expect(page().querySelector('#tab-panel [role="status"]')).not.toBeNull();
    expect(page().querySelector('h1')).toBeNull();
    expect(page().querySelector('a')).toBeNull();
    resolve({ success: true, data: [] });
    await done;
  });
});

describe('creating a unit', () => {
  test('a form that did not load is an error with the way back to the district tools', async () => {
    ajax.getOrganizationFormFormats.mockRejectedValueOnce(new Error('offline'));
    await new CreateOrganization(makeApp()).init();

    expectErrorPage('create_new_unit', '/district?tab=outils');
    expect(page().querySelector('#submit-organization')).toBeNull();
  });

  test('a refused creation says it was refused; leaving cancels the redirect after a success', async () => {
    jest.useFakeTimers();
    ajax.getOrganizationFormFormats.mockResolvedValue({ organization_info: { fields: [] } });
    const app = makeApp();
    const screen = new CreateOrganization(app);
    await screen.init();
    expect(page().querySelector('#submit-organization').getAttribute('type')).toBe('submit');

    ajax.createOrganization.mockRejectedValueOnce(FORBIDDEN);
    await screen.handleSubmit();
    expect(app.showMessage).toHaveBeenCalledWith('api_error_forbidden', 'error');

    ajax.createOrganization.mockResolvedValueOnce({ success: true });
    await screen.handleSubmit();
    screen.destroy();
    jest.runAllTimers();
    jest.useRealTimers();

    expect(app.showMessage).toHaveBeenCalledWith('unit_created_successfully', 'success');
    expect(app.router.navigate).not.toHaveBeenCalled();
  });
});
