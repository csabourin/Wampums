/**
 * Tenant and role-escalation guards on user and role management.
 *
 * - GET /api/v1/users lists the caller's own unit only, whatever the query says.
 * - Someone may grant or remove only roles whose permissions they hold
 *   (services/roleAssignment.js); the roles list says which ones those are.
 * - Creating a role whose name already exists answers 409.
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
  return { Pool: jest.fn(() => mPool), __mClient: mClient, __mPool: mPool };
});

const TEST_SECRET = 'role-assignment-guard-secret';
const ORG_ID = 3;
const OTHER_ORG_ID = 99;
const CALLER_ID = '11111111-1111-4111-8111-111111111111';
const TARGET_ID = '22222222-2222-4222-8222-222222222222';
const DISTRICT_LEVEL_ROLE_ID = 41;
const OTHER_UNIT_ROLE_ID = 77;
const LEADER_ROLE_ID = 2;

let app;

const normalize = (query) => (typeof query === 'string' ? query : query?.text || '')
  .replace(/\s+/g, ' ')
  .trim();

function tokenFor(permissions) {
  return jwt.sign({
    user_id: CALLER_ID,
    organizationId: ORG_ID,
    roleIds: [1],
    roleNames: ['unitadmin'],
    permissions,
  }, TEST_SECRET);
}

/**
 * Answer the middleware lookups (membership, permissions, demo roles, scout
 * year) and delegate everything else to the test's handler.
 */
function mockDatabase({ permissions, handle = () => undefined }) {
  const { __mPool, __mClient } = require('pg');
  const respond = (query, params = []) => {
    const sql = normalize(query);
    const handled = handle(sql, params);
    if (handled) {
      return Promise.resolve(handled);
    }
    if (sql.startsWith('SELECT organization_id FROM user_organizations')) {
      return Promise.resolve({ rows: [{ organization_id: params[1] }] });
    }
    if (sql.startsWith('SELECT DISTINCT p.permission_key')) {
      return Promise.resolve({ rows: permissions.map((key) => ({ permission_key: key })) });
    }
    return Promise.resolve({ rows: [] });
  };
  __mPool.query.mockImplementation(respond);
  __mClient.query.mockImplementation(respond);
}

beforeAll(() => {
  process.env.JWT_SECRET_KEY = TEST_SECRET;
  process.env.ORGANIZATION_ID = String(ORG_ID);
  app = require('../api');
});

beforeEach(() => {
  const { __mPool, __mClient } = require('pg');
  __mPool.query.mockReset();
  __mClient.query.mockReset();
});

afterAll((done) => {
  closeServerResources(app, done);
});

describe('GET /api/v1/users', () => {
  test('ignores an organization_id query naming another unit', async () => {
    const queriedOrganizations = [];
    mockDatabase({
      permissions: ['users.view'],
      handle: (sql, params) => {
        if (sql.includes('FROM users u JOIN user_organizations uo')) {
          queriedOrganizations.push(params[0]);
          return { rows: [] };
        }
        return undefined;
      },
    });

    const res = await request(app)
      .get(`/api/v1/users?organization_id=${OTHER_ORG_ID}`)
      .set('Authorization', `Bearer ${tokenFor(['users.view'])}`);

    expect(res.status).toBe(200);
    expect(queriedOrganizations).toEqual([ORG_ID]);
  });
});

