/**
 * The unit's equipment catalogue (/api/v1/equipment-catalog).
 *
 * Held here: reading it takes the catalogue or meeting-planning right, and
 * changing it the catalogue right; demo accounts cannot change it; malformed
 * input is refused before any write; every query keeps to the unit of the
 * token; a duplicate name, another unit's article and equipment the unit may
 * not use are refused with the field at fault; database details never leak.
 *
 * @module test/routes-equipment-catalog
 */
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { authorizationContextRow } = require('./mock-helpers');

process.env.JWT_SECRET_KEY = 'equipment-catalog-route-secret';
const USER = '00000000-0000-4000-8000-000000000001';
const UNIT = 7;
const ARTICLE = {
  id: 3, name: 'Tente 4 places', category: 'camping', unit_of_measure: 'each',
  equipment_item_id: null, archived_at: null, equipment_name: null, usage_count: '2',
};
let permissions;
let demo;
let found;
let duplicate;
let equipmentVisible;
let failInsert;
const db = {
  query: jest.fn((sql, params) => {
    if (sql.includes('AS authorization_permissions')) {
      return authorizationContextRow({ permissions, roles: [{ role_name: demo ? 'demoadmin' : 'u7_quartermaster', display_name: 'Quartermaster', data_scope: 'organization' }] });
    }
    if (sql.includes('SELECT organization_id FROM user_organizations')) {return { rows: [{ organization_id: UNIT }] };}
    if (sql.includes('FROM equipment_items ei') && sql.includes('equipment_item_organizations')) {
      return { rows: equipmentVisible ? params[1].map((id) => ({ id })) : [] };
    }
    if (sql.includes('INSERT INTO equipment_catalog_items')) {
      if (failInsert) {throw new Error('relation "equipment_catalog_items" violates something internal');}
      if (duplicate) {throw Object.assign(new Error('duplicate key value'), { code: '23505' });}
      return { rows: [{ id: 3 }] };
    }
    if (sql.includes('UPDATE equipment_catalog_items')) {
      if (duplicate) {throw Object.assign(new Error('duplicate key value'), { code: '23505' });}
      return { rows: found ? [{ id: 3 }] : [] };
    }
    if (sql.includes('FROM equipment_catalog_items c')) {return { rows: found ? [ARTICLE] : [] };}
    return { rows: [] };
  }),
};
const pool = { query: db.query, connect: jest.fn() };
const app = express();
app.locals.pool = pool;
app.use(express.json());
app.use('/api/v1/equipment-catalog', require('../routes/equipmentCatalog')(pool));
app.use((err, req, res, _next) => res.status(500).json({ success: false, message: 'internal_server_error' }));
const token = () => jwt.sign({ user_id: USER, organizationId: UNIT }, process.env.JWT_SECRET_KEY);
const article = { name: 'Tente 4 places', category: 'camping', unit_of_measure: 'each' };
const auth = (req) => req.set('Authorization', `Bearer ${token()}`);

/** @returns {Array} The calls that wrote the catalogue */
const writes = () => db.query.mock.calls.filter(([sql]) => /INSERT INTO equipment_catalog_items|UPDATE equipment_catalog_items/.test(sql));

beforeEach(() => {
  permissions = ['equipment_catalog.manage'];
  demo = false; found = true; duplicate = false; equipmentVisible = true; failInsert = false;
  jest.clearAllMocks();
});

test.each([['get', ''], ['post', ''], ['patch', '/3']])('%s %s requires authentication', async (method, path) => {
  expect((await request(app)[method](`/api/v1/equipment-catalog${path}`).send(article)).status).toBe(401);
});

test('a leader who plans meetings may read the catalogue to pick articles', async () => {
  permissions = ['meetings.manage'];
  const res = await auth(request(app).get('/api/v1/equipment-catalog'));
  expect(res.status).toBe(200);
  expect(res.body.data).toEqual([expect.objectContaining({ id: 3, name: 'Tente 4 places', archived: false, usage_count: 2 })]);
});

