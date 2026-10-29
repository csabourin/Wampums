/**
 * Asking for equipment suggestions is refused before any AI call when the
 * request should be: no token, a demo account, no right to reserve,
 * malformed input, or no assistant configured.
 */
const { adaptAuthorizationMock } = require('./mock-helpers');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../services/equipmentSuggestions', () => ({ suggestEquipment: jest.fn() }));
jest.mock('../services/aiText', () => ({ isAIConfigured: jest.fn(() => true) }));
jest.mock('../services/ai-budget', () => ({ getBudgetStatus: jest.fn(() => Promise.resolve({ remaining: 1 })) }));

const { suggestEquipment } = require('../services/equipmentSuggestions');
const { isAIConfigured } = require('../services/aiText');

const TEST_SECRET = 'equipment-suggestions-secret';
process.env.JWT_SECRET_KEY = TEST_SECRET;
const USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const ORGANIZATION_ID = 7;

let scenario;
const pool = {
  query: jest.fn((query) => {
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
    if (query.includes('FROM activities WHERE id = $1 AND organization_id = $2')) {
      return Promise.resolve({ rows: scenario.activityInUnit ? [{ '?column?': 1 }] : [] });
    }
    if (query.includes('SELECT DISTINCT r.data_scope')) {
      return Promise.resolve({ rows: [{ data_scope: 'organization' }] });
    }
    return Promise.resolve({ rows: [] });
  }),
};
adaptAuthorizationMock(pool);

const app = express();
app.locals.pool = pool;
app.use(express.json());
app.use('/api/v1/equipment-suggestions', require('../routes/equipmentSuggestions')(pool));

const bearer = () => `Bearer ${jwt.sign({ user_id: USER_ID, organizationId: ORGANIZATION_ID }, TEST_SECRET)}`;
const valid = { description: 'Camp d\'hiver, deux nuits, repas sur réchaud', date_from: '2099-01-10', date_to: '2099-01-12', locale: 'fr' };
const ask = (body = valid) => request(app).post('/api/v1/equipment-suggestions').set('Authorization', bearer()).send(body);

beforeEach(() => {
  scenario = { permissions: ['inventory.reserve', 'ai.use'], demo: false, activityInUnit: true };
  suggestEquipment.mockReset();
  suggestEquipment.mockResolvedValue({ items: [{ equipment_id: 3, quantity: 2, reason: 'Pour dormir' }], usage: null });
  isAIConfigured.mockReturnValue(true);
});

test('is refused without a token', async () => {
  const response = await request(app).post('/api/v1/equipment-suggestions').send(valid);
  expect(response.status).toBe(401);
});

test('a demo account cannot spend the AI budget', async () => {
  scenario.demo = true;
  const response = await ask();
  expect(response.status).toBe(403);
  expect(response.body.isDemo).toBe(true);
  expect(suggestEquipment).not.toHaveBeenCalled();
});

test('someone who may not reserve is refused, saying what is missing', async () => {
  scenario.permissions = ['ai.use', 'inventory.view'];
  const response = await ask();
  expect(response.status).toBe(403);
  expect(response.body.missing).toEqual(['inventory.reserve']);
});

test.each([
  ['a description too short', { ...valid, description: 'a' }],
  ['no dates', { description: valid.description }],
  ['dates in the wrong order', { ...valid, date_from: '2099-02-01', date_to: '2099-01-01' }],
  ['an unknown locale', { ...valid, locale: 'xx' }],
])('%s is a bad request', async (_label, body) => {
  const response = await ask(body);
  expect(response.status).toBe(400);
  expect(suggestEquipment).not.toHaveBeenCalled();
});

test('without an assistant configured, it says so', async () => {
  isAIConfigured.mockReturnValue(false);
  const response = await ask();
  expect(response.status).toBe(503);
  expect(response.body.message).toBe('ai_unavailable');
});

test('a suggestion comes back with the unit\'s dates and language', async () => {
  const response = await ask();
  expect(response.status).toBe(200);
  expect(response.body.data.items).toEqual([{ equipment_id: 3, quantity: 2, reason: 'Pour dormir' }]);
  expect(suggestEquipment).toHaveBeenCalledWith(pool, expect.objectContaining({
    organizationId: ORGANIZATION_ID, dateFrom: '2099-01-10', dateTo: '2099-01-12', locale: 'fr',
  }));
});

test('a suggestion for an activity counts what that activity already took home as its own', async () => {
  const response = await ask({ ...valid, activity_id: 12 });
  expect(response.status).toBe(200);
  expect(suggestEquipment).toHaveBeenCalledWith(pool, expect.objectContaining({ activityId: 12 }));
});

test('another unit\'s activity is not found, and nothing is asked', async () => {
  scenario.activityInUnit = false;
  const response = await ask({ ...valid, activity_id: 12 });
  expect(response.status).toBe(404);
  expect(suggestEquipment).not.toHaveBeenCalled();
});

test('a malformed activity is refused', async () => {
  const response = await ask({ ...valid, activity_id: '12abc' });
  expect(response.status).toBe(400);
  expect(suggestEquipment).not.toHaveBeenCalled();
});

test('a spent budget is explained, not reported as a server error', async () => {
  suggestEquipment.mockRejectedValue(Object.assign(new Error('cap'), { code: 'AI_BUDGET_EXCEEDED' }));
  const response = await ask();
  expect(response.status).toBe(429);
  expect(response.body.message).toBe('ai_budget_exceeded');
});
