const request = require('supertest');
const jwt = require('jsonwebtoken');
const { closeServerResources } = require('./test-helpers');

// Mock pg module before requiring app
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

let app;
const { Pool } = require('pg');
const { setupDefaultMocks, mockQueryImplementation } = require('./mock-helpers');

beforeAll(() => {
  process.env.JWT_SECRET_KEY = 'testsecret';
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
  __mClient.query.mockClear();
  __mClient.release.mockClear();
  __mPool.connect.mockClear();
  __mPool.query.mockClear();
  mockQueryImplementation(__mClient, __mPool, (sql) => {
    if (sql.includes("r.role_name IN ('demoadmin', 'demoparent')")) {return { rows: [] };}
    if (sql.includes('SELECT DISTINCT p.permission_key')) {return { rows: [] };}
    if (sql.includes('SELECT DISTINCT r.role_name')) {
      return { rows: [{ role_name: 'leader', display_name: 'Leader', data_scope: 'organization' }] };
    }
    if (sql.includes('INSERT INTO subscribers')) {return { rows: [] };}
    return undefined;
  });
});

afterEach(() => {
  Pool.mockClear();
});

afterAll((done) => {
  closeServerResources(app, done);
});

describe('POST /api/v1/notifications/subscription', () => {
  test('saves subscription with authenticated user context', async () => {
    const { __mPool } = require('pg');

    const token = jwt.sign({ user_id: 'user-123', organizationId: 5 }, 'testsecret');

    const res = await request(app)
      .post('/api/v1/notifications/subscription')
      .set('Authorization', `Bearer ${token}`)
      .set('x-organization-id', '5')
      .send({
        endpoint: 'https://push.example.com/subscription/123',
        expirationTime: null,
        keys: { p256dh: 'p256dh-key', auth: 'auth-key' }
      });

    expect(res.statusCode).toBe(202);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Subscription accepted');
    expect(__mPool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO subscribers'),
      ['user-123', 5, 'https://push.example.com/subscription/123', null, 'p256dh-key', 'auth-key']
    );
  });

  test('rejects invalid payloads with validation error', async () => {
    const { __mPool } = require('pg');

    const token = jwt.sign({ user_id: 'user-123', organizationId: 5 }, 'testsecret');

    const res = await request(app)
      .post('/api/v1/notifications/subscription')
      .set('Authorization', `Bearer ${token}`)
      .set('x-organization-id', '5')
      .send({
        endpoint: '',
        keys: {}
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/endpoint.*required|keys.*required/i);
    // Authorization runs first, but malformed data never reaches a write.
    expect(__mPool.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO subscribers'))).toBe(false);
  });
});
