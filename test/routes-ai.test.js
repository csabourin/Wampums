/**
 * POST /api/v1/ai/text — who may spend the AI budget, and what a failure
 * tells the page. The provider's own message and status never reach the
 * browser: a provider's 401 (bad key) must not read as an expired session.
 *
 * @module test/routes-ai
 */
const { adaptAuthorizationMock } = require('./mock-helpers');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const TEST_SECRET = 'routes-ai-secret';
process.env.JWT_SECRET_KEY = TEST_SECRET;
const USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const ORGANIZATION_ID = 7;

jest.mock('../services/aiText', () => ({
  generateText: jest.fn(),
  isAIConfigured: jest.fn(() => true),
}));
jest.mock('../services/ai-budget', () => ({
  getBudgetStatus: jest.fn(() => Promise.resolve({ capUsd: 5, remainingUsd: 4 })),
}));
jest.mock('../services/veryfi', () => ({ parseReceipt: jest.fn() }));

const { generateText, isAIConfigured } = require('../services/aiText');

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
    return Promise.resolve({ rows: [] });
  }),
};
adaptAuthorizationMock(pool);

const app = express();
app.locals.pool = pool;
app.use(express.json());
app.use('/api/v1/ai', require('../routes/ai'));

const token = () => jwt.sign({ user_id: USER_ID, user_role: 'leader', organizationId: ORGANIZATION_ID }, TEST_SECRET);
const ask = (body) => request(app).post('/api/v1/ai/text').set('Authorization', `Bearer ${token()}`).send(body);
const REWRITE = { mode: 'rewrite', payload: { tone: 'professional', text: 'Salut les parents' } };

beforeAll(() => jest.spyOn(console, 'error').mockImplementation(() => {}));

beforeEach(() => {
  jest.clearAllMocks();
  scenario = { permissions: ['communications.send'], demo: false };
  isAIConfigured.mockReturnValue(true);
});

test('is refused without a token', async () => {
  const response = await request(app).post('/api/v1/ai/text').send(REWRITE);

  expect(response.status).toBe(401);
  expect(response.body.message).toMatch(/authentication required/i);
});

test('is refused to someone with no feature that offers the assistant', async () => {
  scenario.permissions = ['participants.view'];
  const response = await ask(REWRITE);

  expect(response.status).toBe(403);
  expect(response.body.missing).toEqual(expect.arrayContaining(['communications.send']));
  expect(generateText).not.toHaveBeenCalled();
});

test('is refused to a demo account', async () => {
  scenario.demo = true;
  const response = await ask(REWRITE);

  expect(response.status).toBe(403);
  expect(response.body.isDemo).toBe(true);
});

test('rejects an unknown mode', async () => {
  const response = await ask({ mode: 'system_prompt', payload: {} });

  expect(response.status).toBe(400);
});

test('a leader gets the rewritten text and what is left of the budget', async () => {
  generateText.mockResolvedValue({ data: { text: 'Bonjour chers parents' }, usage: { provider: 'groq' } });
  const response = await ask(REWRITE);

  expect(response.status).toBe(200);
  expect(response.body.data.data.text).toBe('Bonjour chers parents');
  expect(response.body.data.budget).toEqual({ capUsd: 5, remainingUsd: 4 });
});

test('says the assistant is unavailable when no provider is configured', async () => {
  isAIConfigured.mockReturnValue(false);
  const response = await ask(REWRITE);

  expect(response.status).toBe(503);
  expect(response.body.message).toBe('ai_unavailable');
  expect(response.body.errors).toEqual({ code: 'AI_NOT_CONFIGURED' });
});

test('a provider refusing its key is a service error, not a sign-in error, and its message stays on the server', async () => {
  generateText.mockRejectedValue(Object.assign(new Error('Invalid API Key gsk_secret'), { status: 401 }));
  const response = await ask(REWRITE);

  expect(response.status).toBe(502);
  expect(response.body.errors).toEqual({ code: 'AI_SERVICE_ERROR' });
  expect(JSON.stringify(response.body)).not.toContain('gsk_secret');
});

test('a provider rate limit asks the leader to try again shortly', async () => {
  generateText.mockRejectedValue(Object.assign(new Error('Rate limit reached'), { status: 429 }));
  const response = await ask(REWRITE);

  expect(response.status).toBe(503);
  expect(response.body.errors).toEqual({ code: 'AI_RATE_LIMITED' });
  expect(JSON.stringify(response.body)).not.toContain('Rate limit reached');
});

test('the monthly budget being spent is said as such', async () => {
  generateText.mockRejectedValue(Object.assign(new Error('Monthly AI budget cap reached.'), { code: 'AI_BUDGET_EXCEEDED' }));
  const response = await ask(REWRITE);

  expect(response.status).toBe(429);
  expect(response.body.errors).toEqual({ code: 'AI_BUDGET_EXCEEDED' });
});

test('an unreadable answer from the model is a service error', async () => {
  generateText.mockRejectedValue(Object.assign(new Error('cut off'), { code: 'AI_INVALID_RESPONSE' }));
  const response = await ask(REWRITE);

  expect(response.status).toBe(502);
  expect(response.body.errors).toEqual({ code: 'AI_SERVICE_ERROR' });
});
