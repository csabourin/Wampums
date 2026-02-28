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

const { Pool } = require('pg');
const { setupDefaultMocks } = require('./mock-helpers');
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
  setupDefaultMocks(__mClient, __mPool);
  __mClient.query.mockClear();
  __mClient.release.mockClear();
  __mPool.connect.mockClear();
  __mPool.query.mockClear();
});

afterEach(() => {
  // Clear mock calls after each test
  Pool.mockClear();
});

afterAll((done) => {
  closeServerResources(app, done);
});

describe('Authenticated API communication', () => {
  test('returns error when no token is provided', async () => {
    const res = await request(app).get('/api/v1/forms/types');
    expect(res.status).toBe(401);
  });

  test('returns data when valid token is provided', async () => {
    const { __mPool } = require('pg');
    
    // Mock form types query
    __mPool.query.mockResolvedValueOnce({ 
      rows: [{ form_type: 'general' }] 
    });

    const token = jwt.sign({ user_id: 1, organizationId: 1 }, 'testsecret');

    const res = await request(app)
      .get('/api/v1/forms/types')
      .set('Authorization', `Bearer ${token}`)
      .set('x-organization-id', '1');  // Explicitly set organization ID

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual(['general']);
  });
});
