/**
 * Role permissions — integration suite
 *
 * The finance and budget routes answer for every family in a unit. A role
 * limited to its members' own children (data_scope 'linked') that held one of
 * those permissions would read every family's fees, which is how parents
 * reached the finance workspace. Role management must refuse that grant, and
 * only that grant.
 *
 * Skipped unless SCOUT_YEAR_TEST_DATABASE_URL (or TEST_DATABASE_URL) points at
 * a disposable database holding the project schema and permission catalog.
 *
 * @module test/role-permissions.integration
 */

const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');

require('./jest-conditional-helpers');

const DATABASE_URL = process.env.SCOUT_YEAR_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL;

process.env.JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || 'role-permissions-integration-secret';

const mockContext = { userId: null, organizationId: null };

// Only authentication is faked; permissions are checked against the database.
jest.mock('../middleware/auth', () => {
  const actual = jest.requireActual('../middleware/auth');
  return {
    ...actual,
    authenticate: (req, _res, next) => {
      req.user = { id: mockContext.userId, organizationId: mockContext.organizationId };
      next();
    },
  };
});

const { UNIT_FINANCE_PERMISSIONS } = require('../config/constants');

describe.skipIf(!DATABASE_URL)('Role permissions', () => {
  let pool;
  let app;
  const ids = {};
  const suffix = Date.now();

  /**
   * Read a single value.
   *
   * @param {string} sql - Query returning one row and one column
   * @param {Array} params - Query parameters
   * @returns {Promise<*>} The value, or undefined
   */
  async function one(sql, params = []) {
    const result = await pool.query(sql, params);
    return result.rows[0] ? Object.values(result.rows[0])[0] : undefined;
  }

  /**
   * A custom (non-system) role with the given data scope.
   *
   * @param {string} name - Role name prefix
   * @param {string} dataScope - 'organization' or 'linked'
   * @returns {Promise<number>} Role ID
   */
  function role(name, dataScope) {
    return one(
      `INSERT INTO roles (role_name, display_name, data_scope, is_system_role)
       VALUES ($1, $1, $2, false) RETURNING id`,
      [`${name}_${suffix}`, dataScope]
    );
  }

  /**
   * Ask role management to add a permission to a role, as the unit admin.
   *
   * @param {number} roleId - Role
   * @param {string} permissionKey - Permission
   * @returns {Promise<Object>} Supertest response
   */
  async function grant(roleId, permissionKey) {
    const permissionId = await one('SELECT id FROM permissions WHERE permission_key = $1', [permissionKey]);
    return request(app).post(`/api/v1/roles/${roleId}/permissions`).send({ permissionId });
  }

  /**
   * Whether a role holds a permission.
   *
   * @param {number} roleId - Role
   * @param {string} permissionKey - Permission
   * @returns {Promise<boolean>} Held or not
   */
  async function holds(roleId, permissionKey) {
    return (await one(
      `SELECT count(*) FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = $1 AND p.permission_key = $2`,
      [roleId, permissionKey]
    )) === '1';
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });

    // The program section and its unit reference each other; the key is
    // checked at commit.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const created = await client.query("INSERT INTO organizations (name) VALUES ('Role permissions unit') RETURNING id");
      ids.unit = created.rows[0].id;
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

    ids.managerRole = await role('role_manager', 'organization');
    await pool.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT $1, id FROM permissions WHERE permission_key = 'roles.manage'`,
      [ids.managerRole]
    );
    ids.manager = await one(
      `INSERT INTO users (email, password, full_name)
       VALUES ('role-manager-' || gen_random_uuid() || '@example.test', 'x', 'Manager') RETURNING id`
    );
    await pool.query(
      `INSERT INTO user_organizations (user_id, organization_id, role_ids, status)
       VALUES ($1, $2, $3, 'active')`,
      [ids.manager, ids.unit, JSON.stringify([ids.managerRole])]
    );

    ids.familyRole = await role('family_custom', 'linked');
    ids.treasurerRole = await role('treasurer_custom', 'organization');

    mockContext.userId = ids.manager;
    mockContext.organizationId = ids.unit;

    app = express();
    app.use(express.json());
    app.locals.pool = pool;
    app.use('/', require('../routes/roles')(pool, console));
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  test.each(UNIT_FINANCE_PERMISSIONS)('a role limited to its own children cannot be given %s', async (permissionKey) => {
    const response = await grant(ids.familyRole, permissionKey);

    expect(response.status).toBe(409);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain(permissionKey);
    expect(await holds(ids.familyRole, permissionKey)).toBe(false);
  });

  test('a role limited to its own children can still be given other permissions', async () => {
    const response = await grant(ids.familyRole, 'carpools.view');

    expect(response.status).toBe(200);
    expect(await holds(ids.familyRole, 'carpools.view')).toBe(true);
  });

  test('a role that sees the whole unit can be given finance permissions', async () => {
    const response = await grant(ids.treasurerRole, 'finance.view');

    expect(response.status).toBe(200);
    expect(await holds(ids.treasurerRole, 'finance.view')).toBe(true);
  });

  test('an unknown permission is reported as not found', async () => {
    const response = await request(app)
      .post(`/api/v1/roles/${ids.treasurerRole}/permissions`)
      .send({ permissionId: 2147483647 });

    expect(response.status).toBe(404);
  });
});
