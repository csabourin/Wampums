/** Policy boundaries are identical for single-cell and full-role writes. */
const express = require('express');
const request = require('supertest');
process.env.JWT_SECRET_KEY ||= 'matrix-route-test-secret';
const { checkPermissionChange, permissionLockReason } = require('../services/roleAssignment');
const catalog = [
  { id: 1, permission_key: 'points.view' },
  { id: 2, permission_key: 'points.manage' },
  { id: 3, permission_key: 'finance.view' },
  { id: 4, permission_key: 'participants.create_own', self_scoped: true },
  { id: 5, permission_key: 'roles.manage_district', district_only: true },
];
const role = { is_system_role: false, data_scope: 'organization' };
const check = (overrides = {}) => checkPermissionChange({ role, catalog, currentKeys: [], requestedKeys: [], heldPermissions: [], ...overrides });

test('a missing View is a conflict even when the grantor holds Manage', () => {
  expect(check({ requestedKeys: ['points.manage'], heldPermissions: ['points.manage'] }).status).toBe(409);
});
test('a grantor must hold both keys of the Manage and View pair', () => {
  expect(check({ requestedKeys: ['points.manage', 'points.view'], heldPermissions: ['points.manage'] })).toMatchObject({ status: 403, missing: ['points.view'] });
});
test('retained permissions do not require the grantor to hold them', () => {
  expect(check({ currentKeys: ['finance.view'], requestedKeys: ['finance.view', 'points.view'], heldPermissions: ['points.view'] })).toBeNull();
});
test('removing a permission requires the same authority as adding it', () => {
  expect(check({ currentKeys: ['finance.view'] })).toMatchObject({ status: 403, required: ['finance.view'], missing: ['finance.view'] });
});
test('self-scoped permissions are exempt only in linked roles', () => {
  expect(check({ role: { ...role, data_scope: 'linked' }, requestedKeys: ['participants.create_own'] })).toBeNull();
  expect(check({ requestedKeys: ['participants.create_own'] }).status).toBe(403);
});
test('a newly created district permission cannot be delegated from unit management alone', () => {
  const permission = { permission_key: 'district.future', district_only: true };
  expect(check({ catalog: [...catalog, permission], requestedKeys: ['district.future'], heldPermissions: ['district.future'] })).toMatchObject({ status: 403, missing: ['roles.manage_district'] });
});
test('linked scope cannot hold unit financial access', () => {
  expect(check({ role: { ...role, data_scope: 'linked' }, requestedKeys: ['finance.view'], heldPermissions: ['finance.view'] }).status).toBe(409);
});
test('lock explanations distinguish shared roles, scope, authority and district permissions', () => {
  expect(permissionLockReason({ ...role, is_system_role: true }, catalog[0], [])).toBe('system_role');
  expect(permissionLockReason({ ...role, data_scope: 'linked' }, catalog[2], [])).toBe('linked_finance');
  expect(permissionLockReason(role, catalog[0], [])).toBe('not_held');
  expect(permissionLockReason(role, catalog[4], [])).toBe('district_only');
});

describe('role definition endpoints require authentication', () => {
  const app = express();
  app.use(express.json());
  app.use(require('../routes/roles')({ query: jest.fn() }, { error: jest.fn() }));
  test.each([
    ['get', '/api/v1/roles/matrix'], ['put', '/api/v1/roles/1/permissions'],
    ['patch', '/api/v1/roles/1'], ['post', '/api/v1/roles'],
    ['post', '/api/v1/roles/1/permissions'], ['delete', '/api/v1/roles/1/permissions/1'],
    ['delete', '/api/v1/roles/1'], ['put', '/api/v1/roles/1/visibility'],
  ])('%s %s refuses an anonymous request', async (method, url) => {
    expect((await request(app)[method](url).send({})).status).toBe(401);
  });
});
