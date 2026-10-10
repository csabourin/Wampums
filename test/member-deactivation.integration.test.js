/**
 * Deactivating a member who left — integration suite
 *
 * PATCH /api/v1/users/:userId/membership ends or restores someone's access to
 * the unit (a leader who stepped down) while keeping their account, roles and
 * history. It needs users.delete, and like removing roles, the caller must
 * hold every permission of the member's roles: a unit administrator cannot
 * deactivate a district administrator. Nobody changes their own membership.
 * A deactivated member no longer passes authentication for the unit.
 *
 * Skipped unless SCOUT_YEAR_TEST_DATABASE_URL (or TEST_DATABASE_URL) points at
 * a disposable database holding the project schema, permission catalog and
 * migrations.
 *
 * @module test/member-deactivation.integration
 */

const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');

require('./jest-conditional-helpers');

const DATABASE_URL = process.env.SCOUT_YEAR_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL;

process.env.JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || 'member-deactivation-integration-secret';

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

describe.skipIf(!DATABASE_URL)('Deactivating a member who left', () => {
  let pool;
  let app;
  const ids = {};
  const suffix = Date.now();

  async function one(sql, params = []) {
    const result = await pool.query(sql, params);
    return result.rows[0] ? Object.values(result.rows[0])[0] : undefined;
  }

  async function createRole(key, permissionKeys) {
    const roleId = await one(
      `INSERT INTO roles (role_name, display_name, data_scope, is_system_role, organization_id)
       VALUES ($1, $1, 'organization', false, $2) RETURNING id`,
      [`${key}_${suffix}`, ids.unit]
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
       VALUES ('leaving-' || gen_random_uuid() || '@example.test', 'x', 'Member') RETURNING id`
    );
    await pool.query(
      `INSERT INTO user_organizations (user_id, organization_id, role_ids, status)
       VALUES ($1, $2, $3, 'active')`,
      [userId, ids.unit, JSON.stringify(roleIds)]
    );
    return userId;
  }

  const membership = (userId) => pool.query(
    `SELECT status, role_ids, deactivated_at, deactivated_reason, last_active_scout_year_id
       FROM user_organizations WHERE user_id = $1 AND organization_id = $2`,
    [userId, ids.unit]
  ).then((result) => result.rows[0]);

  const setStatus = (userId, payload) => request(app).patch(`/api/v1/users/${userId}/membership`).send(payload);

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      ids.unit = (await client.query("INSERT INTO organizations (name) VALUES ('Leaving unit') RETURNING id")).rows[0].id;
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

    ids.admin = await createRole('unit_admin', ['users.view', 'users.delete', 'carpools.view', 'activities.view']);
    ids.leader = await createRole('leader', ['carpools.view', 'activities.view']);
    ids.higher = await createRole('higher', ['finance.manage']);
    ids.viewer = await createRole('viewer', ['users.view']);

    ids.caller = await createMember([ids.admin]);
    mockContext.userId = ids.caller;
    mockContext.organizationId = ids.unit;

    app = express();
    app.use(express.json());
    app.locals.pool = pool;
    app.use('/api/v1/users', require('../routes/users')(pool, console));
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  test('a leader who left is deactivated, keeping roles, and can be reactivated', async () => {
    const leader = await createMember([ids.leader]);

    const off = await setStatus(leader, { status: 'inactive', reason: '  A quitté l’unité  ' });
    expect(off.status).toBe(200);
    const deactivated = await membership(leader);
    expect(deactivated.status).toBe('inactive');
    expect(deactivated.deactivated_reason).toBe('A quitté l’unité');
    expect(deactivated.deactivated_at).not.toBeNull();
    expect(deactivated.last_active_scout_year_id).not.toBeNull();
    expect(deactivated.role_ids.map(Number)).toEqual([ids.leader]);

    const list = await request(app).get('/api/v1/users');
    expect(list.body.data.find((user) => user.id === leader).status).toBe('inactive');

    const on = await setStatus(leader, { status: 'active' });
    expect(on.status).toBe(200);
    const reactivated = await membership(leader);
    expect(reactivated.status).toBe('active');
    expect(reactivated.deactivated_at).toBeNull();
    expect(reactivated.deactivated_reason).toBeNull();
  });

  test('a deactivated member no longer passes authentication for the unit', async () => {
    const leader = await createMember([ids.leader]);
    await setStatus(leader, { status: 'inactive' });

    const { requirePermission } = jest.requireActual('../middleware/auth');
    const probe = express();
    probe.use((req, _res, next) => {
      req.user = { id: leader, organizationId: ids.unit, permissions: [] };
      next();
    });
    probe.get('/probe', requirePermission('activities.view'), (_req, res) => res.json({ ok: true }));
    // requirePermission reads the pool from the app, as api.js provides it.
    probe.locals.pool = pool;

    const response = await request(probe).get('/probe');
    expect(response.status).toBe(403);
  });

  test('a deactivation without a note is recorded as the team\'s decision', async () => {
    const leader = await createMember([ids.leader]);

    expect((await setStatus(leader, { status: 'inactive' })).status).toBe(200);

    // Not the year transition's reason: the member cannot reopen it alone.
    expect((await membership(leader)).deactivated_reason).toBe('deactivated_by_admin');
    expect((await setStatus(leader, { status: 'inactive', reason: 'no_enrolled_child' })).status).toBe(400);
  });

  test('cannot deactivate someone holding permissions the caller lacks', async () => {
    const higher = await createMember([ids.higher]);

    const response = await setStatus(higher, { status: 'inactive' });

    expect(response.status).toBe(403);
    expect(response.body.missing).toEqual(['finance.manage']);
    expect((await membership(higher)).status).toBe('active');
  });

  test('cannot change one\'s own membership', async () => {
    const response = await setStatus(ids.caller, { status: 'inactive' });

    expect(response.status).toBe(400);
    expect((await membership(ids.caller)).status).toBe('active');
  });

  test('requires users.delete', async () => {
    const leader = await createMember([ids.leader]);
    mockContext.userId = await createMember([ids.viewer]);
    try {
      const response = await setStatus(leader, { status: 'inactive' });

      expect(response.status).toBe(403);
      expect(response.body.missing).toEqual(['users.delete']);
    } finally {
      mockContext.userId = ids.caller;
    }
  });

  test('rejects a malformed request, and a member of another unit', async () => {
    const leader = await createMember([ids.leader]);

    expect((await setStatus(leader, { status: 'alumni' })).status).toBe(400);
    expect((await setStatus('not-a-uuid', { status: 'inactive' })).status).toBe(400);
    expect((await setStatus(leader, { status: 'inactive', reason: 'x'.repeat(501) })).status).toBe(400);

    const stranger = await one(
      `INSERT INTO users (email, password, full_name)
       VALUES ('stranger-' || gen_random_uuid() || '@example.test', 'x', 'Stranger') RETURNING id`
    );
    expect((await setStatus(stranger, { status: 'inactive' })).status).toBe(404);
  });
});