describe('PUT /api/v1/users/:userId/roles', () => {
  const CALLER_PERMISSIONS = ['users.assign_roles', 'carpools.view'];
  /** Permissions each role carries, as loadRolePermissions reports them. */
  const ROLE_PERMISSIONS = {
    [LEADER_ROLE_ID]: ['carpools.view'],
    [DISTRICT_LEVEL_ROLE_ID]: ['carpools.view', 'roles.manage'],
  };

  /**
   * @param {number[]} currentRoleIds - Roles the member holds before the request
   * @param {Array} writes - Collects UPDATE parameters
   * @param {string[]} statements - Collects transaction statements
   */
  const handleRoles = (currentRoleIds, writes, statements) => (sql, params) => {
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) {
      statements.push(sql);
      return { rows: [] };
    }
    if (sql.startsWith('SELECT id, role_name, is_system_role, organization_id, data_scope FROM roles')) {
      // findRolesInUnit: only roles the caller's unit may use come back.
      expect(params[1]).toBe(ORG_ID);
      return {
        rows: params[0]
          .filter((id) => id !== OTHER_UNIT_ROLE_ID)
          .map((id) => ({ id, role_name: `role_${id}`, is_system_role: false, organization_id: ORG_ID })),
      };
    }
    if (sql.startsWith('SELECT role_ids FROM user_organizations')) {
      expect(sql).toContain('FOR UPDATE');
      return { rows: [{ role_ids: currentRoleIds }] };
    }
    if (sql.startsWith('SELECT r.id, r.role_name,')) {
      return {
        rows: params[0].map((id) => ({ id, role_name: `role_${id}`, permissions: ROLE_PERMISSIONS[id] || [] })),
      };
    }
    if (sql.startsWith('UPDATE user_organizations')) {
      writes.push(params);
      return { rows: [] };
    }
    return undefined;
  };

  async function putRoles(currentRoleIds, roleIds) {
    const writes = [];
    const statements = [];
    mockDatabase({ permissions: CALLER_PERMISSIONS, handle: handleRoles(currentRoleIds, writes, statements) });
    const res = await request(app)
      .put(`/api/v1/users/${TARGET_ID}/roles`)
      .set('Authorization', `Bearer ${tokenFor(CALLER_PERMISSIONS)}`)
      .send({ roleIds });
    return { res, writes, statements };
  }

  test('refuses to grant a role carrying a permission the caller lacks', async () => {
    const { res, writes, statements } = await putRoles([LEADER_ROLE_ID], [LEADER_ROLE_ID, DISTRICT_LEVEL_ROLE_ID]);

    expect(res.status).toBe(403);
    expect(res.body.missing).toEqual(['roles.manage']);
    expect(res.body.required).toEqual(['carpools.view', 'roles.manage']);
    expect(writes).toHaveLength(0);
    expect(statements).toContain('ROLLBACK');
  });

  test('refuses to remove such a role from someone who holds it', async () => {
    const { res, writes } = await putRoles([DISTRICT_LEVEL_ROLE_ID], [LEADER_ROLE_ID]);

    expect(res.status).toBe(403);
    expect(writes).toHaveLength(0);
  });

  test('grants a role whose permissions the caller holds', async () => {
    const { res, writes, statements } = await putRoles([], [LEADER_ROLE_ID]);

    expect(res.status).toBe(200);
    expect(writes).toEqual([[JSON.stringify([LEADER_ROLE_ID]), TARGET_ID, ORG_ID]]);
    expect(statements).toEqual(['BEGIN', 'COMMIT']);
  });

  test('leaves a role the caller could not grant in place while adding another', async () => {
    const { res, writes } = await putRoles([DISTRICT_LEVEL_ROLE_ID], [String(DISTRICT_LEVEL_ROLE_ID), LEADER_ROLE_ID]);

    expect(res.status).toBe(200);
    expect(writes).toHaveLength(1);
  });

  test('rejects a role belonging to another unit', async () => {
    const { res, writes } = await putRoles([LEADER_ROLE_ID], [LEADER_ROLE_ID, OTHER_UNIT_ROLE_ID]);

    expect(res.status).toBe(400);
    expect(writes).toHaveLength(0);
  });

  test('rejects role IDs that are not integers', async () => {
    const { res, writes } = await putRoles([], ['admin']);

    expect(res.status).toBe(400);
    expect(writes).toHaveLength(0);
  });
});

describe('GET /api/v1/roles', () => {
  test('lists the built-in and own-unit roles with whether the caller may grant each', async () => {
    let listing = null;
    const permissions = ['roles.view', 'carpools.view'];
    mockDatabase({
      permissions,
      handle: (sql, params) => {
        if (sql.startsWith('SELECT r.id, r.role_name')) {
          listing = { sql, params };
          return { rows: [{ id: 1, role_name: 'district', assignable: false }] };
        }
        return undefined;
      },
    });

    const res = await request(app)
      .get('/api/v1/roles')
      .set('Authorization', `Bearer ${tokenFor(permissions)}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ id: 1, role_name: 'district', assignable: false }]);
    expect(listing.params).toEqual([permissions, ORG_ID]);
    expect(listing.sql).toContain('r.organization_id = $2 OR (r.organization_id IS NULL AND r.is_system_role)');
    expect(listing.sql).toContain("NOT (p.self_scoped AND r.data_scope = 'linked')");
    expect(listing.sql).not.toMatch(/WHERE\s+r\.role_name|role_name != /);
  });
});

describe('POST /api/v1/roles', () => {
  test('answers 409 when the role name already exists', async () => {
    const permissions = ['roles.manage'];
    mockDatabase({
      permissions,
      handle: (sql) => {
        if (sql.startsWith('INSERT INTO roles')) {
          const duplicate = new Error('duplicate key value');
          duplicate.code = '23505';
          throw duplicate;
        }
        return undefined;
      },
    });

    const res = await request(app)
      .post('/api/v1/roles')
      .set('Authorization', `Bearer ${tokenFor(permissions)}`)
      .send({ role_name: 'leader', display_name: 'Leader' });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
  });
});
