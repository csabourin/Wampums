/*
 * Rate limits on wampums.app, which is served before the app's general limiter.
 */
const request = require('supertest');
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
  process.env.DEV_WEB_ORIGIN = 'http://127.0.0.1:5173';

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

afterAll((done) => {
  closeServerResources(app, done);
});

const { RATE_LIMITS } = require('../config/constants');

describe('the public site is rate-limited like the app', () => {
  test('marketing pages report their rate limit', async () => {
    const res = await request(app).get('/en/').set('Host', 'wampums.app');
    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBe(String(RATE_LIMITS.GENERAL_MAX_REQUESTS));
  });

  test('a unit\'s app host is not counted against the marketing site\'s budget', async () => {
    const res = await request(app).get('/en/').set('Host', 'demo.wampums.app');
    expect(res.headers['ratelimit-limit']).toBe(String(RATE_LIMITS.GENERAL_MAX_REQUESTS));
    expect(res.headers['ratelimit-remaining']).toBe(String(RATE_LIMITS.GENERAL_MAX_REQUESTS - 1));
  });

  test('refreshing the blog index is refused once the window\'s refreshes are used up', async () => {
    const statuses = [];
    for (let i = 0; i <= RATE_LIMITS.BLOG_REFRESH_MAX_REQUESTS; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- requests must arrive in order to exhaust the limit
      const res = await request(app).post('/api/blog/refresh').set('Host', 'wampums.app');
      statuses.push(res.status);
    }
    expect(statuses.slice(0, -1)).not.toContain(429);
    expect(statuses.at(-1)).toBe(429);
  });
});
