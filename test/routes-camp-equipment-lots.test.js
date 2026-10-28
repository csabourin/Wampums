const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { authorizationContextRow } = require('./mock-helpers');
const { readRoles } = require('../services/campEquipmentLots');
process.env.JWT_SECRET_KEY = 'fictional-camp-lots-route-tests';
const USER = '00000000-0000-4000-8000-000000000001';
let permissions;
let demo;
const db = { query: jest.fn((sql) => {
  if (sql.includes('AS authorization_permissions')) {
    return authorizationContextRow({ permissions, roles: [{ role_name: demo ? 'demoadmin' : 'custom_lot_helper', display_name: 'Equipment helper', data_scope: 'organization' }] });
  }
  if (sql.includes('SELECT organization_id FROM user_organizations')) {return { rows: [{ organization_id: 7 }] };}
  return { rows: [] };
}), release: jest.fn() };
const pool = { query: db.query, connect: jest.fn(() => Promise.resolve(db)) };
const app = express(); app.locals.pool = pool; app.use(express.json());
app.use('/api/v1/camp-equipment-lots', require('../routes/camp-equipment-lots')(pool));
app.use((err, _req, res, _next) => res.status(500).json({ success: false, message: 'internal_server_error' }));
const paths = [['get', '/mine'], ['get', '/meetings/4'], ['get', '/meetings/4/options'], ['post', '/meetings/4'], ['put', '/meetings/4/3'], ['patch', '/3/status'], ['patch', '/mine/3/status']];
const token = () => jwt.sign({ user_id: USER, organizationId: 7 }, process.env.JWT_SECRET_KEY);
const call = (method, path) => request(app)[method](`/api/v1/camp-equipment-lots${path}`).set('Authorization', `Bearer ${token()}`);
const assignment = { name: 'Kitchen', creation_key: '00000000-0000-4000-8000-000000000002', items: [{ catalog_item_id: 2, quantity: 1 }], roles: [{ role: 'prepare', user_id: USER }], expected_version: 1 };
const state = { status: 'loaded', expected_version: 1, mutation_id: '00000000-0000-4000-8000-000000000003' };
beforeEach(() => {jest.clearAllMocks(); permissions = ['camp_lots.view', 'camp_lots.manage', 'tasks.view', 'tasks.manage']; demo = false;});
test.each(paths)('%s %s requires authentication', async (method, path) => {
  expect((await request(app)[method](`/api/v1/camp-equipment-lots${path}`).send(assignment)).status).toBe(401);
});
test('a task helper cannot read or manage all camp equipment lots', async () => {
  permissions = ['tasks.view'];
  for (const [method, path] of paths.filter(([, path]) => !path.startsWith('/mine'))) {
    // eslint-disable-next-line no-await-in-loop -- check each route's independent permission denial
    const response = await call(method, path).send(assignment);
    expect(response.status).toBe(403);
    expect(response.body.required.length).toBeGreaterThan(0);
    expect(response.body.missing.length).toBeGreaterThan(0);
  }
});
test('personal lots always use the authenticated account and unit', async () => {
  permissions = ['tasks.view'];
  const response = await call('get', '/mine?organization_id=99&assignee_id=other');
  expect(response.status).toBe(200);
  expect(db.query).toHaveBeenCalledWith(expect.stringContaining('t.assignee_id = $3'), [7, null, USER]);
});
test.each(paths.filter(([method]) => method !== 'get'))('demo accounts cannot %s %s', async (method, path) => {
  demo = true;
  const response = await call(method, path).send(method === 'patch' ? state : assignment);
  expect(response.status).toBe(403); expect(response.body.isDemo).toBe(true);
  expect(pool.connect).not.toHaveBeenCalled();
});
test.each([
  { ...assignment, name: '' }, { ...assignment, name: [] }, { ...assignment, creation_key: ['00000000-0000-4000-8000-000000000002'] },
  { ...assignment, items: [] }, { ...assignment, items: [{ catalog_item_id: 2, quantity: -1 }] },
  { ...assignment, items: [{ catalog_item_id: 2, equipment_item_id: 2, quantity: 1 }] },
  { ...assignment, roles: [{ role: 'unknown', user_id: USER }] },
  { ...assignment, roles: [{ role: 'prepare', user_id: USER }, { role: 'prepare', user_id: USER }] },
])('invalid lot contents are refused before opening a transaction', async (data) => {
  expect((await call('post', '/meetings/4').send(data)).status).toBe(400);
  expect(pool.connect).not.toHaveBeenCalled();
});
test.each(['12abc', '0', '3000000000'])('malformed lot id %s never reaches a transaction', async (id) => {
  expect((await call('patch', `/${id}/status`).send(state)).status).toBe(400);
  expect(pool.connect).not.toHaveBeenCalled();
});
test.each([{ ...state, status: ['loaded'] }, { ...state, expected_version: [1] }, { ...state, mutation_id: 'wrong' }])('invalid status payloads never reach a transaction', async (data) => {
  expect((await call('patch', '/3/status').send(data)).status).toBe(400);
  expect(pool.connect).not.toHaveBeenCalled();
});
test('a camp outside this unit is missing and writes roll back', async () => {
  expect((await call('post', '/meetings/4').send(assignment)).status).toBe(404);
  expect(db.query).toHaveBeenCalledWith('ROLLBACK');
  expect(db.release).toHaveBeenCalled();
});
test('the preparation role is required and each role has only one assignee', () => {
  expect(readRoles([{ role: 'return', user_id: USER }])).toBeNull();
  expect(readRoles([{ role: 'prepare', user_id: USER }, { role: 'prepare', user_id: USER }])).toBeNull();
  expect(readRoles([{ role: 'prepare', user_id: USER }, { role: 'transport', user_id: USER }])).toHaveLength(2);
});
