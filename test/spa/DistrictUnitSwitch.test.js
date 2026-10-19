/**
 * @jest-environment jsdom
 */

/**
 * Choosing another unit in the district space: the session switches to it
 * before anything of that unit is read or changed, and a failed switch leaves
 * the screen on the unit the session is still in.
 *
 * @module test/spa/DistrictUnitSwitch
 */

import axe from 'axe-core';

jest.mock('../../spa/app.js', () => ({ app: {}, translate: (key) => key }));

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
  canViewRoles: jest.fn(() => true),
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
  clearUserCaches,
  getRoleAuditLog,
  getRoleBundles,
  getRolePermissions,
  getUserOrganizations,
  getUserRoleAssignments,
  getUsers,
  updateUserRoleBundles,
} from '../../spa/ajax-functions.js';
import { getCachedData, setCachedData } from '../../spa/indexedDB.js';
import { switchActiveUnit } from '../../spa/modules/session/UnitSwitch.js';
import { canViewRoles } from '../../spa/utils/PermissionUtils.js';

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom does no layout, so contrast cannot be computed here.
  rules: { 'color-contrast': { enabled: false } },
};

const LEADER = { id: 3, role_name: 'leader', display_name: 'Animation' };
const FIRST_UNIT_MEMBER = {
  id: 'u-first', full_name: 'Akela', email: 'akela@example.test', status: 'active',
  role_ids: [LEADER.id], roles: [LEADER], children: [],
};
const SECOND_UNIT_MEMBER = {
  id: 'u-second', full_name: 'Bagheera', email: 'bagheera@example.test', status: 'active',
  role_ids: [LEADER.id], roles: [LEADER], children: [],
};

let appInstance;
let view;

const select = () => document.getElementById('dm-org-select');
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Pick a unit in the selector, the way a person would.
 *
 * @param {string} unitId - The unit to choose
 * @returns {Promise<void>}
 */
async function chooseUnit(unitId) {
  select().value = unitId;
  select().dispatchEvent(new Event('change'));
  await flush();
  await flush();
}

beforeEach(async () => {
  document.body.innerHTML = '<main id="app"></main>';
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  canViewRoles.mockReturnValue(true);
  getCachedData.mockResolvedValue(null);
  setCachedData.mockResolvedValue();
  getUserOrganizations.mockResolvedValue({
    success: true,
    data: [{ id: 1, name: 'Première unité' }, { id: 2, name: 'Seconde unité' }],
  });
  getRoleBundles.mockResolvedValue({ success: true, data: [LEADER] });
  getRolePermissions.mockResolvedValue({ success: true, data: [] });
  getUsers.mockResolvedValue({ success: true, data: [FIRST_UNIT_MEMBER] });
  switchActiveUnit.mockResolvedValue();
  appInstance = { lang: 'fr', userRoles: ['district'], showMessage: jest.fn(), router: { navigate: jest.fn() } };
  view = new DistrictManagement(appInstance);
  await view.init();
});

afterEach(() => {
  view?.destroy();
  jest.clearAllMocks();
});

test('choosing another unit switches the session to it before reading its members', async () => {
  getUsers.mockClear();
  getUsers.mockResolvedValue({ success: true, data: [SECOND_UNIT_MEMBER] });
  await chooseUnit('2');

  expect(switchActiveUnit).toHaveBeenCalledWith(appInstance, '2');
  expect(switchActiveUnit.mock.invocationCallOrder[0]).toBeLessThan(getUsers.mock.invocationCallOrder[0]);
  expect(clearUserCaches).toHaveBeenCalledWith('2');
  expect(select().value).toBe('2');
  expect(document.getElementById('app').textContent).toContain('Bagheera');
  expect(document.getElementById('app').textContent).not.toContain('Akela');
  expect(document.activeElement).toBe(select());
});

test('a failed switch says so and keeps showing the unit the session is still in', async () => {
  switchActiveUnit.mockRejectedValue(new Error('offline'));
  getUsers.mockClear();
  await chooseUnit('2');

  expect(appInstance.showMessage).toHaveBeenCalledWith('district_management_switch_failed', 'error');
  expect(getUsers).not.toHaveBeenCalled();
  expect(select().value).toBe('1');
  expect(select().getAttribute('aria-disabled')).toBeNull();
  expect(document.activeElement).toBe(select());
  expect(document.getElementById('app').textContent).toContain('Akela');
  expect((await axe.run(document.getElementById('app'), AXE_OPTIONS)).violations).toEqual([]);
});

