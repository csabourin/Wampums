const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { authorizationContextRow } = require('./mock-helpers');
process.env.JWT_SECRET_KEY = 'packing-route-secret';
jest.mock('../middleware/auth', () => ({ ...jest.requireActual('../middleware/auth'), getScoutYear: jest.fn(() => Promise.resolve({ id: 1, status: 'active' })) }));
jest.mock('../services/personalEquipment', () => ({ ...jest.requireActual('../services/personalEquipment'), familyTasks: jest.fn(() => Promise.resolve([])), readFamilyList: jest.fn(), saveList: jest.fn(), translateList: jest.fn() }));
const { getScoutYear } = require('../middleware/auth');
const equipment = require('../services/personalEquipment');
const USER = '00000000-0000-4000-8000-000000000001';
let permissions; let demo; let scope;
const pool = { query: jest.fn((sql) => {
  if (sql.includes('SELECT organization_id FROM user_organizations')) { return { rows: [{ organization_id: 7 }] }; }
  if (sql.includes('AS authorization_permissions')) { return authorizationContextRow({ permissions, roles: [{ role_name: demo ? 'demoparent' : 'packing', data_scope: scope }] }); }
  return { rows: [] };
}) };
const app = express(); app.locals.pool = pool; app.use(express.json());
app.use('/api/v1/personal-equipment', require('../routes/personal-equipment')(pool));
const auth = () => ({ Authorization: `Bearer ${jwt.sign({ user_id: USER, organizationId: 7 }, process.env.JWT_SECRET_KEY)}` });
const input = { season: 'winter', stay_type: 'cabin', nights: 2, expected_version: 0, notes_fr: '', notes_en: '', published: true, reviewed: true, items: [{ key: 'bag', label_fr: 'Sac', label_en: '', quantity: 1 }] };
beforeEach(() => {
  jest.clearAllMocks(); permissions = ['personal_equipment.view', 'personal_equipment.manage']; demo = false; scope = 'organization';
  getScoutYear.mockResolvedValue({ id: 1, status: 'active' });
});
test.each([['get','/mine'], ['get','/4'], ['get','/4/manage'], ['put','/4'], ['post','/4/translations']])('packing lists require authentication for %s %s', async (method, path) => {
  expect((await request(app)[method](`/api/v1/personal-equipment${path}`).send(input)).status).toBe(401);
});
test('a family with read access cannot publish or inspect the management view', async () => {
  permissions = ['personal_equipment.view']; scope = 'linked';
  const res = await request(app).put('/api/v1/personal-equipment/4').set(auth()).send(input);
  expect(res.status).toBe(403); expect(res.body.required).toEqual(['personal_equipment.manage']);
  expect((await request(app).get('/api/v1/personal-equipment/4/manage').set(auth())).status).toBe(403);
});
test.each([['put','/4',input], ['post','/4/translations',{language:'es'}]])('demo accounts cannot %s %s', async (method, path, payload) => {
  demo = true;
  const res = await request(app)[method](`/api/v1/personal-equipment${path}`).set(auth()).send(payload);
  expect(res.status).toBe(403); expect(res.body.isDemo).toBe(true);
});
test.each(['12abc','2147483648','0'])('invalid camp id %s never reaches a family read', async (id) => {
  expect((await request(app).get(`/api/v1/personal-equipment/${id}`).set(auth())).status).toBe(400);
  expect(equipment.readFamilyList).not.toHaveBeenCalled();
});
test('a selected archived year refuses publishing', async () => {
  getScoutYear.mockResolvedValue({ id: 1, status: 'archived' });
  expect((await request(app).put('/api/v1/personal-equipment/4').set(auth()).send(input)).status).toBe(409);
  expect(equipment.saveList).not.toHaveBeenCalled();
});
test('translation receives only the selected language and trusted family context', async () => {
  equipment.translateList.mockResolvedValue({ items: [], notes: '' });
  const res = await request(app).post('/api/v1/personal-equipment/4/translations').set(auth()).send({ language: 'es', child: 'ignored', text: 'ignored' });
  expect(res.status).toBe(200);
  expect(equipment.translateList).toHaveBeenCalledWith(pool, { organizationId: 7, yearId: 1, userId: USER }, 4, 'es');
});
