/** Camp equipment allocations, shared assignments and concurrent edits on a disposable database. */
const express = require('express');
const request = require('supertest');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const { saveLot, changeLotStatus } = require('../services/campEquipmentLots');
require('./jest-conditional-helpers');
process.env.JWT_SECRET_KEY ||= 'fictional-camp-lots-integration';
const DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!DATABASE_URL)('Equipment lots of a camp', () => {
  let pool; let app;
  const ids = {}; const units = []; const users = [];
  const one = async (sql, params = []) => Object.values((await pool.query(sql, params)).rows[0] || {})[0];
  async function unit() {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const id = (await db.query("INSERT INTO organizations (name) VALUES ('Fictional Equipment Unit') RETURNING id")).rows[0].id;
      await db.query("INSERT INTO organization_program_sections (organization_id, section_key, display_name) VALUES ($1, 'general', 'General')", [id]);
      await db.query('COMMIT'); units.push(id); return id;
    } catch (err) {await db.query('ROLLBACK'); throw err;}
    finally {db.release();}
  }
  async function member(unitId, keys, name) {
    const role = await one("INSERT INTO roles (role_name, display_name, data_scope, organization_id) VALUES ('lot_' || gen_random_uuid(), 'Equipment helper', 'linked', $1) RETURNING id", [unitId]);
    await pool.query('INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE permission_key = ANY($2::text[])', [role, keys]);
    const user = await one("INSERT INTO users (email, password, full_name) VALUES ('lot-' || gen_random_uuid() || '@example.test', 'x', $1) RETURNING id", [name]);
    users.push(user);
    await pool.query('INSERT INTO user_organizations (organization_id, user_id, role_ids) VALUES ($1, $2, $3)', [unitId, user, JSON.stringify([role])]);
    return user;
  }
  async function camp(unitId) {
    const outing = await one(`INSERT INTO activities (organization_id, created_by, name, activity_date, meeting_location_going,
      meeting_time_going, departure_time_going, activity_start_date, activity_start_time, activity_end_date, activity_end_time)
      VALUES ($1, $2, 'Fictional camp', '2026-11-14', 'Hall', '09:00', '09:15', '2026-11-14', '09:00', '2026-11-16', '16:00') RETURNING id`, [unitId, ids.manager]);
    return one("INSERT INTO year_plan_meetings (organization_id, meeting_date, theme, meeting_kind, activity_id) VALUES ($1, '2026-11-14', 'Fictional camp', 'camp', $2) RETURNING id", [unitId, outing]);
  }
  const auth = (user = ids.manager, unitId = ids.unit) => ({ Authorization: `Bearer ${jwt.sign({ user_id: user, organizationId: unitId }, process.env.JWT_SECRET_KEY)}` });
  const call = (method, path, user, unitId) => request(app)[method](`/api/v1/camp-equipment-lots${path}`).set(auth(user, unitId));
  const input = (extra = {}) => ({ name: 'Kitchen', creation_key: randomUUID(), items: [{ catalog_item_id: ids.article, quantity: 2 }],
    roles: [{ role: 'prepare', user_id: ids.preparer }, { role: 'transport', user_id: ids.carrier }, { role: 'return', user_id: ids.returner }], ...extra });
  async function create(extra = {}) {
    const response = await call('post', `/meetings/${ids.camp}`).send(input(extra));
    expect(response.status).toBe(201); return response.body.data;
  }
  const state = (extra = {}) => ({ status: 'loaded', expected_version: 1, mutation_id: randomUUID(), ...extra });
  const context = (actorId = ids.manager, ownOnly = false) => ({ organizationId: ids.unit, actorId, ownOnly });

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    ids.unit = await unit(); ids.otherUnit = await unit();
    const manage = ['camp_lots.view', 'camp_lots.manage', 'tasks.view', 'tasks.manage'];
    ids.manager = await member(ids.unit, manage, 'Ada Fiction');
    ids.preparer = await member(ids.unit, ['tasks.view'], 'Preparation Fiction');
    ids.carrier = await member(ids.unit, ['tasks.view'], 'Transport Fiction');
    ids.returner = await member(ids.unit, ['tasks.view'], 'Return Fiction');
    ids.colleague = await member(ids.unit, ['tasks.view'], 'Other Fiction');
    ids.outsider = await member(ids.otherUnit, manage, 'Foreign Fiction');
    ids.camp = await camp(ids.unit); ids.otherCamp = await camp(ids.otherUnit);
    ids.article = await one("INSERT INTO equipment_catalog_items (organization_id, name, category, unit_of_measure) VALUES ($1, 'Cooking pot', 'kitchen', 'each') RETURNING id", [ids.unit]);
    ids.foreignArticle = await one("INSERT INTO equipment_catalog_items (organization_id, name, category, unit_of_measure) VALUES ($1, 'Foreign tent', 'camping', 'each') RETURNING id", [ids.otherUnit]);
    const line = await one("INSERT INTO year_plan_meeting_activities (organization_id, meeting_id, name, day_offset) VALUES ($1, $2, 'Camp meal', 0) RETURNING id", [ids.unit, ids.camp]);
    await pool.query('INSERT INTO meeting_activity_equipment (organization_id, meeting_activity_id, catalog_item_id, quantity) VALUES ($1, $2, $3, 4)', [ids.unit, line, ids.article]);
    app = express(); app.locals.pool = pool; app.use(express.json());
    app.use('/api/v1/camp-equipment-lots', require('../routes/camp-equipment-lots')(pool));
    app.use('/api/v1/tasks', require('../routes/tasks')(pool));
    app.use((err, _req, res, _next) => res.status(500).json({ success: false, message: 'internal_server_error' }));
  });
  beforeEach(async () => {
    await pool.query('DELETE FROM camp_equipment_lots WHERE organization_id = $1', [ids.unit]);
    await pool.query('DELETE FROM activity_tasks WHERE organization_id = $1', [ids.unit]);
    await pool.query('DELETE FROM camp_equipment_lot_receipts WHERE organization_id = $1', [ids.unit]);
  });
  afterAll(async () => {
    if (!pool) {return;}
    await pool.query('DELETE FROM organizations WHERE id = ANY($1::int[])', [units]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    await pool.end();
  });

  test('one camp lot creates one shared task per role with the camp dates and minimal member choices', async () => {
    const lot = await create();
    expect(lot).toMatchObject({ name: 'Kitchen', status: 'to_prepare', version: 1, meeting_id: ids.camp });
    expect(lot.items).toEqual([{ key: `a${ids.article}`, name: 'Cooking pot', quantity: 2, unit_of_measure: 'each' }]);
    expect(lot.roles.find((role) => role.role === 'return').due_date).toBe('2026-11-16');
    expect(lot.roles.find((role) => role.role === 'prepare').due_date).toBe('2026-11-14');
    const tasks = await request(app).get('/api/v1/tasks/mine').set(auth(ids.carrier));
    expect(tasks.body.data).toEqual([expect.objectContaining({ equipment_lot_id: lot.id, equipment_lot_role: 'transport' })]);
    const choices = await call('get', `/meetings/${ids.camp}/options`);
    expect(choices.status).toBe(200);
    expect(Object.keys(choices.body.data.members[0]).sort()).toEqual(['full_name', 'id']);
    expect(choices.body.data.members.some((member) => member.id === ids.outsider)).toBe(false);
    expect(choices.body.data.items[0].allocated).toBe(2);
  });
  test('a lost creation response reuses its key without duplicating lots or tasks', async () => {
    const payload = input();
    const results = await Promise.all([call('post', `/meetings/${ids.camp}`).send(payload), call('post', `/meetings/${ids.camp}`).send(payload)]);
    expect(results.map((res) => res.status)).toEqual([201, 201]);
    expect(results[0].body.data.id).toBe(results[1].body.data.id);
    expect(await one('SELECT COUNT(*)::int FROM activity_tasks WHERE organization_id = $1', [ids.unit])).toBe(3);
    expect((await call('post', `/meetings/${ids.camp}`).send({ ...payload, name: 'Different' })).status).toBe(409);
  });
  test('competing allocations cannot exceed the camp quantity', async () => {
    const results = await Promise.all([
      call('post', `/meetings/${ids.camp}`).send(input({ name: 'Kitchen A', items: [{ catalog_item_id: ids.article, quantity: 3 }] })),
      call('post', `/meetings/${ids.camp}`).send(input({ name: 'Kitchen B', items: [{ catalog_item_id: ids.article, quantity: 3 }] })),
    ]);
    expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
    expect(await one('SELECT SUM(quantity)::int FROM camp_equipment_lot_items WHERE organization_id = $1', [ids.unit])).toBe(3);
  });
  test('another unit’s article and inactive assignees roll back every part of the lot', async () => {
    expect((await call('post', `/meetings/${ids.camp}`).send(input({ items: [{ catalog_item_id: ids.foreignArticle, quantity: 1 }] }))).status).toBe(409);
    expect((await call('post', `/meetings/${ids.camp}`).send(input({ roles: [{ role: 'prepare', user_id: ids.outsider }] }))).status).toBe(400);
    await pool.query("UPDATE user_organizations SET status = 'inactive' WHERE organization_id = $1 AND user_id = $2", [ids.unit, ids.carrier]);
    try {expect((await call('post', `/meetings/${ids.camp}`).send(input())).status).toBe(400);}
    finally {await pool.query("UPDATE user_organizations SET status = 'active' WHERE organization_id = $1 AND user_id = $2", [ids.unit, ids.carrier]);}
    expect(await one('SELECT COUNT(*)::int FROM activity_tasks WHERE organization_id = $1', [ids.unit])).toBe(0);
    expect(await one('SELECT COUNT(*)::int FROM camp_equipment_lots WHERE organization_id = $1', [ids.unit])).toBe(0);
  });
  test('loading and returning update the role tasks and histories once even after a replay', async () => {
    const lot = await create(); const payload = state();
    const loadedResponse = await call('patch', `/${lot.id}/status`).send(payload);
    expect(loadedResponse.status).toBe(200);
    const loaded = loadedResponse.body.data;
    expect(loaded).toMatchObject({ version: 2, status: 'loaded' });
    expect(loaded.roles.find((role) => role.role === 'transport').status).toBe('done');
    expect(loaded.roles.find((role) => role.role === 'return').status).toBe('todo');
    const replay = await call('patch', `/${lot.id}/status`).send(payload);
    expect(replay.status).toBe(200);
    expect(replay.body.data).toEqual(loaded);
    expect(await one('SELECT COUNT(*)::int FROM camp_equipment_lot_history WHERE lot_id = $1', [lot.id])).toBe(2);
    const returned = await call('patch', `/mine/${lot.id}/status`, ids.returner).send(state({ status: 'returned', expected_version: 2 }));
    expect(returned.status).toBe(200);
    expect(returned.body.data.roles.every((role) => role.status === 'done')).toBe(true);
  });
  test('a single preparer can load and return a lot when optional duties are absent', async () => {
    const lot = await create({ roles: [{ role: 'prepare', user_id: ids.preparer }] });
    expect((await call('patch', `/mine/${lot.id}/status`, ids.preparer).send(state())).status).toBe(200);
    const returned = await call('patch', `/mine/${lot.id}/status`, ids.preparer).send(state({ status: 'returned', expected_version: 2 }));
    expect(returned.status).toBe(200);
    expect(returned.body.data.roles[0].status).toBe('done');
  });
  test('invalid jumps and a reused mutation key never change the lot or its history', async () => {
    const lot = await create();
    expect((await call('patch', `/${lot.id}/status`).send(state({ status: 'returned' }))).status).toBe(409);
    const payload = state();
    expect((await call('patch', `/${lot.id}/status`).send(payload)).status).toBe(200);
    expect((await call('patch', `/${lot.id}/status`).send({ ...payload, status: 'returned', expected_version: 2 })).status).toBe(409);
    const current = (await call('get', `/meetings/${ids.camp}`)).body.data[0];
    expect(current).toMatchObject({ status: 'loaded', version: 2 });
    expect(current.history).toHaveLength(2);
  });
  test('two status changes from the same version cannot silently overwrite each other', async () => {
    const lot = await create();
    const results = await Promise.allSettled([changeLotStatus(pool, context(), lot.id, state()), changeLotStatus(pool, context(), lot.id, state())]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected').reason.status).toBe(409);
  });
  test('personal access is limited to assigned lots and the role needed for the transition', async () => {
    const lot = await create();
    expect((await call('get', '/mine', ids.carrier)).body.data.map((row) => row.id)).toEqual([lot.id]);
    expect((await call('get', '/mine', ids.colleague)).body.data).toEqual([]);
    expect((await call('patch', `/mine/${lot.id}/status`, ids.preparer).send(state())).status).toBe(404);
    expect((await call('patch', `/mine/${lot.id}/status`, ids.carrier).send(state())).status).toBe(200);
    expect((await call('patch', `/mine/${lot.id}/status`, ids.carrier).send(state({ status: 'returned', expected_version: 2 }))).status).toBe(404);
  });
  test('linked tasks cannot be reassigned or completed independently of their lot', async () => {
    const lot = await create(); const role = lot.roles.find((row) => row.role === 'transport');
    const response = await request(app).patch(`/api/v1/tasks/mine/${role.task_id}/status`).set(auth(ids.carrier)).send({ status: 'done', expected_status: 'todo' });
    expect(response.status).toBe(409);
    const edit = await request(app).put(`/api/v1/tasks/${role.task_id}`).set(auth()).send({ title: 'Different', assignee_id: ids.manager, due_date: '2026-11-14', activity_id: null, meeting_id: ids.camp });
    expect(edit.status).toBe(409);
    expect((await call('get', `/meetings/${ids.camp}`)).body.data[0].version).toBe(1);
  });
  test('editing a preparation lot reassigns the same shared task and removes obsolete roles', async () => {
    const lot = await create();
    const response = await call('put', `/meetings/${ids.camp}/${lot.id}`).send(input({ expected_version: 1, roles: [{ role: 'prepare', user_id: ids.colleague }] }));
    expect(response.status).toBe(200);
    expect(response.body.data.roles).toEqual([expect.objectContaining({ role: 'prepare', user_id: ids.colleague })]);
    expect((await call('get', '/mine', ids.preparer)).body.data).toEqual([]);
    expect((await call('get', '/mine', ids.returner)).body.data).toEqual([]);
    expect(await one('SELECT COUNT(*)::int FROM activity_tasks WHERE organization_id = $1', [ids.unit])).toBe(1);
    expect((await call('put', `/meetings/${ids.camp}/${lot.id}`).send(input({ expected_version: 1 }))).status).toBe(409);
  });
  test('a removed assignee cannot use an old receipt to retrieve the lot', async () => {
    const lot = await create(); const loaded = state();
    await changeLotStatus(pool, context(ids.carrier, true), lot.id, loaded);
    await changeLotStatus(pool, context(), lot.id, state({ status: 'to_prepare', expected_version: 2 }));
    await saveLot(pool, ids.unit, ids.manager, ids.camp, input({ expected_version: 3, roles: [{ role: 'prepare', user_id: ids.colleague }] }), lot.id);
    await expect(changeLotStatus(pool, context(ids.carrier, true), lot.id, loaded)).rejects.toMatchObject({ status: 404 });
  });
  test('other units cannot read or mutate this camp’s lots', async () => {
    const lot = await create();
    expect((await call('get', `/meetings/${ids.camp}`, ids.outsider, ids.otherUnit)).status).toBe(404);
    expect((await call('patch', `/${lot.id}/status`, ids.outsider, ids.otherUnit).send(state())).status).toBe(404);
    expect((await call('put', `/meetings/${ids.otherCamp}/${lot.id}`, ids.outsider, ids.otherUnit).send(input({ expected_version: 1 }))).status).toBe(404);
  });
  test('a history failure rolls back the lot, its items and every shared task', async () => {
    const failing = { connect: async () => {
      const db = await pool.connect();
      return { release: () => db.release(), query: (sql, params) => {
        if (String(sql).includes('INSERT INTO camp_equipment_lot_history')) {throw new Error('fictional history failure');}
        return db.query(sql, params);
      } };
    } };
    await expect(saveLot(failing, ids.unit, ids.manager, ids.camp, input())).rejects.toThrow('fictional history failure');
    expect(await one('SELECT COUNT(*)::int FROM camp_equipment_lots WHERE organization_id = $1', [ids.unit])).toBe(0);
    expect(await one('SELECT COUNT(*)::int FROM activity_tasks WHERE organization_id = $1', [ids.unit])).toBe(0);
  });
  test('cancelled camps and loaded lots cannot have their contents replaced', async () => {
    const lot = await create();
    await changeLotStatus(pool, context(), lot.id, state());
    expect((await call('put', `/meetings/${ids.camp}/${lot.id}`).send(input({ expected_version: 2 }))).status).toBe(409);
    await pool.query('UPDATE year_plan_meetings SET is_cancelled = TRUE WHERE id = $1', [ids.camp]);
    try {expect((await call('patch', `/${lot.id}/status`).send(state({ status: 'returned', expected_version: 2 }))).status).toBe(409);}
    finally {await pool.query('UPDATE year_plan_meetings SET is_cancelled = FALSE WHERE id = $1', [ids.camp]);}
  });
});
