/**
 * Password reset link description — route suite
 *
 * The reset page asks which account a link belongs to so it can show the
 * address and let password managers save the new password against it. The
 * lookup must change nothing and answer only for a live token.
 *
 * @module test/routes-auth-reset-describe
 */

const crypto = require('crypto');
const request = require('supertest');
const { closeServerResources } = require('./test-helpers');

jest.mock('pg', () => {
  const mClient = {
    query: jest.fn(),
    release: jest.fn()
  };
  const mPool = {
    connect: jest.fn(() => Promise.resolve(mClient)),
    query: jest.fn(),
    on: jest.fn()
  };
  return {
    Pool: jest.fn(() => mPool),
    __esModule: true,
    __mClient: mClient,
    __mPool: mPool
  };
});

const { setupDefaultMocks, mockQueryImplementation } = require('./mock-helpers');

let app;

const ENDPOINT = '/api/v1/auth/reset-password/describe';
const RAW_TOKEN = 'a'.repeat(64);
const EMAIL = 'parent@example.org';
const TOKEN_QUERY = 'FROM users WHERE reset_token = $1 AND reset_token_expiry > NOW()';

beforeAll(() => {
  process.env.JWT_SECRET_KEY = 'testsecret';
  process.env.ORGANIZATION_ID = '1';
  process.env.DB_USER = 'test';
  process.env.DB_HOST = 'localhost';
  process.env.DB_NAME = 'testdb';
  process.env.DB_PASSWORD = 'test';
  process.env.DB_PORT = '5432';

  app = require('../api');
});

beforeEach(() => {
  const { __mClient, __mPool } = require('pg');
  setupDefaultMocks(__mClient, __mPool);
  __mPool.query.mockClear();
});

afterAll((done) => {
  closeServerResources(app, done);
});

/**
 * Answer the token lookup, recording the digest it was asked about.
 *
 * @param {Object|null} row - Row to return, or null for no live token
 * @param {Object} seen - Collects the queried digest and any writes
 * @returns {void}
 */
function answerTokenLookup(row, seen) {
  const { __mClient, __mPool } = require('pg');
  mockQueryImplementation(__mClient, __mPool, (query, params) => {
    const normalized = typeof query === 'string' ? query.replace(/\s+/g, ' ') : '';
    if (/^\s*(UPDATE|INSERT|DELETE)/i.test(normalized)) {
      seen.wrote = true;
    }
    if (normalized.includes(TOKEN_QUERY)) {
      seen.digest = params[0];
      return Promise.resolve({ rows: row ? [row] : [] });
    }
    return undefined;
  });
}

describe(`POST ${ENDPOINT}`, () => {
  test('a live token is answered with its account address, looked up by digest', async () => {
    const seen = {};
    answerTokenLookup({ email: EMAIL }, seen);

    const res = await request(app).post(ENDPOINT).send({ token: RAW_TOKEN });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({ email: EMAIL });
    expect(seen.digest).toBe(crypto.createHash('sha256').update(RAW_TOKEN).digest('hex'));
    expect(seen.wrote).toBeUndefined();
  });

  test('an unknown or expired token is refused without naming anyone', async () => {
    answerTokenLookup(null, {});

    const res = await request(app).post(ENDPOINT).send({ token: RAW_TOKEN });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('invalid_or_expired_token');
    expect(JSON.stringify(res.body)).not.toContain('@');
  });

  test('a missing token is a validation error', async () => {
    const res = await request(app).post(ENDPOINT).send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('a token only in the query string is not looked up', async () => {
    const seen = {};
    answerTokenLookup({ email: EMAIL }, seen);

    const res = await request(app).post(`${ENDPOINT}?token=${RAW_TOKEN}`).send({});

    expect(res.status).toBe(400);
    expect(Array.isArray(res.body.errors)).toBe(true);
    expect(seen.digest).toBeUndefined();
  });
});
