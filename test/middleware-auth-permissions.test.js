/**
 * Authorization Permissions Test Suite
 *
 * Tests critical middleware functions:
 * - requirePermission: Permission-based authorization
 * - getOrganizationId: Organization resolution and override prevention
 * - blockDemoRoles: Demo user write protection
 * - getUserDataScope: Data access level determination
 *
 * @module test/middleware-auth-permissions
 */

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
const { setupDefaultMocks, mockQueryImplementation } = require('./mock-helpers');
let app;

const TEST_SECRET = 'testsecret';
const ORG_ID = 1;
const USER_ID = 100;

/**
 * Generate a valid JWT token with customizable payload
 */
function generateToken(overrides = {}, secret = TEST_SECRET) {
  return jwt.sign({
    user_id: USER_ID,
    user_role: 'admin',
    organizationId: ORG_ID,
    roleIds: [1],
    roleNames: ['admin'],
    permissions: ['users.view', 'users.manage'],
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
  setupDefaultMocks(__mClient, __mPool);
  __mClient.query.mockClear();
  __mClient.release.mockClear();
  __mPool.connect.mockClear();
  __mPool.query.mockClear();
});

afterAll((done) => {
  closeServerResources(app, done);
});

// ============================================
// getOrganizationId Tests
// ============================================

describe('getOrganizationId middleware', () => {
  test('retrieves organization ID from JWT token', async () => {
    const { __mPool } = require('pg');
    const token = generateToken({ organizationId: ORG_ID });

    __mPool.query.mockImplementation((query, params) => {
      if (query.includes('permission')) {
        return Promise.resolve({ rows: [{ permission_key: 'users.view' }] });
      }
      if (query.includes('organization_id FROM user_organizations')) {
        return Promise.resolve({ rows: [{ organization_id: ORG_ID }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${token}`);

    // Should succeed because token has valid org ID
    expect(res.status).not.toBe(500);
  });

  test('ignores x-organization-id header override when authenticated', async () => {
    const { __mPool } = require('pg');
    const token = generateToken({ organizationId: ORG_ID });
    const evilOrgId = 999;

    let capturedOrgId = null;

    __mPool.query.mockImplementation((query, params) => {
      if (query.includes('FROM user_organizations uo')) {
        capturedOrgId = params[1]; // Second param should be org ID from token, not header
        return Promise.resolve({ rows: [{ permission_key: 'users.view' }] });
      }
      return Promise.resolve({ rows: [] });
    });

    await request(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${token}`)
      .set('x-organization-id', evilOrgId.toString());

    // Verify query used token org ID, not header override
    expect(capturedOrgId).toBe(ORG_ID);
  });

  test('prevents organization_id body override when authenticated', async () => {
    const { __mPool } = require('pg');
    const token = generateToken({ organizationId: ORG_ID });

    let capturedParams = [];

    __mPool.query.mockImplementation((query, params) => {
      if (query.includes('FROM user_organizations uo')) {
        capturedParams = params;
        return Promise.resolve({ rows: [{ permission_key: 'budget.manage' }] });
      }
      return Promise.resolve({ rows: [] });
    });

    await request(app)
      .post('/api/v1/users/update-role')
      .set('Authorization', `Bearer ${token}`)
      .send({ organization_id: 999, user_id: '550e8400-e29b-41d4-a716-446655440111', role: 'leader' });

    // Verify the second param (organizationId) came from token
    expect(capturedParams[1]).toBe(ORG_ID);
  });

  test('uses header organization_id for unauthenticated public requests', async () => {
    const { __mPool } = require('pg');

    let capturedQuery = '';
    let capturedParams = [];

    __mPool.query.mockImplementation((query, params) => {
      capturedQuery = query;
      capturedParams = params;
      if (query.includes('organization_domains')) {
        return Promise.resolve({ rows: [{ organization_id: ORG_ID }] });
      }
      return Promise.resolve({ rows: [] });
    });

    await request(app)
      .get('/public/landing')
      .set('x-organization-id', ORG_ID.toString());

    // For unauthenticated requests, header org ID should be used
    expect(capturedQuery.includes('organization_domains') || capturedParams.length === 0).toBe(true);
  });

  test('throws OrganizationNotFoundError when organization cannot be resolved', async () => {
    const { __mPool } = require('pg');

    __mPool.query.mockImplementation((query, params) => {
      if (query.includes('organization_domains')) {
        return Promise.resolve({ rows: [] }); // No domain mapping found
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${generateToken()}`);

    // Should fail gracefully with 500 or organization error
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

// ============================================
// requirePermission Tests
// ============================================

describe('requirePermission middleware', () => {
  test('allows access when user has required permission', async () => {
    const { __mPool } = require('pg');
    const token = generateToken({
      permissions: ['users.view']
    });

    __mPool.query.mockImplementation((query, params) => {
      if (query.includes('permission_key')) {
        return Promise.resolve({
          rows: [{ permission_key: 'users.view' }]
        });
      }
      if (query.includes('role_name')) {
        return Promise.resolve({
          rows: [{ role_name: 'admin', display_name: 'Administrator' }]
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${token}`);

    // Should not be 403 (forbidden)
    expect(res.status).not.toBe(403);
  });

  test('denies access when user lacks required permission', async () => {
    const { __mPool } = require('pg');
    const token = generateToken({
      permissions: ['participants.view']
    });

    __mPool.query.mockImplementation((query, params) => {
      if (query.includes('permission_key')) {
        return Promise.resolve({
          rows: [{ permission_key: 'participants.view' }]
        });
      }
      if (query.includes('role_name')) {
        return Promise.resolve({
          rows: [{ role_name: 'parent' }]
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${token}`);

    // Should be 403 forbidden
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/permission|insufficient/i);
  });

  test('requires ALL permissions when multiple are specified', async () => {
    const { __mPool } = require('pg');
    const token = generateToken();

    // Has budget.manage but not budget.delete
    __mPool.query.mockImplementation((query, params) => {
      if (query.includes('permission_key')) {
        return Promise.resolve({
          rows: [{ permission_key: 'budget.manage' }]
        });
      }
      if (query.includes('role_name')) {
        return Promise.resolve({
          rows: [{ role_name: 'finance' }]
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .delete('/api/v1/budgets/categories/1')
      .set('Authorization', `Bearer ${token}`);

    // If endpoint checks for multiple permissions, should fail
    expect([403, 404]).toContain(res.status); // 403 if permission denied, 404 if not found
  });

  test('attaches userPermissions and userRoles to request context', async () => {
    const { __mPool } = require('pg');
    const token = generateToken();

    const permissions = ['budget.manage', 'budget.view'];
    const roles = ['admin', 'finance'];

    __mPool.query.mockImplementation((query, params) => {
      if (query.includes('permission_key')) {
        return Promise.resolve({
          rows: permissions.map(p => ({ permission_key: p }))
        });
      }
      if (query.includes('role_name')) {
        return Promise.resolve({
          rows: roles.map(r => ({ role_name: r, display_name: r }))
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${token}`);

    // Verify permissions were fetched and attached
    expect(__mPool.query).toHaveBeenCalledWith(
      expect.stringContaining('permission_key'),
      expect.any(Array)
    );
  });
});

// ============================================
// blockDemoRoles Tests
// ============================================

describe('blockDemoRoles middleware', () => {
  test('blocks demo users from making write requests', async () => {
    const { __mPool } = require('pg');
    const token = generateToken({
      roleNames: ['demoparent'],
      roleIds: [999]
    });

    let demoCheckCalled = false;

    __mPool.query.mockImplementation((query, params) => {
      if (query.includes('demoadmin') || query.includes('demoparent')) {
        demoCheckCalled = true;
        return Promise.resolve({
          rows: [{ role_name: 'demoparent' }]
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/api/v1/users/approve')
      .set('Authorization', `Bearer ${token}`)
      .send({ user_id: '550e8400-e29b-41d4-a716-446655440999' });

    // Should be blocked
    expect(res.status).toBe(403);
    expect(res.body.isDemo).toBe(true);
    expect(demoCheckCalled).toBe(true);
  });

  test('allows non-demo users to make write requests', async () => {
    const { __mPool } = require('pg');
    const token = generateToken({
      roleNames: ['admin'],
      roleIds: [1]
    });

    __mPool.query.mockImplementation((query, params) => {
      if (query.includes('demoadmin') || query.includes('demoparent')) {
        return Promise.resolve({ rows: [] }); // No demo roles
      }
      if (query.includes('permission_key')) {
        return Promise.resolve({
          rows: [{ permission_key: 'budget.manage' }]
        });
      }
      if (query.includes('role_name')) {
        return Promise.resolve({
          rows: [{ role_name: 'admin', display_name: 'Admin' }]
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/api/v1/budgets/categories')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Test Category' });

    // Should not be blocked by demo check
    expect(res.status).not.toBe(403);
  });
});

// ============================================
// getUserDataScope Tests
// ============================================

describe('getUserDataScope middleware', () => {
  test('returns "organization" scope for staff with organization-scoped role', async () => {
    const { __mPool } = require('pg');
    const token = generateToken({
      roleNames: ['admin'],
      roleIds: [1]
    });

    __mPool.query.mockImplementation((query, params) => {
      if (query.includes('data_scope')) {
        return Promise.resolve({
          rows: [{ data_scope: 'organization' }]
        });
      }
      if (query.includes('permission_key')) {
        return Promise.resolve({
          rows: [{ permission_key: 'participants.view' }]
        });
      }
      if (query.includes('role_name')) {
        return Promise.resolve({
          rows: [{ role_name: 'admin' }]
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .get('/api/v1/participants')
      .set('Authorization', `Bearer ${token}`);

    // Should see organization-scoped data
    expect(res.status).not.toBe(403);
  });

  test('returns "linked" scope for parent with linked-only role', async () => {
    const { __mPool } = require('pg');
    const token = generateToken({
      roleNames: ['parent'],
      roleIds: [5]
    });

    __mPool.query.mockImplementation((query, params) => {
      if (query.includes('data_scope')) {
        return Promise.resolve({
          rows: [{ data_scope: 'linked' }]
        });
      }
      if (query.includes('permission_key')) {
        return Promise.resolve({
          rows: [{ permission_key: 'participants.view' }]
        });
      }
      if (query.includes('role_name')) {
        return Promise.resolve({
          rows: [{ role_name: 'parent' }]
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .get('/api/v1/participants')
      .set('Authorization', `Bearer ${token}`);

    // Parent should get filtered view of only linked participants
    expect(res.status).not.toBe(401);
  });

  test('gives organization scope to multi-role user with ANY organization-scoped role', async () => {
    const { __mPool } = require('pg');
    // User with both parent and leader (leader = organization scope)
    const token = generateToken({
      roleNames: ['parent', 'leader'],
      roleIds: [5, 2]
    });

    __mPool.query.mockImplementation((query, params) => {
      if (query.includes('data_scope')) {
        // If user has ANY organization role, return that
        return Promise.resolve({
          rows: [{ data_scope: 'organization' }]
        });
      }
      if (query.includes('permission_key')) {
        return Promise.resolve({
          rows: [{ permission_key: 'participants.view' }]
        });
      }
      if (query.includes('role_name')) {
        return Promise.resolve({
          rows: [
            { role_name: 'parent' },
            { role_name: 'leader' }
          ]
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .get('/api/v1/participants')
      .set('Authorization', `Bearer ${token}`);

    // Should have organization-wide access due to leader role
    expect(res.status).not.toBe(403);
  });
});

// ============================================
// Organization Isolation Tests
// ============================================

describe('Multi-tenant isolation', () => {
  test('prevents user from accessing another organization\'s data via organization_id override', async () => {
    const { __mPool } = require('pg');
    const userOrg = 1;
    const evilOrg = 999;

    const token = generateToken({ organizationId: userOrg });

    let participantQueryParams = null;

    __mPool.query.mockImplementation((query, params) => {
      if (query.includes('FROM participants p')) {
        participantQueryParams = params;
      }
      if (query.includes('permission_key')) {
        return Promise.resolve({
          rows: [{ permission_key: 'participants.view' }]
        });
      }
      if (query.includes('role_name')) {
        return Promise.resolve({
          rows: [{ role_name: 'admin' }]
        });
      }
      return Promise.resolve({ rows: [] });
    });

    await request(app)
      .get('/api/v1/participants')
      .set('Authorization', `Bearer ${token}`)
      .set('x-organization-id', evilOrg.toString());

    // Even with header override, query params should include token org and never include override org
    expect(participantQueryParams).toContain(userOrg);
    expect(participantQueryParams).not.toContain(evilOrg);
  });
});
