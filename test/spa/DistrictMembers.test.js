/**
 * @jest-environment jsdom
 */

/**
 * Members in the district space: deactivated accounts folded at the bottom,
 * a parent shown with their children, and role changes waiting to be sent
 * that can be retried or dropped one by one.
 *
 * @module test/spa/DistrictMembers
 */

import axe from 'axe-core';

const TRANSLATIONS = {
  district_management_children: 'Enfants : {names}',
  district_management_inactive_accounts: 'Comptes désactivés ({count})',
  district_management_queue_discard_for: 'Retirer de la file le changement pour {name}',
  district_management_queue_discarded: 'Le changement pour {name} a été retiré de la file.',
  member_access_inactive_badge: 'Désactivé',
};

jest.mock('../../spa/app.js', () => ({
  app: {},
  translate: (key) => TRANSLATIONS[key] || key,
}));

jest.mock('../../spa/ajax-functions.js', () => ({
  CONFIG: { CACHE_DURATION: { SHORT: 1 } },
  clearUserCaches: jest.fn(),
  getCurrentOrganizationId: jest.fn(() => 1),
  getRoleAuditLog: jest.fn(),
  getRoleBundles: jest.fn(),
  getRolePermissions: jest.fn(),
  getUserOrganizations: jest.fn(),
  getUsers: jest.fn(),
  getUserRoleAssignments: jest.fn(),
  updateUserRoleBundles: jest.fn(),
  updateUserRolesV1: jest.fn(),
}));

jest.mock('../../spa/modules/session/UnitSwitch.js', () => ({ switchActiveUnit: jest.fn() }));
jest.mock('../../spa/api/api-members.js', () => ({ setUserMembershipStatus: jest.fn() }));
jest.mock('../../spa/utils/DialogUtils.js', () => ({ confirmDestructive: jest.fn() }));
jest.mock('../../spa/indexedDB.js', () => ({ getCachedData: jest.fn(), setCachedData: jest.fn() }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
}));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  canAssignRoles: () => true,
  canViewRoles: () => true,
  hasPermission: () => true,
}));
jest.mock('../../spa/utils/RoleValidationUtils.js', () => ({
  buildRoleBundleIndex: (roles = []) => ({
    list: roles,
    byId: new Map(roles.map((role) => [role.id, role])),
    byName: new Map(roles.map((role) => [role.role_name, role])),
  }),
  calculatePermissionGaps: () => ({ missing: [] }),
  detectRoleConflicts: () => ({ hasConflict: false, conflicts: [] }),
  getLocalGroupEligibleRoles: () => [],
}));
jest.mock('../../spa/utils/PageMount.js', () => ({
  getMountPoint: () => globalThis.document.getElementById('app'),
  resolveMountOptions: () => ({}),
}));

import { DistrictManagement } from '../../spa/modules/district/DistrictManagement.js';
import {
  getRoleBundles,
  getRolePermissions,
  getUserOrganizations,
  getUsers,
  updateUserRolesV1,
} from '../../spa/ajax-functions.js';
import { getCachedData, setCachedData } from '../../spa/indexedDB.js';

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom does no layout, so contrast cannot be computed here.
  rules: { 'color-contrast': { enabled: false } },
};

const PARENT = { id: 4, role_name: 'parent', display_name: 'Parent' };
const LEADER = { id: 3, role_name: 'leader', display_name: 'Animation' };

const ACTIVE_PARENT = {
  id: 'u-parent',
  full_name: 'Marie Tremblay',
  email: 'marie@example.test',
  status: 'active',
  role_ids: [PARENT.id],
  roles: [PARENT],
  children: [
    { id: 1, first_name: 'Léa', last_name: 'Tremblay', nickname: null },
    { id: 2, first_name: '<img src=x onerror=alert(1)>', last_name: 'Tremblay', nickname: null },
  ],
};
const ACTIVE_LEADER = {
  id: 'u-leader', full_name: 'Akela', email: 'akela@example.test', status: 'active',
  role_ids: [LEADER.id], roles: [LEADER], children: [],
};
const DEACTIVATED = {
  id: 'u-gone', full_name: 'Paul Ancien', email: 'paul@example.test', status: 'inactive',
  role_ids: [PARENT.id], roles: [PARENT], children: [],
};

const app = () => document.getElementById('app');
let showMessage;

/**
 * Open the screen with these members, and these changes waiting.
 *
 * @param {Array<Object>} queuedChanges - Changes cached from an earlier visit
 * @returns {Promise<DistrictManagement>} The screen
 */
async function openScreen(queuedChanges = []) {
  getCachedData.mockResolvedValue(queuedChanges.length ? { queuedChanges } : null);
  const view = new DistrictManagement({ lang: 'fr', showMessage, userRoles: ['district'] });
  await view.init();
  return view;
}

beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main>';
  showMessage = jest.fn();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  getUserOrganizations.mockResolvedValue({ success: true, data: [{ id: 1, name: 'Unité' }] });
  getRoleBundles.mockResolvedValue({ success: true, data: [PARENT, LEADER] });
  getRolePermissions.mockResolvedValue({ success: true, data: [] });
  getUsers.mockResolvedValue({ success: true, data: [DEACTIVATED, ACTIVE_PARENT, ACTIVE_LEADER] });
  updateUserRolesV1.mockResolvedValue({ success: true });
  setCachedData.mockResolvedValue();
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('deactivated accounts', () => {
  test('are folded in a section at the bottom, apart from the active members', async () => {
    const view = await openScreen();

    const section = app().querySelector('details.dm-inactive-accounts');
    expect(section.open).toBe(false);
    expect(section.querySelector('summary').textContent).toBe('Comptes désactivés (1)');
    expect([...section.querySelectorAll('.dm-user-card')].map((card) => card.dataset.userId)).toEqual(['u-gone']);

    const list = app().querySelector('#dm-user-list');
    const outside = [...list.children].filter((node) => node.matches('.dm-user-card'));
    expect(outside.map((card) => card.dataset.userId)).toEqual(['u-parent', 'u-leader']);
    expect(list.lastElementChild).toBe(section);
    view.destroy();
  });

  test('stay open once opened, when the list is drawn again', async () => {
    const view = await openScreen();

    const section = app().querySelector('details.dm-inactive-accounts');
    section.open = true;
    section.dispatchEvent(new Event('toggle'));
    view.renderAndBind();

    expect(app().querySelector('details.dm-inactive-accounts').open).toBe(true);
    view.destroy();
  });

  test('a search that finds one opens the section', async () => {
    const view = await openScreen();

    view.searchTerm = 'paul';
    view.filteredUsers = view.getFilteredUsers();
    view.renderAndBind();

    const section = app().querySelector('details.dm-inactive-accounts');
    expect(section.open).toBe(true);
    expect(app().querySelectorAll('.dm-user-card')).toHaveLength(1);
    view.destroy();
  });

  test('there is no such section when everyone is active', async () => {
    getUsers.mockResolvedValue({ success: true, data: [ACTIVE_PARENT] });
    const view = await openScreen();

    expect(app().querySelector('details.dm-inactive-accounts')).toBeNull();
    view.destroy();
  });
});

describe('a parent', () => {
  test('is shown with the names of their children, escaped, in the card and its accessible name', async () => {
    const view = await openScreen();

    const card = app().querySelector('[data-user-id="u-parent"]');
    const line = card.querySelector('.dm-user-children');
    expect(line.textContent).toBe('Enfants : Léa Tremblay, <img src=x onerror=alert(1)> Tremblay');
    expect(card.querySelector('img')).toBeNull();
    // Without an aria-label, the card's accessible name is its visible text.
    expect(card.hasAttribute('aria-label')).toBe(false);
    expect(card.textContent).toContain('Enfants : Léa Tremblay');
    expect(app().querySelector('[data-user-id="u-leader"] .dm-user-children')).toBeNull();
    view.destroy();
  });

  test('can be found by a child\'s name', async () => {
    const view = await openScreen();

    view.searchTerm = 'léa';
    view.filteredUsers = view.getFilteredUsers();
    view.renderAndBind();

    expect([...app().querySelectorAll('.dm-user-card')].map((card) => card.dataset.userId)).toEqual(['u-parent']);
    view.destroy();
  });
});

