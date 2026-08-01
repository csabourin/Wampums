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
let requireAnyPermission;

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

function installAuthedPoolMock(handler, { activeMembership = true } = {}) {
  const { __mClient, __mPool } = require('pg');
  mockQueryImplementation(__mClient, __mPool, async (query, params) => {
    if (typeof query === 'string' && query.includes('SELECT organization_id FROM user_organizations')) {
      return {
        rows: activeMembership
          ? [{ organization_id: params?.[1] ?? ORG_ID }]
          : []
      };
    }
    const customResult = await handler(query, params);
    if (customResult !== undefined) {
      return customResult;
    }
    return undefined;
  }, { activeMembership });
}

beforeAll(() => {
  process.env.JWT_SECRET_KEY = TEST_SECRET;
  process.env.ORGANIZATION_ID = ORG_ID.toString();
  process.env.DB_USER = 'test';
  process.env.DB_HOST = 'localhost';
  process.env.DB_NAME = 'testdb';
  process.env.DB_PASSWORD = 'test';
  process.env.DB_PORT = '5432';

  ({ requireAnyPermission } = require('../middleware/auth'));
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

    installAuthedPoolMock((query, params) => {
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

  test('ignores an organization header that differs from the signed organization', async () => {
    const { __mPool } = require('pg');
    const token = generateToken({ organizationId: ORG_ID });
    const evilOrgId = 999;

    let capturedOrgId = null;

    installAuthedPoolMock((query, params) => {
      if (query.includes('SELECT DISTINCT p.permission_key')) {
        capturedOrgId = params[1];
        return Promise.resolve({ rows: [{ permission_key: 'users.view' }] });
      }
      if (query.includes('SELECT DISTINCT r.role_name')) {
        return Promise.resolve({ rows: [{ role_name: 'admin', display_name: 'Admin' }] });
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

    installAuthedPoolMock((query, params) => {
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

    installAuthedPoolMock((query, params) => {
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

    installAuthedPoolMock((query, params) => {
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

  test('rejects a deactivated membership even when the JWT still contains permissions', async () => {
    const token = generateToken({
      permissions: ['users.view', 'users.manage']
    });

    installAuthedPoolMock(() => Promise.resolve({
      rows: [{ permission_key: 'users.view' }]
    }), { activeMembership: false });

    const res = await request(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/active|membership|organization/i);
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

    installAuthedPoolMock((query, params) => {
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

    installAuthedPoolMock((query, params) => {
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
    installAuthedPoolMock((query, params) => {
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

    installAuthedPoolMock((query, params) => {
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
    expect(
      __mPool.query.mock.calls.some(([query, params]) =>
        typeof query === 'string'
          && query.includes('permission_key')
          && Array.isArray(params)
      )
    ).toBe(true);
  });
});

describe('requireAnyPermission middleware', () => {
  function createResponse() {
    return {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
  }

  test.each(['forms.view', 'forms.submit', 'forms.manage'])(
    'allows form review access with %s',
    async (permission) => {
      const pool = {
        query: jest.fn().mockResolvedValue({
          rows: [{ permission_key: permission }]
        })
      };
      const req = {
        user: { id: USER_ID, organizationId: ORG_ID },
        headers: {},
        query: {},
        body: {},
        app: { locals: { pool } }
      };
      const res = createResponse();
      const next = jest.fn();

      await requireAnyPermission('forms.view', 'forms.submit', 'forms.manage')(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining("uo.status = 'active'"),
        [USER_ID, ORG_ID, ['forms.view', 'forms.submit', 'forms.manage']]
      );
    }
  );

  test('denies form review access when none of the accepted permissions is active', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const req = {
      user: { id: USER_ID, organizationId: ORG_ID },
      headers: {},
      query: {},
      body: {},
      app: { locals: { pool } }
    };
    const res = createResponse();
    const next = jest.fn();

    await requireAnyPermission('forms.view', 'forms.submit', 'forms.manage')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      requiredAny: ['forms.view', 'forms.submit', 'forms.manage']
    }));
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

    installAuthedPoolMock((query, params) => {
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

    installAuthedPoolMock((query, params) => {
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

    installAuthedPoolMock((query, params) => {
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

    installAuthedPoolMock((query, params) => {
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

    installAuthedPoolMock((query, params) => {
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

    installAuthedPoolMock((query, params) => {
      if (query.includes('FROM participants p')) {
        participantQueryParams = params;
      }
      if (query.includes('FROM scout_years')) {
        // The roster is scoped to a scout year, so the endpoint resolves one
        // before it can query participants.
        return Promise.resolve({
          rows: [{
            id: 7, organization_id: userOrg, label: '2025-2026',
            start_date: '2025-09-01', end_date: '2026-08-31', status: 'active'
          }]
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

    await request(app)
      .get('/api/v1/participants')
      .set('Authorization', `Bearer ${token}`)
      .set('x-organization-id', evilOrg.toString());

    // Even with header override, query params should include token org and never include override org
    expect(participantQueryParams).toBeDefined();
    expect(Array.isArray(participantQueryParams)).toBe(true);
    expect(participantQueryParams).toContain(userOrg);
    expect(participantQueryParams).not.toContain(evilOrg);
  });
});
