/**
 * Reusing an earlier camp (#1256) on a disposable database: what is copied,
 * what is reset, what is left out, and who may copy what.
 */
const express = require('express');
const request = require('supertest');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const { saveLot } = require('../services/campEquipmentLots');
require('./jest-conditional-helpers');
process.env.JWT_SECRET_KEY ||= 'fictional-camp-duplication-integration';
const DATABASE_URL = process.env.TEST_DATABASE_URL;

const EVERY_PART = ['schedule', 'packing_list', 'lots', 'tasks'];
const MANAGE = ['meetings.view', 'meetings.manage', 'personal_equipment.manage', 'camp_lots.view', 'camp_lots.manage', 'tasks.view', 'tasks.manage'];

describe.skipIf(!DATABASE_URL)('Reusing an earlier camp', () => {
  let pool; let app;
  const ids = {}; const units = []; const users = [];
  const one = async (sql, params = []) => Object.values((await pool.query(sql, params)).rows[0] || {})[0];
  const rows = async (sql, params = []) => (await pool.query(sql, params)).rows;

  /** A unit and its section, together: the unit's section is checked at commit. */
  async function unit() {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const id = (await db.query("INSERT INTO organizations (name) VALUES ('Fictional Reuse Unit') RETURNING id")).rows[0].id;
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
  async function member(unitId, keys, name) {
    const role = await one("INSERT INTO roles (role_name, display_name, data_scope, organization_id) VALUES ('dup_' || gen_random_uuid(), 'Camp team', 'organization', $1) RETURNING id", [unitId]);
    await pool.query('INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE permission_key = ANY($2::text[])', [role, keys]);
    const user = await one("INSERT INTO users (email, password, full_name) VALUES ('dup-' || gen_random_uuid() || '@example.test', 'x', $1) RETURNING id", [name]);
    users.push(user);
    await pool.query('INSERT INTO user_organizations (organization_id, user_id, role_ids) VALUES ($1, $2, $3)', [unitId, user, JSON.stringify([role])]);
    return user;
  }
  /** A camp: its activity and its year-plan date, over the given days. */
  async function camp(unitId, start, end, theme = 'Fictional winter camp') {
    const outing = await one(`INSERT INTO activities (organization_id, created_by, name, activity_date, meeting_location_going,
      meeting_time_going, departure_time_going, activity_start_date, activity_start_time, activity_end_date, activity_end_time)
      VALUES ($1, $2, $3, $4, 'Hall', '09:00', '09:15', $4, '09:00', $5, '16:00') RETURNING id`, [unitId, ids.manager, theme, start, end]);
    const meeting = await one(`INSERT INTO year_plan_meetings (organization_id, meeting_date, theme, meeting_kind, activity_id)
      VALUES ($1, $2, $3, 'camp', $4) RETURNING id`, [unitId, start, theme, outing]);
    return { meeting, activity: outing };
  }
  const auth = (user = ids.manager, unitId = ids.unit) => ({ Authorization: `Bearer ${jwt.sign({ user_id: user, organizationId: unitId }, process.env.JWT_SECRET_KEY)}` });
  const duplicate = (target, body, user) => request(app)
    .post(`/api/v1/yearly-planner/meetings/${target}/duplicate`).set(auth(user)).send(body);

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    ids.unit = await unit(); ids.otherUnit = await unit();
    ids.manager = await member(ids.unit, MANAGE, 'Ada Fiction');
    ids.planner = await member(ids.unit, ['meetings.view', 'meetings.manage'], 'Planner Fiction');
    ids.helper = await member(ids.unit, ['tasks.view'], 'Helper Fiction');
    ids.leaver = await member(ids.unit, ['tasks.view'], 'Former Fiction');
    ids.outsider = await member(ids.otherUnit, MANAGE, 'Foreign Fiction');

    ids.source = await camp(ids.unit, '2025-11-14', '2025-11-16', 'Camp d’hiver 2025');
    ids.foreign = await camp(ids.otherUnit, '2025-11-14', '2025-11-16');
    ids.pot = await one("INSERT INTO equipment_catalog_items (organization_id, name, category, unit_of_measure) VALUES ($1, 'Cooking pot', 'kitchen', 'each') RETURNING id", [ids.unit]);
    ids.tent = await one("INSERT INTO equipment_catalog_items (organization_id, name, category, unit_of_measure) VALUES ($1, 'Tent', 'camping', 'each') RETURNING id", [ids.unit]);
    ids.retired = await one("INSERT INTO equipment_catalog_items (organization_id, name, category, unit_of_measure, archived_at) VALUES ($1, 'Old lantern', 'camping', 'each', NOW()) RETURNING id", [ids.unit]);

    // Schedule: a later-day heading and line with an article; a first-day line stays with meeting preparation.
    await pool.query("INSERT INTO year_plan_meeting_days (organization_id, meeting_id, day_offset, title) VALUES ($1, $2, 1, 'Hike day')", [ids.unit, ids.source.meeting]);
    const hike = await one("INSERT INTO year_plan_meeting_activities (organization_id, meeting_id, name, day_offset, material) VALUES ($1, $2, 'Hike', 1, 'Maps') RETURNING id", [ids.unit, ids.source.meeting]);
    await pool.query('INSERT INTO meeting_activity_equipment (organization_id, meeting_activity_id, catalog_item_id, quantity) VALUES ($1, $2, $3, 4)', [ids.unit, hike, ids.pot]);
    const arrival = await one("INSERT INTO year_plan_meeting_activities (organization_id, meeting_id, name, day_offset) VALUES ($1, $2, 'Arrival', 0) RETURNING id", [ids.unit, ids.source.meeting]);
    await pool.query('INSERT INTO meeting_activity_equipment (organization_id, meeting_activity_id, catalog_item_id, quantity) VALUES ($1, $2, $3, 2)', [ids.unit, arrival, ids.tent]);

    // A published packing list, with a translation, one item linked to an article since archived.
    await pool.query(`INSERT INTO personal_equipment_lists (organization_id, meeting_id, season, nights, stay_type, notes_fr, notes_en, published, reviewed_at)
      VALUES ($1, $2, 'winter', 2, 'cabin', 'Bien s’habiller', 'Dress warmly', TRUE, NOW())`, [ids.unit, ids.source.meeting]);
    await pool.query(`INSERT INTO personal_equipment_items (organization_id, meeting_id, item_key, label_fr, label_en, quantity, catalog_item_id, position, category)
      VALUES ($1, $2, 'boots', 'Bottes', 'Boots', 1, NULL, 0, 'clothing'), ($1, $2, 'lantern', 'Lanterne', 'Lantern', 1, $3, 1, NULL)`,
    [ids.unit, ids.source.meeting, ids.retired]);
    await pool.query(`INSERT INTO personal_equipment_translations (organization_id, meeting_id, version, language, content)
      VALUES ($1, $2, 1, 'uk', '{"notes":"Тепло","items":[{"key":"boots","label":"Чоботи"},{"key":"lantern","label":"Ліхтар"}]}')`, [ids.unit, ids.source.meeting]);
    await pool.query("INSERT INTO packing_list_publications (organization_id, resource_key, content) VALUES ($1, $2, '{}')", [ids.unit, String(ids.source.meeting)]);

    // Two lots: one from the later-day material, one only from the first day's.
    ids.kitchen = (await saveLot(pool, ids.unit, ids.manager, ids.source.meeting, {
      name: 'Kitchen', creation_key: randomUUID(), items: [{ catalog_item_id: ids.pot, quantity: 3 }],
      roles: [{ role: 'prepare', user_id: ids.helper }, { role: 'return', user_id: ids.leaver }],
    })).id;
    await saveLot(pool, ids.unit, ids.manager, ids.source.meeting, {
      name: 'Arrival bin', creation_key: randomUUID(), items: [{ catalog_item_id: ids.tent, quantity: 2 }],
      roles: [{ role: 'prepare', user_id: ids.helper }],
    });
    await pool.query("UPDATE camp_equipment_lots SET status = 'returned', version = 3 WHERE organization_id = $1 AND meeting_id = $2", [ids.unit, ids.source.meeting]);
    await pool.query("UPDATE activity_tasks SET status = 'done' WHERE organization_id = $1 AND meeting_id = $2", [ids.unit, ids.source.meeting]);

    // Two tasks of the camp itself: one on its date, done, with a reminder; one on its activity.
    const booking = await one(`INSERT INTO activity_tasks (organization_id, meeting_id, title, assignee_id, due_date, status)
      VALUES ($1, $2, 'Book the site', $3, '2025-10-01', 'done') RETURNING id`, [ids.unit, ids.source.meeting, ids.helper]);
    await pool.query(`INSERT INTO task_equipment_reminders (organization_id, task_id, materials, lead_days, repeat_hours, confirmed_at, delivery_status)
      VALUES ($1, $2, 'Site contract', 3, 48, NOW(), 'sent')`, [ids.unit, booking]);
    await pool.query(`INSERT INTO activity_tasks (organization_id, activity_id, title, assignee_id, due_date)
      VALUES ($1, $2, 'Buy food', $3, '2025-11-10')`, [ids.unit, ids.source.activity, ids.leaver]);

    // Someone who left the unit since.
    await pool.query("UPDATE user_organizations SET status = 'inactive' WHERE organization_id = $1 AND user_id = $2", [ids.unit, ids.leaver]);

    app = express(); app.locals.pool = pool; app.use(express.json());
    app.use('/api/v1/yearly-planner', require('../routes/yearlyPlanner')(pool, { error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
    app.use((err, _req, res, _next) => res.status(500).json({ success: false, message: 'internal_server_error' }));
  });

  afterAll(async () => {
    if (!pool) {return;}
    // Packing items point at catalogue articles of the same unit: they go first.
    await pool.query('DELETE FROM personal_equipment_lists WHERE organization_id = ANY($1::int[])', [units]);
    await pool.query('DELETE FROM organizations WHERE id = ANY($1::int[])', [units]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    await pool.end();
  });

  test('a leader sees the unit’s earlier camps with what each holds, and none from another unit', async () => {
    const target = await camp(ids.unit, '2026-10-09', '2026-10-11');
    const response = await request(app).get(`/api/v1/yearly-planner/meetings/${target.meeting}/duplication`).set(auth());

    expect(response.status).toBe(200);
    expect(response.body.data.target.counts).toEqual({ site: 0, schedule: 0, packing_list: 0, lots: 0, tasks: 0 });
    const source = response.body.data.sources.find((item) => item.id === ids.source.meeting);
    expect(source).toMatchObject({ span_days: 3, fits_schedule: true, counts: { schedule: 2, packing_list: 2, lots: 2, tasks: 2 } });
    expect(response.body.data.sources.some((item) => item.id === ids.foreign.meeting)).toBe(false);
  });

  test('everything prepared is copied with dates shifted and every state reset; nothing personal comes along', async () => {
    const target = await camp(ids.unit, '2026-11-13', '2026-11-15');
    const response = await duplicate(target.meeting, { source_meeting_id: ids.source.meeting, parts: EVERY_PART });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      offset_days: 364,
      copied: { schedule_days: 1, schedule_activities: 1, packing_items: 2, lots: 1, tasks: 2 },
      skipped_lots: ['Arrival bin'],
      reassigned_tasks: 2,
    });

    // Schedule: the later day only, with its article.
    const lines = await rows(`SELECT a.name, a.day_offset, a.material, mae.catalog_item_id, mae.quantity::int AS quantity
      FROM year_plan_meeting_activities a LEFT JOIN meeting_activity_equipment mae ON mae.meeting_activity_id = a.id
      WHERE a.meeting_id = $1`, [target.meeting]);
    expect(lines).toEqual([{ name: 'Hike', day_offset: 1, material: 'Maps', catalog_item_id: ids.pot, quantity: 4 }]);

    // Packing list: a draft families do not see, the archived article unlinked, its translation kept.
    const list = (await rows('SELECT published, reviewed_at, version, season FROM personal_equipment_lists WHERE meeting_id = $1', [target.meeting]))[0];
    expect(list).toEqual({ published: false, reviewed_at: null, version: 1, season: 'winter' });
    expect(await rows('SELECT item_key, catalog_item_id FROM personal_equipment_items WHERE meeting_id = $1 ORDER BY position', [target.meeting]))
      .toEqual([{ item_key: 'boots', catalog_item_id: null }, { item_key: 'lantern', catalog_item_id: null }]);
    expect(await one("SELECT content->>'notes' FROM personal_equipment_translations WHERE meeting_id = $1 AND version = 1 AND language = 'uk'", [target.meeting])).toBe('Тепло');
    expect(await one('SELECT COUNT(*)::int FROM packing_list_publications WHERE organization_id = $1 AND resource_key = $2', [ids.unit, String(target.meeting)])).toBe(0);

    // Lots: to prepare again, duties due on the new dates, a departed holder's duty handed to the person copying.
    const lots = await rows('SELECT id, name, status, version FROM camp_equipment_lots WHERE meeting_id = $1', [target.meeting]);
    expect(lots).toEqual([{ id: expect.any(Number), name: 'Kitchen', status: 'to_prepare', version: 1 }]);
    expect(await rows('SELECT item_key, quantity::int AS quantity FROM camp_equipment_lot_items WHERE lot_id = $1', [lots[0].id]))
      .toEqual([{ item_key: `a${ids.pot}`, quantity: 3 }]);
    const duties = await rows(`SELECT r.role, t.assignee_id, t.due_date::text, t.status FROM camp_equipment_lot_roles r
      JOIN activity_tasks t ON t.id = r.task_id WHERE r.lot_id = $1 ORDER BY r.role`, [lots[0].id]);
    expect(duties).toEqual([
      { role: 'prepare', assignee_id: ids.helper, due_date: '2026-11-13', status: 'todo' },
      { role: 'return', assignee_id: ids.manager, due_date: '2026-11-15', status: 'todo' },
    ]);
    expect(await rows('SELECT action, previous_status, status FROM camp_equipment_lot_history WHERE lot_id = $1', [lots[0].id]))
      .toEqual([{ action: 'created', previous_status: null, status: 'to_prepare' }]);

    // Tasks: to do, as many days before the camp as before the earlier one, the reminder waiting to be sent.
    const tasks = await rows(`SELECT t.title, t.meeting_id, t.activity_id, t.assignee_id, t.due_date::text, t.status,
        er.materials, er.confirmed_at, er.delivery_status
      FROM activity_tasks t LEFT JOIN task_equipment_reminders er ON er.task_id = t.id
      WHERE (t.meeting_id = $1 OR t.activity_id = $2)
        AND NOT EXISTS (SELECT 1 FROM camp_equipment_lot_roles r WHERE r.task_id = t.id)
      ORDER BY t.due_date`, [target.meeting, target.activity]);
    expect(tasks).toEqual([
      { title: 'Book the site', meeting_id: target.meeting, activity_id: null, assignee_id: ids.helper, due_date: '2026-09-30',
        status: 'todo', materials: 'Site contract', confirmed_at: null, delivery_status: 'pending' },
      { title: 'Buy food', meeting_id: null, activity_id: target.activity, assignee_id: ids.manager, due_date: '2026-11-09',
        status: 'todo', materials: null, confirmed_at: null, delivery_status: null },
    ]);

    // The earlier camp is left as it was.
    expect(await one('SELECT status FROM camp_equipment_lots WHERE id = $1', [ids.kitchen])).toBe('returned');
    expect(await one('SELECT published FROM personal_equipment_lists WHERE meeting_id = $1', [ids.source.meeting])).toBe(true);
  });

  test('a part already filled is refused, and nothing else is copied with it', async () => {
    const target = await camp(ids.unit, '2026-12-04', '2026-12-06');
    await pool.query(`INSERT INTO activity_tasks (organization_id, meeting_id, title, assignee_id, due_date)
      VALUES ($1, $2, 'Already planned', $3, '2026-11-20')`, [ids.unit, target.meeting, ids.helper]);

    const response = await duplicate(target.meeting, { source_meeting_id: ids.source.meeting, parts: EVERY_PART });

    expect(response.status).toBe(409);
    expect(response.body.message).toBe('camp_duplicate_target_not_empty');
    expect(response.body.errors).toEqual([{ field: 'parts', part: 'tasks' }]);
    expect(await one('SELECT COUNT(*)::int FROM year_plan_meeting_activities WHERE meeting_id = $1', [target.meeting])).toBe(0);
    expect(await one('SELECT COUNT(*)::int FROM camp_equipment_lots WHERE meeting_id = $1', [target.meeting])).toBe(0);
  });

  test('a first-day heading the team already wrote neither blocks the schedule nor is replaced', async () => {
    await pool.query("INSERT INTO year_plan_meeting_days (organization_id, meeting_id, day_offset, title) VALUES ($1, $2, 0, 'Source arrival') ON CONFLICT DO NOTHING", [ids.unit, ids.source.meeting]);
    const target = await camp(ids.unit, '2026-12-11', '2026-12-13');
    await pool.query("INSERT INTO year_plan_meeting_days (organization_id, meeting_id, day_offset, title) VALUES ($1, $2, 0, 'Our arrival')", [ids.unit, target.meeting]);

    const response = await duplicate(target.meeting, { source_meeting_id: ids.source.meeting, parts: ['schedule'] });

    expect(response.status).toBe(201);
    expect(await rows('SELECT day_offset, title FROM year_plan_meeting_days WHERE meeting_id = $1 ORDER BY day_offset', [target.meeting]))
      .toEqual([{ day_offset: 0, title: 'Our arrival' }, { day_offset: 1, title: 'Hike day' }]);
    await pool.query('DELETE FROM year_plan_meeting_days WHERE meeting_id = $1 AND day_offset = 0', [ids.source.meeting]);
  });

  test('two leaders copying into the same camp at once produce one copy', async () => {
    const target = await camp(ids.unit, '2027-01-08', '2027-01-10');
    const body = { source_meeting_id: ids.source.meeting, parts: ['schedule', 'lots'] };

    const results = await Promise.all([duplicate(target.meeting, body), duplicate(target.meeting, body)]);

    expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
    expect(await one('SELECT COUNT(*)::int FROM camp_equipment_lots WHERE meeting_id = $1', [target.meeting])).toBe(1);
    expect(await one('SELECT COUNT(*)::int FROM year_plan_meeting_activities WHERE meeting_id = $1', [target.meeting])).toBe(1);
  });

  test('a planner without lot or task rights may copy the schedule, and is refused the lots with what is missing', async () => {
    const target = await camp(ids.unit, '2027-02-05', '2027-02-07');

    const refused = await duplicate(target.meeting, { source_meeting_id: ids.source.meeting, parts: ['schedule', 'lots'] }, ids.planner);
    expect(refused.status).toBe(403);
    expect(refused.body.missing).toEqual(expect.arrayContaining(['camp_lots.manage', 'tasks.manage']));
    expect(await one('SELECT COUNT(*)::int FROM year_plan_meeting_activities WHERE meeting_id = $1', [target.meeting])).toBe(0);

    const allowed = await duplicate(target.meeting, { source_meeting_id: ids.source.meeting, parts: ['schedule'] }, ids.planner);
    expect(allowed.status).toBe(201);
    expect(allowed.body.data.copied).toEqual({ schedule_days: 1, schedule_activities: 1 });
  });

  test('another unit’s camp can be neither copied from nor copied into', async () => {
    const target = await camp(ids.unit, '2027-03-05', '2027-03-07');

    expect((await duplicate(target.meeting, { source_meeting_id: ids.foreign.meeting, parts: ['schedule'] })).status).toBe(404);
    expect((await duplicate(ids.foreign.meeting, { source_meeting_id: ids.source.meeting, parts: ['schedule'] })).status).toBe(404);
    expect((await request(app).get(`/api/v1/yearly-planner/meetings/${ids.foreign.meeting}/duplication`).set(auth())).status).toBe(404);
  });

  test('a shorter camp cannot take a longer schedule, but can take its tasks', async () => {
    const target = await camp(ids.unit, '2027-04-10', '2027-04-11');

    const refused = await duplicate(target.meeting, { source_meeting_id: ids.source.meeting, parts: ['schedule', 'tasks'] });
    expect(refused.status).toBe(409);
    expect(refused.body.errors).toEqual([{ field: 'parts', part: 'schedule', dropped_days: [2] }]);

    const allowed = await duplicate(target.meeting, { source_meeting_id: ids.source.meeting, parts: ['tasks'] });
    expect(allowed.status).toBe(201);
    expect(allowed.body.data.copied).toEqual({ tasks: 2 });
  });

  test('a malformed request is refused before anything is read', async () => {
    const target = await camp(ids.unit, '2027-05-07', '2027-05-09');
    for (const body of [
      { source_meeting_id: ids.source.meeting, parts: [] },
      { source_meeting_id: ids.source.meeting, parts: ['schedule', 'schedule'] },
      { source_meeting_id: ids.source.meeting, parts: ['attendance'] },
      { source_meeting_id: ids.source.meeting, parts: 'schedule' },
      { source_meeting_id: '12abc', parts: ['schedule'] },
      { source_meeting_id: target.meeting, parts: ['schedule'] },
    ]) {
      // eslint-disable-next-line no-await-in-loop -- each refusal is checked on its own
      const response = await duplicate(target.meeting, body);
      expect(response.status).toBe(400);
    }
  });
});