describe('changes waiting to be sent', () => {
  const stuck = {
    userId: 'u-gone',
    roleIds: [LEADER.id],
    auditNote: '',
    createdAt: 1,
    reason: 'stale',
    organizationId: 1,
  };

  test('each one is listed with a button that names whose change it removes', async () => {
    const view = await openScreen([stuck]);

    const item = app().querySelector('.dm-queue-item');
    expect(item.querySelector('.dm-user-name').textContent).toBe('Paul Ancien');
    expect(item.textContent).toContain('district_management_queue_reason_stale');
    const button = item.querySelector('button[data-discard-queued="u-gone"]');
    expect(button.getAttribute('aria-label')).toBe('Retirer de la file le changement pour Paul Ancien');
    view.destroy();
  });

  test('removing one drops it, reloads the members from the server and says so', async () => {
    const view = await openScreen([stuck]);
    getUsers.mockClear();

    app().querySelector('button[data-discard-queued="u-gone"]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(view.queuedChanges).toEqual([]);
    expect(app().querySelector('.dm-queued')).toBeNull();
    expect(setCachedData).toHaveBeenLastCalledWith(
      'district_management_state', expect.objectContaining({ queuedChanges: [] }), 1,
    );
    expect(getUsers).toHaveBeenCalledWith(1, { forceRefresh: true });
    expect(showMessage).toHaveBeenCalledWith('Le changement pour Paul Ancien a été retiré de la file.', 'success');
    expect(document.activeElement).toBe(document.getElementById('dm-refresh'));
    view.destroy();
  });

  test('removing one keeps the others, and moves focus to the list of those left', async () => {
    const other = { ...stuck, userId: 'u-leader' };
    const view = await openScreen([stuck, other]);

    app().querySelector('button[data-discard-queued="u-gone"]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(view.queuedChanges.map((change) => change.userId)).toEqual(['u-leader']);
    expect(document.activeElement).toBe(document.getElementById('dm-queue-title'));
    view.destroy();
  });

  test('removing one puts back the member\'s roles even when the server cannot be reached', async () => {
    const view = await openScreen([{ ...stuck, userId: 'u-parent', baseRoleIds: [PARENT.id] }]);
    view.applyOptimisticRoles(view.users.find((user) => user.id === 'u-parent'), [LEADER.id]);
    getUsers.mockRejectedValue(new Error('offline'));

    app().querySelector('button[data-discard-queued="u-parent"]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(view.users.find((user) => user.id === 'u-parent').role_ids).toEqual([PARENT.id]);
    expect(setCachedData).toHaveBeenCalledWith(
      'district_management_state',
      expect.objectContaining({
        queuedChanges: [],
        users: expect.arrayContaining([expect.objectContaining({ id: 'u-parent', role_ids: [PARENT.id] })]),
      }),
      1,
    );
    view.destroy();
  });

  test('removing a change keeps the roles a refresh already brought back', async () => {
    const view = await openScreen([{ ...stuck, userId: 'u-parent', roleIds: [LEADER.id], baseRoleIds: [LEADER.id] }]);
    // The refresh at opening shows the server's roles: Parent, not the change.
    getUsers.mockRejectedValue(new Error('offline'));

    app().querySelector('button[data-discard-queued="u-parent"]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(view.users.find((user) => user.id === 'u-parent').role_ids).toEqual([PARENT.id]);
    view.destroy();
  });

  test('a second change for the same member keeps the roles the first one started from', async () => {
    const view = await openScreen();

    view.queueChange('u-parent', [LEADER.id], null, [PARENT.id]);
    view.queueChange('u-parent', [LEADER.id, PARENT.id], null, [LEADER.id]);

    expect(view.queuedChanges).toEqual([
      expect.objectContaining({ roleIds: [LEADER.id, PARENT.id], baseRoleIds: [PARENT.id] }),
    ]);
    view.destroy();
  });

  test('a change made after a refresh brought other roles back starts from those roles', async () => {
    const view = await openScreen();

    view.queueChange('u-parent', [LEADER.id], null, [PARENT.id]);
    view.queueChange('u-parent', [PARENT.id], null, [LEADER.id, PARENT.id]);

    expect(view.queuedChanges[0].baseRoleIds).toEqual([LEADER.id, PARENT.id]);
    view.destroy();
  });

  test('a change is sent when the member\'s roles have not changed since it was made', async () => {
    const view = await openScreen([{ ...stuck, userId: 'u-parent', reason: 'error', baseRoleIds: [PARENT.id] }]);

    await view.retryQueuedChanges();

    expect(updateUserRolesV1).toHaveBeenCalledWith('u-parent', [LEADER.id], expect.any(Object));
    expect(view.queuedChanges).toEqual([]);
    view.destroy();
  });

  test('a change whose member\'s roles changed since stays, marked as such', async () => {
    const view = await openScreen([{ ...stuck, userId: 'u-parent', reason: null, baseRoleIds: [LEADER.id] }]);

    await view.retryQueuedChanges();

    expect(updateUserRolesV1).not.toHaveBeenCalled();
    expect(view.queuedChanges).toEqual([expect.objectContaining({ userId: 'u-parent', reason: 'stale' })]);
    view.destroy();
  });

  test('a failed save waits with the roles it started from, so a retry can send it', async () => {
    const view = await openScreen();

    view.queueChange('u-parent', [LEADER.id], 'error', [PARENT.id]);

    expect(view.queuedChanges[0].baseRoleIds).toEqual([PARENT.id]);
    view.destroy();
  });
});

test('the list, the waiting changes and the folded section pass axe', async () => {
  const view = await openScreen([{
    userId: 'u-gone', roleIds: [LEADER.id], createdAt: 1, reason: 'stale', organizationId: 1,
  }]);
  app().querySelector('details.dm-inactive-accounts').open = true;

  const results = await axe.run(app(), AXE_OPTIONS);

  expect(results.violations).toEqual([]);
  view.destroy();
});
