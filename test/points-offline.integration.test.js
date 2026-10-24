/** Real PostgreSQL transactions: concurrent camp replays must award a batch once. */
const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const USER_ID = '550e8400-e29b-41d4-a716-446655440000';

jest.mock('../middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = { id: '550e8400-e29b-41d4-a716-446655440000' }; next(); },
  requirePermission: () => (_req, _res, next) => next(),
  requireAnyPermission: () => (_req, _res, next) => next(),
  blockDemoRoles: (_req, _res, next) => next(),
  withScoutYear: () => (_req, _res, next) => next(),
  allowDemoSandbox: () => (_req, _res, next) => next(),
  getOrganizationId: () => Promise.resolve(1),
  getScoutYear: () => Promise.resolve({ id: 1 }),
  rosterStatusesFor: () => ['active'],
}));
jest.mock('../services/scoutYear', () => ({ ensureActiveScoutYear: () => Promise.resolve({ id: 1 }) }));

const describeWithDatabase = process.env.TEST_DATABASE_URL ? describe : describe.skip;

describeWithDatabase('points replay receipts in PostgreSQL', () => {
  let admin;
  let pool;
  let app;
  const schema = `points_offline_${process.pid}_${Date.now()}`;

  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}` });
    await pool.query(`
      CREATE TABLE organizations (id integer PRIMARY KEY);
      CREATE TABLE users (id uuid PRIMARY KEY);
      CREATE TABLE participants (id integer PRIMARY KEY);
      CREATE TABLE participant_enrollments (participant_id integer, organization_id integer, scout_year_id integer, status text);
      CREATE TABLE participant_group_assignments (participant_id integer, organization_id integer, scout_year_id integer, group_id integer);
      CREATE TABLE points (participant_id integer, group_id integer, organization_id integer, scout_year_id integer, value integer);
      CREATE TABLE attendance (id serial PRIMARY KEY, participant_id integer, date date, status varchar(20), organization_id integer,
        UNIQUE (participant_id, date, organization_id));
      CREATE TABLE activities (id integer PRIMARY KEY, organization_id integer, name text, activity_start_date date, activity_end_date date, is_active boolean);
      CREATE TABLE permission_slips (activity_id integer, organization_id integer, participant_id integer, status text);
      CREATE TABLE reunion_preparations (organization_id integer, date date);
      CREATE TABLE year_plan_meetings (organization_id integer, meeting_date date, activity_id integer);
      CREATE TABLE organization_settings (organization_id integer, setting_key text, setting_value jsonb);
      INSERT INTO activities VALUES (5, 1, 'Camp des Érables', '2026-07-15', '2026-07-20', true),
        (6, 1, 'Jeux du parc', '2026-07-15', '2026-07-15', true), (99, 2, 'Other unit', '2026-07-15', '2026-07-20', true);
      INSERT INTO permission_slips VALUES (5, 1, 1, 'signed'), (5, 1, 2, 'pending');
      INSERT INTO organizations VALUES (1), (2);
      INSERT INTO participants VALUES (1), (2);
      INSERT INTO participant_enrollments VALUES (1, 1, 1, 'active');
    `);
    await pool.query('INSERT INTO users VALUES ($1)', [USER_ID]);
    await pool.query(readFileSync(path.join(__dirname, '../migrations/044_point_mutation_receipts.sql'), 'utf8'));
    await pool.query(readFileSync(path.join(__dirname, '../migrations/045_attendance_on_site.sql'), 'utf8'));
    await pool.query(readFileSync(path.join(__dirname, '../migrations/047_attendance_points_awarded.sql'), 'utf8'));
    app = express();
    app.use(express.json());
    app.use('/api/v1/points', require('../routes/points')(pool, { info: () => {} }));
    app.use('/api/v1/attendance', require('../routes/attendance')(pool, { info: () => {}, debug: () => {} }));
    app.use('/api/v1/action-roster', require('../routes/action-roster')(pool));
  });

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    }
  });

  const send = (key, id = 1, points = 3) => request(app).post('/api/v1/points')
    .set('Idempotency-Key', key).send([{ type: 'individual', id, points }]);

  test('concurrent retransmissions insert one award and return the same receipt', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => send('concurrent-camp-batch')));
    results.forEach((result) => {
      expect(result.status).toBe(200);
      expect(result.body.data).toEqual(results[0].body.data);
    });
    expect((await pool.query('SELECT COUNT(*)::int AS count FROM points WHERE organization_id = $1', [1])).rows[0].count).toBe(1);
    expect((await pool.query('SELECT COUNT(*)::int AS count FROM point_mutation_receipts WHERE organization_id = $1', [1])).rows[0].count).toBe(1);
  });

  test('a failed batch leaves no receipt and succeeds when its cause is resolved', async () => {
    await send('enrollment-retry', 2).expect(404);
    expect((await pool.query('SELECT mutation_key FROM point_mutation_receipts WHERE organization_id = $1 AND mutation_key = $2', [1, 'enrollment-retry'])).rows).toHaveLength(0);
    await pool.query("INSERT INTO participant_enrollments VALUES (2, 1, 1, 'active')");
    await send('enrollment-retry', 2).expect(200);
    await send('enrollment-retry', 2).expect(200);
    expect((await pool.query('SELECT SUM(value)::int AS total FROM points WHERE organization_id = $1 AND participant_id = $2', [1, 2])).rows[0].total).toBe(3);
  });

  test('the same identity with a different amount is refused without inserting points', async () => {
    await send('fixed-amount').expect(200);
    await send('fixed-amount', 1, 9).expect(409);
    expect((await pool.query('SELECT request_hash FROM point_mutation_receipts WHERE organization_id = $1 AND mutation_key = $2', [1, 'fixed-amount'])).rows).toHaveLength(1);
  });

  test('offline preparation exposes only this unit activities and signed ids', async () => {
    const { getActionRoster } = require('../services/actionRoster');
    const snapshot = await getActionRoster(pool, 1, '2026-07-15', '2026-07-20');
    expect(snapshot.activities.map((activity) => activity.id)).toEqual([5, 6]);
    expect(snapshot.activities[0]).toMatchObject({ requires_permission: true, signed_participant_ids: [1] });
    expect(snapshot.activities[1].requires_permission).toBe(false);
    const response = await request(app).get('/api/v1/action-roster?date=2026-07-15').expect(200);
    expect(response.body.data.activities).toHaveLength(2);
  });

  test('departure and return change eligibility without erasing or duplicating attendance points', async () => {
    const { eligibleActionParticipants } = require('../services/actionRoster');
    const context = { date: '2026-07-15', activity_id: 5, include_all: false };
    await pool.query("INSERT INTO attendance (organization_id, participant_id, date, status, is_on_site) VALUES (1, 1, '2026-07-15', 'present', true)");
    const before = (await pool.query('SELECT SUM(value)::int AS total FROM points WHERE organization_id = $1', [1])).rows[0].total;
    expect([...(await eligibleActionParticipants(pool, 1, context))]).toEqual([1]);
    const leave = () => request(app).post('/api/v1/attendance/departure').send({ participant_id: 1, date: context.date });
    const first = await leave().expect(200);
    const replay = await leave().expect(200);
    expect(replay.body.data.departed_at).toBe(first.body.data.departed_at);
    expect(replay.body.data.status).toBe('present');
    expect([...(await eligibleActionParticipants(pool, 1, context))]).toEqual([]);
    await request(app).post('/api/v1/attendance').send({ participant_id: 1, date: context.date, status: 'present' }).expect(201);
    expect([...(await eligibleActionParticipants(pool, 1, context))]).toEqual([1]);
    expect((await pool.query('SELECT SUM(value)::int AS total FROM points WHERE organization_id = $1', [1])).rows[0].total).toBe(before);
  });

  test('an explicit exception still cannot target another unit activity', async () => {
    const { eligibleActionParticipants } = require('../services/actionRoster');
    await expect(eligibleActionParticipants(pool, 1, { date: '2026-07-15', activity_id: 99, include_all: true })).rejects.toMatchObject({ status: 409 });
    expect(await eligibleActionParticipants(pool, 1, { date: '2026-07-15', activity_id: 5, include_all: true })).toBeNull();
  });

});
