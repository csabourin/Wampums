/**
 * Role change history — integration suite
 *
 * Every change to a member's roles is recorded in the same transaction
 * (role_assignment_audit, migration 023): who made it, the roles before and
 * after as they were then, and the optional note. GET /api/v1/audit/roles
 * returns a member's history in the caller's unit, newest first. A save that
 * changes nothing records nothing, and a refused change records nothing.
 *
 * Skipped unless SCOUT_YEAR_TEST_DATABASE_URL (or TEST_DATABASE_URL) points at
 * a disposable database holding the project schema, permission catalog and
 * migrations.
 *
 * @module test/role-audit.integration
 */

const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');

require('./jest-conditional-helpers');

const DATABASE_URL = process.env.SCOUT_YEAR_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL;

process.env.JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || 'role-audit-integration-secret';

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

describe.skipIf(!DATABASE_URL)('Role change history', () => {
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

  async function createRole(key, unit, permissionKeys) {
    const roleId = await one(
      `INSERT INTO roles (role_name, display_name, data_scope, is_system_role, organization_id)
       VALUES ($1, $2, 'organization', false, $3) RETURNING id`,
      [`${key}_${suffix}`, `Display ${key}`, unit]
    );
    await pool.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT $1, id FROM permissions WHERE permission_key = ANY($2::text[])`,
      [roleId, permissionKeys]
    );
    return roleId;
  }

  async function createMember(unit, roleIds, fullName) {
    const userId = await one(
      `INSERT INTO users (email, password, full_name)
       VALUES ('audit-' || gen_random_uuid() || '@example.test', 'x', $1) RETURNING id`,
      [fullName]
    );
    await pool.query(
      `INSERT INTO user_organizations (user_id, organization_id, role_ids, status)
       VALUES ($1, $2, $3, 'active')`,
      [userId, unit, JSON.stringify(roleIds)]
    );
    return userId;
  }

  const putRoles = (userId, roleIds, note) => request(app)
    .put(`/api/v1/users/${userId}/roles`)
    .send(note === undefined ? { roleIds } : { roleIds, audit_note: note });

  const history = (userId, query = '') => request(app).get(`/api/v1/audit/roles?user_id=${userId}${query}`);

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });

    ids.unit = await createUnit('Role audit unit');
    ids.otherUnit = await createUnit('Role audit other unit');

    ids.admin = await createRole('audit_admin', ids.unit, ['users.view', 'users.assign_roles', 'carpools.view']);
    ids.leader = await createRole('audit_leader', ids.unit, ['carpools.view']);
    ids.parent = await createRole('audit_parent', ids.unit, ['carpools.view']);
    ids.high = await createRole('audit_high', ids.unit, ['finance.manage']);

    ids.caller = await createMember(ids.unit, [ids.admin], 'Akela Audit');
    ids.member = await createMember(ids.unit, [ids.parent], 'Marie Audit');

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

  test('records who changed which roles, with the note, newest first', async () => {
    expect((await putRoles(ids.member, [ids.parent, ids.leader], '  Devenue animatrice  ')).status).toBe(200);
    expect((await putRoles(ids.member, [ids.leader])).status).toBe(200);

    const response = await history(ids.member);

    expect(response.status).toBe(200);
    const [latest, first] = response.body.data;
    expect(response.body.data).toHaveLength(2);

    expect(first.actor_name).toBe('Akela Audit');
    expect(first.changed_by).toBe(ids.caller);
    expect(first.note).toBe('Devenue animatrice');
    expect(first.previous_roles.map((role) => role.id)).toEqual([ids.parent]);
    expect(first.new_roles.map((role) => role.id).sort()).toEqual([ids.parent, ids.leader].sort());
    expect(first.new_roles.find((role) => role.id === ids.leader)).toEqual({
      id: ids.leader, role_name: `audit_leader_${suffix}`, display_name: 'Display audit_leader',
    });

    expect(latest.note).toBeNull();
    expect(latest.new_roles.map((role) => role.id)).toEqual([ids.leader]);
  });

  test('a save that changes nothing records nothing', async () => {
    const before = await one('SELECT count(*)::int FROM role_assignment_audit WHERE user_id = $1', [ids.member]);

    expect((await putRoles(ids.member, [ids.leader])).status).toBe(200);

    expect(await one('SELECT count(*)::int FROM role_assignment_audit WHERE user_id = $1', [ids.member])).toBe(before);
  });

  test('a refused change records nothing', async () => {
    const before = await one('SELECT count(*)::int FROM role_assignment_audit WHERE user_id = $1', [ids.member]);

    expect((await putRoles(ids.member, [ids.leader, ids.high])).status).toBe(403);

    expect(await one('SELECT count(*)::int FROM role_assignment_audit WHERE user_id = $1', [ids.member])).toBe(before);
  });

  test('keeps the role names of the time after a role is renamed', async () => {
    await pool.query("UPDATE roles SET display_name = 'Renamed' WHERE id = $1", [ids.leader]);

    const response = await history(ids.member);

    expect(response.body.data[0].new_roles[0].display_name).toBe('Display audit_leader');
  });

  test('honours the limit', async () => {
    const response = await history(ids.member, '&limit=1');

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
  });

  test('shows nothing from another unit', async () => {
    await pool.query(
      `INSERT INTO role_assignment_audit (organization_id, user_id, changed_by, new_roles)
       VALUES ($1, $2, $3, '[]'::jsonb)`,
      [ids.otherUnit, ids.member, ids.caller]
    );

    const response = await history(ids.member);

    expect(response.body.data.every((entry) => entry.previous_roles.length + entry.new_roles.length > 0)).toBe(true);
    expect(response.body.data).toHaveLength(2);
  });

  test('rejects a malformed request', async () => {
    expect((await history('not-a-uuid')).status).toBe(400);
    expect((await history(ids.member, '&limit=500')).status).toBe(400);
  });

  test('requires users.view', async () => {
    const outsider = await createMember(ids.unit, [ids.parent], 'Sans droit');
    mockContext.userId = outsider;
    try {
      const response = await history(ids.member);

      expect(response.status).toBe(403);
      expect(response.body.missing).toEqual(['users.view']);
    } finally {
      mockContext.userId = ids.caller;
    }
  });
});
