/**
 * The camp material list route (GET /api/v1/yearly-planner/meetings/:id/material-list).
 *
 * Held here: reading it takes `meetings.view`; the inventory comparison is
 * added only for `inventory.view`; every query keeps to the unit of the
 * token; a camp the unit does not have is a 404 and a malformed id a 400;
 * database details never leak.
 *
 * @module test/routes-camp-material-list
 */
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { authorizationContextRow } = require('./mock-helpers');

process.env.JWT_SECRET_KEY = 'camp-material-list-route-secret';
const USER = '00000000-0000-4000-8000-000000000002';
const UNIT = 7;
const CAMP = { id: 42, theme: 'Camp d\'automne', meeting_kind: 'camp', activity_id: 9, date_from: '2026-11-13', date_to: '2026-11-15' };
const ENTRY = {
  meeting_activity_id: 5, catalog_item_id: 3, equipment_item_id: null, quantity: '2', article_equipment_id: 11,
  activity_name: 'Repas', day_offset: 1, name: 'Réchaud', category: 'kitchen', unit_of_measure: 'each', archived: false,
};
let permissions;
let found;
let failQuery;
let demo;
const db = {
  query: jest.fn((sql, params) => {
    if (sql.includes('AS authorization_permissions')) {
      return authorizationContextRow({ permissions, roles: [{ role_name: demo ? 'demoadmin' : 'u7_leader', display_name: 'Leader', data_scope: 'organization' }] });
    }
    if (sql.includes('SELECT organization_id FROM user_organizations')) {return { rows: [{ organization_id: UNIT }] };}
    if (failQuery) {throw new Error('relation "year_plan_meetings" is broken at /srv/app/services');}
    if (sql.includes('FROM year_plan_meetings m')) {return { rows: found ? [CAMP] : [] };}
    if (sql.includes('FROM meeting_activity_equipment mae')) {return { rows: [ENTRY] };}
    if (sql.includes('FROM equipment_items ei') && sql.includes('equipment_item_organizations')) {
      return { rows: params[1].map((id) => ({ id })) };
    }
    if (sql.includes('AS free_for_dates')) {return { rows: [{ id: 11, reserved_for_camp: 1, free_for_dates: 4 }] };}
    return { rows: [] };
  }),
};
const pool = { query: db.query, connect: jest.fn() };
const app = express();
app.locals.pool = pool;
app.use(express.json());
app.use('/api/v1/yearly-planner', require('../routes/yearlyPlanner')(pool, { error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
app.use('/api/v1/resources', require('../routes/resources')(pool, { error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
app.use((err, req, res, _next) => res.status(500).json({ success: false, message: 'internal_server_error' }));
const token = () => jwt.sign({ user_id: USER, organizationId: UNIT }, process.env.JWT_SECRET_KEY);
const get = (id = 42) => request(app).get(`/api/v1/yearly-planner/meetings/${id}/material-list`).set('Authorization', `Bearer ${token()}`);

beforeEach(() => {
  permissions = ['meetings.view', 'inventory.view'];
  found = true;
  failQuery = false;
  demo = false;
  jest.clearAllMocks();
});

test('the list requires authentication', async () => {
  expect((await request(app).get('/api/v1/yearly-planner/meetings/42/material-list')).status).toBe(401);
});

test('someone who cannot view meetings cannot read a camp\'s material', async () => {
  permissions = ['inventory.view'];
  const res = await get();
  expect(res.status).toBe(403);
  expect(res.body).toMatchObject({ required: ['meetings.view'], missing: ['meetings.view'] });
});

test('a leader with the inventory right sees how each item stands against the inventory', async () => {
  const res = await get();
  expect(res.status).toBe(200);
  expect(res.body.data.inventory_compared).toBe(true);
  expect(res.body.data.items).toEqual([expect.objectContaining({
    name: 'Réchaud', quantity: 2, equipment_item_id: 11,
    inventory: { status: 'available', reserved: 1, free: 4, missing: 0, to_reserve: 1 },
  })]);
});

test('a leader without the inventory right sees the list, never the inventory', async () => {
  permissions = ['meetings.view'];
  const res = await get();
  expect(res.status).toBe(200);
  expect(res.body.data.inventory_compared).toBe(false);
  expect(res.body.data.items[0].inventory).toBeUndefined();
  expect(db.query.mock.calls.some(([sql]) => sql.includes('equipment_reservations'))).toBe(false);
});

test('the camp is read in the unit of the token, whatever the request names', async () => {
  await get().set('x-organization-id', '99').query({ organization_id: 99 });
  const campQuery = db.query.mock.calls.find(([sql]) => sql.includes('FROM year_plan_meetings m'));
  expect(campQuery[1]).toEqual([42, UNIT]);
  const linesQuery = db.query.mock.calls.find(([sql]) => sql.includes('FROM meeting_activity_equipment mae'));
  expect(linesQuery[1]).toEqual([UNIT, 42]);
});

test('a camp the unit does not have is not found', async () => {
  found = false;
  expect((await get()).status).toBe(404);
});

test.each(['12abc', '0', '2147483648'])('a malformed camp id (%s) is refused', async (id) => {
  expect((await get(id)).status).toBe(400);
});

test('a database failure does not leak its details', async () => {
  failQuery = true;
  const res = await get();
  expect(res.status).toBe(500);
  expect(JSON.stringify(res.body)).not.toMatch(/year_plan_meetings|\/srv\//);
});

describe('reserving what a camp still needs', () => {
  const reserve = (items, id = 42) => request(app).post(`/api/v1/resources/equipment/reservations/camps/${id}`)
    .set('Authorization', `Bearer ${token()}`).send({ items });

  beforeEach(() => {
    permissions = ['meetings.view', 'inventory.view', 'inventory.reserve'];
  });

  test('it requires authentication', async () => {
    expect((await request(app).post('/api/v1/resources/equipment/reservations/camps/42').send({ items: [] })).status).toBe(401);
  });

  test('a demo account cannot reserve', async () => {
    demo = true;
    const res = await reserve([{ equipment_item_id: 11, quantity: 1 }]);
    expect(res.status).toBe(403);
    expect(res.body.isDemo).toBe(true);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  test('someone without the reservation right is told what is missing', async () => {
    permissions = ['meetings.view', 'inventory.view'];
    const res = await reserve([{ equipment_item_id: 11, quantity: 1 }]);
    expect(res.status).toBe(403);
    expect(res.body.missing).toEqual(['inventory.reserve']);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  test.each([
    ['no items', []],
    ['the same item twice', [{ equipment_item_id: 11, quantity: 1 }, { equipment_item_id: 11, quantity: 1 }]],
    ['a fractional quantity', [{ equipment_item_id: 11, quantity: 1.5 }]],
    ['an id beyond an integer', [{ equipment_item_id: 2147483648, quantity: 1 }]],
  ])('%s is refused before anything is written', async (_label, items) => {
    expect((await reserve(items)).status).toBe(400);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  test('a whole camp\'s list, beyond one activity\'s fifty entries, is accepted in one request', async () => {
    pool.connect.mockRejectedValueOnce(new Error('stop after validation'));
    const items = Array.from({ length: 60 }, (_, index) => ({ equipment_item_id: index + 1, quantity: 1 }));
    expect((await reserve(items)).status).toBe(500);
    expect(pool.connect).toHaveBeenCalledTimes(1);
  });

  test('a malformed camp id is refused', async () => {
    expect((await reserve([{ equipment_item_id: 11, quantity: 1 }], '12abc')).status).toBe(400);
  });
});