test('someone without the catalogue or planning right cannot read it', async () => {
  permissions = ['inventory.view'];
  const res = await auth(request(app).get('/api/v1/equipment-catalog'));
  expect(res.status).toBe(403);
  expect(res.body.required).toEqual(expect.arrayContaining(['equipment_catalog.manage', 'meetings.manage']));
});

test('a leader who plans meetings cannot change the catalogue', async () => {
  permissions = ['meetings.manage'];
  const res = await auth(request(app).post('/api/v1/equipment-catalog')).send(article);
  expect(res.status).toBe(403);
  expect(res.body).toMatchObject({ required: ['equipment_catalog.manage'], missing: ['equipment_catalog.manage'] });
  expect(writes()).toHaveLength(0);
});

test('the catalogue is read for the unit of the token, whatever the request names', async () => {
  await auth(request(app).get('/api/v1/equipment-catalog?organization_id=99')).set('x-organization-id', '99');
  const list = db.query.mock.calls.find(([sql]) => sql.includes('FROM equipment_catalog_items c'));
  expect(list[0]).toContain('c.organization_id = $1');
  expect(list[1]).toEqual([UNIT, false]);
});

test('archived articles are listed only when asked for', async () => {
  await auth(request(app).get('/api/v1/equipment-catalog?include_archived=true'));
  const list = db.query.mock.calls.find(([sql]) => sql.includes('FROM equipment_catalog_items c'));
  expect(list[1]).toEqual([UNIT, true]);
});

test('an article is created in the unit of the token, with its trimmed name', async () => {
  const res = await auth(request(app).post('/api/v1/equipment-catalog')).send({ ...article, name: '  Tente 4 places ', organization_id: 99 });
  expect(res.status).toBe(201);
  const [, params] = writes()[0];
  expect(params).toEqual([UNIT, 'Tente 4 places', 'camping', 'each', null, USER]);
});

test.each([['post', ''], ['patch', '/3']])('demo accounts cannot %s the catalogue', async (method, path) => {
  demo = true;
  const res = await auth(request(app)[method](`/api/v1/equipment-catalog${path}`)).send(article);
  expect(res.status).toBe(403);
  expect(res.body.isDemo).toBe(true);
  expect(writes()).toHaveLength(0);
});

test.each([
  { ...article, name: '' }, { ...article, name: '   ' }, { ...article, name: ['Tente'] },
  { ...article, name: 'x'.repeat(151) }, { category: 'camping' },
  { ...article, category: 'weapons' }, { ...article, unit_of_measure: 'gallon' },
  { ...article, equipment_item_id: '12abc' }, { ...article, equipment_item_id: 3000000000 },
  { ...article, equipment_item_id: [4] },
])('a malformed article %j is refused before any write', async (data) => {
  const res = await auth(request(app).post('/api/v1/equipment-catalog')).send(data);
  expect(res.status).toBe(400);
  expect(writes()).toHaveLength(0);
});

test.each([
  ['/abc', { name: 'Tente' }], ['/12abc', { name: 'Tente' }], ['/3', { archived: 'yes' }], ['/3', { archived: [true] }],
])('a malformed change %s %j is refused before any write', async (path, data) => {
  const res = await auth(request(app).patch(`/api/v1/equipment-catalog${path}`)).send(data);
  expect(res.status).toBe(400);
  expect(writes()).toHaveLength(0);
});

test('a second active article with the same name is refused on the name field', async () => {
  duplicate = true;
  const res = await auth(request(app).post('/api/v1/equipment-catalog')).send(article);
  expect(res.status).toBe(409);
  expect(res.body.message).toBe('equipment_catalog_duplicate_name');
  expect(res.body.errors[0].path).toBe('name');
});

