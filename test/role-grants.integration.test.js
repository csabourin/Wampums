/**
 * Granting only what one holds — integration suite
 *
 * Assigning or removing a role, adding or removing a permission on a role, and
 * deleting a role all require the caller to hold the permissions involved. A
 * self-scoped permission (permissions.self_scoped, migration 013) does not
 * count in a role limited to linked children, and does count in an
 * organization-wide one. Runs the real routes, requirePermission and SQL.
 *
 * Skipped unless SCOUT_YEAR_TEST_DATABASE_URL (or TEST_DATABASE_URL) points at
 * a disposable database holding the project schema, permission catalog and
 * migrations.
 *
 * @module test/role-grants.integration
 */

const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');

require('./jest-conditional-helpers');

const DATABASE_URL = process.env.SCOUT_YEAR_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL;

process.env.JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || 'role-grants-integration-secret';

const mockContext = { userId: null, organizationId: null };

jest.mock('../middleware/auth', () => {
  const actual = jest.requireActual('../middleware/auth');
  return {
    ...actual,
    authenticate: (req, _res, next) => {
      req.user = { id: mockContext.userId, organizationId: mockContext.organizationId, permissions: [] };
      next();
    },
  };
});

describe.skipIf(!DATABASE_URL)('Granting only what one holds', () => {
  let pool;
  let app;
  const ids = {};
  const suffix = Date.now();

  async function one(sql, params = []) {
    const result = await pool.query(sql, params);
    return result.rows[0] ? Object.values(result.rows[0])[0] : undefined;
  }

  async function createRole(key, dataScope, permissionKeys) {
    const roleId = await one(
      `INSERT INTO roles (role_name, display_name, data_scope, is_system_role, organization_id)
       VALUES ($1, $1, $2, false, $3) RETURNING id`,
      [`${key}_${suffix}`, dataScope, ids.unit]
    );
    await pool.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT $1, id FROM permissions WHERE permission_key = ANY($2::text[])`,
      [roleId, permissionKeys]
    );
    return roleId;
  }

  async function createMember(roleIds) {
    const userId = await one(
      `INSERT INTO users (email, password, full_name)
       VALUES ('grants-' || gen_random_uuid() || '@example.test', 'x', 'Member') RETURNING id`
    );
    await pool.query(
      `INSERT INTO user_organizations (user_id, organization_id, role_ids, status)
       VALUES ($1, $2, $3, 'active')`,
      [userId, ids.unit, JSON.stringify(roleIds)]
    );
    return userId;
  }

  async function rolesOf(userId) {
    return (await one(
      'SELECT role_ids FROM user_organizations WHERE user_id = $1 AND organization_id = $2',
      [userId, ids.unit]
    )).map(Number).sort((a, b) => a - b);
  }

  async function permissionId(key) {
    return one('SELECT id FROM permissions WHERE permission_key = $1', [key]);
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      ids.unit = (await client.query("INSERT INTO organizations (name) VALUES ('Role grants unit') RETURNING id")).rows[0].id;
      await client.query(
        `INSERT INTO organization_program_sections (organization_id, section_key, display_name)
         VALUES ($1, 'general', 'General')`,
        [ids.unit]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    ids.granter = await createRole('granter', 'organization', [
      'users.view', 'users.assign_roles', 'roles.view', 'roles.manage', 'carpools.view',
    ]);
    ids.plain = await createRole('plain', 'organization', ['carpools.view']);
    ids.high = await createRole('high', 'organization', ['carpools.view', 'finance.manage']);
    ids.family = await createRole('family', 'linked', ['carpools.view', 'participants.create_own']);
    ids.orgSelf = await createRole('org_self', 'organization', ['participants.create_own']);

    ids.caller = await createMember([ids.granter]);
    mockContext.userId = ids.caller;
    mockContext.organizationId = ids.unit;

    app = express();
    app.use(express.json());
    app.locals.pool = pool;
    app.use('/api/v1/users', require('../routes/users')(pool, console));
    app.use(require('../routes/roles')(pool, console));
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  test('the roles list says which roles the caller may grant', async () => {
    const response = await request(app).get('/api/v1/roles');

    expect(response.status).toBe(200);
    const assignable = Object.fromEntries(response.body.data.map((role) => [role.id, role.assignable]));
    expect(assignable[ids.plain]).toBe(true);
    expect(assignable[ids.high]).toBe(false);
    expect(assignable[ids.family]).toBe(true);
    expect(assignable[ids.orgSelf]).toBe(false);
  });

  test('adds a grantable role while keeping one the caller could not grant', async () => {
    const target = await createMember([ids.high]);

    const response = await request(app)
      .put(`/api/v1/users/${target}/roles`)
      .send({ roleIds: [ids.high, ids.plain] });

    expect(response.status).toBe(200);
    expect(await rolesOf(target)).toEqual([ids.plain, ids.high].sort((a, b) => a - b));
  });

  test('refuses to remove a role carrying a permission the caller lacks', async () => {
    const target = await createMember([ids.high]);

    const response = await request(app)
      .put(`/api/v1/users/${target}/roles`)
      .send({ roleIds: [ids.plain] });

    expect(response.status).toBe(403);
    expect(response.body.missing).toEqual(['finance.manage']);
    expect(response.body.required).toEqual(expect.arrayContaining(['finance.manage', 'carpools.view']));
    expect(await rolesOf(target)).toEqual([ids.high]);
  });

  test('the legacy single-role endpoint follows the same rule', async () => {
    const target = await createMember([ids.plain]);

    const response = await request(app)
      .post('/api/v1/users/update-role')
      .send({ user_id: target, role: `high_${suffix}` });

    expect(response.status).toBe(403);
    expect(await rolesOf(target)).toEqual([ids.plain]);
  });

  test('a self-scoped permission does not count in a linked role', async () => {
    const target = await createMember([ids.plain]);

    const response = await request(app)
      .put(`/api/v1/users/${target}/roles`)
      .send({ roleIds: [ids.plain, ids.family] });

    expect(response.status).toBe(200);
  });

  test('a self-scoped permission counts in an organization-wide role', async () => {
    const target = await createMember([ids.plain]);

    const response = await request(app)
      .put(`/api/v1/users/${target}/roles`)
      .send({ roleIds: [ids.plain, ids.orgSelf] });

    expect(response.status).toBe(403);
    expect(response.body.missing).toEqual(['participants.create_own']);
  });

  test('adding or removing a permission on a role requires holding it', async () => {
    const custom = await createRole('custom', 'organization', ['finance.manage']);

    const add = await request(app)
      .post(`/api/v1/roles/${custom}/permissions`)
      .send({ permissionId: await permissionId('finance.approve') });
    expect(add.status).toBe(403);
    expect(add.body.missing).toEqual(['finance.approve']);

    const addHeld = await request(app)
      .post(`/api/v1/roles/${custom}/permissions`)
      .send({ permissionId: await permissionId('carpools.view') });
    expect(addHeld.status).toBe(200);

    const remove = await request(app)
      .delete(`/api/v1/roles/${custom}/permissions/${await permissionId('finance.manage')}`);
    expect(remove.status).toBe(403);
  });

  test('deleting a role requires holding its permissions', async () => {
    const response = await request(app).delete(`/api/v1/roles/${ids.high}`);

    expect(response.status).toBe(403);
    expect(response.body.missing).toEqual(['finance.manage']);
    expect(await one('SELECT count(*)::int FROM roles WHERE id = $1', [ids.high])).toBe(1);
  });
});
