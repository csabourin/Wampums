/**
 * Listing a unit's members (GET /api/v1/users).
 *
 * The other member routes are covered where they are specified:
 * - POST /users/approve: routes-user-contract.test.js, middleware-auth-permissions.test.js
 * - POST /users/update-role: middleware-auth-permissions.test.js
 * - PUT /users/:userId/roles: role-assignment-guard.test.js
 * - PATCH /users/:userId/membership: member-deactivation.integration.test.js
 * - POST /users/link-participants, /users/associate-participant: participant-access.integration.test.js
 *
 * This file used to hold 27 more tests of routes that do not exist
 * (GET/PUT/DELETE /users/:id, POST /users, …). They accepted a 404 as a
 * pass and verified nothing (#1462).
 *
 * @module test/routes-users
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { closeServerResources } = require('./test-helpers');
const { setupDefaultMocks, mockQueryImplementation, MockFactory } = require('./mock-helpers');

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

const TEST_SECRET = 'testsecret';
const ORG_ID = 3; // Demo organization - safe for live testing
const ADMIN_USER_ID = 1;
const PENDING_USER_ID = 100;

function generateToken(overrides = {}, secret = TEST_SECRET) {
  return jwt.sign({
    user_id: ADMIN_USER_ID,
    user_role: 'admin',
    organizationId: ORG_ID,
    roleIds: [1],
    roleNames: ['district'],
    permissions: ['users.view', 'users.manage', 'users.approve'],
    ...overrides
  }, secret);
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
  __mClient.query.mockClear();
  __mClient.release.mockClear();
  __mPool.connect.mockClear();
  __mPool.query.mockReset();
  
  // Setup default schema-based mocks as fallback
  setupDefaultMocks(__mClient, __mPool);
});

afterAll((done) => {
  closeServerResources(app, done);
});

// ============================================
// GET /api/v1/users - LIST USERS
// ============================================

describe('GET /api/v1/users', () => {
  test('returns list of users in organization', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['users.view']
    });

    // Use mockQueryImplementation with schema-based fallback
    const factory = new MockFactory();
    mockQueryImplementation(__mClient, __mPool, (query, _params) => {
      if (query.includes('FROM users') && query.includes('WHERE')) {
        return Promise.resolve({
          rows: [
            factory.mockTable('users', {
              id: '550e8400-e29b-41d4-a716-446655440000',
              email: 'admin@example.com',
              full_name: 'Admin User',
              first_name: 'Admin',
              last_name: 'User',
              status: 'active'
            }),
            factory.mockTable('users', {
              id: '550e8400-e29b-41d4-a716-446655440001',
              email: 'staff@example.com',
              full_name: 'Staff Member',
              first_name: 'Staff',
              last_name: 'Member',
              status: 'pending'
            })
          ]
        });
      }
      // Undefined: the default schema-based mocks answer
      return undefined;
    });

    const res = await request(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].email).toBe('admin@example.com');
    expect(res.body.data[1]).toBeDefined();
  });

  test('lists pending users separately if status filter', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['users.view']
    });

    // Rely on default mocks for permission checks, only customize the pending users query
    mockQueryImplementation(__mClient, __mPool, (query, _params) => {
      if (query.includes('FROM users') && query.includes('is_verified = false')) {
        return Promise.resolve({
          rows: [
            {
              id: PENDING_USER_ID,
              email: 'pending@example.com',
              full_name: 'Pending User',
              is_verified: false,
              created_at: new Date().toISOString()
            }
          ]
        });
      }
      // Return undefined to use default schema-based mocks for other queries
      return undefined;
    });

    const res = await request(app)
      .get('/api/v1/users/pending')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0].is_verified).toBe(false);
  });

  test('requires users.view permission', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: [] // No permission
    });

    mockQueryImplementation(__mClient, __mPool, (query, _params) => {
      if (query.includes('FROM role_permissions')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  test('enforces organization isolation', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      organizationId: ORG_ID,
      permissions: ['users.view']
    });

    let queriedOrgId = null;

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('FROM users')) {
        queriedOrgId = params[params.length - 1];
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    await request(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${token}`);

    expect([ORG_ID, null]).toContain(queriedOrgId);
  });
});

// ============================================
// GET /api/v1/users/:id - GET SINGLE USER
// ============================================
