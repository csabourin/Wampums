/**
 * @jest-environment jsdom
 *
 * Opening a role's permissions on the roles screen.
 *
 * The button says whether the list is open; while the permissions load the list
 * says so in the page's language, and a failed load is announced.
 */

import axe from 'axe-core';

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn(),
}));
jest.mock('../../spa/app.js', () => ({ app: {}, translate: (key) => key }));
jest.mock('../../spa/config.js', () => ({ CONFIG: {}, getApiUrl: (endpoint) => endpoint }));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  hasPermission: () => true,
  canAccessAdminPanel: () => true,
  canCreateOrganization: () => false,
  canManageUsers: () => true,
  canSendCommunications: () => false,
  canViewUsers: () => true,
}));
jest.mock('../../spa/utils/PageMount.js', () => ({
  getMountPoint: () => globalThis.document.getElementById('app'),
  resolveMountOptions: () => ({}),
}));
jest.mock('../../spa/ajax-functions.js', () => ({ getCurrentOrganizationId: jest.fn(() => 3) }));
jest.mock('../../spa/indexedDB.js', () => ({ deleteCachedData: jest.fn() }));
jest.mock('../../spa/api/api-core.js', () => ({ API: { get: jest.fn() } }));
jest.mock('../../spa/api/api-endpoints.js', () => ({
  getUsers: jest.fn(),
  getRoleCatalog: jest.fn(),
  getUserRoleAssignments: jest.fn(),
  updateUserRolesV1: jest.fn(),
  clearUserCaches: jest.fn(),
}));
jest.mock('../../spa/utils/DOMUtils.js', () => {
  const actual = jest.requireActual('../../spa/utils/DOMUtils.js');
  return { ...actual, loadStylesheet: jest.fn(() => Promise.resolve()) };
});

import { API } from '../../spa/api/api-core.js';
import * as endpoints from '../../spa/api/api-endpoints.js';
import { RoleManagement } from '../../spa/modules/roles/RoleManagement.js';

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom does no layout, so contrast cannot be computed here.
  rules: { 'color-contrast': { enabled: false } },
};
const LEADER = { id: 3, role_name: 'leader', display_name: 'Leader', assignable: true };

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });
const toggle = () => document.querySelector(`.toggle-permissions-btn[data-role-id="${LEADER.id}"]`);
const list = () => document.getElementById(`role-permissions-${LEADER.id}`);

beforeEach(async () => {
  document.body.innerHTML = '<main id="app"></main>';
  jest.clearAllMocks();
  endpoints.getRoleCatalog.mockResolvedValue({ data: [LEADER] });
  await new RoleManagement({ showMessage: jest.fn() }).init();
});

describe('a role\'s permissions', () => {
  test('the button says the list is closed, and controls it', () => {
    expect(toggle().getAttribute('type')).toBe('button');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(toggle().getAttribute('aria-controls')).toBe(list().id);
  });

  test('while they load, the open list says so in the page\'s language, and passes axe', async () => {
    API.get.mockReturnValue(new Promise(() => {}));

    toggle().click();
    await flush();

    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    const status = list().querySelector('[role="status"]');
    expect(status.textContent).toBe('loading');
    expect(list().textContent).not.toMatch(/Loading permissions/);
    expect((await axe.run(document.getElementById('app'), AXE_OPTIONS)).violations).toEqual([]);
  });

  test('a failed load is announced', async () => {
    API.get.mockRejectedValue(Object.assign(new Error('offline'), { status: 0 }));

    toggle().click();
    await flush();

    expect(list().querySelector('[role="alert"]')).not.toBeNull();
  });
});
