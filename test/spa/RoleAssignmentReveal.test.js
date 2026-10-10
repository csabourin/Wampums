/**
 * @jest-environment jsdom
 */

/**
 * Opening a user's roles on a phone.
 *
 * The role form sits below the whole user list. "Manage roles" rendered it
 * there and left focus on the button, so on a phone nothing seemed to happen
 * and a screen reader announced nothing. Opening it now scrolls to the form
 * and moves focus to its heading (without animation when the person asks for
 * reduced motion); Cancel returns to the user's button. Saving re-renders the
 * list without binding the form a second time, which made the next save send
 * the request twice.
 *
 * @module test/spa/RoleAssignmentReveal
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
  translate: (key) => key,
}));

jest.mock('../../spa/config.js', () => ({ CONFIG: {}, getApiUrl: (endpoint) => endpoint }));

jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  hasPermission: () => true,
}));

jest.mock('../../spa/indexedDB.js', () => ({ deleteCachedData: jest.fn() }));
jest.mock('../../spa/api/api-core.js', () => ({ API: { get: jest.fn() } }));
jest.mock('../../spa/api/api-endpoints.js', () => ({
  getUsers: jest.fn(),
  getRoleCatalog: jest.fn(),
  getUserRoleAssignments: jest.fn(),
  updateUserRolesV1: jest.fn(),
  clearUserCaches: jest.fn(),
}));

jest.mock('../../spa/api/api-members.js', () => ({
  setUserMembershipStatus: jest.fn(),
}));

jest.mock('../../spa/utils/DialogUtils.js', () => ({
  confirmDestructive: jest.fn(),
}));

jest.mock('../../spa/utils/DOMUtils.js', () => {
  const actual = jest.requireActual('../../spa/utils/DOMUtils.js');
  return { ...actual, loadStylesheet: jest.fn(() => Promise.resolve()) };
});

import * as endpoints from '../../spa/api/api-endpoints.js';
import { setUserMembershipStatus } from '../../spa/api/api-members.js';
import { confirmDestructive } from '../../spa/utils/DialogUtils.js';
import { RoleManagement } from '../../spa/role_management.js';

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom does no layout, so contrast cannot be computed here.
  rules: { 'color-contrast': { enabled: false } },
};

const LEADER = { id: 3, role_name: 'leader', display_name: 'Leader', assignable: true };
const PARENT = { id: 4, role_name: 'parent', display_name: 'Parent', assignable: true };
const ROLES = [LEADER, PARENT];
const ALEX = { id: 'aaaaaaaa-0000-4000-8000-000000000001', email: 'alex@example.org', full_name: 'Alex', roles: [PARENT] };
const SAM = { id: 'aaaaaaaa-0000-4000-8000-000000000002', email: 'sam@example.org', full_name: 'Sam', roles: [PARENT] };

let scrollCalls;

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Pretend the person does or does not ask for reduced motion.
 *
 * @param {boolean} reduce - Whether prefers-reduced-motion is "reduce"
 */
function prefersReducedMotion(reduce) {
  window.matchMedia = (query) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
  });
}

/**
 * Render the users tab, as the page does, with two users.
 *
 * @returns {RoleManagement} The page
 */
function renderUsersTab() {
  const page = new RoleManagement({});
  page.users = [ALEX, SAM];
  page.roles = ROLES;
  page.activeTab = 'users';
  page.fetchUsers = jest.fn();
  page.render();
  return page;
}

/**
 * The "manage roles" button of a user.
 *
 * @param {Object} user - User row
 * @returns {HTMLButtonElement} Button
 */
function manageButton(user) {
  return document.querySelector(`.btn-manage-roles[data-user-id="${user.id}"]`);
}

/**
 * Activate "manage roles" for a user and wait for the form.
 *
 * @param {Object} user - User row
 */
async function open(user) {
  manageButton(user).click();
  await flush();
  await flush();
}

beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main>';
  jest.clearAllMocks();
  endpoints.getUserRoleAssignments.mockResolvedValue({ data: [PARENT] });
  scrollCalls = [];
  Element.prototype.scrollIntoView = function scrollIntoView(options) {
    scrollCalls.push({ element: this, options });
  };
  prefersReducedMotion(false);
});

