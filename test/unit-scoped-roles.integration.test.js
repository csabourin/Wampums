/**
 * Unit-scoped roles — integration suite
 *
 * A unit sees and uses the shared built-in roles and its own custom roles,
 * never another unit's (migration 014). It can create, edit, and delete only
 * its own custom roles; built-in roles are read-only to every unit.
 *
 * Skipped unless SCOUT_YEAR_TEST_DATABASE_URL (or TEST_DATABASE_URL) points at
 * a disposable database holding the project schema, permission catalog and
 * migrations.
 *
 * @module test/unit-scoped-roles.integration
 */

const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');

require('./jest-conditional-helpers');

const DATABASE_URL = process.env.SCOUT_YEAR_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL;

process.env.JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || 'unit-scoped-roles-integration-secret';

const { signJWTToken } = require('../utils/jwt-config');

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

const MANAGER_PERMISSIONS = [
  'roles.view', 'roles.manage', 'users.view', 'users.assign_roles', 'forms.manage', 'carpools.view',
];

describe.skipIf(!DATABASE_URL)('Unit-scoped roles', () => {
  let pool;
  let app;
  const ids = {};
  const suffix = Date.now();

  async function one(sql, params = []) {
    const result = await pool.query(sql, params);
    return result.rows[0] ? Object.values(result.rows[0])[0] : undefined;
  }

  async function createUnit(name) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const unit = (await client.query('INSERT INTO organizations (name) VALUES ($1) RETURNING id', [name])).rows[0].id;
      await client.query(
        `INSERT INTO organization_program_sections (organization_id, section_key, display_name)
         VALUES ($1, 'general', 'General')`,
        [unit]
      );
      await client.query('COMMIT');
      return unit;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async function createRole(key, { unit = null, system = false, permissions = ['carpools.view'] } = {}) {
    const roleId = await one(
      `INSERT INTO roles (role_name, display_name, data_scope, is_system_role, organization_id)
       VALUES ($1, $1, 'organization', $2, $3) RETURNING id`,
      [`${key}_${suffix}`, system, unit]
    );
    await pool.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT $1, id FROM permissions WHERE permission_key = ANY($2::text[])`,
      [roleId, permissions]
    );
    return roleId;
  }

  async function createMember(unit, roleIds) {
    const userId = await one(
      `INSERT INTO users (email, password, full_name)
       VALUES ('scoped-' || gen_random_uuid() || '@example.test', 'x', 'Member') RETURNING id`
    );
    await pool.query(
      `INSERT INTO user_organizations (user_id, organization_id, role_ids, status)
       VALUES ($1, $2, $3, 'active')`,
      [userId, unit, JSON.stringify(roleIds)]
    );
    return userId;
  }

  function actAs(userId, unit) {
    mockContext.userId = userId;
    mockContext.organizationId = unit;
  }

  async function rolesOf(userId, unit) {
    return (await one(
      'SELECT role_ids FROM user_organizations WHERE user_id = $1 AND organization_id = $2',
      [userId, unit]
    )).map(Number);
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });

    ids.unitA = await createUnit('Scoped roles unit A');
    ids.unitB = await createUnit('Scoped roles unit B');

    ids.builtin = await createRole('builtin', { system: true });
    ids.customA = await createRole('custom_a', { unit: ids.unitA });
    ids.customB = await createRole('custom_b', { unit: ids.unitB });
    ids.orphan = await createRole('orphan');

    ids.managerA = await createMember(ids.unitA, [await createRole('manager_a', { unit: ids.unitA, permissions: MANAGER_PERMISSIONS })]);
    ids.managerB = await createMember(ids.unitB, [await createRole('manager_b', { unit: ids.unitB, permissions: MANAGER_PERMISSIONS })]);

    ids.formA = await one(
      `INSERT INTO organization_form_formats (organization_id, form_type, form_structure)
       VALUES ($1, $2, '{}'::jsonb) RETURNING id`,
      [ids.unitA, `scoped_form_${suffix}`]
    );

    app = express();
    app.use(express.json());
    app.locals.pool = pool;
    app.use('/api/v1/users', require('../routes/users')(pool, console));
    app.use('/api/v1/forms', require('../routes/forms')(pool, console));
    app.use(require('../routes/roles')(pool, console));
  });

  beforeEach(() => {
    actAs(ids.managerA, ids.unitA);
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  test('a unit lists the built-in roles and its own, not another unit\'s or unowned ones', async () => {
    const response = await request(app).get('/api/v1/roles');

    expect(response.status).toBe(200);
    const listed = response.body.data.map((role) => role.id);
    expect(listed).toEqual(expect.arrayContaining([ids.builtin, ids.customA]));
    expect(listed).not.toContain(ids.customB);
    expect(listed).not.toContain(ids.orphan);
  });

  test('another unit\'s role cannot be read', async () => {
    expect((await request(app).get(`/api/v1/roles/${ids.customB}/permissions`)).status).toBe(404);
    expect((await request(app).get(`/api/v1/roles/${ids.customA}/permissions`)).status).toBe(200);
    expect((await request(app).get('/api/v1/roles/not-a-number/permissions')).status).toBe(404);
  });

  test('a created role belongs to its unit, and two units may use the same name', async () => {
    const inA = await request(app).post('/api/v1/roles').send({ role_name: 'Trésorier', display_name: 'Trésorier' });
    actAs(ids.managerB, ids.unitB);
    const inB = await request(app).post('/api/v1/roles').send({ role_name: 'Trésorier', display_name: 'Trésorier' });

    expect(inA.status).toBe(201);
    expect(inB.status).toBe(201);
    expect(inA.body.data).toMatchObject({ role_name: `u${ids.unitA}_tresorier`, organization_id: ids.unitA });
    expect(inB.body.data).toMatchObject({ role_name: `u${ids.unitB}_tresorier`, organization_id: ids.unitB });

    actAs(ids.managerA, ids.unitA);
    const again = await request(app).post('/api/v1/roles').send({ role_name: 'tresorier', display_name: 'Again' });
    expect(again.status).toBe(409);
  });

  test('built-in roles are read-only and other units\' roles are out of reach', async () => {
    const permissionId = await one("SELECT id FROM permissions WHERE permission_key = 'carpools.view'");

    const builtin = await request(app).post(`/api/v1/roles/${ids.builtin}/permissions`).send({ permissionId });
    expect(builtin.status).toBe(403);

    const otherUnit = await request(app).post(`/api/v1/roles/${ids.customB}/permissions`).send({ permissionId });
    expect(otherUnit.status).toBe(404);

    const removeOther = await request(app).delete(`/api/v1/roles/${ids.customB}/permissions/${permissionId}`);
    expect(removeOther.status).toBe(404);
  });

  test('a unit deletes only its own custom roles', async () => {
    const deletable = await createRole('deletable_a', { unit: ids.unitA });

    expect((await request(app).delete(`/api/v1/roles/${ids.customB}`)).status).toBe(404);
    expect(await one('SELECT count(*)::int FROM roles WHERE id = $1', [ids.customB])).toBe(1);

    expect((await request(app).delete(`/api/v1/roles/${ids.builtin}`)).status).toBe(403);

    expect((await request(app).delete(`/api/v1/roles/${deletable}`)).status).toBe(200);
    expect(await one('SELECT count(*)::int FROM roles WHERE id = $1', [deletable])).toBe(0);
  });

  test('members are given only roles their unit may use', async () => {
    const target = await createMember(ids.unitA, [ids.builtin]);

    const foreign = await request(app).put(`/api/v1/users/${target}/roles`).send({ roleIds: [ids.builtin, ids.customB] });
    expect(foreign.status).toBe(400);

    const unowned = await request(app).put(`/api/v1/users/${target}/roles`).send({ roleIds: [ids.orphan] });
    expect(unowned.status).toBe(400);

    const legacy = await request(app).post('/api/v1/users/update-role').send({ user_id: target, role: `custom_b_${suffix}` });
    expect(legacy.status).toBe(400);
    expect(legacy.body.message).not.toContain(`custom_b_${suffix}`);

    expect(await rolesOf(target, ids.unitA)).toEqual([ids.builtin]);

    const own = await request(app).put(`/api/v1/users/${target}/roles`).send({ roleIds: [ids.builtin, ids.customA] });
    expect(own.status).toBe(200);
    expect(await rolesOf(target, ids.unitA)).toEqual([ids.builtin, ids.customA]);
  });

  test('form permissions list and accept only the unit\'s roles', async () => {
    const token = signJWTToken({ user_id: ids.managerA, organizationId: ids.unitA });

    const listed = await request(app).get('/api/v1/forms/form-permissions').set('Authorization', `Bearer ${token}`);
    expect(listed.status).toBe(200);
    const roleIds = new Set(listed.body.data.filter((row) => row.form_format_id === ids.formA).map((row) => row.role_id));
    expect(roleIds.has(ids.customA)).toBe(true);
    expect(roleIds.has(ids.customB)).toBe(false);
    expect(roleIds.has(ids.orphan)).toBe(false);

    const foreign = await request(app)
      .put('/api/v1/forms/form-permissions')
      .set('Authorization', `Bearer ${token}`)
      .send({ form_format_id: ids.formA, role_id: ids.customB, can_view: true });
    expect(foreign.status).toBe(404);

    const own = await request(app)
      .put('/api/v1/forms/form-permissions')
      .set('Authorization', `Bearer ${token}`)
      .send({ form_format_id: ids.formA, role_id: ids.customA, can_view: true });
    expect(own.status).toBe(200);
  });
});
