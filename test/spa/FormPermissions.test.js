/**
 * @jest-environment jsdom
 */

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

jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  isAdmin: jest.fn(() => true)
}));

jest.mock('../../spa/utils/DOMUtils.js', () => ({
  setContent: (element, html) => {
    // eslint-disable-next-line no-param-reassign
    element.innerHTML = html;
  }
}));

import { FormPermissionsManager } from '../../spa/form_permissions.js';

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
