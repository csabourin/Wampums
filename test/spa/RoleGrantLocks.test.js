/**
 * @jest-environment jsdom
 */

/**
 * Role forms under the rule that someone may grant only what they hold.
 *
 * The roles list marks each role `assignable`. A role the viewer cannot grant
 * stays visible with its current state, disabled, and explained; saving sends
 * it back unchanged so a member never silently loses a role the viewer could
 * not have removed. A refusal from the server reads as such, in the page's
 * language, and is announced.
 *
 * @module test/spa/RoleGrantLocks
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

jest.mock('../../spa/ajax-functions.js', () => ({
  getUsers: jest.fn(),
  updateUserRolesV1: jest.fn(),
  getRoleCatalog: jest.fn(),
  approveUser: jest.fn(),
  getSubscribers: jest.fn(),
  sendNotification: jest.fn(),
  getCurrentOrganizationId: jest.fn(() => 3),
  importSISC: jest.fn(),
  clearUserCaches: jest.fn(),
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

jest.mock('../../spa/utils/DOMUtils.js', () => {
  const actual = jest.requireActual('../../spa/utils/DOMUtils.js');
  return { ...actual, loadStylesheet: jest.fn(() => Promise.resolve()) };
});

import { updateUserRolesV1 as adminUpdateRoles } from '../../spa/ajax-functions.js';
import * as endpoints from '../../spa/api/api-endpoints.js';
import { Admin } from '../../spa/admin.js';
import { RoleManagement } from '../../spa/role_management.js';

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom does no layout, so contrast cannot be computed here.
  rules: { 'color-contrast': { enabled: false } },
};

const DISTRICT = { id: 1, role_name: 'district', display_name: 'District admin', assignable: false };
const LEADER = { id: 3, role_name: 'leader', display_name: 'Leader', assignable: true };
const PARENT = { id: 4, role_name: 'parent', display_name: 'Parent', assignable: true };
const ROLES = [DISTRICT, LEADER, PARENT];
const MEMBER = { id: 'aaaaaaaa-0000-4000-8000-000000000001', email: 'd@example.org', full_name: 'Dana', role_ids: [DISTRICT.id] };

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function forbiddenError() {
  const err = new Error('API request failed: 403');
  err.status = 403;
  return err;
}

/**
 * Accessible name of a checkbox wrapped in its label: the label's text.
 * @param {HTMLInputElement} input - Checkbox
 * @returns {string} Normalized label text
 */
function labelText(input) {
  return input.closest('label').textContent.replace(/\s+/g, ' ').trim();
}

beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main>';
  jest.clearAllMocks();
  window.requestAnimationFrame = (callback) => setTimeout(callback, 0);
});

describe('admin role modal', () => {
  function openModal() {
    const app = { showMessage: jest.fn() };
    const admin = new Admin(app);
    admin.users = [MEMBER];
    admin.roleCatalog = ROLES;
    admin.currentOrganizationId = 3;
    admin.fetchData = jest.fn();
    admin.render = jest.fn();
    admin.initEventListeners = jest.fn();
    const trigger = document.createElement('button');
    trigger.textContent = 'Manage roles';
    document.getElementById('app').appendChild(trigger);
    trigger.focus();
    admin.showRoleModal(MEMBER.id);
    return { admin, app, trigger, modal: document.getElementById('role-modal') };
  }

  test('shows a role the viewer cannot grant as disabled, keeping its state, and says why', () => {
    const { modal } = openModal();
    const district = modal.querySelector(`input[value="${DISTRICT.id}"]`);
    const leader = modal.querySelector(`input[value="${LEADER.id}"]`);

    expect(district.disabled).toBe(true);
    expect(district.checked).toBe(true);
    const note = document.getElementById(district.getAttribute('aria-describedby'));
    expect(note.textContent).toBe('role_not_assignable');
    expect(labelText(district)).toBe('District admin');

    expect(leader.disabled).toBe(false);
    expect(leader.hasAttribute('aria-describedby')).toBe(false);
  });

  test('saving keeps the locked role the member already holds', async () => {
    adminUpdateRoles.mockResolvedValue({ success: false });
    const { modal } = openModal();

    modal.querySelector(`input[value="${LEADER.id}"]`).click();
    document.getElementById('role-modal-save').click();
    await flush();

    expect(adminUpdateRoles).toHaveBeenCalledWith(MEMBER.id, [DISTRICT.id, LEADER.id], { organizationId: 3 });
  });

  test('a refused grant reads as a refusal, not a generic error', async () => {
    adminUpdateRoles.mockRejectedValue(forbiddenError());
    const { app, modal } = openModal();

    modal.querySelector(`input[value="${LEADER.id}"]`).click();
    document.getElementById('role-modal-save').click();
    await flush();

    expect(app.showMessage).toHaveBeenCalledWith('role_grant_forbidden', 'error');
  });

  test('keyboard: focus enters the dialog, Tab skips the locked role, Escape closes and returns focus', async () => {
    const { trigger, modal } = openModal();
    await flush();

    const dialog = modal.querySelector('[role="dialog"]') || modal;
    expect(dialog.contains(document.activeElement)).toBe(true);

    const district = modal.querySelector(`input[value="${DISTRICT.id}"]`);
    expect(district.matches('input:not([disabled])')).toBe(false);

    modal.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flush();

    expect(document.getElementById('role-modal')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  test('has no WCAG A/AA violations', async () => {
    const { modal } = openModal();
    const results = await axe.run(modal, AXE_OPTIONS);
    expect(results.violations).toEqual([]);
  });
});

describe('role management assignment form', () => {
  async function openForm() {
    endpoints.getUserRoleAssignments.mockResolvedValue({ data: [DISTRICT] });
    const page = new RoleManagement({});
    page.users = [MEMBER];
    page.roles = ROLES;
    page.fetchUsers = jest.fn();
    page.attachUsersTabListeners = jest.fn();
    page.renderUserList = () => '';
    document.getElementById('app').innerHTML = '<div id="user-assignment-content"></div><div id="user-list"></div>';
    await page.showUserRoleAssignment(MEMBER.id);
    return { page, form: document.getElementById('user-role-assignment-form') };
  }

  test('shows a role the viewer cannot grant as disabled, keeping its state, and says why', async () => {
    const { form } = await openForm();
    const district = form.querySelector(`input[value="${DISTRICT.id}"]`);

    expect(district.disabled).toBe(true);
    expect(district.checked).toBe(true);
    expect(document.getElementById(district.getAttribute('aria-describedby')).textContent)
      .toBe('role_not_assignable');
    expect(form.querySelector(`input[value="${PARENT.id}"]`).disabled).toBe(false);
  });

  test('saving keeps the locked role, and a refusal is announced in the page language', async () => {
    endpoints.updateUserRolesV1.mockRejectedValue(forbiddenError());
    const { form } = await openForm();

    form.querySelector(`input[value="${PARENT.id}"]`).click();
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await flush();

    expect(endpoints.updateUserRolesV1).toHaveBeenCalledWith(MEMBER.id, [DISTRICT.id, PARENT.id]);
    const message = document.getElementById('assignment-message');
    expect(message.getAttribute('role')).toBe('status');
    expect(message.textContent).toBe('role_grant_forbidden');
  });

  test('has no WCAG A/AA violations', async () => {
    const { form } = await openForm();
    const results = await axe.run(form, AXE_OPTIONS);
    expect(results.violations).toEqual([]);
  });
});
