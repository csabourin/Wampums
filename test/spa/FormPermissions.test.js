/**
 * @jest-environment jsdom
 */

import axe from 'axe-core';

const mockApiGet = jest.fn();
const mockApiPut = jest.fn();

jest.mock('../../spa/api/api-core.js', () => ({
  API: {
    get: (...args) => mockApiGet(...args),
    put: (...args) => mockApiPut(...args)
  }
}));

jest.mock('../../spa/app.js', () => ({
  translate: (key) => key
}));

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugError: jest.fn(),
  debugLog: jest.fn()
}));

const mockPermissions = new Set(['forms.manage']);
jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  hasPermission: jest.fn((key) => mockPermissions.has(key))
}));

jest.mock('../../spa/utils/DOMUtils.js', () => ({
  setContent: (element, html) => {
    // eslint-disable-next-line no-param-reassign
    element.innerHTML = html;
  }
}));

import { FormPermissionsManager } from '../../spa/modules/forms/FormPermissions.js';

const PERMISSION_ROW = {
  form_format_id: 41,
  form_type: 'registration',
  display_name: 'Registration',
  display_context: ['participant'],
  role_id: 7,
  role_name: 'parent',
  role_display_name: 'Parent',
  can_view: false,
  can_submit: false,
  can_edit: false,
  can_approve: false
};

let app;
let manager;

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  jest.clearAllMocks();
  app = {
    showMessage: jest.fn(),
    renderError: jest.fn()
  };
  manager = new FormPermissionsManager(app);
  mockPermissions.clear();
  mockPermissions.add('forms.manage');
});

test('opens for forms.manage, whatever the role is called', async () => {
  mockApiGet.mockResolvedValue({ success: true, data: [] });

  await manager.init();

  expect(app.renderError).not.toHaveBeenCalled();
  expect(mockApiGet).toHaveBeenCalled();
});

test('without forms.manage the screen refuses and asks the server for nothing', async () => {
  mockPermissions.clear();

  await manager.init();

  expect(app.renderError).toHaveBeenCalledWith('access_denied');
  expect(mockApiGet).not.toHaveBeenCalled();
});

test('always refreshes the mutable permissions matrix and replaces stale dimensions', async () => {
  manager.formTypes.add('deleted_form');
  manager.roles.add('deleted_role');
  mockApiGet.mockResolvedValue({ success: true, data: [{ ...PERMISSION_ROW }] });

  await manager.loadPermissions();

  expect(mockApiGet).toHaveBeenCalledWith(
    'v1/forms/form-permissions',
    {},
    { forceRefresh: true }
  );
  expect([...manager.formTypes]).toEqual(['registration']);
  expect([...manager.roles]).toEqual(['parent']);
});

test('keeps the confirmed permission values in memory after a save', async () => {
  manager.permissions = [{ ...PERMISSION_ROW }];
  mockApiPut.mockResolvedValue({ success: true, data: { id: 99 } });

  const saved = await manager.updatePermission(41, 7, {
    can_view: true,
    can_submit: true,
    can_edit: false,
    can_approve: false
  });

  expect(saved).toBe(true);
  expect(manager.permissions[0]).toMatchObject({
    can_view: true,
    can_submit: true,
    can_edit: false,
    can_approve: false
  });
  expect(app.showMessage).toHaveBeenCalledWith('permissions_updated', 'success');
});

test('refreshes the page with current form IDs after a stale form returns 404', async () => {
  const notFound = new Error('Form not found');
  notFound.status = 404;
  mockApiPut.mockRejectedValue(notFound);
  mockApiGet.mockResolvedValue({
    success: true,
    data: [{ ...PERMISSION_ROW, form_format_id: 84 }]
  });

  const saved = await manager.updatePermission(41, 7, {
    can_view: true,
    can_submit: false,
    can_edit: false,
    can_approve: false
  });

  expect(saved).toBe(false);
  expect(app.showMessage).toHaveBeenCalledWith('form_not_found', 'error');
  expect(mockApiGet).toHaveBeenCalledWith(
    'v1/forms/form-permissions',
    {},
    { forceRefresh: true }
  );
  expect(document.querySelector('.permission-checkbox').dataset.formFormatId).toBe('84');
});

