/**
 * A year-plan date's kind and its activity's camp mark change together, even when two
 * managers change the kind at the same moment. Runs on a migrated PostgreSQL.
 */
const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');

require('./jest-conditional-helpers');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || 'planner-camp-kind-integration-secret';

const mockContext = { userId: null, organizationId: null };
// Only authentication is faked; membership and permissions come from the database.
jest.mock('../middleware/auth', () => {
  const actual = jest.requireActual('../middleware/auth');
  return {
    ...actual,
    authenticate: (req, _res, next) => {
      req.user = { id: mockContext.userId, organizationId: mockContext.organizationId };
      next();
    },
  };
});

const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

describe.skipIf(!DATABASE_URL)('a date\'s kind and its activity\'s camp mark', () => {
  let pool; let app;
  const ids = {};
  const one = async (sql, params = []) => Object.values((await pool.query(sql, params)).rows[0])[0];

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      ids.unit = (await client.query("INSERT INTO organizations (name) VALUES ('Fictional kind unit') RETURNING id")).rows[0].id;
      await client.query("INSERT INTO organization_program_sections (organization_id, section_key, display_name) VALUES ($1, 'general', 'General')", [ids.unit]);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    ids.manager = await one(`INSERT INTO users (email, password, full_name, is_verified)
      VALUES ('kind-' || gen_random_uuid() || '@example.test', 'x', 'Ada Lovelace', TRUE) RETURNING id`);
    const district = await one("SELECT id FROM roles WHERE role_name = 'district' AND organization_id IS NULL");
    await pool.query(`INSERT INTO user_organizations (user_id, organization_id, role_ids, status) VALUES ($1, $2, $3, 'active')`,
      [ids.manager, ids.unit, JSON.stringify([district])]);
    const plan = await one(`INSERT INTO year_plans (organization_id, title, start_date, end_date, created_by)
      VALUES ($1, 'Fictional year', '2030-09-01', '2031-06-30', $2) RETURNING id`, [ids.unit, ids.manager]);
    ids.activity = await one(`INSERT INTO activities (organization_id, created_by, name, activity_date, meeting_location_going,
        meeting_time_going, departure_time_going, activity_start_date, activity_start_time, activity_end_date, activity_end_time, is_camp)
      VALUES ($1, $2, 'Camp de la Toussaint', '2030-10-30', 'Hall', '18:00', '18:15', '2030-10-30', '18:00', '2030-11-01', '14:00', TRUE)
      RETURNING id`, [ids.unit, ids.manager]);
    ids.meeting = await one(`INSERT INTO year_plan_meetings (organization_id, year_plan_id, meeting_date, meeting_kind, activity_id)
      VALUES ($1, $2, '2030-10-30', 'camp', $3) RETURNING id`, [ids.unit, plan, ids.activity]);

    app = express();
    app.locals.pool = pool;
    app.use(express.json());
    app.use('/api/v1/yearly-planner', require('../routes/yearlyPlanner')(pool, logger));
    mockContext.userId = ids.manager;
    mockContext.organizationId = ids.unit;
  });

  afterAll(async () => { if (pool) { await pool.end(); } });

  const state = async () => (await pool.query(`SELECT m.meeting_kind, a.is_camp FROM year_plan_meetings m
    JOIN activities a ON a.id = m.activity_id WHERE m.id = $1`, [ids.meeting])).rows[0];
  const setKind = (kind) => request(app).patch(`/api/v1/yearly-planner/meetings/${ids.meeting}`).send({ meeting_kind: kind });

  test('changing the kind in the year plan changes the activity\'s camp mark', async () => {
    expect((await setKind('weekend')).status).toBe(200);
    expect(await state()).toEqual({ meeting_kind: 'weekend', is_camp: false });
    expect((await setKind('camp')).status).toBe(200);
    expect(await state()).toEqual({ meeting_kind: 'camp', is_camp: true });
  });

  test('a change of theme alone leaves the camp mark as it is', async () => {
    await request(app).patch(`/api/v1/yearly-planner/meetings/${ids.meeting}`).send({ theme: 'Hiver' });
    expect(await state()).toEqual({ meeting_kind: 'camp', is_camp: true });
  });

  test('two managers changing the kind at once leave the date and its activity agreeing', async () => {
    for (let round = 0; round < 5; round += 1) {
      // eslint-disable-next-line no-await-in-loop -- each round races two requests, then checks them
      await Promise.all([setKind('camp'), setKind('weekend')]);
      // eslint-disable-next-line no-await-in-loop -- checked after each race
      const { meeting_kind: kind, is_camp: isCamp } = await state();
      expect(isCamp).toBe(kind === 'camp');
    }
  });

  test('adding a date of another kind on a camp\'s day updates the activity\'s camp mark too', async () => {
    const plan = await one('SELECT year_plan_id FROM year_plan_meetings WHERE id = $1', [ids.meeting]);
    await setKind('camp');
    const response = await request(app).post(`/api/v1/yearly-planner/plans/${plan}/meetings`)
      .send({ meeting_date: '2030-10-30', kind: 'weekend' });
    expect(response.status).toBe(200);
    expect(response.body.data.activity_event_skipped).toBe('already_linked');
    expect(await state()).toEqual({ meeting_kind: 'weekend', is_camp: false });
  });
});
