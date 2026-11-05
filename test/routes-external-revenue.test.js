const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { authorizationContextRow } = require('./mock-helpers');

process.env.JWT_SECRET_KEY = 'external-revenue-test-secret';
const USER = '00000000-0000-4000-8000-000000000001';
const UNIT = 7;
let revenues;
let categoryFound;
const pool = {
  query: jest.fn((sql) => {
    if (sql.includes('AS authorization_permissions')) {
      return authorizationContextRow({ permissions: ['finance.view', 'finance.manage'] });
    }
    if (sql.includes('SELECT organization_id FROM user_organizations')) {
      return { rows: [{ organization_id: UNIT }] };
    }
    if (sql.includes('SELECT 1 FROM budget_categories')) {
      return { rows: categoryFound ? [{ exists: 1 }] : [] };
    }
    if (sql.includes('INSERT INTO budget_revenues')) {
      return { rows: revenues };
    }
    if (sql.includes('UPDATE budget_revenues')) {
      return { rows: revenues };
    }
    return { rows: [] };
  }),
};
const logger = { info: jest.fn(), error: jest.fn() };
const app = express();
app.locals.pool = pool;
app.use(express.json());
app.use('/api', require('../routes/external-revenue')(pool, logger));
app.use((err, req, res, _next) => res.status(500).json({ success: false }));
const update = (body = { amount: 25 }) => request(app).put('/api/v1/revenue/external/4')
  .set('Authorization', `Bearer ${jwt.sign({ user_id: USER, organizationId: UNIT }, process.env.JWT_SECRET_KEY)}`)
  .send(body);

beforeEach(() => {
  jest.clearAllMocks();
  categoryFound = true;
  revenues = [{ id: 4, organization_id: UNIT, amount: '25.00' }];
});

test('updating a missing or foreign revenue returns 404 instead of crashing', async () => {
  revenues = [];
  const res = await update();
  expect(res.status).toBe(404);
  expect(res.body).toMatchObject({ success: false, message: 'External revenue entry not found' });
  expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('WHERE id = $10 AND organization_id = $11'),
    expect.arrayContaining(['4', UNIT]));
});

test('updating an existing revenue still returns the saved amount', async () => {
  const res = await update();
  expect(res.status).toBe(200);
  expect(res.body.data).toMatchObject({ id: 4, organization_id: UNIT, amount: 25 });
});

test.each([null, ''])('clearing a category with %s is passed as an explicit null update', async (value) => {
  expect((await update({ budget_category_id: value })).status).toBe(200);
  const [, params] = pool.query.mock.calls.find(([sql]) => sql.includes('UPDATE budget_revenues'));
  expect(params[0]).toBeNull();
  expect(params[11]).toBe(true);
});

test('omitting optional fields does not request their removal', async () => {
  expect((await update({ amount: 30 })).status).toBe(200);
  const [, params] = pool.query.mock.calls.find(([sql]) => sql.includes('UPDATE budget_revenues'));
  expect(params.slice(11)).toEqual([false, false, false, false, false]);
});

const create = (body) => request(app).post('/api/v1/revenue/external')
  .set('Authorization', `Bearer ${jwt.sign({ user_id: USER, organizationId: UNIT }, process.env.JWT_SECRET_KEY)}`)
  .send({ amount: 25, revenue_date: '2026-11-04', description: 'Test donation', ...body });

test.each(['create', 'update'])('%s refuses a category outside the unit before writing', async (method) => {
  categoryFound = false;
  const res = await (method === 'create' ? create : update)({ budget_category_id: 99 });
  expect(res.status).toBe(400);
  expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('WHERE id = $1 AND organization_id = $2'), [99, UNIT]);
  expect(pool.query.mock.calls.some(([sql]) => /INSERT INTO budget_revenues|UPDATE budget_revenues/.test(sql))).toBe(false);
});

test.each(['create', 'update'])('%s accepts a category in the current unit', async (method) => {
  const res = await (method === 'create' ? create : update)({ budget_category_id: 9 });
  expect(res.status).toBe(method === 'create' ? 201 : 200);
  expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('WHERE id = $1 AND organization_id = $2'), [9, UNIT]);
});

const wroteRevenue = () => pool.query.mock.calls.some(([sql]) => /INSERT INTO budget_revenues|UPDATE budget_revenues/.test(sql));

test.each([
  ['an amount with a currency code', { amount: '12CAD' }],
  ['an amount with a decimal comma', { amount: '12,50' }],
  ['an amount with three decimals', { amount: '12.345' }],
  ['a negative amount', { amount: -5 }],
  ['an impossible date', { revenue_date: '2026-02-30' }],
  ['a date in another format', { revenue_date: '11/04/2026' }],
  ['a category id followed by letters', { budget_category_id: '7abc' }],
  ['a category id beyond the integer range', { budget_category_id: 2147483648 }],
])('a revenue with %s is refused without being recorded', async (_label, body) => {
  const createResponse = await create(body);
  const updateResponse = await update(body);
  expect(createResponse.status).toBe(400);
  expect(updateResponse.status).toBe(400);
  expect(wroteRevenue()).toBe(false);
});

test.each([
  ['a whole amount', { amount: 12 }],
  ['an amount in cents', { amount: 12.5 }],
  ['an amount written as text', { amount: '12.50' }],
  ['a category id written as text', { budget_category_id: '9' }],
])('a revenue with %s is still recorded', async (_label, body) => {
  expect((await create(body)).status).toBe(201);
});

test('a revenue created with a text amount records exactly that amount', async () => {
  expect((await create({ amount: '12.50' })).status).toBe(201);
  const [, params] = pool.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO budget_revenues'));
  expect(params).toContain(12.5);
  expect(params).not.toContain(12);
});

test('filtering revenues by a category id followed by letters is refused', async () => {
  const res = await request(app).get('/api/v1/revenue/external?category_id=7abc')
    .set('Authorization', `Bearer ${jwt.sign({ user_id: USER, organizationId: UNIT }, process.env.JWT_SECRET_KEY)}`);
  expect(res.status).toBe(400);
});
