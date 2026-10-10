/**
 * Current access — integration suite
 *
 * GET /api/v1/users/me/access is what the app reads to replace the roles,
 * permissions and data scope it stored at sign-in. It must answer from the database, not
 * echo the token, and give nothing to a membership that is no longer active.
 *
 * Skipped unless SCOUT_YEAR_TEST_DATABASE_URL (or TEST_DATABASE_URL) points at
 * a disposable database holding the project schema and permission catalog.
 *
 * @module test/user-access.integration
 */

const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');

require('./jest-conditional-helpers');

const DATABASE_URL = process.env.SCOUT_YEAR_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL;

process.env.JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || 'user-access-integration-secret';

const mockContext = { userId: null, organizationId: null };

// The token claims a permission the role no longer holds.
jest.mock('../middleware/auth', () => {
  const actual = jest.requireActual('../middleware/auth');
  return {
    ...actual,
    authenticate: (req, _res, next) => {
      req.user = {
        id: mockContext.userId,
        organizationId: mockContext.organizationId,
        permissions: ['finance.view'],
      };
      next();
    },
  };
});

describe.skipIf(!DATABASE_URL)('Current access', () => {
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

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });

    // The program section and its unit reference each other; the key is
    // checked at commit.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const created = await client.query("INSERT INTO organizations (name) VALUES ('Current access unit') RETURNING id");
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

    ids.roleName = `family_access_${suffix}`;
    const roleId = await one(
      `INSERT INTO roles (role_name, display_name, data_scope) VALUES ($1, 'Family', 'linked') RETURNING id`,
      [ids.roleName]
    );
    await pool.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT $1, id FROM permissions WHERE permission_key IN ('carpools.view', 'participants.create_own')`,
      [roleId]
    );
    ids.user = await one(
      `INSERT INTO users (email, password, full_name)
       VALUES ('access-' || gen_random_uuid() || '@example.test', 'x', 'Parent') RETURNING id`
    );
    await pool.query(
      `INSERT INTO user_organizations (user_id, organization_id, role_ids, status)
       VALUES ($1, $2, $3, 'active')`,
      [ids.user, ids.unit, JSON.stringify([roleId])]
    );

    mockContext.userId = ids.user;
    mockContext.organizationId = ids.unit;

    app = express();
    app.use(express.json());
    app.locals.pool = pool;
    app.use('/api/v1/users/me', require('../routes/userProfile')(pool, console));
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  test('answers with the roles and permissions the database holds, not the token\'s', async () => {
    const response = await request(app).get('/api/v1/users/me/access');

    expect(response.status).toBe(200);
    expect(response.body.data.roles).toEqual([ids.roleName]);
    expect(response.body.data.permissions).toEqual(expect.arrayContaining(['carpools.view', 'participants.create_own']));
    expect(response.body.data.permissions).not.toContain('finance.view');
    expect(response.body.data.data_scope).toBe('linked');
  });

  test('a parent who also holds a whole-unit role reads the whole unit', async () => {
    const staffRoleId = await one(
      `INSERT INTO roles (role_name, display_name, data_scope) VALUES ($1, 'Leader', 'organization') RETURNING id`,
      [`unit_access_${suffix}`]
    );
    const familyRoleId = await one('SELECT id FROM roles WHERE role_name = $1', [ids.roleName]);
    await pool.query(
      'UPDATE user_organizations SET role_ids = $3 WHERE user_id = $1 AND organization_id = $2',
      [ids.user, ids.unit, JSON.stringify([familyRoleId, staffRoleId])]
    );

    try {
      const response = await request(app).get('/api/v1/users/me/access');

      expect(response.status).toBe(200);
      expect(response.body.data.roles).toEqual(expect.arrayContaining([ids.roleName, `unit_access_${suffix}`]));
      expect(response.body.data.data_scope).toBe('organization');
    } finally {
      await pool.query(
        'UPDATE user_organizations SET role_ids = $3 WHERE user_id = $1 AND organization_id = $2',
        [ids.user, ids.unit, JSON.stringify([familyRoleId])]
      );
    }
  });

  test('gives nothing to a membership that is no longer active', async () => {
    await pool.query(
      "UPDATE user_organizations SET status = 'inactive' WHERE user_id = $1 AND organization_id = $2",
      [ids.user, ids.unit]
    );

    try {
      const response = await request(app).get('/api/v1/users/me/access');

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual({ roles: [], permissions: [], data_scope: 'linked' });
    } finally {
      await pool.query(
        "UPDATE user_organizations SET status = 'active' WHERE user_id = $1 AND organization_id = $2",
        [ids.user, ids.unit]
      );
    }
  });
});
