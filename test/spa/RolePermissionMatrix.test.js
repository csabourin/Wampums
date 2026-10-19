/** @jest-environment jsdom */
import axe from 'axe-core';
import mockEn from '../../lang/en.json';
import mockFr from '../../lang/fr.json';
let mockLanguage = 'fr';
jest.mock('../../spa/app.js', () => ({ app: {}, translate: (key) => (mockLanguage === 'en' ? mockEn : mockFr)[key] || key }));
jest.mock('../../spa/modules/session/AccessRefresh.js', () => ({ refreshAccess: jest.fn() }));
jest.mock('../../spa/config.js', () => ({ CONFIG: {}, getApiUrl: (key) => key }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({ debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn() }));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({ hasPermission: jest.fn(() => true), isDemoUser: jest.fn(() => false) }));
jest.mock('../../spa/utils/DOMUtils.js', () => ({ ...jest.requireActual('../../spa/utils/DOMUtils.js'), loadStylesheet: jest.fn(() => Promise.resolve()) }));
jest.mock('../../spa/api/api-roles.js', () => ({ getRoleMatrix: jest.fn(), replaceRolePermissions: jest.fn(), createUnitRole: jest.fn(), updateUnitRole: jest.fn(), deleteUnitRole: jest.fn() }));
jest.mock('../../spa/api/api-endpoints.js', () => ({ getUserOrganizations: jest.fn(), switchOrganization: jest.fn() }));
jest.mock('../../spa/utils/DialogUtils.js', () => ({ ...jest.requireActual('../../spa/utils/DialogUtils.js'), confirm: jest.fn(() => Promise.resolve(true)), confirmDestructive: jest.fn(() => Promise.resolve(true)) }));

import { RolePermissionMatrix } from '../../spa/modules/roles/RolePermissionMatrix.js';
import { getRoleMatrix, replaceRolePermissions, createUnitRole, updateUnitRole, deleteUnitRole } from '../../spa/api/api-roles.js';
import { getUserOrganizations, switchOrganization } from '../../spa/api/api-endpoints.js';
import { confirm, confirmDestructive } from '../../spa/utils/DialogUtils.js';
import { hasPermission, isDemoUser } from '../../spa/utils/PermissionUtils.js';

const options = { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, rules: { 'color-contrast': { enabled: false } } };
const permissions = [
  { id: 1, permission_key: 'points.view', category: 'points' },
  { id: 2, permission_key: 'points.manage', category: 'points' },
  { id: 3, permission_key: 'finance.view', category: 'finance' },
];
const role = { id: 20, role_name: 'u3_custom', display_name: 'Équipe', description: 'Organisation', data_scope: 'organization', permission_ids: [], can_copy: true,
  cells: [{ permission_id: 1, reason: null }, { permission_id: 2, reason: null, required_view: 'points.view' }, { permission_id: 3, reason: 'not_held' }] };
const system = { ...role, id: 1, role_name: 'leader', display_name: 'Leader', is_system_role: true, can_copy: false,
  cells: permissions.map((p) => ({ permission_id: p.id, reason: 'system_role' })) };
const matrix = () => ({ data: { organization_id: 3, permissions, roles: [structuredClone(role), structuredClone(system)] } });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const box = (id, prefix = 'mobile') => document.getElementById(`role-matrix-${prefix}-20-${id}`);
let screen, app;
async function open(extra = {}) { screen = new RolePermissionMatrix(app, extra); await screen.init(); return screen; }

beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main>';
  jest.clearAllMocks(); mockLanguage = 'fr';
  app = { showMessage: jest.fn(), router: { navigate: jest.fn() }, useOrganization: jest.fn(() => Promise.resolve()) };
  getRoleMatrix.mockResolvedValue(matrix());
  getUserOrganizations.mockResolvedValue({ data: [{ id: 3, name: 'Notre unité' }, { id: 4, name: 'Autre unité' }] });
  replaceRolePermissions.mockResolvedValue({ success: true });
  createUnitRole.mockResolvedValue({ data: { id: 21 } }); updateUnitRole.mockResolvedValue({ success: true }); deleteUnitRole.mockResolvedValue({ success: true });
  confirm.mockResolvedValue(true); confirmDestructive.mockResolvedValue(true);
  hasPermission.mockReturnValue(true); isDemoUser.mockReturnValue(false);
});
afterEach(() => { screen?.destroy(); screen = null; localStorage.clear(); });