test('when the new unit\'s members cannot be loaded, the previous unit\'s are not left to edit', async () => {
  getUsers.mockRejectedValue(new Error('offline'));
  // Opening the screen cached the first unit's members, as it should.
  setCachedData.mockClear();
  await chooseUnit('2');

  expect(document.getElementById('app').textContent).not.toContain('Akela');
  expect(document.getElementById('dm-load-retry')).not.toBeNull();
  expect(appInstance.showMessage).toHaveBeenCalledWith('district_management_load_error', 'error');
  expect(setCachedData).not.toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ users: [expect.objectContaining({ id: FIRST_UNIT_MEMBER.id })] }),
    expect.anything(),
  );
});

/**
 * A promise settled from the outside, for a request still under way.
 *
 * @returns {{promise: Promise, resolve: Function}} The promise and its resolver
 */
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('while the switch is under way, the previous unit\'s members cannot be opened and the selector holds', async () => {
  const pending = deferred();
  switchActiveUnit.mockReturnValue(pending.promise);
  getUsers.mockResolvedValue({ success: true, data: [SECOND_UNIT_MEMBER] });
  await chooseUnit('2');

  expect(document.getElementById('app').textContent).not.toContain('Akela');
  expect(select().getAttribute('aria-disabled')).toBe('true');
  expect(select().value).toBe('2');
  expect(document.activeElement).toBe(select());

  // A refresh asked for meanwhile reads nothing: the token may still be the old one.
  getUsers.mockClear();
  await view.refreshData(true);
  expect(getUsers).not.toHaveBeenCalled();

  // Choosing again before the first switch ends starts no second one.
  await chooseUnit('1');
  expect(switchActiveUnit).toHaveBeenCalledTimes(1);
  expect(select().value).toBe('2');

  pending.resolve();
  await flush();
  await flush();
  expect(document.getElementById('app').textContent).toContain('Bagheera');
  expect(select().getAttribute('aria-disabled')).toBeNull();
});

test('a refresh of the previous unit that answers after the switch is dropped', async () => {
  const late = deferred();
  getUsers.mockReturnValueOnce(late.promise);
  const refresh = view.refreshData(true);
  getUsers.mockResolvedValue({ success: true, data: [SECOND_UNIT_MEMBER] });
  await chooseUnit('2');
  setCachedData.mockClear();

  late.resolve({ success: true, data: [FIRST_UNIT_MEMBER] });
  await refresh;
  await flush();

  expect(document.getElementById('app').textContent).toContain('Bagheera');
  expect(document.getElementById('app').textContent).not.toContain('Akela');
  expect(setCachedData).not.toHaveBeenCalled();
});

test('the unit cannot change while a role change is being saved, and can once it is done', async () => {
  const save = deferred();
  updateUserRoleBundles.mockReturnValue(save.promise);
  getUserRoleAssignments.mockResolvedValue({ success: true, data: [LEADER] });
  view.selectedUserId = FIRST_UNIT_MEMBER.id;
  view.selectedRoleIds = new Set([LEADER.id]);
  const saving = view.handleSaveRoles();

  await chooseUnit('2');
  expect(switchActiveUnit).not.toHaveBeenCalled();
  expect(appInstance.showMessage).toHaveBeenCalledWith('district_management_switch_wait', 'info');
  expect(select().value).toBe('1');

  save.resolve({ success: true });
  await saving;
  await chooseUnit('2');
  expect(switchActiveUnit).toHaveBeenCalledWith(appInstance, '2');
});

test('a member\'s history from the previous unit that answers after the switch is dropped', async () => {
  const late = deferred();
  getRoleAuditLog.mockReturnValue(late.promise);
  const loading = view.loadAuditLog(FIRST_UNIT_MEMBER.id);
  getUsers.mockResolvedValue({ success: true, data: [SECOND_UNIT_MEMBER] });
  await chooseUnit('2');

  late.resolve({ success: true, data: [{ id: 9, note: 'unité A' }] });
  await loading;
  expect(view.auditLogByUser).toEqual({});
});

test('a unit where the person cannot see roles sends them to the dashboard', async () => {
  switchActiveUnit.mockImplementation(() => {
    canViewRoles.mockReturnValue(false);
    return Promise.resolve();
  });
  getUsers.mockClear();
  await chooseUnit('2');

  expect(appInstance.router.navigate).toHaveBeenCalledWith('/dashboard');
  expect(getUsers).not.toHaveBeenCalled();
});

test('choosing the unit already shown changes nothing', async () => {
  await chooseUnit('1');
  expect(switchActiveUnit).not.toHaveBeenCalled();
});
