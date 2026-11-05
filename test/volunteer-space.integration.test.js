/**
 * Volunteer space (#1360) on a migrated PostgreSQL.
 *
 * A camp opens to those who take part in it: a place on one of its shifts or a seat on its team.
 * Another camp of the unit, or a camp of another unit, reads as not found. Nothing returned names
 * another volunteer; what a shift type calls for (a cook's menus) follows the member's
 * own shifts.
 */
const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');

require('./jest-conditional-helpers');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || 'volunteer-space-integration-secret';

const mockContext = { userId: null, organizationId: null };
// Only authentication is faked; membership, permissions and scope come from the database.
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

const { saveShift, signUp } = require('../services/volunteerShifts');
const { saveTemplate } = require('../services/campPlan');

describe.skipIf(!DATABASE_URL)('volunteer space', () => {
  let pool; let app;
  const ids = {};
  const one = async (sql, params = []) => Object.values((await pool.query(sql, params)).rows[0])[0];
  /** A unit and its program section, created together as the deferred foreign key expects. */
  const unit = async (name) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const id = (await client.query('INSERT INTO organizations (name) VALUES ($1) RETURNING id', [name])).rows[0].id;
      await client.query("INSERT INTO organization_program_sections (organization_id, section_key, display_name) VALUES ($1, 'general', 'General')", [id]);
      await client.query('COMMIT');
      return id;
    } finally {
      client.release();
    }
  };
  /** A member holding a built-in role, or a role of the unit made of the given keys. */
  const member = async (unitId, name, role) => {
    const userId = await one(`INSERT INTO users (email, password, full_name, is_verified)
      VALUES ('space-' || gen_random_uuid() || '@example.test', 'x', $1, TRUE) RETURNING id`, [name]);
    let roleId;
    if (Array.isArray(role)) {
      roleId = await one(`INSERT INTO roles (role_name, display_name, data_scope, organization_id)
        VALUES ('space_' || gen_random_uuid(), 'Camp team', 'organization', $1) RETURNING id`, [unitId]);
      await pool.query('INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE permission_key = ANY($2::text[])', [roleId, role]);
    } else {
      roleId = await one('SELECT id FROM roles WHERE role_name = $1 AND organization_id IS NULL', [role]);
    }
    await pool.query(`INSERT INTO user_organizations (user_id, organization_id, role_ids, status)
      VALUES ($1, $2, $3, 'active')`, [userId, unitId, JSON.stringify([roleId])]);
    return userId;
  };
  const camp = async (unitId, name, creator, start = 3) => {
    const activity = await one(`INSERT INTO activities (organization_id, created_by, name, activity_date, meeting_location_going,
        meeting_time_going, departure_time_going, activity_start_date, activity_start_time, activity_end_date, activity_end_time, is_camp)
      VALUES ($1, $2, $3, CURRENT_DATE + $4::int, 'Local scout', '17:30', '18:00', CURRENT_DATE + $4::int, '18:00', CURRENT_DATE + $4::int + 2, '14:00', TRUE)
      RETURNING id`, [unitId, creator, name, start]);
    const meeting = await one(`INSERT INTO year_plan_meetings (organization_id, meeting_date, theme, meeting_kind, activity_id)
      VALUES ($1, CURRENT_DATE + $4::int, $2, 'camp', $3) RETURNING id`, [unitId, name, activity, start]);
    return { activity, meeting };
  };
  const shift = async (unitId, activityId, type, notes = '') => (await saveShift(pool, unitId, ids.manager, {
    activity_id: activityId, volunteer_type: type, title: type === 'cook' ? 'Souper' : '', shift_date: await one('SELECT (CURRENT_DATE + 4)::text'),
    start_time: '16:00', end_time: '19:00', slots: 3, notes,
  })).id;
  const as = (userId, unitId = ids.unit) => {
    mockContext.userId = userId;
    mockContext.organizationId = unitId;
    return request(app);
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    ids.unit = await unit('Fictional volunteer-space unit');
    ids.other = await unit('Another fictional unit');
    ids.manager = await member(ids.unit, 'Ada Lovelace', 'district');
    ids.cook = await member(ids.unit, 'Léa Tremblay', 'volunteer');
    ids.driver = await member(ids.unit, 'Grace Hopper', 'volunteer');
    ids.leader = await member(ids.unit, 'Katherine Johnson', ['volunteer_space.view', 'meetings.view']);
    ids.bystander = await member(ids.unit, 'Mary Jackson', 'volunteer');
    ids.winter = await camp(ids.unit, 'Camp d’hiver fictif', ids.manager);
    ids.spring = await camp(ids.unit, 'Camp du printemps fictif', ids.manager, 20);
    ids.foreign = await camp(ids.other, 'Camp d’une autre unité', ids.manager);

    ids.cookShift = await shift(ids.unit, ids.winter.activity, 'cook', 'Menu : spaghetti, salade');
    ids.driverShift = await shift(ids.unit, ids.winter.activity, 'driver');
    await signUp(pool, ids.unit, ids.cookShift, ids.cook);
    await signUp(pool, ids.unit, ids.driverShift, ids.driver);
    await pool.query(`INSERT INTO camp_team_members (organization_id, meeting_id, user_id, team_role)
      VALUES ($1, $2, $3, 'leader')`, [ids.unit, ids.spring.meeting, ids.leader]);
    await pool.query(`INSERT INTO year_plan_meeting_activities (organization_id, meeting_id, day_offset, name, start_time, duration_minutes)
      VALUES ($1, $2, 1, 'Grand jeu', '09:30', 90)`, [ids.unit, ids.winter.meeting]);
    await saveTemplate(pool, ids.unit, ids.manager, 'emergency_procedures', { body_html: '<p>Trois coups de sifflet.</p>', expected_version: 0 });
    await saveTemplate(pool, ids.unit, ids.manager, 'rules_of_life', { body_html: '<p>On se respecte.</p>', expected_version: 0 });

    app = express();
    app.locals.pool = pool;
    app.use(express.json());
    app.use('/api/v1/volunteer-space', require('../routes/volunteer-space')(pool));
  });

  afterAll(async () => { if (pool) { await pool.end(); } });

  test('every role that may take a shift may open the space', async () => {
    const missing = await one(`SELECT COUNT(*)::int FROM role_permissions rp
      JOIN permissions p ON p.id = rp.permission_id AND p.permission_key = 'volunteers.view'
      WHERE NOT EXISTS (SELECT 1 FROM role_permissions other JOIN permissions q ON q.id = other.permission_id
        WHERE other.role_id = rp.role_id AND q.permission_key = 'volunteer_space.view')`);
    expect(missing).toBe(0);
  });

  test('a cook finds their camp, their place and nothing of another camp', async () => {
    const response = await as(ids.cook).get('/api/v1/volunteer-space');
    expect(response.status).toBe(200);
    expect(response.body.data.camps.map((row) => row.activity_id)).toEqual([ids.winter.activity]);
    expect(response.body.data.camps[0]).toMatchObject({ shift_count: 1, team_role: null });
    expect(response.body.data.shifts.map((row) => row.id)).toEqual([ids.cookShift]);
  });

  test('a cook\'s camp shows the menus, the schedule and the team\'s instructions, but no one else', async () => {
    const response = await as(ids.cook).get(`/api/v1/volunteer-space/camps/${ids.winter.activity}`);
    expect(response.status).toBe(200);
    const space = response.body.data;
    expect(space.panels).toEqual(['menus']);
    expect(space.menus.map((meal) => meal.notes)).toEqual(['Menu : spaghetti, salade']);
    expect(space.schedule[1].items).toEqual([{ name: 'Grand jeu', start_time: '09:30', duration_minutes: 90 }]);
    expect(space.sections.map((section) => section.key)).toEqual(['rules_of_life', 'emergency_procedures']);
    const body = JSON.stringify(space);
    expect(body).not.toContain('Grace Hopper');
  });

  test('a driver sees the departure, without the kitchen\'s menus', async () => {
    const space = (await as(ids.driver).get(`/api/v1/volunteer-space/camps/${ids.winter.activity}`)).body.data;
    expect(space.panels).toEqual(['transport']);
    expect(space.menus).toEqual([]);
    expect(space.camp).toMatchObject({ meeting_location_going: 'Local scout', meeting_time_going: '17:30' });
  });

  test('a seat on a camp\'s team opens that camp without any shift', async () => {
    const response = await as(ids.leader).get(`/api/v1/volunteer-space/camps/${ids.spring.activity}`);
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ team_role: 'leader', shifts: [], panels: [] });
  });

  test.each([
    ['a camp of the unit they take no part in', () => ids.spring.activity],
    ['a camp of another unit', () => ids.foreign.activity],
  ])('a volunteer is told %s is not theirs', async (_label, activity) => {
    const response = await as(ids.cook).get(`/api/v1/volunteer-space/camps/${activity()}`);
    expect(response.status).toBe(404);
    expect(response.body.message).toBe('volunteer_space_camp_not_found');
  });

  test('a volunteer who takes part in nothing sees an empty space', async () => {
    const response = await as(ids.bystander).get('/api/v1/volunteer-space');
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ camps: [], shifts: [], tasks: [], open_tasks: 0 });
  });

  test('a camp that is cancelled in the plan no longer opens to its team', async () => {
    await pool.query('UPDATE year_plan_meetings SET is_cancelled = TRUE WHERE id = $1', [ids.spring.meeting]);
    const response = await as(ids.leader).get(`/api/v1/volunteer-space/camps/${ids.spring.activity}`);
    expect(response.status).toBe(404);
  });
});
