/**
 * The camp permit's checklist (#1416) on a disposable database: each line read
 * from where it lives, nothing complete by default, rights from the engine, and
 * isolation between units.
 */
const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
require('./jest-conditional-helpers');
process.env.JWT_SECRET_KEY ||= 'fictional-camp-permit-integration';
const DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!DATABASE_URL)('Camp permit checklist', () => {
  let pool; let app;
  const ids = {}; const units = []; const users = []; const groups = [];
  const one = async (sql, params = []) => Object.values((await pool.query(sql, params)).rows[0] || {})[0];

  /** A unit and its program section, together: the unit's section is checked at commit. */
  async function unit() {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const id = (await db.query("INSERT INTO organizations (name) VALUES ('Fictional Permit Unit') RETURNING id")).rows[0].id;
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
    const role = await one("INSERT INTO roles (role_name, display_name, data_scope, organization_id) VALUES ('permit_' || gen_random_uuid(), 'Camp team', $2, $1) RETURNING id", [unitId, scope]);
    await pool.query('INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE permission_key = ANY($2::text[])', [role, keys]);
    const user = await one("INSERT INTO users (email, password, full_name) VALUES ('permit-' || gen_random_uuid() || '@example.test', 'x', $1) RETURNING id", [name]);
    users.push(user);
    await pool.query('INSERT INTO user_organizations (organization_id, user_id, role_ids) VALUES ($1, $2, $3)', [unitId, user, JSON.stringify([role])]);
    return user;
  }
  async function camp(unitId, start, end) {
    const outing = await one(`INSERT INTO activities (organization_id, created_by, name, activity_date, meeting_location_going,
      meeting_time_going, departure_time_going, activity_start_date, activity_start_time, activity_end_date, activity_end_time, is_camp)
      VALUES ($1, $2, 'Fictional camp', $3, 'Hall', '09:00', '09:15', $3, '09:00', $4, '16:00', TRUE) RETURNING id`, [unitId, ids.leader, start, end]);
    return one(`INSERT INTO year_plan_meetings (organization_id, meeting_date, theme, meeting_kind, activity_id)
      VALUES ($1, $2, 'Fictional camp', 'camp', $3) RETURNING id`, [unitId, start, outing]);
  }
  const auth = (user, unitId = ids.unit) => ({ Authorization: `Bearer ${jwt.sign({ user_id: user, organizationId: unitId }, process.env.JWT_SECRET_KEY)}` });
  const read = (meetingId, user = ids.leader, unitId = ids.unit) => request(app).get(`/api/v1/camp-plans/camps/${meetingId}/permit`).set(auth(user, unitId));
  const lines = (body) => Object.fromEntries(body.data.lines.map((entry) => [entry.key, entry]));

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    ids.unit = await unit(); ids.otherUnit = await unit();
    ids.leader = await member(ids.unit, ['meetings.view', 'participants.view', 'carpools.view', 'camp_reviews.view'], 'Ada Lovelace');
    ids.reader = await member(ids.unit, ['meetings.view'], 'Léa Tremblay');
    ids.parent = await member(ids.unit, ['meetings.view', 'participants.view'], 'Parent Fiction', 'linked');
    ids.outsider = await member(ids.otherUnit, ['meetings.view', 'participants.view'], 'Foreign Fiction');
    // A camp in the future, three days long.
    ids.camp = await camp(ids.unit, '2099-07-04', '2099-07-06');
    app = express(); app.locals.pool = pool; app.use(express.json());
    app.use('/api/v1/camp-plans', require('../routes/camp-plans')(pool));
    app.use((err, _req, res, _next) => res.status(500).json({ success: false, message: 'internal_server_error' }));
  });

  afterAll(async () => {
    if (!pool) {return;}
    await pool.query('DELETE FROM organizations WHERE id = ANY($1::int[])', [units]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    await pool.query('DELETE FROM local_groups WHERE id = ANY($1::int[])', [groups]);
    await pool.end();
  });

  test('a camp with nothing recorded is to complete or not verified, never complete', async () => {
    const response = await read(ids.camp);
    expect(response.status).toBe(200);
    const byKey = lines(response.body);
    expect(byKey.identification.reasons).toEqual(['missing_scout_group', 'missing_district', 'missing_coeducation']);
    expect(byKey.site.reasons).toEqual(['no_site']);
    expect(byKey.schedule.reasons).toEqual(['no_schedule']);
    expect(byKey.written_sections.state).toBe('to_complete');
    expect(byKey.group_material.reasons).toEqual(['no_group_material']);
    expect(byKey.personal_material.reasons).toEqual(['no_personal_list']);
    expect(byKey.youth_list.reasons).toEqual(['no_scout_year', 'sisc_not_compared']);
    expect(byKey.team_list).toMatchObject({ state: 'to_complete', blocking: true });
    expect(byKey.evaluation.reasons).toEqual(['after_camp']);
    expect(byKey.transport).toMatchObject({ state: 'unverified', counts: { offers: 0 } });
    const complete = response.body.data.lines.filter((entry) => entry.state === 'complete').map((entry) => entry.key);
    expect(complete).toEqual(['dates']);
    expect(response.body.data.header).toMatchObject({ days: 3, youth_count: 0, district: null, coeducation: null, scout_groups: [] });
  });

  test('what the unit and the camp record completes their lines', async () => {
    const group = await one("INSERT INTO local_groups (name, slug) VALUES ('Groupe fictif', 'permit-' || gen_random_uuid()) RETURNING id");
    groups.push(group);
    await pool.query('INSERT INTO organization_local_groups (organization_id, local_group_id) VALUES ($1, $2)', [ids.unit, group]);
    await pool.query(`INSERT INTO organization_settings (organization_id, setting_key, setting_value)
      VALUES ($1, 'organization_info', $2::jsonb)`, [ids.unit, JSON.stringify({ name: 'Fictional Permit Unit', district: 'District fictif', coeducation: 'mixed' })]);
    const site = await one(`INSERT INTO camp_sites (organization_id, name, owner_name, address, phone, accommodation, has_own_insurance,
        hospital_name, hospital_phone, hospital_travel_minutes, poison_centre_phone, directions_url)
      VALUES ($1, 'Base fictive', 'Propriétaire fictif', '1 chemin du Lac', '555-0100', 'tent', FALSE,
        'Hôpital fictif', '555-0101', 25, '555-0102', 'https://example.org/route') RETURNING id`, [ids.unit]);
    await pool.query(`INSERT INTO camp_details (organization_id, meeting_id, camp_site_id, season, on_site_lead_id)
      VALUES ($1, $2, $3, 'summer', $4)`, [ids.unit, ids.camp, site, ids.leader]);
    await pool.query(`INSERT INTO year_plan_meeting_activities (organization_id, meeting_id, name, day_offset)
      SELECT $1, $2, 'Grand jeu fictif', day FROM generate_series(0, 2) AS day`, [ids.unit, ids.camp]);
    await pool.query(`INSERT INTO year_plan_meeting_days (organization_id, meeting_id, day_offset, title)
      SELECT $1, $2, day, 'Journée fictive ' || day FROM generate_series(0, 2) AS day`, [ids.unit, ids.camp]);

    const response = await read(ids.camp);
    const byKey = lines(response.body);
    ['identification', 'site', 'camp_type', 'emergency', 'insurance', 'directions', 'schedule']
      .forEach((key) => expect([key, byKey[key].state]).toEqual([key, 'complete']));
    expect(response.body.data.header).toMatchObject({ district: 'District fictif', coeducation: 'mixed', scout_groups: ['Groupe fictif'] });
  });

  test('a day of the camp with nothing planned leaves the schedule to complete', async () => {
    await pool.query('DELETE FROM year_plan_meeting_activities WHERE organization_id = $1 AND meeting_id = $2 AND day_offset = 1', [ids.unit, ids.camp]);
    const byKey = lines((await read(ids.camp)).body);
    expect(byKey.schedule).toMatchObject({ state: 'to_complete', reasons: ['days_without_activity'], counts: { empty_days: 1 } });
  });

  test('without the rights a line needs, it is not verified and says nothing more', async () => {
    const response = await read(ids.camp, ids.reader);
    expect(response.status).toBe(200);
    const byKey = lines(response.body);
    ['youth_list', 'team_list', 'health_forms', 'allergies', 'transport', 'evaluation']
      .forEach((key) => expect(byKey[key]).toEqual({ key, state: 'unverified', reasons: ['no_access'] }));
    expect(response.body.data.header.youth_count).toBeNull();
  });

  test('a parent, whose role reaches only their own children, cannot read it', async () => {
    expect((await read(ids.camp, ids.parent)).status).toBe(403);
  });

  test('another unit’s camp is not found, whatever the request names', async () => {
    const response = await read(ids.camp, ids.outsider, ids.otherUnit);
    expect(response.status).toBe(404);
    expect(response.body.message).toBe('camp_permit_camp_not_found');
  });
});
