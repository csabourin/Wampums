/**
 * Who leads a camp schedule line (#1417) on a disposable database: members of
 * the unit's team only, kept in order, marked once they leave, and a line
 * changed since it was loaded refused rather than overwritten.
 */
const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
require('./jest-conditional-helpers');
process.env.JWT_SECRET_KEY ||= 'fictional-schedule-leaders-integration';
const DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!DATABASE_URL)('Members in charge of a schedule line', () => {
  let pool; let app;
  const ids = {}; const units = []; const users = [];
  const one = async (sql, params = []) => Object.values((await pool.query(sql, params)).rows[0] || {})[0];

  async function unit() {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const id = (await db.query("INSERT INTO organizations (name) VALUES ('Fictional Schedule Unit') RETURNING id")).rows[0].id;
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
  async function member(unitId, keys, name, scope = 'organization') {
    const role = await one("INSERT INTO roles (role_name, display_name, data_scope, organization_id) VALUES ('sched_' || gen_random_uuid(), 'Team', $2, $1) RETURNING id", [unitId, scope]);
    await pool.query('INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE permission_key = ANY($2::text[])', [role, keys]);
    const user = await one("INSERT INTO users (email, password, full_name) VALUES ('sched-' || gen_random_uuid() || '@example.test', 'x', $1) RETURNING id", [name]);
    users.push(user);
    await pool.query('INSERT INTO user_organizations (organization_id, user_id, role_ids) VALUES ($1, $2, $3)', [unitId, user, JSON.stringify([role])]);
    return user;
  }
  const auth = (user = ids.planner, unitId = ids.unit) => ({ Authorization: `Bearer ${jwt.sign({ user_id: user, organizationId: unitId }, process.env.JWT_SECRET_KEY)}` });
  const schedule = async () => (await request(app).get(`/api/v1/yearly-planner/meetings/${ids.camp}/schedule`).set(auth())).body.data;
  const lineOf = (data, id) => data.days.flatMap((day) => day.activities).find((activity) => activity.id === id);
  const patch = (lineId, body, user, unitId) => request(app).patch(`/api/v1/yearly-planner/meeting-activities/${lineId}`).set(auth(user, unitId)).send(body);

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    ids.unit = await unit(); ids.otherUnit = await unit();
    ids.planner = await member(ids.unit, ['meetings.view', 'meetings.manage'], 'Ada Lovelace');
    ids.leader = await member(ids.unit, ['meetings.view'], 'Léa Tremblay');
    ids.parent = await member(ids.unit, ['meetings.view'], 'Parent Fiction', 'linked');
    ids.outsider = await member(ids.otherUnit, ['meetings.view', 'meetings.manage'], 'Foreign Fiction');
    const outing = await one(`INSERT INTO activities (organization_id, created_by, name, activity_date, meeting_location_going,
      meeting_time_going, departure_time_going, activity_start_date, activity_start_time, activity_end_date, activity_end_time, is_camp)
      VALUES ($1, $2, 'Fictional camp', '2099-07-04', 'Hall', '09:00', '09:15', '2099-07-04', '09:00', '2099-07-06', '16:00', TRUE) RETURNING id`, [ids.unit, ids.planner]);
    ids.camp = await one(`INSERT INTO year_plan_meetings (organization_id, meeting_date, theme, meeting_kind, activity_id)
      VALUES ($1, '2099-07-04', 'Fictional camp', 'camp', $2) RETURNING id`, [ids.unit, outing]);
    await pool.query("INSERT INTO camp_team_members (organization_id, meeting_id, user_id, team_role) VALUES ($1, $2, $3, 'lead')", [ids.unit, ids.camp, ids.leader]);
    app = express(); app.locals.pool = pool; app.use(express.json());
    app.use('/api/v1/yearly-planner', require('../routes/yearlyPlanner')(pool, { error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
    app.use((err, _req, res, _next) => res.status(500).json({ success: false, message: 'internal_server_error' }));
  });

  afterAll(async () => {
    if (!pool) {return;}
    await pool.query('DELETE FROM organizations WHERE id = ANY($1::int[])', [units]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    await pool.end();
  });

  test('a line names team members in the order chosen, with its logistic notes', async () => {
    const created = await request(app).post(`/api/v1/yearly-planner/meetings/${ids.camp}/activities`).set(auth())
      .send({ name: 'Grand jeu fictif', day_offset: 1, leader_ids: [ids.leader, ids.planner], description: 'Cones and bibs in the blue bin.' });
    expect(created.status).toBe(201);
    ids.line = created.body.data.id;
    expect(created.body.data.leaders.map((leader) => leader.name)).toEqual(['Léa Tremblay', 'Ada Lovelace']);
    const data = await schedule();
    expect(data.team_user_ids).toEqual([ids.leader]);
    expect(lineOf(data, ids.line)).toMatchObject({ description: 'Cones and bibs in the blue bin.' });
    expect(lineOf(data, ids.line).leaders.map((leader) => leader.user_id)).toEqual([ids.leader, ids.planner]);
  });

  test('a parent of the unit, or a member of another unit, cannot be named, and nothing changes', async () => {
    for (const someone of [ids.parent, ids.outsider]) {
      // eslint-disable-next-line no-await-in-loop -- each refusal is checked in turn
      const response = await patch(ids.line, { leader_ids: [ids.leader, someone] });
      expect(response.status).toBe(400);
      expect(response.body.message).toBe('schedule_leaders_invalid');
    }
    expect(lineOf(await schedule(), ids.line).leaders.map((leader) => leader.user_id)).toEqual([ids.leader, ids.planner]);
  });

  test('another unit cannot name anyone on this unit’s line', async () => {
    expect((await patch(ids.line, { leader_ids: [ids.outsider] }, ids.outsider, ids.otherUnit)).status).toBe(404);
  });

  test('a line changed since it was loaded is refused, not overwritten; a fresh one saves', async () => {
    const loaded = lineOf(await schedule(), ids.line);
    expect((await patch(ids.line, { name: 'First edit', expected_updated_at: loaded.updated_at })).status).toBe(200);
    const stale = await patch(ids.line, { name: 'Stale edit', expected_updated_at: loaded.updated_at });
    expect(stale.status).toBe(409);
    expect(stale.body.message).toBe('schedule_line_changed');
    const fresh = lineOf(await schedule(), ids.line);
    expect(fresh.name).toBe('First edit');
    expect((await patch(ids.line, { leader_ids: [ids.planner], expected_updated_at: fresh.updated_at })).status).toBe(200);
  });

  test('a member who leaves the unit stays named and marked, may be kept, and cannot be newly named', async () => {
    await patch(ids.line, { leader_ids: [ids.leader, ids.planner] });
    await pool.query("UPDATE user_organizations SET status = 'inactive' WHERE organization_id = $1 AND user_id = $2", [ids.unit, ids.leader]);
    const named = lineOf(await schedule(), ids.line).leaders;
    expect(named.find((leader) => leader.user_id === ids.leader)).toMatchObject({ active_member: false });
    expect((await patch(ids.line, { leader_ids: [ids.planner, ids.leader] })).status).toBe(200);

    const other = await request(app).post(`/api/v1/yearly-planner/meetings/${ids.camp}/activities`).set(auth())
      .send({ name: 'Veillée fictive', day_offset: 2, leader_ids: [ids.leader] });
    expect(other.status).toBe(400);
    expect(await one('SELECT COUNT(*)::int FROM year_plan_meeting_activities WHERE meeting_id = $1 AND name = $2', [ids.camp, 'Veillée fictive'])).toBe(0);
  });

  test('deleting a line removes who led it', async () => {
    expect((await request(app).delete(`/api/v1/yearly-planner/meeting-activities/${ids.line}`).set(auth())).status).toBe(200);
    expect(await one('SELECT COUNT(*)::int FROM year_plan_meeting_activity_leaders WHERE meeting_activity_id = $1', [ids.line])).toBe(0);
  });
});
