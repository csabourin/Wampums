const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { authorizationContextRow } = require('./mock-helpers');

process.env.JWT_SECRET_KEY = 'external-revenue-test-secret';
const USER = '00000000-0000-4000-8000-000000000001';
const UNIT = 7;
let revenues;
const pool = {
  query: jest.fn((sql) => {
    if (sql.includes('AS authorization_permissions')) {
      return authorizationContextRow({ permissions: ['finance.view', 'finance.manage'] });
    }
    if (sql.includes('SELECT organization_id FROM user_organizations')) {
      return { rows: [{ organization_id: UNIT }] };
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
