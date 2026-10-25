/**
 * The equipment loans endpoints refuse what they should before touching a loan:
 * no token, a demo account, malformed input. What they record is covered
 * against PostgreSQL in equipment-loans.integration.test.js.
 */
const { adaptAuthorizationMock } = require('./mock-helpers');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const TEST_SECRET = 'equipment-loans-secret';
process.env.JWT_SECRET_KEY = TEST_SECRET;
const USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const ORGANIZATION_ID = 7;

const DEFAULTS = { permissions: ['inventory.view', 'inventory.reserve', 'participants.view'], demo: false };
let scenario;
const clientQuery = jest.fn(() => Promise.resolve({ rows: [] }));

const pool = {
  query: jest.fn((query) => answer(query)),
  connect: jest.fn(() => Promise.resolve({ query: clientQuery, release: jest.fn() })),
};

function answer(query) {
  if (query.includes('SELECT organization_id FROM user_organizations')) {
    return Promise.resolve({ rows: [{ organization_id: ORGANIZATION_ID }] });
  }
  if (query.includes("role_name IN ('demoadmin', 'demoparent')")) {
    return Promise.resolve({ rows: scenario.demo ? [{ role_name: 'demoadmin' }] : [] });
  }
  if (query.includes('SELECT DISTINCT p.permission_key')) {
    return Promise.resolve({ rows: scenario.permissions.map((key) => ({ permission_key: key })) });
  }
  if (query.includes('SELECT DISTINCT r.role_name')) {
    return Promise.resolve({ rows: [{ role_name: 'leader', display_name: 'Leader', data_scope: 'organization' }] });
  }
  if (query.includes('SELECT DISTINCT r.data_scope')) {
    return Promise.resolve({ rows: [{ data_scope: 'organization' }] });
  }
  return Promise.resolve({ rows: [], rowCount: 0 });
}
adaptAuthorizationMock(pool);

const app = express();
app.locals.pool = pool;
app.use(express.json());
app.use('/api/v1/equipment-loans', require('../routes/equipmentLoans')(pool));

const bearer = () => `Bearer ${jwt.sign({ user_id: USER_ID, organizationId: ORGANIZATION_ID }, TEST_SECRET)}`;
const validHandout = { loans: [{ equipment_id: 3, quantity: 2, participant_id: 11 }] };

beforeEach(() => {
  scenario = { ...DEFAULTS };
  clientQuery.mockClear();
});

describe('equipment loans endpoints', () => {
  test.each([
    ['get', '/api/v1/equipment-loans'],
    ['get', '/api/v1/equipment-loans/handout'],
    ['post', '/api/v1/equipment-loans'],
    ['patch', '/api/v1/equipment-loans/4'],
    ['delete', '/api/v1/equipment-loans/4'],
  ])('%s %s is refused without a token', async (method, path) => {
    const response = await request(app)[method](path);
    expect(response.status).toBe(401);
    expect(response.body.message).toMatch(/authentication required/i);
  });

  test('a demo account cannot lend equipment', async () => {
    scenario.demo = true;
    const response = await request(app).post('/api/v1/equipment-loans')
      .set('Authorization', bearer()).send(validHandout);
    expect(response.status).toBe(403);
    expect(response.body.isDemo).toBe(true);
    expect(clientQuery).not.toHaveBeenCalled();
  });

  test('a demo account cannot record a return', async () => {
    scenario.demo = true;
    const response = await request(app).patch('/api/v1/equipment-loans/4')
      .set('Authorization', bearer()).send({ returned_quantity: 1 });
    expect(response.status).toBe(403);
    expect(response.body.isDemo).toBe(true);
  });

  test('preparing a handout without seeing the participants is refused, saying what is missing', async () => {
    scenario.permissions = ['inventory.view', 'inventory.reserve'];
    const response = await request(app).get('/api/v1/equipment-loans/handout').set('Authorization', bearer());
    expect(response.status).toBe(403);
    expect(response.body.missing).toEqual(['participants.view']);
  });

  test.each([
    ['no loans', { loans: [] }],
    ['a quantity of zero', { loans: [{ equipment_id: 3, quantity: 0, participant_id: 11 }] }],
    ['an unknown reason', { ...validHandout, reason: 'party' }],
    ['a malformed adult id', { loans: [{ equipment_id: 3, quantity: 1, user_id: '12' }] }],
    ['an equipment id beyond the integer range', { loans: [{ equipment_id: 2147483648, quantity: 1, participant_id: 11 }] }],
  ])('a handout with %s is a bad request', async (_label, body) => {
    const response = await request(app).post('/api/v1/equipment-loans').set('Authorization', bearer()).send(body);
    expect(response.status).toBe(400);
    expect(clientQuery).not.toHaveBeenCalled();
  });

  test('a loan names exactly one holder, a youth or an adult', async () => {
    const neither = await request(app).post('/api/v1/equipment-loans').set('Authorization', bearer())
      .send({ loans: [{ equipment_id: 3, quantity: 1 }] });
    expect(neither.status).toBe(400);
    expect(neither.body.message).toBe('equipment_loan_holder_required');

    const both = await request(app).post('/api/v1/equipment-loans').set('Authorization', bearer())
      .send({ loans: [{ equipment_id: 3, quantity: 1, participant_id: 11, user_id: USER_ID }] });
    expect(both.status).toBe(400);
  });

  test.each(['abc', '12abc', '0'])('a loan id of %s is a bad request', async (id) => {
    const response = await request(app).patch(`/api/v1/equipment-loans/${id}`)
      .set('Authorization', bearer()).send({ returned_quantity: 1 });
    expect(response.status).toBe(400);
  });

  test('a return with nothing to change is a bad request', async () => {
    const response = await request(app).patch('/api/v1/equipment-loans/4').set('Authorization', bearer()).send({});
    expect(response.status).toBe(400);
  });

  test('a return for a loan of another unit is not found', async () => {
    const response = await request(app).patch('/api/v1/equipment-loans/4')
      .set('Authorization', bearer()).send({ returned_quantity: 1 });
    expect(response.status).toBe(404);
    expect(response.body.message).toBe('equipment_loan_not_found');
  });
});
