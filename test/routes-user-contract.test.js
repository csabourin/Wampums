const { adaptAuthorizationMock } = require('./mock-helpers');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const TEST_SECRET = 'user-contract-secret';
const USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const PENDING_USER_ID = '550e8400-e29b-41d4-a716-446655440001';
const ORGANIZATION_ID = 17;

function token() {
  return jwt.sign({
    user_id: USER_ID,
    user_role: 'district',
    organizationId: ORGANIZATION_ID,
  }, TEST_SECRET);
}

function createFixture(organizations, permissions = ['users.edit']) {
  const pool = {
    query: jest.fn(async (query, params = []) => {
      if (query.includes('SELECT organization_id FROM user_organizations')) {
        return { rows: [{ organization_id: ORGANIZATION_ID }] };
      }
      if (query.includes("role_name IN ('demoadmin', 'demoparent')")) {
        return { rows: [] };
      }
      if (query.includes('SELECT DISTINCT p.permission_key')) {
        return { rows: permissions.map((key) => ({ permission_key: key })) };
      }
      if (query.includes('SELECT DISTINCT r.role_name')) {
        return { rows: [{ role_name: 'district', display_name: 'District' }] };
      }
      if (query.includes('SELECT DISTINCT o.id, o.name')) {
        expect(params).toEqual([USER_ID]);
        return { rows: organizations };
      }
      if (query.includes('SELECT u.id, u.email')) {
        return { rows: [{ id: PENDING_USER_ID, email: 'pending@example.com' }] };
      }
      if (query.includes('UPDATE users SET is_verified')) {
        return { rows: [] };
      }
      return { rows: [] };
    }),
  };
  adaptAuthorizationMock(pool);
  const app = express();
  app.locals.pool = pool;
  app.use(express.json());
  app.use('/api/v1/users', require('../routes/users')(pool, {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }));
  return { app, pool };
}

beforeAll(() => {
  process.env.JWT_SECRET_KEY = TEST_SECRET;
});

test.each([
  [[{ id: 17, name: 'North District', roles: ['district'] }]],
  [[
    { id: 17, name: 'North District', roles: ['district'] },
    { id: 22, name: '12th Group', roles: ['leader'] },
  ]],
])('loads the current user organizations for District Management', async (organizations) => {
  const { app } = createFixture(organizations);
  const response = await request(app)
    .get('/api/v1/users/me/organizations')
    .set('Authorization', `Bearer ${token()}`);

  expect(response.status).toBe(200);
  expect(response.body).toEqual(expect.objectContaining({
    success: true,
    data: organizations,
    timestamp: expect.any(String),
  }));
});

test('approves a pending user through the mounted users endpoint', async () => {
  const { app, pool } = createFixture([]);
  const response = await request(app)
    .post('/api/v1/users/approve')
    .set('Authorization', `Bearer ${token()}`)
    .send({ user_id: PENDING_USER_ID });

  expect(response.status).toBe(200);
  expect(response.body).toEqual(expect.objectContaining({
    success: true,
    message: 'User approved successfully',
  }));
  expect(pool.query).toHaveBeenCalledWith(
    expect.stringContaining('UPDATE users SET is_verified = true'),
    [PENDING_USER_ID]
  );
});

test('organization listing requires authentication', async () => {
  const { app } = createFixture([]);
  const response = await request(app).get('/api/v1/users/me/organizations');

  expect(response.status).toBe(401);
});

test('the family picker lists members of family roles, whatever the unit calls them', async () => {
  const { app, pool } = createFixture([], ['users.view']);
  const response = await request(app)
    .get('/api/v1/users/parents')
    .set('Authorization', `Bearer ${token()}`);

  expect(response.status).toBe(200);
  const [sql, params] = pool.query.mock.calls.find(([query]) => query.includes('account_display_names'));
  expect(sql).toContain("r.data_scope = 'linked'");
  expect(sql).not.toMatch(/role_name/);
  expect(params).toEqual([ORGANIZATION_ID]);
});

test('the leader picker lists members of whole-unit roles, whatever the unit calls them', async () => {
  const { app, pool } = createFixture([], ['users.view']);
  const response = await request(app)
    .get('/api/v1/users/animateurs')
    .set('Authorization', `Bearer ${token()}`);

  expect(response.status).toBe(200);
  const [sql, params] = pool.query.mock.calls.find(([query]) => query.includes('u.nickname'));
  expect(sql).toContain("r.data_scope = 'organization'");
  expect(sql).not.toMatch(/role_name/);
  expect(params).toEqual([ORGANIZATION_ID]);
});