test('the mobile role picker and desktop table use labelled native controls and pass axe', async () => {
  await open();
  expect(document.querySelector('.role-matrix-mobile select')).not.toBeNull();
  expect(document.querySelector('.role-matrix-desktop table th[scope="col"]')).not.toBeNull();
  expect(document.querySelectorAll('input[type="checkbox"]')).toHaveLength(9);
  expect((await axe.run(document.getElementById('app'), options)).violations).toEqual([]);
});
test('Manage selects View in both views, locks it with a written reason and announces the change', async () => {
  await open(); box(2).click();
  expect(box(1).checked).toBe(true); expect(box(1, 'table').checked).toBe(true);
  expect(box(1).disabled).toBe(true);
  expect(document.getElementById(box(1).getAttribute('aria-describedby')).textContent).toContain(mockFr.role_matrix_lock_view_required);
  expect(document.getElementById('role-matrix-live').textContent).toBe(mockFr.role_matrix_view_added);
  expect(document.getElementById('role-matrix-changes').textContent).toContain('2');
  box(2).click(); expect(box(1).disabled).toBe(false);
});
test('changing the selected role keeps local changes and the selector focus', async () => {
  await open(); box(2).click();
  const picker = document.getElementById('role-matrix-role'); picker.value = '1'; picker.dispatchEvent(new Event('change'));
  expect(screen.pending.size).toBe(1);
  expect(document.activeElement.id).toBe('role-matrix-role');
  const next = document.getElementById('role-matrix-role'); next.value = '20'; next.dispatchEvent(new Event('change'));
  expect(box(2).checked).toBe(true);
});
test('saving sends one request per changed role and includes its original permissions', async () => {
  await open(); box(2).click();
  await screen.save(document.getElementById('role-matrix-save-form'));
  expect(replaceRolePermissions).toHaveBeenCalledTimes(1);
  expect(replaceRolePermissions).toHaveBeenCalledWith(20, [1, 2], []);
  expect(screen.pending.size).toBe(0);
  expect(app.showMessage).toHaveBeenCalledWith(mockFr.role_matrix_saved, 'success');
});
test('a failed save keeps local edits and does not report success', async () => {
  await open(); box(2).click(); replaceRolePermissions.mockRejectedValue(Object.assign(new Error('server details'), { status: 409 }));
  await screen.save(document.getElementById('role-matrix-save-form'));
  expect(screen.pending.size).toBe(1); expect(box(2).checked).toBe(true);
  expect(app.showMessage).toHaveBeenCalledWith(expect.any(String), 'error');
  expect(document.body.textContent).not.toContain('server details');
});
test('a second submit is ignored while the first is being saved', async () => {
  await open(); box(1).click();
  let finish; replaceRolePermissions.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const first = screen.save(document.getElementById('role-matrix-save-form'));
  await screen.save(document.getElementById('role-matrix-save-form'));
  expect(replaceRolePermissions).toHaveBeenCalledTimes(1);
  finish({ success: true }); await first;
});
test('role names containing HTML remain text in table headers, selectors and modals', async () => {
  const response = matrix(); response.data.roles[0].display_name = '<img src=x onerror=alert(1)>';
  getRoleMatrix.mockResolvedValue(response); await open();
  expect(document.body.querySelector('img')).toBeNull();
  expect(document.getElementById('role-matrix-role').textContent).toContain('<img src=x onerror=alert(1)>');
  await screen.editRole(screen.roles[0]);
  expect(document.getElementById('role-matrix-name').value).toBe('<img src=x onerror=alert(1)>');
  expect(document.querySelector('.modal-dialog img')).toBeNull();
});
test('loading, a retryable failure and an empty catalog are distinct states', async () => {
  let finish; getRoleMatrix.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  screen = new RolePermissionMatrix(app); const initializing = screen.init(); await flush();
  expect(document.querySelector('[role="status"]').textContent).toBe(mockFr.loading);
  finish(matrix()); await initializing;
  getRoleMatrix.mockRejectedValue(new Error('offline')); await screen.reload();
  expect(document.querySelector('[role="alert"]')).not.toBeNull(); expect(document.getElementById('role-matrix-retry')).not.toBeNull();
  getRoleMatrix.mockResolvedValue({ data: { organization_id: 3, roles: [], permissions: [] } });
  document.getElementById('role-matrix-retry').click(); await flush();
  expect(document.body.textContent).toContain(mockFr.role_matrix_empty);
});
test('dirty navigation asks before leaving, and live refresh leaves local work intact', async () => {
  await open(); box(1).click(); confirm.mockResolvedValue(false);
  expect(await screen.beforeLeave()).toBe(false);
  expect(await screen.beforeLeave({ refresh: true })).toBe(false);
  expect(confirm).toHaveBeenCalledTimes(1); expect(screen.pending.size).toBe(1);
});
test('copying a built-in role submits the source and explicit member transfer choice', async () => {
  await open(); await screen.editRole(screen.roles[1], true);
  const form = document.getElementById('role-matrix-definition');
  form.querySelector('input[name="reassign_members"]').click();
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush(); await flush();
  expect(createUnitRole).toHaveBeenCalledWith(expect.objectContaining({ base_role_id: 1, reassign_members: true, data_scope: 'organization' }));
});
test('editing changes metadata without sending the internal role key', async () => {
  await open(); await screen.editRole(screen.roles[0]);
  const form = document.getElementById('role-matrix-definition'); form.querySelector('[name="display_name"]').value = 'Coordination';
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush(); await flush();
  expect(updateUnitRole).toHaveBeenCalledWith(20, { display_name: 'Coordination', description: 'Organisation', data_scope: 'organization' });
});
test('Escape closes a modal and restores keyboard focus to its opener, and the modal passes axe', async () => {
  await open(); const opener = document.getElementById('role-matrix-create'); opener.focus(); opener.click(); await flush();
  expect(document.querySelector('.modal-dialog').contains(document.activeElement)).toBe(true);
  expect((await axe.run(document.querySelector('.modal-dialog'), options)).violations).toEqual([]);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(document.querySelector('.modal-dialog')).toBeNull(); expect(document.activeElement).toBe(opener);
});
test('deleting requires the destructive confirmation and a refusal leaves the role alone', async () => {
  await open(); confirmDestructive.mockResolvedValue(false); await screen.removeRole(screen.roles[0]);
  expect(deleteUnitRole).not.toHaveBeenCalled();
});
test('the district selector switches authenticated context before loading any target-unit data', async () => {
  await open({ district: true });
  const token = `${btoa('{}')}.${btoa(JSON.stringify({ permissions: ['roles.manage', 'roles.manage_district'], roleIds: [1], roleNames: ['district'] }))}.x`;
  switchOrganization.mockResolvedValue({ data: { token } }); getRoleMatrix.mockClear();
  await screen.changeUnit(4);
  expect(switchOrganization).toHaveBeenCalledWith(4); expect(localStorage.getItem('jwtToken')).toBe(token);
  expect(getRoleMatrix).toHaveBeenCalledWith();
  expect(switchOrganization.mock.invocationCallOrder[0]).toBeLessThan(getRoleMatrix.mock.invocationCallOrder[0]);
});
test('after a district switch, the app holds the chosen unit and its settings before the matrix reloads', async () => {
  await open({ district: true });
  const token = `${btoa('{}')}.${btoa(JSON.stringify({ permissions: ['roles.manage', 'roles.manage_district'], roleIds: [1], roleNames: ['district'] }))}.x`;
  switchOrganization.mockResolvedValue({ data: { token } }); getRoleMatrix.mockClear();
  await screen.changeUnit(4);
  expect(app.useOrganization).toHaveBeenCalledWith(4);
  expect(app.useOrganization.mock.invocationCallOrder[0]).toBeLessThan(getRoleMatrix.mock.invocationCallOrder[0]);
});
test('a failed district switch leaves the app on its current unit', async () => {
  await open({ district: true });
  switchOrganization.mockRejectedValue(new Error('offline'));
  await screen.changeUnit(4);
  expect(app.useOrganization).not.toHaveBeenCalled();
});
test('a cancelled district switch preserves the active unit and pending permissions', async () => {
  await open({ district: true }); box(1).click(); confirm.mockResolvedValue(false);
  await screen.changeUnit(4);
  expect(switchOrganization).not.toHaveBeenCalled(); expect(screen.pending.size).toBe(1);
});
test('a failed district switch restores the displayed unit and unlocks the preserved edits', async () => {
  await open({ district: true }); box(1).click();
  switchOrganization.mockRejectedValue(new Error('offline'));
  document.getElementById('role-matrix-unit').value = '4';
  await screen.changeUnit(4);
  expect(document.getElementById('role-matrix-unit').value).toBe('3');
  expect(screen.pending.size).toBe(1); expect(box(1).checked).toBe(true);
  expect(box(1).disabled).toBe(false);
});
test.each(['en', 'fr'])('the screen has no untranslated permission or lock keys in %s', async (language) => {
  mockLanguage = language; await open();
  expect(document.body.textContent).not.toMatch(/role_(?:matrix|permission|category)_[a-z_]+/);
});
test('a late response never paints over the next screen', async () => {
  let finish; getRoleMatrix.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  screen = new RolePermissionMatrix(app); const initializing = screen.init(); await flush(); screen.destroy();
  document.getElementById('app').textContent = 'Next screen'; finish(matrix()); await initializing;
  expect(document.getElementById('app').textContent).toBe('Next screen');
});
