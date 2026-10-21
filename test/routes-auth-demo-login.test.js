/**
 * Opening the demo unit (demo.wampums.app) as a parent or as a leader,
 * without a password: POST /api/v1/auth/demo-login.
 *
 * @module test/routes-auth-demo-login
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');
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
const DEMO_PARENT = { id: 'aaaaaaaa-0000-4000-8000-000000000001', email: 'Parent@Demo.Example', full_name: 'Demo Parent' };

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
  __mPool.query.mockClear();
});

afterAll((done) => {
  closeServerResources(app, done);
});

/**
 * Answer the database as a unit would.
 *
 * @param {Object} options
 * @param {*} options.setting - The unit's demo_sign_in value (undefined: none)
 * @param {Object|null} options.account - The demo account found for the view
 * @returns {jest.Mock} The pool query mock, to inspect what was asked
 */
function unit({ setting, account }) {
  const { __mClient, __mPool } = require('pg');
  mockQueryImplementation(__mClient, __mPool, (query) => {
    if (query.includes("setting_key = 'demo_sign_in'")) {
      return Promise.resolve({ rows: setting === undefined ? [] : [{ setting_value: setting }] });
    }
    if (query.includes('FROM users u') && query.includes('u.is_verified = TRUE')) {
      return Promise.resolve({ rows: account ? [account] : [] });
    }
    if (query.includes('r.role_name, r.data_scope')) {
      return Promise.resolve({ rows: [{ role_id: 8, role_name: 'demoparent', data_scope: 'linked' }] });
    }
    if (query.includes('permission_key')) {
      return Promise.resolve({ rows: [{ permission_key: 'participants.view' }] });
    }
    return Promise.resolve({ rows: [] });
  });
  return __mPool.query;
}

/** @returns {Array} The parameters of the query that looked for the demo account */
function accountQueryParams(queryMock) {
  return queryMock.mock.calls.find(([sql]) => sql.includes('u.is_verified = TRUE'))?.[1];
}

describe('POST /api/v1/auth/demo-login', () => {
  test('a visitor of the demo unit opens the parent view without a password', async () => {
    const queries = unit({ setting: true, account: DEMO_PARENT });

    const res = await request(app).post('/api/v1/auth/demo-login').send({ view: 'parent' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      user_id: DEMO_PARENT.id,
      user_full_name: 'Demo Parent',
      user_roles: ['demoparent'],
      user_data_scope: 'linked',
      organization_id: ORG_ID
    });
    expect(jwt.verify(res.body.token, TEST_SECRET)).toMatchObject({ user_id: DEMO_PARENT.id, organizationId: ORG_ID });
    expect(accountQueryParams(queries)).toEqual([ORG_ID, 'demoparent']);
  });

  test('the leader view opens the unit\'s demo administrator account', async () => {
    const queries = unit({ setting: true, account: { ...DEMO_PARENT, full_name: 'Demo Leader' } });

    const res = await request(app).post('/api/v1/auth/demo-login').send({ view: 'leader' });

    expect(res.status).toBe(200);
    expect(accountQueryParams(queries)).toEqual([ORG_ID, 'demoadmin']);
  });

  test('an account holding any role besides the demo ones is never opened this way', async () => {
    const queries = unit({ setting: true, account: DEMO_PARENT });

    await request(app).post('/api/v1/auth/demo-login').send({ view: 'parent' });

    const sql = queries.mock.calls.find(([text]) => text.includes('u.is_verified = TRUE'))[0];
    expect(sql).toMatch(/NOT EXISTS[\s\S]*role_name NOT IN \('demoadmin', 'demoparent'\)/);
    expect(sql).toMatch(/uo\.status = 'active'/);
  });

  test('a unit that is not set up as a demo still requires a password, even with demo accounts', async () => {
    const queries = unit({ setting: undefined, account: DEMO_PARENT });

    const res = await request(app).post('/api/v1/auth/demo-login').send({ view: 'parent' });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, message: 'demo_sign_in_unavailable' });
    expect(res.body.token).toBeUndefined();
    expect(accountQueryParams(queries)).toBeUndefined();
  });

  test('a demo setting that is off counts as no demo', async () => {
    unit({ setting: false, account: DEMO_PARENT });

    const res = await request(app).post('/api/v1/auth/demo-login').send({ view: 'leader' });

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('demo_sign_in_unavailable');
  });

  test('a demo unit without an account for the view says so', async () => {
    unit({ setting: true, account: null });

    const res = await request(app).post('/api/v1/auth/demo-login').send({ view: 'leader' });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, message: 'demo_account_unavailable' });
  });

  test.each([[{ view: 'admin' }], [{}], [{ view: ['parent'] }]])('an unknown view %j is refused as bad input', async (payload) => {
    unit({ setting: true, account: DEMO_PARENT });

    const res = await request(app).post('/api/v1/auth/demo-login').send(payload);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(Array.isArray(res.body.errors)).toBe(true);
  });

  test('a database failure answers a generic error, without its details', async () => {
    const { __mClient, __mPool } = require('pg');
    mockQueryImplementation(__mClient, __mPool, (query) => {
      if (query.includes("setting_key = 'demo_sign_in'")) {
        return Promise.reject(new Error('relation "organization_settings" does not exist'));
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app).post('/api/v1/auth/demo-login').send({ view: 'parent' });

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toMatch(/relation|organization_settings/);
  });
});
