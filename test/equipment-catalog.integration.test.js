/**
 * The equipment catalogue on a disposable database: real membership and
 * permission checks, the unit constraints of migration 054, and the schedule
 * lines that list catalogue articles.
 *
 * @module test/equipment-catalog.integration
 */
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
require('./jest-conditional-helpers');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET_KEY = 'equipment-catalog-integration-secret';

describe.skipIf(!DATABASE_URL)('Equipment catalogue', () => {
  let pool;
  let app;
  const units = [];
  const users = [];
  let quartermaster;
  let planner;
  let outsider;
  let camp;
  let lastYearCamp;
  let line;
  let foreignLine;
  let tent;
  let stove;

  async function one(sql, params = []) {
    return Object.values((await pool.query(sql, params)).rows[0])[0];
  }
  /** A unit and its program section, which the unit's constraint requires in the same transaction. */
  async function unit() {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const id = (await db.query("INSERT INTO organizations (name) VALUES ('Fictional Catalogue Unit') RETURNING id")).rows[0].id;
      await db.query("INSERT INTO organization_program_sections (organization_id, section_key, display_name) VALUES ($1, 'general', 'General')", [id]);
      await db.query('COMMIT');
      units.push(id);
      return id;
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    } finally {
      db.release();
    }
  }
  async function role(organizationId, keys) {
    const id = await one(`INSERT INTO roles (role_name, display_name, data_scope, organization_id)
      VALUES ('catalogue_' || gen_random_uuid(), 'Catalogue helper', 'organization', $1) RETURNING id`, [organizationId]);
    await pool.query('INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE permission_key = ANY($2::text[])', [id, keys]);
    return id;
  }
  async function member(organizationId, roleId) {
    const id = await one("INSERT INTO users (email, password, full_name) VALUES ('catalogue-' || gen_random_uuid() || '@example.test', 'x', 'Ada Lovelace') RETURNING id");
    users.push(id);
    await pool.query('INSERT INTO user_organizations (organization_id, user_id, role_ids) VALUES ($1, $2, $3)', [organizationId, id, JSON.stringify([roleId])]);
    return id;
  }
  /** A camp of three days: a year-plan meeting linked to an outing. */
  async function threeDayCamp(organizationId, start, end) {
    const outing = await one(`INSERT INTO activities (organization_id, created_by, name, activity_date, meeting_location_going,
      meeting_time_going, departure_time_going, activity_start_date, activity_start_time, activity_end_date, activity_end_time)
      VALUES ($1, $2, 'Fictional camp', $3, 'Local', '09:00', '09:00', $3, '09:00', $4, '16:00') RETURNING id`,
    [organizationId, quartermaster, start, end]);
    return one(`INSERT INTO year_plan_meetings (organization_id, meeting_date, theme, meeting_kind, activity_id)
      VALUES ($1, $2, 'Fictional camp', 'camp', $3) RETURNING id`, [organizationId, start, outing]);
  }
  function as(userId, organizationId = units[0]) {
    return { Authorization: `Bearer ${jwt.sign({ user_id: userId, organizationId }, process.env.JWT_SECRET_KEY)}` };
  }
  async function schedule(meetingId, userId = planner, organizationId = units[0]) {
    const res = await request(app).get(`/api/v1/yearly-planner/meetings/${meetingId}/schedule`).set(as(userId, organizationId));
    expect(res.status).toBe(200);
    return res.body.data.days.flatMap((day) => day.activities);
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    const first = await unit();
    const second = await unit();
    quartermaster = await member(first, await role(first, ['equipment_catalog.manage', 'meetings.view', 'meetings.manage', 'inventory.view']));
    planner = await member(first, await role(first, ['meetings.view', 'meetings.manage']));
    outsider = await member(second, await role(second, ['equipment_catalog.manage', 'meetings.view', 'meetings.manage']));
    camp = await threeDayCamp(first, '2026-11-13', '2026-11-15');
    lastYearCamp = await threeDayCamp(first, '2025-11-14', '2025-11-16');
    const foreignCamp = await threeDayCamp(second, '2026-11-13', '2026-11-15');
    foreignLine = await one("INSERT INTO year_plan_meeting_activities (organization_id, meeting_id, name, day_offset) VALUES ($1, $2, 'Their line', 1) RETURNING id", [second, foreignCamp]);

    app = express();
    app.locals.pool = pool;
    app.use(express.json());
    app.use('/api/v1/equipment-catalog', require('../routes/equipmentCatalog')(pool));
    app.use('/api/v1/yearly-planner', require('../routes/yearlyPlanner')(pool, { error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
    app.use((err, _req, res, _next) => res.status(500).json({ success: false, message: 'internal_server_error' }));
  });

  afterAll(async () => {
    if (pool) {
      await pool.query('DELETE FROM organizations WHERE id = ANY($1::int[])', [units]);
      await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
      await pool.end();
    }
  });

  test('an article created once is offered in the unit, never in another unit', async () => {
    const created = await request(app).post('/api/v1/equipment-catalog').set(as(quartermaster))
      .send({ name: 'Tente 4 places', category: 'camping', unit_of_measure: 'each' });
    expect(created.status).toBe(201);
    tent = created.body.data.id;
    stove = (await request(app).post('/api/v1/equipment-catalog').set(as(quartermaster))
      .send({ name: 'Réchaud', category: 'kitchen' })).body.data.id;

    const ours = await request(app).get('/api/v1/equipment-catalog').set(as(planner));
    expect(ours.body.data.map((item) => item.name)).toEqual(['Réchaud', 'Tente 4 places']);
    const theirs = await request(app).get('/api/v1/equipment-catalog').set(as(outsider, units[1]));
    expect(theirs.body.data).toEqual([]);
    expect((await request(app).patch(`/api/v1/equipment-catalog/${tent}`).set(as(outsider, units[1])).send({ name: 'Mine' })).status).toBe(404);
  });

  test('a second active article of the same name is refused, whatever its case', async () => {
    const res = await request(app).post('/api/v1/equipment-catalog').set(as(quartermaster)).send({ name: ' tente 4 PLACES ' });
    expect(res.status).toBe(409);
    expect(res.body.errors[0].path).toBe('name');
  });

  test('a planner lists articles with quantities on a camp line, beside its free-text material', async () => {
    const res = await request(app).post(`/api/v1/yearly-planner/meetings/${camp}/activities`).set(as(planner))
      .send({ name: 'Montage du camp', day_offset: 1, material: 'Maillets', material_items: [{ catalog_item_id: tent, quantity: 3 }] });
    expect(res.status).toBe(201);
    line = res.body.data.id;
    expect(res.body.data.material_items).toEqual([expect.objectContaining({ catalog_item_id: tent, quantity: 3 })]);

    const changed = await request(app).patch(`/api/v1/yearly-planner/meeting-activities/${line}`).set(as(planner))
      .send({ material_items: [{ catalog_item_id: tent, quantity: '2.5' }, { catalog_item_id: stove, quantity: 1 }] });
    expect(changed.status).toBe(200);

    const [saved] = await schedule(camp);
    expect(saved.material).toBe('Maillets');
    expect(saved.material_items.map((item) => [item.name, item.quantity])).toEqual([['Réchaud', 1], ['Tente 4 places', 2.5]]);
  });

  test('another unit cannot put this unit\'s article on its own line', async () => {
    const res = await request(app).patch(`/api/v1/yearly-planner/meeting-activities/${foreignLine}`).set(as(outsider, units[1]))
      .send({ material_items: [{ catalog_item_id: tent, quantity: 1 }] });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('equipment_catalog_item_unavailable');
    expect(Number(await one('SELECT COUNT(*) FROM meeting_activity_equipment WHERE meeting_activity_id = $1', [foreignLine]))).toBe(0);
  });

  test('the database itself refuses a line listing another unit\'s article', async () => {
    await expect(pool.query(
      'INSERT INTO meeting_activity_equipment (organization_id, meeting_activity_id, catalog_item_id, quantity) VALUES ($1, $2, $3, 1)',
      [units[1], foreignLine, tent],
    )).rejects.toMatchObject({ code: '23503' });
  });

  test('a refused article leaves the line as it was', async () => {
    const res = await request(app).patch(`/api/v1/yearly-planner/meeting-activities/${line}`).set(as(planner))
      .send({ name: 'Renamed', material_items: [{ catalog_item_id: tent, quantity: 1 }, { catalog_item_id: 2147483000, quantity: 1 }] });
    expect(res.status).toBe(400);
    const [kept] = await schedule(camp);
    expect(kept.name).toBe('Montage du camp');
    expect(kept.material_items).toHaveLength(2);
  });

  test('an archived article stays on the lines that list it, but is not offered for new ones', async () => {
    expect((await request(app).patch(`/api/v1/equipment-catalog/${stove}`).set(as(quartermaster)).send({ archived: true })).status).toBe(200);
    expect((await request(app).get('/api/v1/equipment-catalog').set(as(planner))).body.data.map((item) => item.id)).toEqual([tent]);

    const [kept] = await schedule(camp);
    expect(kept.material_items.find((item) => item.catalog_item_id === stove)).toMatchObject({ archived: true });
    const resaved = await request(app).patch(`/api/v1/yearly-planner/meeting-activities/${line}`).set(as(planner))
      .send({ material_items: [{ catalog_item_id: tent, quantity: 2 }, { catalog_item_id: stove, quantity: 1 }] });
    expect(resaved.status).toBe(200);

    const added = await request(app).post(`/api/v1/yearly-planner/meetings/${camp}/activities`).set(as(planner))
      .send({ name: 'Repas', day_offset: 2, material_items: [{ catalog_item_id: stove, quantity: 1 }] });
    expect(added.status).toBe(400);
    expect((await schedule(camp)).map((activity) => activity.name)).not.toContain('Repas');
  });

  test('an archived name can be reused, and restoring the archived one then collides', async () => {
    const reused = await request(app).post('/api/v1/equipment-catalog').set(as(quartermaster)).send({ name: 'Réchaud' });
    expect(reused.status).toBe(201);
    expect((await request(app).patch(`/api/v1/equipment-catalog/${stove}`).set(as(quartermaster)).send({ archived: false })).status).toBe(409);
  });

  test('copying a camp schedule brings each line\'s active articles along', async () => {
    const copied = await request(app).post(`/api/v1/yearly-planner/meetings/${lastYearCamp}/schedule/copy-from/${camp}`).set(as(planner));
    expect(copied.status).toBe(201);
    const [copy] = await schedule(lastYearCamp);
    expect(copy.id).not.toBe(line);
    expect(copy.material_items.map((item) => [item.catalog_item_id, item.quantity])).toEqual([[tent, 2]]);
  });

  test('an article can be linked only to equipment the unit may use', async () => {
    const own = await one("INSERT INTO equipment_items (organization_id, name, category) VALUES ($1, 'Tentes du local', 'camping') RETURNING id", [units[0]]);
    const foreign = await one(`INSERT INTO equipment_items (organization_id, name, category, attributes)
      VALUES ($1, 'Their tents', 'camping', '{"share_with_local_group": false}') RETURNING id`, [units[1]]);
    expect((await request(app).patch(`/api/v1/equipment-catalog/${tent}`).set(as(quartermaster)).send({ equipment_item_id: foreign })).status).toBe(400);
    const linked = await request(app).patch(`/api/v1/equipment-catalog/${tent}`).set(as(quartermaster)).send({ equipment_item_id: own });
    expect(linked.status).toBe(200);
    expect(linked.body.data).toMatchObject({ equipment_item_id: own, equipment_name: 'Tentes du local' });
  });

  test('deleting a line removes its articles, and the articles stay in the catalogue', async () => {
    expect((await request(app).delete(`/api/v1/yearly-planner/meeting-activities/${line}`).set(as(planner))).status).toBe(200);
    expect(Number(await one('SELECT COUNT(*) FROM meeting_activity_equipment WHERE meeting_activity_id = $1', [line]))).toBe(0);
    expect((await request(app).get('/api/v1/equipment-catalog').set(as(planner))).body.data.map((item) => item.id)).toContain(tent);
  });
});
