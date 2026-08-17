/**
 * Reactivation — route suite
 *
 * A deactivated parent who wanted to register another child used to meet three
 * closed doors: login refused them, password reset ignored them silently, and
 * registering again collided with the global unique index on `users.email` and
 * came back as "use a different email". Registration then sent them to the
 * password reset that was already ignoring them, which closed the loop.
 *
 * These tests hold each of those doors open, at the HTTP boundary where the
 * person actually met them.
 *
 * @module test/routes-auth-reactivation
 */

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

const TEST_SECRET = 'testsecret';
const ORG_ID = 1;
const USER_ID = '99999999-8888-7777-6666-555555555555';
const EMAIL = 'returning.parent@example.org';

/** The eligibility lookup registration runs before inserting anything. */
const STANDING_QUERY = 'FROM users u LEFT JOIN user_organizations uo';

/**
 * Answer the eligibility lookup with one membership standing.
 *
 * @param {Object|null} standing - Row to return, or null for "no such account"
 * @returns {Function} Custom query handler
 */
function standingHandler(standing) {
  return (query) => {
    const normalized = typeof query === 'string' ? query.replace(/\s+/g, ' ') : '';
    if (normalized.includes(STANDING_QUERY)) {
      return Promise.resolve({ rows: standing ? [standing] : [] });
    }
    return undefined;
  };
}

beforeAll(() => {
  process.env.JWT_SECRET_KEY = TEST_SECRET;
  process.env.ORGANIZATION_ID = ORG_ID.toString();
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

afterAll((done) => {
  closeServerResources(app, done);
});

describe('POST /public/register with an address that already exists', () => {
  const body = {
    email: EMAIL,
    password: 'ValidPass123!',
    full_name: 'Returning Parent',
    user_type: 'parent'
  };

  test('a deactivated member is pointed at reactivation, not at a different email', async () => {
    const { __mClient, __mPool } = require('pg');
    mockQueryImplementation(__mClient, __mPool, standingHandler({
      user_id: USER_ID,
      email: EMAIL,
      membership_id: 42,
      status: 'inactive',
      deactivated_reason: 'no_enrolled_child'
    }));

    const res = await request(app).post('/public/register').send(body);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('account_exists_reactivation_available');
  });

  test('a parent who belongs to another unit gets the same way forward', async () => {
    const { __mClient, __mPool } = require('pg');
    mockQueryImplementation(__mClient, __mPool, standingHandler({
      user_id: USER_ID,
      email: EMAIL,
      membership_id: null
    }));

    const res = await request(app).post('/public/register').send(body);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('account_exists_reactivation_available');
  });

  test('someone already active here is still told to sign in', async () => {
    const { __mClient, __mPool } = require('pg');
    mockQueryImplementation(__mClient, __mPool, standingHandler({
      user_id: USER_ID,
      email: EMAIL,
      membership_id: 42,
      status: 'active'
    }));

    const res = await request(app).post('/public/register').send(body);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('account_already_exists');
  });

  test('no user row is ever inserted for an address that already exists', async () => {
    const { __mClient, __mPool } = require('pg');
    let insertCalled = false;

    mockQueryImplementation(__mClient, __mPool, (query) => {
      const normalized = typeof query === 'string' ? query.replace(/\s+/g, ' ') : '';
      if (normalized.includes('INSERT INTO users')) {
        insertCalled = true;
        return Promise.resolve({ rows: [] });
      }
      if (normalized.includes(STANDING_QUERY)) {
        return Promise.resolve({
          rows: [{ user_id: USER_ID, email: EMAIL, membership_id: 42, status: 'inactive' }]
        });
      }
      return undefined;
    });

    await request(app).post('/public/register').send(body);

    expect(insertCalled).toBe(false);
  });
});

describe('POST /api/auth/request-reset for a deactivated member', () => {
  test('a reset token is issued even though the membership is closed', async () => {
    const { __mClient, __mPool } = require('pg');
    let tokenPersisted = false;
    let statusFilterUsed = false;

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      const normalized = typeof query === 'string' ? query.replace(/\s+/g, ' ') : '';

      if (normalized.includes('FROM users u JOIN user_organizations uo')) {
        // The bug this replaces: recovery was *filtered* on an active
        // membership, so the lookup found nothing and the constant response hid
        // that fact. Reading the status to order the results is fine — only
        // restricting the rows on it is not.
        if (normalized.includes("AND uo.status = 'active'")) {
          statusFilterUsed = true;
        }
        return Promise.resolve({ rows: [{ id: USER_ID, organization_id: ORG_ID }] });
      }

      if (normalized.includes('SET reset_token = $1')) {
        tokenPersisted = true;
        return Promise.resolve({ rows: [{ id: params[1] }], rowCount: 1 });
      }

      return undefined;
    });

    const res = await request(app)
      .post('/api/auth/request-reset')
      .send({ email: EMAIL });

    expect(res.status).toBe(200);
    expect(statusFilterUsed).toBe(false);
    expect(tokenPersisted).toBe(true);
  });
});

describe('POST /api/v1/public/reactivation/request', () => {
  test('an unknown address is answered exactly like a known one', async () => {
    const { __mClient, __mPool } = require('pg');
    mockQueryImplementation(__mClient, __mPool, standingHandler(null));

    const unknown = await request(app)
      .post('/api/v1/public/reactivation/request')
      .set('x-organization-id', String(ORG_ID))
      .send({ email: 'nobody@example.org' });

    mockQueryImplementation(__mClient, __mPool, standingHandler({
      user_id: USER_ID,
      email: EMAIL,
      membership_id: 42,
      status: 'inactive',
      deactivated_reason: 'no_enrolled_child'
    }));

    const known = await request(app)
      .post('/api/v1/public/reactivation/request')
      .set('x-organization-id', String(ORG_ID))
      .send({ email: EMAIL });

    expect(unknown.status).toBe(200);
    expect(known.status).toBe(200);
    expect(known.body).toEqual(unknown.body);
  });

  test('a malformed address is refused before anything is looked up', async () => {
    const res = await request(app)
      .post('/api/v1/public/reactivation/request')
      .set('x-organization-id', String(ORG_ID))
      .send({ email: 'not-an-email' });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/public/reactivation/link', () => {
  test('an unusable token is reported in the body, not as a status code', async () => {
    const res = await request(app)
      .get('/api/v1/public/reactivation/link')
      .query({ token: 'not-a-jwt' });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ state: 'invalid' });
  });
});
