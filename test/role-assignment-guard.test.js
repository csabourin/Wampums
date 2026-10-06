/**
 * Tenant and role-escalation guards on user and role management.
 *
 * - GET /api/v1/users lists the caller's own unit only, whatever the query says.
 * - A role is district-level when it grants users.assign_district, not when it
 *   is named 'district'. Only holders of that permission may assign or list it.
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
const RENAMED_DISTRICT_ROLE_ID = 41;
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
  /** A role named 'chef-de-district' that carries users.assign_district. */
  const handleRoles = (writes) => (sql, params) => {
    if (sql.startsWith('SELECT id, role_name FROM roles WHERE id = ANY')) {
      return {
        rows: params[0].map((id) => ({
          id,
          role_name: id === RENAMED_DISTRICT_ROLE_ID ? 'chef-de-district' : 'leader',
        })),
      };
    }
    if (sql.startsWith('SELECT DISTINCT rp.role_id AS id')) {
      expect(params[1]).toBe('users.assign_district');
      return {
        rows: params[0]
          .filter((id) => id === RENAMED_DISTRICT_ROLE_ID)
          .map((id) => ({ id })),
      };
    }
    if (sql.startsWith('SELECT id FROM user_organizations')) {
      return { rows: [{ id: 1 }] };
    }
    if (sql.startsWith('UPDATE user_organizations')) {
      writes.push(params);
      return { rows: [] };
    }
    return undefined;
  };

  test('refuses a renamed role that grants users.assign_district', async () => {
    const writes = [];
    const permissions = ['users.assign_roles'];
    mockDatabase({ permissions, handle: handleRoles(writes) });

    const res = await request(app)
      .put(`/api/v1/users/${TARGET_ID}/roles`)
      .set('Authorization', `Bearer ${tokenFor(permissions)}`)
      .send({ roleIds: [RENAMED_DISTRICT_ROLE_ID] });

    expect(res.status).toBe(403);
    expect(writes).toHaveLength(0);
  });

  test('allows an ordinary role without users.assign_district', async () => {
    const writes = [];
    const permissions = ['users.assign_roles'];
    mockDatabase({ permissions, handle: handleRoles(writes) });

    const res = await request(app)
      .put(`/api/v1/users/${TARGET_ID}/roles`)
      .set('Authorization', `Bearer ${tokenFor(permissions)}`)
      .send({ roleIds: [LEADER_ROLE_ID] });

    expect(res.status).toBe(200);
    expect(writes).toHaveLength(1);
  });

  test('lets a holder of users.assign_district assign the district-level role', async () => {
    const writes = [];
    const permissions = ['users.assign_roles', 'users.assign_district'];
    mockDatabase({ permissions, handle: handleRoles(writes) });

    const res = await request(app)
      .put(`/api/v1/users/${TARGET_ID}/roles`)
      .set('Authorization', `Bearer ${tokenFor(permissions)}`)
      .send({ roleIds: [RENAMED_DISTRICT_ROLE_ID] });

    expect(res.status).toBe(200);
    expect(writes).toHaveLength(1);
  });
});

describe('GET /api/v1/roles', () => {
  test('hides district-level roles by permission, not by name', async () => {
    let listing = null;
    const permissions = ['roles.view'];
    mockDatabase({
      permissions,
      handle: (sql, params) => {
        if (sql.startsWith('SELECT r.id, r.role_name')) {
          listing = { sql, params };
          return { rows: [] };
        }
        return undefined;
      },
    });

    const res = await request(app)
      .get('/api/v1/roles')
      .set('Authorization', `Bearer ${tokenFor(permissions)}`);

    expect(res.status).toBe(200);
    expect(listing.params).toEqual([true, 'users.assign_district']);
    expect(listing.sql).not.toMatch(/role_name != 'district'/);
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
