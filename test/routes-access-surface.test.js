/**
 * What the API answers outside /api/v1, and the unit leaders list.
 *
 * - Authentication lives under /api/v1/auth; the old paths still answer for
 *   mobile builds already installed.
 * - Only two signed-out organization reads remain under /public. The whole
 *   organizations router used to be mounted there as well, writes included,
 *   along with an unauthenticated POST /create that made verified accounts.
 * - The leaders list is decided by the roles' data scope, never their names,
 *   and carries no contact details.
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { closeServerResources } = require('./test-helpers');

jest.mock('pg', () => {
  const mClient = { query: jest.fn(), release: jest.fn() };
  const mPool = {
    connect: jest.fn(() => Promise.resolve(mClient)),
    query: jest.fn(),
    on: jest.fn(),
  };
  return { Pool: jest.fn(() => mPool), __esModule: true, __mClient: mClient, __mPool: mPool };
});

const TEST_SECRET = 'testsecret';
const ORG_ID = 3;
const NOT_FOUND = 404;
const BAD_REQUEST = 400;
const OK = 200;
let app;

beforeAll(() => {
  process.env.JWT_SECRET_KEY = TEST_SECRET;
  process.env.ORGANIZATION_ID = String(ORG_ID);
  app = require('../api');
});

beforeEach(() => {
  const { __mClient, __mPool } = require('pg');
  __mPool.query.mockReset();
  __mClient.query.mockReset();
  __mPool.query.mockResolvedValue({ rows: [] });
  __mClient.query.mockResolvedValue({ rows: [] });
});

afterAll((done) => {
  closeServerResources(app, done);
});

describe('authentication paths', () => {
  test.each([
    '/api/v1/auth/login',
    '/public/login',
    '/api/v1/auth/register',
    '/public/register',
  ])('%s is routed (validation answers, not 404/410)', async (path) => {
    const res = await request(app).post(path).send({});
    expect(res.status).toBe(BAD_REQUEST);
  });

  test('the unused /api/auth/register copy is gone', async () => {
    const res = await request(app).post('/api/auth/register').send({});
    expect(res.status).not.toBe(BAD_REQUEST);
  });
});

describe('/public surface', () => {
  test.each([
    ['post', '/public/organizations/create'],
    ['post', '/public/create'],
    ['patch', '/public/settings/organization-info'],
    ['post', '/public/switch'],
  ])('%s %s is not served', async (method, path) => {
    const res = await request(app)[method](path).send({});
    expect(res.status).toBe(NOT_FOUND);
  });

  test('GET /public/organizations/info falls through to the web app, not the API', async () => {
    const res = await request(app).get('/public/organizations/info');
    expect(res.headers['content-type']).not.toMatch(/json/);
  });

  test('public settings answer at the versioned path', async () => {
    const res = await request(app).get('/api/v1/organizations/settings/public');
    expect(res.status).toBe(OK);
    expect(res.body.success).toBe(true);
  });
});

describe('GET /api/v1/users/leaders', () => {
  test('selects leaders by data scope and returns names only', async () => {
    const { __mPool } = require('pg');
    __mPool.query.mockImplementation(async (sql) => {
      if (sql.includes("r.data_scope = 'organization'")) {
        return { rows: [{ id: 'leader-uuid', full_name: 'Akela' }] };
      }
      if (sql.includes('FROM user_organizations') && sql.includes("status = 'active'")) {
        return { rows: [{ organization_id: ORG_ID }] };
      }
      return { rows: [] };
    });
    const token = jwt.sign({ user_id: 'parent-uuid', organizationId: ORG_ID, permissions: [] }, TEST_SECRET);

    const res = await request(app).get('/api/v1/users/leaders').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(OK);
    expect(res.body.data.users).toEqual([{ id: 'leader-uuid', full_name: 'Akela' }]);
    const leadersSql = __mPool.query.mock.calls.map(([sql]) => sql).find((sql) => sql.includes('data_scope'));
    expect(leadersSql).not.toMatch(/role_name/);
  });
});
