/**
 * @jest-environment jsdom
 */

/**
 * Deactivated accounts in the unit's role management: listed after the
 * active ones, folded in a section at the bottom, so they no longer crowd the
 * people a leader is looking for.
 *
 * @module test/spa/RoleManagementInactive
 */

import axe from 'axe-core';

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn(),
}));

jest.mock('../../spa/app.js', () => ({
  app: {},
  translate: (key) => ({
    district_management_inactive_accounts: 'Comptes désactivés ({count})',
    member_access_inactive_badge: 'Inactif',
  })[key] || key,
}));

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

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom does no layout, so contrast cannot be computed here.
  rules: { 'color-contrast': { enabled: false } },
};

const PARENT = { id: 4, role_name: 'parent', display_name: 'Parent', assignable: true };
const ANNIE = {
  id: 'aaaaaaaa-0000-4000-8000-000000000001', email: 'annie@example.org',
  full_name: 'Annie Lécuyer', status: 'active', roles: [PARENT],
};
const GONE = {
  id: 'aaaaaaaa-0000-4000-8000-000000000002', email: 'gone@example.org',
  full_name: '<img src=x onerror=alert(1)>', status: 'inactive', roles: [PARENT],
};
const PAUL = {
  id: 'aaaaaaaa-0000-4000-8000-000000000003', email: 'paul@example.org',
  full_name: 'Paul Ancien', status: 'inactive', roles: [PARENT],
};

let page;

const section = () => document.getElementById('role-inactive-accounts');
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Render the users tab as the page does.
 *
 * @param {Array<Object>} users - The unit's members
 */
function renderUsersTab(users = [GONE, ANNIE, PAUL]) {
  page = new RoleManagement({});
  page.users = users;
  page.roles = [PARENT];
  page.activeTab = 'users';
  page.fetchUsers = jest.fn();
  page.render();
}

/**
 * Type in the search field, the way a person would.
 *
 * @param {string} text - What is typed
 */
function search(text) {
  const input = document.getElementById('user-search-input');
  input.value = text;
  input.dispatchEvent(new Event('input'));
}

/**
 * @param {Element} item - A member's row
 * @returns {boolean} Whether the row is shown
 */
function shown(item) {
  return item.style.display !== 'none' && !item.closest('[hidden]');
}

beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main>';
  jest.clearAllMocks();
  endpoints.getUserRoleAssignments.mockResolvedValue({ data: [PARENT] });
  Element.prototype.scrollIntoView = jest.fn();
  window.matchMedia = () => ({ matches: false });
});

test('deactivated accounts are folded in a closed section after the active ones', () => {
  renderUsersTab();

  const list = document.getElementById('user-list');
  const rows = Array.from(list.querySelectorAll('.user-item'));
  expect(rows[0].dataset.userId).toBe(ANNIE.id);
  expect(rows[0].closest('details')).toBeNull();

  expect(section().tagName).toBe('DETAILS');
  expect(section().open).toBe(false);
  expect(section().querySelector('summary').textContent).toBe('Comptes désactivés (2)');
  expect(Array.from(section().querySelectorAll('.user-item')).map((row) => row.dataset.userId))
    .toEqual([GONE.id, PAUL.id]);
  expect(list.lastElementChild).toBe(section());
});

test('a deactivated account\'s name shows as text, not markup', () => {
  renderUsersTab();
  expect(section().querySelector('img')).toBeNull();
  expect(section().textContent).toContain('<img src=x onerror=alert(1)>');
});

test('there is no such section when everyone is active', () => {
  renderUsersTab([ANNIE]);
  expect(section()).toBeNull();
});

test('the section stays open once opened, when the list is drawn again', async () => {
  renderUsersTab();
  section().open = true;
  section().dispatchEvent(new Event('toggle'));
  await flush();

  page.render();
  expect(section().open).toBe(true);
});

test('a search that finds a deactivated account opens the section, and clearing it closes it again', () => {
  renderUsersTab();

  search('paul');
  expect(section().hidden).toBe(false);
  expect(section().open).toBe(true);
  const paul = section().querySelector(`[data-user-id="${PAUL.id}"]`);
  expect(shown(paul)).toBe(true);

  search('');
  expect(section().open).toBe(false);
});

test('a search that finds only active accounts hides the section', () => {
  renderUsersTab();
  search('annie');
  expect(section().hidden).toBe(true);
  expect(shown(document.querySelector(`[data-user-id="${ANNIE.id}"]`))).toBe(true);
});

test('a deactivated account being edited keeps its section open when the list is drawn again', async () => {
  renderUsersTab();
  section().open = true;
  section().querySelector(`.btn-manage-roles[data-user-id="${PAUL.id}"]`).click();
  await flush();
  await flush();

  page.inactiveExpanded = false;
  page.render();
  expect(section().open).toBe(true);
});

test('the list with its folded section passes axe, and the section opens from the keyboard', async () => {
  renderUsersTab();
  const summary = section().querySelector('summary');
  summary.focus();
  expect(document.activeElement).toBe(summary);
  summary.click();
  expect(section().open).toBe(true);
  expect((await axe.run(document.getElementById('app'), AXE_OPTIONS)).violations).toEqual([]);
});
