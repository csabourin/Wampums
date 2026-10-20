/**
 * Hiding a built-in role the unit replaced — integration suite
 *
 * A unit that customized a built-in role may hide the original (migration
 * 038, services/roleVisibility.js). Members who hold it keep it; it is no
 * longer offered when writing to families, inviting a leader or assigning
 * roles, and the server refuses to grant it anew. Runs the real routes,
 * requirePermission and SQL.
 *
 * Skipped unless TEST_DATABASE_URL points at a disposable database holding the
 * project schema, permission catalog and migrations.
 *
 * @module test/hidden-builtin-roles.integration
 */
const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('./jest-conditional-helpers');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET_KEY ||= 'hidden-roles-integration-secret';
const mockContext = { userId: null, organizationId: null, authenticated: true };
jest.mock('../middleware/auth', () => {
  const actual = jest.requireActual('../middleware/auth');
  return { ...actual, authenticate: (req, res, next) => {
    if (!mockContext.authenticated) { return res.status(401).json({ success: false, message: 'Authentication required' }); }
    req.user = { id: mockContext.userId, organizationId: mockContext.organizationId };
    return next();
  } };
});

describe.skipIf(!DATABASE_URL)('Hiding a built-in role the unit replaced', () => {
  let pool, app, announcementsRoutes, unit, otherUnit, admin, otherAdmin, manager, builtIn, everything;
  const createdUsers = [];
  const createdBuiltIns = [];
  const suffix = `${Date.now()}_hidden`;
  async function one(sql, params = []) { return Object.values((await pool.query(sql, params)).rows[0] || {})[0]; }
  async function newUnit(name) {
    // The unit and its section reference each other; the check waits for COMMIT.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const id = (await client.query('INSERT INTO organizations (name) VALUES ($1) RETURNING id', [name])).rows[0].id;
      await client.query("INSERT INTO organization_program_sections (organization_id, section_key, display_name) VALUES ($1, 'general', 'General')", [id]);
      await client.query('COMMIT');
      return id;
    } finally { client.release(); }
  }
  async function role(name, { organizationId = unit, keys = [], scope = 'organization', builtInRole = false } = {}) {
    const id = await one(`INSERT INTO roles (role_name, display_name, organization_id, is_system_role, data_scope)
      VALUES ($1, $1, $2, $3, $4) RETURNING id`, [`${name}_${suffix}`, builtInRole ? null : organizationId, builtInRole, scope]);
    if (builtInRole) { createdBuiltIns.push(id); }
    await pool.query('INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE permission_key = ANY($2::text[])', [id, keys]);
    return id;
  }
  async function newMember(organizationId, roleIds) {
    const id = await one("INSERT INTO users (email, password, full_name) VALUES (gen_random_uuid() || '@hidden.test', 'x', 'Member') RETURNING id");
    createdUsers.push(id);
    await pool.query("INSERT INTO user_organizations (organization_id, user_id, role_ids, status) VALUES ($1, $2, $3, 'active')", [organizationId, id, JSON.stringify(roleIds)]);
    return id;
  }
  async function customize(baseId, name = 'Animation de la meute') {
    const res = await request(app).post('/api/v1/roles').send({ display_name: name, base_role_id: baseId });
    expect(res.status).toBe(201);
    return res.body.data;
  }
  const setHidden = (id, hidden) => request(app).put(`/api/v1/roles/${id}/visibility`).send({ hidden });
  const matrixRole = async (id) => (await request(app).get('/api/v1/roles/matrix')).body.data.roles.find((r) => r.id === id);
  const listedRole = async (id) => (await request(app).get('/api/v1/roles')).body.data.find((r) => r.id === id);
  const as = (userId, organizationId = unit) => { mockContext.userId = userId; mockContext.organizationId = organizationId; };

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    unit = await newUnit(suffix); otherUnit = await newUnit(`${suffix}_other`);
    builtIn = await role('leader_builtin', { builtInRole: true, keys: ['carpools.view', 'participants.view'] });
    everything = await role('district_builtin', { builtInRole: true });
    await pool.query('UPDATE roles SET grants_all_permissions = TRUE WHERE id = $1', [everything]);
    const adminRole = await role('admin');
    await pool.query('INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions ON CONFLICT DO NOTHING', [adminRole]);
    admin = await newMember(unit, [adminRole]);
    const otherAdminRole = await role('other_admin', { organizationId: otherUnit });
    await pool.query('INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions ON CONFLICT DO NOTHING', [otherAdminRole]);
    otherAdmin = await newMember(otherUnit, [otherAdminRole]);
    manager = await newMember(unit, [await role('viewer', { keys: ['roles.view'] })]);
    app = express(); app.use(express.json()); app.locals.pool = pool;
    const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() };
    app.use(require('../routes/roles')(pool, logger));
    app.use('/api/v1/users', require('../routes/users')(pool, logger));
    app.use('/api/v1/parent-invitations', require('../routes/parentInvitations')(pool, logger));
    announcementsRoutes = require('../routes/announcements');
    app.use('/api', announcementsRoutes(pool, logger));
  });
  beforeEach(() => { as(admin); mockContext.authenticated = true; });
  afterAll(async () => {
    if (!pool) { return; }
    await announcementsRoutes?.shutdownListenerForTests?.();
    await pool.query('DELETE FROM organizations WHERE id = ANY($1::int[])', [[unit, otherUnit].filter(Boolean)]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [createdUsers]);
    await pool.query('DELETE FROM roles WHERE id = ANY($1::int[])', [createdBuiltIns]);
    await pool.end();
  });
  afterEach(async () => {
    await pool.query('DELETE FROM organization_hidden_roles WHERE organization_id = ANY($1::int[])', [[unit, otherUnit]]);
    await pool.query('DELETE FROM roles WHERE organization_id = ANY($1::int[]) AND customized_from_role_id IS NOT NULL', [[unit, otherUnit]]);
  });

  test('a built-in role cannot be hidden before the unit customizes it, and the matrix says why', async () => {
    expect((await matrixRole(builtIn)).hide_refusal).toBe('not_customized');
    const res = await setHidden(builtIn, true);
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('role_hide_refused_not_customized');
    expect((await listedRole(builtIn)).hidden).toBe(false);
  });

  test('customizing records which role it replaces; the original can then be hidden in this unit only', async () => {
    const custom = await customize(builtIn);
    expect(custom.customized_from_role_id).toBe(builtIn);
    expect((await matrixRole(builtIn)).hide_refusal).toBeNull();
    const res = await setHidden(builtIn, true);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ role_id: builtIn, hidden: true });
    expect((await listedRole(builtIn)).hidden).toBe(true);
    expect((await matrixRole(builtIn)).hidden).toBe(true);
    as(otherAdmin, otherUnit);
    expect((await listedRole(builtIn)).hidden).toBe(false);
  });

  test('a hidden role is no longer offered to invite a leader or to write to families', async () => {
    await customize(builtIn);
    const before = await request(app).get('/api/v1/parent-invitations/leader-roles');
    expect(before.body.data.map((r) => r.id)).toContain(builtIn);
    const announcementsBefore = await request(app).get('/api/v1/announcements');
    expect(announcementsBefore.status).toBe(200);
    expect(announcementsBefore.body.roles.map((r) => r.role_name)).toContain(`leader_builtin_${suffix}`);

    expect((await setHidden(builtIn, true)).status).toBe(200);
    const after = await request(app).get('/api/v1/parent-invitations/leader-roles');
    expect(after.body.data.map((r) => r.id)).not.toContain(builtIn);
    const announcementsAfter = await request(app).get('/api/v1/announcements');
    expect(announcementsAfter.body.roles.map((r) => r.role_name)).not.toContain(`leader_builtin_${suffix}`);
  });

  test('a member keeps a hidden role, but no one can be given it anew, by assignment or invitation', async () => {
    const custom = await customize(builtIn);
    const holder = await newMember(unit, [builtIn]);
    const newcomer = await newMember(unit, [custom.id]);
    expect((await setHidden(builtIn, true)).status).toBe(200);

    // Keeping it while adding another role is allowed.
    const kept = await request(app).put(`/api/v1/users/${holder}/roles`).send({ roleIds: [builtIn, custom.id] });
    expect(kept.status).toBe(200);
    expect(await one('SELECT role_ids FROM user_organizations WHERE user_id = $1 AND organization_id = $2', [holder, unit])).toEqual([builtIn, custom.id]);

    const granted = await request(app).put(`/api/v1/users/${newcomer}/roles`).send({ roleIds: [custom.id, builtIn] });
    expect(granted.status).toBe(409);
    expect(granted.body.message).toBe('role_hidden_in_unit');
    expect(await one('SELECT role_ids FROM user_organizations WHERE user_id = $1 AND organization_id = $2', [newcomer, unit])).toEqual([custom.id]);

    const invited = await request(app).post('/api/v1/parent-invitations')
      .send({ email: `invitee_${suffix}@hidden.test`, kind: 'leader', role_ids: [builtIn] });
    expect(invited.status).toBe(409);
    expect(invited.body.message).toBe('role_hidden_in_unit');
  });

  test('showing a hidden role again offers it once more', async () => {
    await customize(builtIn);
    expect((await setHidden(builtIn, true)).status).toBe(200);
    expect((await setHidden(builtIn, false)).status).toBe(200);
    expect((await listedRole(builtIn)).hidden).toBe(false);
  });

  test('deleting the unit role that replaced it shows the built-in role again', async () => {
    const custom = await customize(builtIn);
    expect((await setHidden(builtIn, true)).status).toBe(200);
    expect((await request(app).delete(`/api/v1/roles/${custom.id}`)).status).toBe(200);
    expect((await listedRole(builtIn)).hidden).toBe(false);
  });

  test('a unit role created earlier can be marked as replacing a built-in role, never the one holding every permission', async () => {
    const earlier = await role('earlier');
    expect((await request(app).patch(`/api/v1/roles/${earlier}`).send({ customized_from_role_id: everything })).status).toBe(400);
    const res = await request(app).patch(`/api/v1/roles/${earlier}`).send({ customized_from_role_id: builtIn });
    expect(res.status).toBe(200);
    expect(res.body.data.customized_from_role_id).toBe(builtIn);
    expect((await setHidden(builtIn, true)).status).toBe(200);
    // Clearing what it replaces shows the built-in role again.
    expect((await request(app).patch(`/api/v1/roles/${earlier}`).send({ customized_from_role_id: null })).status).toBe(200);
    expect((await listedRole(builtIn)).hidden).toBe(false);
  });

  test('the role holding every permission is never hidden', async () => {
    await pool.query('UPDATE roles SET customized_from_role_id = $1 WHERE id = $2', [everything, await role('sneaky')]);
    expect((await matrixRole(everything)).hide_refusal).toBe('all_permissions');
    const res = await setHidden(everything, true);
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('role_hide_refused_all_permissions');
  });

  test('another unit’s role is not found, and a unit role is not a built-in one to hide', async () => {
    const foreign = await role('foreign', { organizationId: otherUnit });
    expect((await setHidden(foreign, true)).status).toBe(404);
    expect((await setHidden(2147483647, true)).status).toBe(404);
    const own = await role('own');
    const res = await setHidden(own, true);
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('role_hide_refused_not_built_in');
  });

  test('without roles.manage, hiding is refused with what is missing', async () => {
    as(manager);
    const res = await setHidden(builtIn, true);
    expect(res.status).toBe(403);
    expect(res.body.required).toContain('roles.manage');
    expect(res.body.missing).toContain('roles.manage');
  });

  test('a demo account cannot hide a role', async () => {
    let demo = await one("SELECT id FROM roles WHERE role_name = 'demoadmin' AND organization_id IS NULL");
    if (!demo) {
      demo = await one("INSERT INTO roles (role_name, display_name, is_system_role) VALUES ('demoadmin', 'Demo', TRUE) RETURNING id");
      createdBuiltIns.push(demo);
    }
    as(await newMember(unit, [demo]));
    const res = await setHidden(builtIn, true);
    expect(res.status).toBe(403);
    expect(res.body.isDemo).toBe(true);
  });

  test('without a session, hiding is refused', async () => {
    mockContext.authenticated = false;
    expect((await setHidden(builtIn, true)).status).toBe(401);
  });

  test.each([{}, { hidden: 'yes' }, { hidden: 1 }])('a malformed request is refused: %p', async (body) => {
    expect((await request(app).put(`/api/v1/roles/${builtIn}/visibility`).send(body)).status).toBe(400);
  });

  test('migration 038 runs twice', async () => {
    const sql = fs.readFileSync(path.join(__dirname, '../migrations/038_hidden_builtin_roles.sql'), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql); await client.query(sql);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
