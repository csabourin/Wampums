const request = require('supertest');
const jwt = require('jsonwebtoken');

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

const { Pool } = require('pg');
let app;

beforeAll(() => {
  // Set required env variables
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
  __mClient.query.mockReset();
  __mClient.release.mockReset();
  __mPool.connect.mockClear();
  __mPool.query.mockReset();
  __mPool.query.mockResolvedValue({ rows: [] });
});

afterEach(() => {
  // Clear mock calls after each test
  Pool.mockClear();
});

describe('Authenticated API communication', () => {
  test('returns error when no token is provided', async () => {
    const res = await request(app).get('/api').query({ action: 'get_form_types' });
    expect(res.body.success).toBe(false);
  });

  test('returns data when valid token is provided', async () => {
    const client = await (new Pool()).connect();
    client.query.mockResolvedValueOnce({ rows: [{ form_type: 'general' }] });

    const token = jwt.sign({ user_id: 1, organizationId: 1 }, 'testsecret');

    const res = await request(app)
      .get('/api')
      .set('Authorization', `Bearer ${token}`)
      .query({ action: 'get_form_types' });

    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual(['general']);
  });
});