test('an article cannot be linked to equipment the unit may not use', async () => {
  equipmentVisible = false;
  const res = await auth(request(app).post('/api/v1/equipment-catalog')).send({ ...article, equipment_item_id: 44 });
  expect(res.status).toBe(400);
  expect(res.body.message).toBe('equipment_catalog_equipment_unavailable');
  expect(res.body.errors[0].path).toBe('equipment_item_id');
  expect(writes()).toHaveLength(0);
});

test('another unit\'s article is not found, and the update keeps to the unit of the token', async () => {
  found = false;
  const res = await auth(request(app).patch('/api/v1/equipment-catalog/3')).send({ name: 'Bâche' });
  expect(res.status).toBe(404);
  const [sql, params] = writes()[0];
  expect(sql).toContain('WHERE organization_id = $1 AND id = $2');
  expect(params.slice(0, 2)).toEqual([UNIT, 3]);
});

test('archiving changes only the archive mark', async () => {
  const res = await auth(request(app).patch('/api/v1/equipment-catalog/3')).send({ archived: true });
  expect(res.status).toBe(200);
  const [, params] = writes()[0];
  // name, category, unit and link are each marked unchanged.
  expect([params[2], params[4], params[6], params[8]]).toEqual([false, false, false, false]);
  expect(params[10]).toBe(true);
});

test('a database failure answers a generic error without its detail', async () => {
  failInsert = true;
  const res = await auth(request(app).post('/api/v1/equipment-catalog')).send(article);
  expect(res.status).toBe(500);
  expect(JSON.stringify(res.body)).not.toContain('equipment_catalog_items');
});

test('what a line may list is the unit\'s articles and the inventory no article stands for', async () => {
  permissions = ['meetings.manage'];
  const linked = { ...ARTICLE, equipment_item_id: 44 };
  const base = db.query.getMockImplementation();
  db.query.mockImplementation((sql, params) => {
    if (sql.includes('FROM equipment_catalog_items c')) {return { rows: [linked] };}
    if (sql.includes('SELECT DISTINCT ei.id')) {return { rows: [{ id: 44 }, { id: 45 }] };}
    if (sql.includes('SELECT id, name, category FROM equipment_items')) {
      return { rows: params[0].map((id) => ({ id, name: `Item ${id}`, category: null })) };
    }
    return base(sql, params);
  });
  try {
    const res = await auth(request(app).get('/api/v1/equipment-catalog/options'));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      articles: [{ id: 3, name: 'Tente 4 places', category: 'camping', unit_of_measure: 'each' }],
      equipment: [{ id: 45, name: 'Item 45', category: 'other', unit_of_measure: 'each' }],
    });
  } finally {
    db.query.mockImplementation(base);
  }
});

test('someone who neither plans meetings nor manages the catalogue gets no material list', async () => {
  permissions = ['inventory.view'];
  const res = await auth(request(app).get('/api/v1/equipment-catalog/options'));
  expect(res.status).toBe(403);
});

test.each([['post', '', { ...article, stock: { quantity_total: 1 } }], ['patch', '/3', { sync_stock: true }]])('catalogue permission alone cannot %s physical stock', async (method, path, payload) => {
  const res = await auth(request(app)[method](`/api/v1/equipment-catalog${path}`)).send(payload);
  expect(res.status).toBe(403);
  expect(res.body.missing).toContain('inventory.manage');
  expect(pool.connect).not.toHaveBeenCalled(); expect(writes()).toHaveLength(0);
});
test.each([{ quantity_total: -1 }, { quantity_total: 1.5 }, { quantity_total: '1' }, []])('malformed stock cannot partially create an article: %j', async (stock) => {
  permissions = ['equipment_catalog.manage', 'inventory.manage'];
  expect((await auth(request(app).post('/api/v1/equipment-catalog')).send({ ...article, stock })).status).toBe(400);
  expect(pool.connect).not.toHaveBeenCalled(); expect(writes()).toHaveLength(0);
});
