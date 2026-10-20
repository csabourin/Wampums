/**
 * @jest-environment jsdom
 */

/**
 * Assigning roles once the unit hid a built-in role it replaced.
 *
 * A hidden role is no longer offered to members who do not hold it. A member
 * who holds it still sees it, marked as hidden, so it can be removed. The
 * screen also mounts as a tab of "Rôles et permissions", without its own
 * heading or way back.
 *
 * @module test/spa/RoleHiddenAssignment
 */

import axe from 'axe-core';
import mockFr from '../../lang/fr.json';

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn(), debugInfo: jest.fn(),
}));
jest.mock('../../spa/app.js', () => ({ app: {}, translate: (key) => mockFr[key] || key }));
jest.mock('../../spa/config.js', () => ({ CONFIG: {}, getApiUrl: (endpoint) => endpoint }));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({ hasPermission: () => true }));
jest.mock('../../spa/indexedDB.js', () => ({ deleteCachedData: jest.fn() }));
jest.mock('../../spa/api/api-core.js', () => ({ API: { get: jest.fn() } }));
jest.mock('../../spa/api/api-endpoints.js', () => ({
  getUsers: jest.fn(),
  getRoleCatalog: jest.fn(),
  getUserRoleAssignments: jest.fn(),
  updateUserRolesV1: jest.fn(),
  clearUserCaches: jest.fn(),
}));
jest.mock('../../spa/api/api-members.js', () => ({ setUserMembershipStatus: jest.fn() }));
jest.mock('../../spa/utils/DialogUtils.js', () => ({ confirmDestructive: jest.fn() }));
jest.mock('../../spa/utils/DOMUtils.js', () => {
  const actual = jest.requireActual('../../spa/utils/DOMUtils.js');
  return { ...actual, loadStylesheet: jest.fn(() => Promise.resolve()) };
});

import * as endpoints from '../../spa/api/api-endpoints.js';
import { RoleManagement } from '../../spa/modules/roles/RoleManagement.js';
import { rolesToOffer } from '../../spa/utils/RoleVisibilityUtils.js';

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  rules: { 'color-contrast': { enabled: false } },
};

const LEADER = { id: 3, role_name: 'leader', display_name: 'Leader', assignable: true, hidden: true };
const PACK_LEADER = { id: 30, role_name: 'u1_animation', display_name: 'Animation de la meute', assignable: true, customized_from_role_id: 3 };
const PARENT = { id: 4, role_name: 'parent', display_name: 'Parent', assignable: true };
const ROLES = [LEADER, PACK_LEADER, PARENT];
const ALEX = { id: 'aaaaaaaa-0000-4000-8000-000000000001', email: 'alex@example.org', full_name: 'Alex', roles: [PARENT] };
const SAM = { id: 'aaaaaaaa-0000-4000-8000-000000000002', email: 'sam@example.org', full_name: 'Sam', roles: [LEADER] };

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function renderUsersTab() {
  const page = new RoleManagement({}, { view: 'users' });
  page.users = [ALEX, SAM];
  page.roles = ROLES;
  page.fetchUsers = jest.fn();
  page.render();
  return page;
}
async function openRolesOf(user, held) {
  endpoints.getUserRoleAssignments.mockResolvedValue({ data: held });
  document.querySelector(`.btn-manage-roles[data-user-id="${user.id}"]`).click();
  await flush(); await flush();
}
const offeredIds = () => [...document.querySelectorAll('input[name="role_ids"]')].map((input) => Number(input.value));

beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main>';
  jest.clearAllMocks();
  window.matchMedia = () => ({ matches: false });
});

test('a built-in role the unit hid is offered only to members who hold it', () => {
  expect(rolesToOffer(ROLES, [4]).map((role) => role.id)).toEqual([30, 4]);
  expect(rolesToOffer(ROLES, ['3']).map((role) => role.id)).toEqual([3, 30, 4]);
});

test('a member without the hidden role is not offered it', async () => {
  renderUsersTab();
  await openRolesOf(ALEX, [PARENT]);
  expect(offeredIds()).toEqual([30, 4]);
});

test('a member who holds the hidden role sees it marked as hidden and can remove it', async () => {
  renderUsersTab();
  await openRolesOf(SAM, [LEADER]);
  expect(offeredIds()).toEqual([3, 30, 4]);
  const hidden = document.querySelector('input[name="role_ids"][value="3"]');
  expect(hidden.checked).toBe(true);
  expect(hidden.disabled).toBe(false);
  expect(document.getElementById(hidden.getAttribute('aria-describedby')).textContent).toBe(mockFr.role_hidden_held_note);
  expect((await axe.run(document.getElementById('app'), AXE_OPTIONS)).violations).toEqual([]);
});

test('a refusal to grant a hidden role is explained in the page language', async () => {
  renderUsersTab();
  await openRolesOf(SAM, [LEADER]);
  endpoints.updateUserRolesV1.mockRejectedValue(Object.assign(new Error('role_hidden_in_unit'), { status: 409 }));
  document.getElementById('user-role-assignment-form')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await flush(); await flush();
  expect(document.getElementById('assignment-message').textContent).toBe(mockFr.role_hidden_in_unit);
});

test('mounted as a tab, the screen draws neither its own heading nor a way back', async () => {
  document.body.innerHTML = '<main id="app"><div id="tab-mount"></div></main>';
  endpoints.getRoleCatalog.mockResolvedValue({ data: ROLES });
  const page = new RoleManagement({}, { view: 'roles', containerId: 'tab-mount', embedded: true });
  await page.init();
  const mount = document.getElementById('tab-mount');
  expect(mount.querySelector('h1')).toBeNull();
  expect(mount.querySelector('a[href]')).toBeNull();
  expect(mount.querySelector('.tab-button')).toBeNull();
  const leaderCard = mount.querySelector('.role-card[data-role-id="3"]');
  expect(leaderCard.textContent).toContain(mockFr.role_hidden_badge);
});
