/** Real SQL, live authorization, isolated units and transactional role definitions. */
const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('./jest-conditional-helpers');
const DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET_KEY ||= 'matrix-integration-secret';
const mockContext = { userId: null, organizationId: null, authenticated: true };
jest.mock('../middleware/auth', () => {
  const actual = jest.requireActual('../middleware/auth');
  return { ...actual, authenticate: (req, res, next) => {
    if (!mockContext.authenticated) { return res.status(401).json({ success: false, message: 'Authentication required' }); }
    req.user = { id: mockContext.userId, organizationId: mockContext.organizationId };
    return next();
  } };
});

describe.skipIf(!DATABASE_URL)('Unit and district permission matrices', () => {
  let pool, app, unit, otherUnit, admin, manager, managerRole, builtIn, member, otherMember;
  const createdUsers = [];
  const createdBuiltIns = [];
  const suffix = `${Date.now()}_matrix`;
  async function one(sql, params = []) { return Object.values((await pool.query(sql, params)).rows[0] || {})[0]; }
  async function newUnit(name) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const id = (await client.query('INSERT INTO organizations (name) VALUES ($1) RETURNING id', [name])).rows[0].id;
      await client.query("INSERT INTO organization_program_sections (organization_id, section_key, display_name) VALUES ($1, 'general', 'General')", [id]);
      await client.query('COMMIT'); return id;
    } finally { client.release(); }
  }
  async function role(name, scope = 'organization', keys = [], organizationId = unit) {
    const id = await one(`INSERT INTO roles (role_name, display_name, organization_id, is_system_role, data_scope)
      VALUES ($1, $1, $2, FALSE, $3) RETURNING id`, [`${name}_${suffix}`, organizationId, scope]);
    await pool.query(`INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE permission_key = ANY($2::text[])`, [id, keys]);
    return id;
  }
  async function newMember(organizationId, roleIds) {
    const id = await one("INSERT INTO users (email, password, full_name) VALUES (gen_random_uuid() || '@matrix.test', 'x', 'Member') RETURNING id");
    createdUsers.push(id);
    await pool.query("INSERT INTO user_organizations (organization_id, user_id, role_ids, status) VALUES ($1, $2, $3, 'active')", [organizationId, id, JSON.stringify(roleIds)]);
    return id;
  }
  async function permissionIds(keys) {
    return (await pool.query('SELECT id FROM permissions WHERE permission_key = ANY($1::text[]) ORDER BY id', [keys])).rows.map((p) => p.id);
  }
  async function keysFor(id) {
    return (await pool.query('SELECT p.permission_key FROM permissions p JOIN role_permissions rp ON rp.permission_id = p.id WHERE rp.role_id = $1 ORDER BY 1', [id])).rows.map((p) => p.permission_key);
  }
  function put(id, keys, expected) {
    return permissionIds(keys).then((ids) => request(app).put(`/api/v1/roles/${id}/permissions`).send({ permission_ids: ids, ...(expected ? { expected_permission_ids: expected } : {}) }));
  }
  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    unit = await newUnit(suffix); otherUnit = await newUnit(`${suffix}_other`);
    builtIn = await role('parent_builtin', 'linked', ['participants.create_own', 'carpools.view'], null);
    createdBuiltIns.push(builtIn);
    await pool.query('UPDATE roles SET is_system_role = TRUE WHERE id = $1', [builtIn]);
    const adminRole = await role('admin');
    await pool.query('INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions', [adminRole]);
    admin = await newMember(unit, [adminRole]);
    managerRole = await role('manager', 'organization', ['roles.view', 'roles.manage', 'points.view', 'points.manage', 'carpools.view']);
    manager = await newMember(unit, [managerRole]);
    member = await newMember(unit, [builtIn, managerRole]);
    otherMember = await newMember(otherUnit, [builtIn]);
    app = express(); app.use(express.json()); app.locals.pool = pool;
    app.use(require('../routes/roles')(pool, { error: jest.fn(), info: jest.fn() }));
  });
  beforeEach(() => { mockContext.userId = admin; mockContext.organizationId = unit; mockContext.authenticated = true; });
  afterAll(async () => {
    if (!pool) { return; }
    await pool.query('DELETE FROM organizations WHERE id = ANY($1::int[])', [[unit, otherUnit].filter(Boolean)]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [createdUsers]);
    await pool.query('DELETE FROM roles WHERE id = ANY($1::int[])', [createdBuiltIns]);
    await pool.end();
  });
  test('the matrix returns own and built-in roles with lock explanations, never another unit’s roles', async () => {
    const own = await role('own');
    const foreign = await role('foreign', 'organization', [], otherUnit);
    const res = await request(app).get(`/api/v1/roles/matrix?organization_id=${otherUnit}`).set('x-organization-id', String(otherUnit));
    expect(res.status).toBe(200);
    expect(res.body.data.organization_id).toBe(unit);
    expect(res.body.data.roles.map((r) => r.id)).toEqual(expect.arrayContaining([own, builtIn]));
    expect(res.body.data.roles.some((r) => r.id === foreign)).toBe(false);
    expect(res.body.data.roles.find((r) => r.id === builtIn).cells.every((c) => c.reason === 'system_role')).toBe(true);
  });
  test('missing authentication returns 401', async () => {
    mockContext.authenticated = false;
    expect((await request(app).get('/api/v1/roles/matrix')).status).toBe(401);
  });
  test('a member without management rights receives the structured permission denial', async () => {
    mockContext.userId = await newMember(unit, [builtIn]);
    const res = await request(app).get('/api/v1/roles/matrix');
    expect(res.status).toBe(403); expect(res.body.required).toContain('roles.manage'); expect(res.body.missing).toContain('roles.manage');
  });
  test('bulk replacement is atomic and records the before and after permission keys', async () => {
    const id = await role('replace', 'organization', ['carpools.view']);
    expect((await put(id, ['points.manage', 'points.view'])).status).toBe(200);
    expect(await keysFor(id)).toEqual(['points.manage', 'points.view']);
    const audit = await one('SELECT new_state FROM role_permission_audit WHERE role_id = $1', [id]);
    expect(audit.permissions).toEqual(['points.manage', 'points.view']);
  });
  test('removing and adding permissions the caller lacks both leave the role unchanged', async () => {
    const id = await role('restricted', 'organization', ['finance.view']);
    mockContext.userId = manager;
    const removal = await put(id, []);
    expect(removal.status).toBe(403); expect(removal.body.missing).toContain('finance.view');
    const addition = await put(id, ['finance.view', 'finance.approve']);
    expect(addition.status).toBe(403); expect(addition.body.missing).toContain('finance.approve');
    expect(await keysFor(id)).toEqual(['finance.view']);
  });
  test('unchanged permissions the caller lacks may be retained while changing an allowed permission', async () => {
    const id = await role('retain', 'organization', ['finance.view']);
    mockContext.userId = manager;
    expect((await put(id, ['finance.view', 'carpools.view'])).status).toBe(200);
  });
  test('Manage without View and removal of a required View return 409', async () => {
    const id = await role('pair', 'organization', ['points.manage', 'points.view']);
    expect((await put(id, ['points.manage'])).status).toBe(409);
    expect(await keysFor(id)).toEqual(['points.manage', 'points.view']);
  });
  test('a stale editor cannot overwrite a permission change made by someone else', async () => {
    const id = await role('stale', 'organization', ['points.view']);
    const original = await permissionIds(['points.view']);
    expect((await put(id, ['points.view', 'points.manage'], original)).status).toBe(200);
    const stale = await put(id, [], original);
    expect(stale.status).toBe(409); expect(stale.body.message).toBe('role_matrix_stale');
  });
  test('linked scope refuses unit finances and a financial role cannot change to linked scope', async () => {
    const linked = await role('linked', 'linked');
    expect((await put(linked, ['finance.view'])).status).toBe(409);
    const financial = await role('financial', 'organization', ['finance.view']);
    expect((await request(app).patch(`/api/v1/roles/${financial}`).send({ data_scope: 'linked' })).status).toBe(409);
  });
  test('changing a linked role to unit-wide scope cannot expose authority the caller lacks', async () => {
    const id = await role('selfscope', 'linked', ['participants.create_own']);
    mockContext.userId = manager;
    const res = await request(app).patch(`/api/v1/roles/${id}`).send({ data_scope: 'organization' });
    expect(res.status).toBe(403); expect(res.body.missing).toContain('participants.create_own');
  });
  test('name, description and scope can be edited without changing the internal key', async () => {
    const id = await role('metadata');
    const key = await one('SELECT role_name FROM roles WHERE id = $1', [id]);
    const res = await request(app).patch(`/api/v1/roles/${id}`).send({ display_name: 'Équipe <img onerror=x>', description: 'Coordination', data_scope: 'linked' });
    expect(res.status).toBe(200); expect(res.body.data.role_name).toBe(key); expect(res.body.data.data_scope).toBe('linked');
  });
  test('copying transfers only this unit’s members, keeps their other roles and audits each change', async () => {
    const stringIdMember = await newMember(unit, [String(builtIn)]);
    const res = await request(app).post('/api/v1/roles').send({ display_name: 'Parents de l’unité', base_role_id: builtIn, reassign_members: true });
    expect(res.status).toBe(201);
    const copy = res.body.data;
    expect(await one('SELECT role_ids FROM user_organizations WHERE user_id = $1 AND organization_id = $2', [stringIdMember, unit])).toEqual([copy.id]);
    expect(copy.is_system_role).toBe(false); expect(copy.organization_id).toBe(unit); expect(copy.data_scope).toBe('linked');
    expect(await keysFor(copy.id)).toEqual(await keysFor(builtIn));
    expect(await one('SELECT role_ids FROM user_organizations WHERE user_id = $1 AND organization_id = $2', [member, unit])).toEqual([copy.id, managerRole]);
    expect(await one('SELECT role_ids FROM user_organizations WHERE user_id = $1 AND organization_id = $2', [otherMember, otherUnit])).toEqual([builtIn]);
    expect(await one('SELECT count(*)::int FROM role_assignment_audit WHERE organization_id = $1 AND user_id = $2', [unit, member])).toBe(1);
  });
  test('copying preserves this unit’s per-form permissions, including edit', async () => {
    const source = await role('formsource');
    const form = await one(`INSERT INTO organization_form_formats (organization_id, form_type, form_structure)
      VALUES ($1, 'matrix_test', '{}'::jsonb) RETURNING id`, [unit]);
    await pool.query('INSERT INTO form_permissions (form_format_id, role_id, can_view, can_edit) VALUES ($1, $2, TRUE, TRUE)', [form, source]);
    const res = await request(app).post('/api/v1/roles').send({ display_name: 'Form copy', base_role_id: source });
    expect(res.status).toBe(201);
    expect(await one('SELECT can_edit FROM form_permissions WHERE role_id = $1 AND form_format_id = $2', [res.body.data.id, form])).toBe(true);
  });
  test('a forbidden copy creates neither a role nor a member audit entry', async () => {
    mockContext.userId = manager;
    const district = await role('cannot_copy', 'organization', ['finance.view']);
    const res = await request(app).post('/api/v1/roles').send({ display_name: 'Forbidden copy', base_role_id: district, reassign_members: true });
    expect(res.status).toBe(403); expect(res.body.missing.length).toBeGreaterThan(0);
    expect(await one("SELECT count(*)::int FROM roles WHERE display_name = 'Forbidden copy' AND organization_id = $1", [unit])).toBe(0);
  });
  test.each(['permissions', 'metadata', 'copy'])('another unit’s role is not found for %s', async (operation) => {
    const id = await role(`foreign_${operation}`, 'organization', [], otherUnit);
    const res = operation === 'permissions' ? await put(id, []) : operation === 'metadata'
      ? await request(app).patch(`/api/v1/roles/${id}`).send({ display_name: 'Hidden' })
      : await request(app).post('/api/v1/roles').send({ display_name: 'Hidden copy', base_role_id: id });
    expect(res.status).toBe(404);
  });
  test('built-in roles remain immutable', async () => {
    const res = await put(builtIn, []);
    expect(res.status).toBe(403); expect(res.body.required).toEqual([]); expect(res.body.missing).toEqual([]);
  });
  test.each([{ permission_ids: 'all' }, { permission_ids: [-1] }, { permission_ids: [2147483647] }])('malformed or unknown permission IDs are rejected', async (body) => {
    const id = await role(`invalid_${Math.random().toString(36).slice(2)}`);
    expect((await request(app).put(`/api/v1/roles/${id}/permissions`).send(body)).status).toBe(400);
  });
  test('demo writes carry isDemo in the denial', async () => {
    let demo = await one("SELECT id FROM roles WHERE role_name = 'demoadmin' AND organization_id IS NULL");
    if (!demo) {
      demo = await one("INSERT INTO roles (role_name, display_name, is_system_role) VALUES ('demoadmin', 'Demo', TRUE) RETURNING id");
      createdBuiltIns.push(demo);
    }
    mockContext.userId = await newMember(unit, [demo]);
    const res = await request(app).post('/api/v1/roles').send({ display_name: 'No write' });
    expect(res.status).toBe(403); expect(res.body.isDemo).toBe(true);
  });
  test('an assignment audit failure rolls back the role copy, permissions and member transfer together', async () => {
    const source = await role('rollback_source', 'organization', ['carpools.view']);
    const holder = await newMember(unit, [source]);
    await pool.query("UPDATE users SET full_name = 'Matrix rollback failure' WHERE id = $1", [holder]);
    await pool.query(`CREATE OR REPLACE FUNCTION reject_matrix_assignment_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND full_name = 'Matrix rollback failure') THEN
          RAISE EXCEPTION 'Injected local audit failure';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER reject_matrix_assignment_audit BEFORE INSERT ON role_assignment_audit
      FOR EACH ROW EXECUTE FUNCTION reject_matrix_assignment_audit()`);
    try {
      const res = await request(app).post('/api/v1/roles').send({ display_name: 'Rolled back copy', base_role_id: source, reassign_members: true });
      expect(res.status).toBe(500);
      expect(res.body.message).toBe('internal_server_error');
      expect(await one('SELECT role_ids FROM user_organizations WHERE user_id = $1 AND organization_id = $2', [holder, unit])).toEqual([source]);
      expect(await one("SELECT count(*)::int FROM roles WHERE organization_id = $1 AND display_name = 'Rolled back copy'", [unit])).toBe(0);
    } finally {
      await pool.query('DROP TRIGGER reject_matrix_assignment_audit ON role_assignment_audit; DROP FUNCTION reject_matrix_assignment_audit()');
    }
  });
  test('deleting a custom role clears member references and preserves the definition and assignment audit', async () => {
    const id = await role('deleted', 'organization', ['carpools.view']);
    const holder = await newMember(unit, [String(id), managerRole]);
    const res = await request(app).delete(`/api/v1/roles/${id}`);
    expect(res.status).toBe(200);
    expect(await one('SELECT role_ids FROM user_organizations WHERE user_id = $1 AND organization_id = $2', [holder, unit])).toEqual([managerRole]);
    expect(await one(`SELECT previous_state FROM role_permission_audit WHERE organization_id = $1 AND previous_state->>'display_name' = $2`, [unit, `deleted_${suffix}`])).toMatchObject({ permissions: ['carpools.view'] });
    expect(await one('SELECT count(*)::int FROM role_assignment_audit WHERE user_id = $1 AND organization_id = $2', [holder, unit])).toBe(1);
  });
  test('migration 036 runs twice and only district automatically receives district management', async () => {
    const sql = fs.readFileSync(path.join(__dirname, '../migrations/036_role_permission_matrix.sql'), 'utf8');
    const districtId = await role('all_permissions');
    const unitAdminId = await role('unit_permissions');
    await pool.query('UPDATE roles SET grants_all_permissions = TRUE WHERE id = $1', [districtId]);
    await pool.query('UPDATE roles SET grants_unit_permissions = TRUE WHERE id = $1', [unitAdminId]);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("DELETE FROM permissions WHERE permission_key = 'roles.manage_district'");
      await client.query(sql); await client.query(sql);
      const held = (id) => client.query(`SELECT p.permission_key FROM role_permissions rp
        JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = $1`, [id]);
      expect((await held(districtId)).rows.map((p) => p.permission_key)).toContain('roles.manage_district');
      expect((await held(unitAdminId)).rows.map((p) => p.permission_key)).not.toContain('roles.manage_district');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
