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
  process.env.JWT_SECRET_KEY = 'testsecret';
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
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
  Pool.mockClear();
});

afterAll((done) => {
  // Close server and socket.io to prevent hanging
  if (app.server) {
    app.server.close(() => {
      if (app.io) {
        app.io.close();
      }
      done();
    });
  } else {
    done();
  }
});

describe('Local groups API', () => {
  test('returns memberships for current organization', async () => {
    const token = jwt.sign({ user_id: 10, organizationId: 5 }, 'testsecret');
    const { __mPool } = require('pg');

    __mPool.query
      .mockResolvedValueOnce({ rows: [{ permission_key: 'org.view' }] }) // permissions
      .mockResolvedValueOnce({ rows: [{ role_name: 'admin', display_name: 'Admin' }] }) // roles
      .mockResolvedValueOnce({ rows: [{ id: 1, name: 'Groupe 6 Aylmer', slug: 'groupe-6-aylmer' }] }); // memberships

    const res = await request(app)
      .get('/api/v1/local-groups/memberships')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].slug).toBe('groupe-6-aylmer');
  });

  test('prevents membership changes without permission', async () => {
    const token = jwt.sign({ user_id: 11, organizationId: 7 }, 'testsecret');
    const { __mPool } = require('pg');

    __mPool.query
      .mockResolvedValueOnce({ rows: [] }) // demo roles
      .mockResolvedValueOnce({ rows: [] }) // permissions missing org.edit
      .mockResolvedValueOnce({ rows: [] }); // roles

    const res = await request(app)
      .post('/api/v1/local-groups/memberships')
      .set('Authorization', `Bearer ${token}`)
      .send({ local_group_id: 2 });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Insufficient permissions');
  });

  test('adds membership when authorized', async () => {
    const token = jwt.sign({ user_id: 12, organizationId: 9 }, 'testsecret');
    const { __mPool } = require('pg');

    __mPool.query
      .mockResolvedValueOnce({ rows: [] }) // demo roles
      .mockResolvedValueOnce({ rows: [{ permission_key: 'org.edit' }] }) // permissions
      .mockResolvedValueOnce({ rows: [{ role_name: 'admin', display_name: 'Admin' }] }) // roles
      .mockResolvedValueOnce({ rows: [{ id: 2, name: 'Hull', slug: 'hull' }] }) // group exists
      .mockResolvedValueOnce({ rows: [] }) // insert membership
      .mockResolvedValueOnce({ rows: [{ id: 2, name: 'Hull', slug: 'hull' }] }); // memberships

    const res = await request(app)
      .post('/api/v1/local-groups/memberships')
      .set('Authorization', `Bearer ${token}`)
      .send({ local_group_id: 2 });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.added.slug).toBe('hull');
    expect(res.body.data.memberships).toHaveLength(1);
  });
});