test('locks a role row while its complete permission snapshot is saving', async () => {
  let resolveSave;
  const pendingSave = new Promise(resolve => {
    resolveSave = resolve;
  });
  mockApiPut.mockReturnValue(pendingSave);
  manager.permissions = [{ ...PERMISSION_ROW }];
  manager.formTypes.add(PERMISSION_ROW.form_type);
  manager.roles.add(PERMISSION_ROW.role_name);
  manager.render();
  manager.attachEventListeners();

  const canView = document.querySelector('[data-permission="can_view"]');
  const row = canView.closest('tr');
  canView.checked = true;
  canView.dispatchEvent(new Event('change', { bubbles: true }));

  expect([...row.querySelectorAll('.permission-checkbox')].every(input => input.disabled)).toBe(true);
  expect(row.getAttribute('aria-busy')).toBe('true');

  resolveSave({ success: true, data: { id: 99 } });
  await pendingSave;
  await Promise.resolve();

  expect(mockApiPut).toHaveBeenCalledWith('v1/forms/form-permissions', {
    form_format_id: 41,
    role_id: 7,
    can_view: true,
    can_submit: false,
    can_edit: false,
    can_approve: false
  });
  expect([...row.querySelectorAll('.permission-checkbox')].every(input => !input.disabled)).toBe(true);
  expect(row.hasAttribute('aria-busy')).toBe(false);
});

describe('built-in roles the unit replaced and hid', () => {
  const LEADER_ROW = { ...PERMISSION_ROW, role_id: 3, role_name: 'leader', role_display_name: 'Leader', role_hidden: true, can_view: true };
  const roleRows = () => [...document.querySelectorAll('.permissions-table tbody tr')]
    .map((row) => row.querySelector('th').textContent.trim().split(/\s+/)[0]);

  test('are folded away, and a switch shows them again with their rights', async () => {
    mockApiGet.mockResolvedValue({ success: true, data: [PERMISSION_ROW, LEADER_ROW] });
    await manager.init();
    expect(roleRows()).toEqual(['Parent']);

    const toggle = document.getElementById('form-permissions-show-hidden');
    expect(toggle.closest('label').textContent).toContain('form_permissions_show_hidden_roles');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));

    expect(roleRows()).toEqual(['Leader', 'Parent']);
    expect(document.querySelector('.permissions-table tbody tr th').textContent).toContain('role_hidden_badge');
    expect(document.querySelector('.permission-checkbox[data-role-id="3"][data-permission="can_view"]').checked).toBe(true);
    expect(document.activeElement).toBe(document.getElementById('form-permissions-show-hidden'));
    const results = await axe.run(document.getElementById('app'), {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });

  test('without any hidden role, no switch is shown', async () => {
    mockApiGet.mockResolvedValue({ success: true, data: [PERMISSION_ROW] });
    await manager.init();
    expect(document.getElementById('form-permissions-show-hidden')).toBeNull();
  });

  test('every right is a labelled checkbox naming the role', async () => {
    mockApiGet.mockResolvedValue({ success: true, data: [{ ...PERMISSION_ROW, role_display_name: '<img src=x onerror=alert(1)>', role_name: 'u1_x' }] });
    await manager.init();
    expect(document.querySelector('#app img')).toBeNull();
    const box = document.querySelector('.permission-checkbox[data-permission="can_edit"]');
    expect(box.getAttribute('aria-label')).toBe('can_edit — <img src=x onerror=alert(1)>');
  });

  test('mounted as a tab, the screen draws neither its own heading nor a way back', async () => {
    document.body.innerHTML = '<div id="app"><div id="tab-mount"></div></div>';
    mockApiGet.mockResolvedValue({ success: true, data: [PERMISSION_ROW] });
    await new FormPermissionsManager(app, { containerId: 'tab-mount', embedded: true }).init();
    const mount = document.getElementById('tab-mount');
    expect(mount.querySelector('h1')).toBeNull();
    expect(mount.querySelector('.permissions-table')).not.toBeNull();
  });
});