describe('opening a user\'s roles', () => {
  test('scrolls to the form and moves focus to its heading', async () => {
    renderUsersTab();
    manageButton(ALEX).focus();

    await open(ALEX);

    const heading = document.getElementById('user-assignment-heading');
    expect(heading.tagName).toBe('H2');
    expect(document.activeElement).toBe(heading);
    expect(scrollCalls).toEqual([{ element: heading, options: { behavior: 'smooth', block: 'start' } }]);
  });

  test('does not animate the scroll when the person asks for reduced motion', async () => {
    prefersReducedMotion(true);
    renderUsersTab();

    await open(ALEX);

    expect(scrollCalls[0].options.behavior).toBe('auto');
  });

  test('marks the user being edited, and only that user', async () => {
    renderUsersTab();

    await open(ALEX);
    expect(manageButton(ALEX).getAttribute('aria-current')).toBe('true');
    expect(manageButton(ALEX).closest('.user-item').classList.contains('selected')).toBe(true);
    expect(manageButton(SAM).hasAttribute('aria-current')).toBe(false);

    await open(SAM);
    expect(manageButton(ALEX).hasAttribute('aria-current')).toBe(false);
    expect(manageButton(SAM).getAttribute('aria-current')).toBe('true');
  });

  test('Cancel returns focus to the user\'s button and clears the selection', async () => {
    renderUsersTab();
    await open(SAM);

    document.getElementById('cancel-assignment').click();

    expect(document.activeElement).toBe(manageButton(SAM));
    expect(manageButton(SAM).hasAttribute('aria-current')).toBe(false);
    expect(document.getElementById('user-role-assignment-form')).toBeNull();
  });

  test('names roles, not their internal keys', async () => {
    renderUsersTab();
    await open(ALEX);

    const form = document.getElementById('user-role-assignment-form');
    expect(form.textContent).not.toMatch(/\bleader\b/);
    expect(form.querySelector(`input[value="${LEADER.id}"]`).closest('label').textContent)
      .toContain('Leader');
  });

  test('each save sends one request, also after the list was refreshed', async () => {
    endpoints.updateUserRolesV1.mockResolvedValue({ success: true });
    renderUsersTab();
    await open(ALEX);
    const form = document.getElementById('user-role-assignment-form');

    form.querySelector(`input[value="${LEADER.id}"]`).click();
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await flush();
    await flush();
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await flush();
    await flush();

    expect(endpoints.updateUserRolesV1).toHaveBeenCalledTimes(2);
  });

  test('the users tab with a user open has no WCAG A/AA violations', async () => {
    renderUsersTab();
    await open(ALEX);

    const results = await axe.run(document.getElementById('app'), AXE_OPTIONS);
    expect(results.violations).toEqual([]);
  });
});

describe('deactivating a member who left', () => {
  const BLAKE = { id: 'aaaaaaaa-0000-4000-8000-000000000003', email: 'blake@example.org', full_name: 'Blake', roles: [LEADER], status: 'active' };

  /**
   * Render the tab with Blake, a leader, and open Blake's roles.
   *
   * @param {string} status - Blake's membership status as listed
   * @returns {Promise<RoleManagement>} The page
   */
  async function openBlake(status = 'active') {
    const page = new RoleManagement({});
    page.users = [{ ...BLAKE, status }];
    page.roles = ROLES;
    page.activeTab = 'users';
    page.fetchUsers = jest.fn(() => {
      page.users = [{ ...BLAKE, status: page.nextStatus || status }];
      return Promise.resolve();
    });
    page.render();
    endpoints.getUserRoleAssignments.mockResolvedValue({ data: [LEADER] });
    await open(BLAKE);
    return page;
  }

  test('asks for confirmation, then deactivates, says so and keeps focus on the button', async () => {
    confirmDestructive.mockResolvedValue(true);
    setUserMembershipStatus.mockResolvedValue({ success: true });
    const page = await openBlake();
    page.nextStatus = 'inactive';

    expect(document.getElementById('membership-toggle').textContent.trim()).toBe('member_access_deactivate');
    document.getElementById('membership-toggle').click();
    await flush();
    await flush();
    await flush();

    expect(confirmDestructive).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: 'member_access_deactivate' }));
    expect(setUserMembershipStatus).toHaveBeenCalledWith(BLAKE.id, 'inactive');
    expect(document.getElementById('membership-message').textContent).toBe('member_access_deactivated');
    expect(document.getElementById('membership-message').getAttribute('role')).toBe('status');
    expect(document.getElementById('membership-toggle').textContent.trim()).toBe('member_access_reactivate');
    expect(document.activeElement).toBe(document.getElementById('membership-toggle'));
    expect(document.querySelector('.user-item .member-inactive-badge').textContent).toBe('member_access_inactive_badge');
  });

  test('cancelling the confirmation changes nothing', async () => {
    confirmDestructive.mockResolvedValue(false);
    await openBlake();

    document.getElementById('membership-toggle').click();
    await flush();

    expect(setUserMembershipStatus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.getElementById('membership-toggle'));
  });

  test('reactivating needs no confirmation', async () => {
    setUserMembershipStatus.mockResolvedValue({ success: true });
    const page = await openBlake('inactive');
    page.nextStatus = 'active';

    document.getElementById('membership-toggle').click();
    await flush();
    await flush();
    await flush();

    expect(confirmDestructive).not.toHaveBeenCalled();
    expect(setUserMembershipStatus).toHaveBeenCalledWith(BLAKE.id, 'active');
    expect(document.getElementById('membership-message').textContent).toBe('member_access_reactivated');
  });

  test('a refusal says the member holds permissions the viewer lacks', async () => {
    confirmDestructive.mockResolvedValue(true);
    const refused = new Error('API request failed: 403');
    refused.status = 403;
    setUserMembershipStatus.mockRejectedValue(refused);
    await openBlake();

    document.getElementById('membership-toggle').click();
    await flush();
    await flush();

    expect(document.getElementById('membership-message').textContent).toBe('member_access_forbidden');
  });

  test('offers nothing for an alumnus, managed from the alumni list', async () => {
    await openBlake('alumni');

    expect(document.querySelector('.membership-section')).toBeNull();
  });

  test('the section has no WCAG A/AA violations', async () => {
    await openBlake('inactive');

    const results = await axe.run(document.querySelector('.membership-section'), AXE_OPTIONS);
    expect(results.violations).toEqual([]);
  });
});
