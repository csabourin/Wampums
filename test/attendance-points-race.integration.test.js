/**
 * Real PostgreSQL transactions: when two devices (or two tabs replaying the same
 * offline outbox) mark the same youth at the same moment, the day's attendance
 * points are awarded once.
 */
const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');

jest.mock('../middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = { id: '550e8400-e29b-41d4-a716-446655440000' }; next(); },
  requirePermission: () => (_req, _res, next) => next(),
  blockDemoRoles: (_req, _res, next) => next(),
  withScoutYear: () => (_req, _res, next) => next(),
  allowDemoSandbox: () => (_req, _res, next) => next(),
  getOrganizationId: () => Promise.resolve(1),
}));

const describeWithDatabase = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const SIMULTANEOUS_REQUESTS = 8;

describeWithDatabase('attendance points under simultaneous marking', () => {
  let admin;
  let pool;
  let app;
  const schema = `attendance_race_${process.pid}_${Date.now()}`;
  const logger = { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} };

  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}` });
    await pool.query(`
      CREATE TABLE participant_enrollments (participant_id integer, organization_id integer, scout_year_id integer, status text);
      CREATE TABLE participant_group_assignments (participant_id integer, organization_id integer, group_id integer);
      CREATE VIEW participant_groups AS SELECT participant_id, group_id, organization_id FROM participant_group_assignments;
      CREATE TABLE organization_settings (organization_id integer, setting_key text, setting_value jsonb);
      CREATE TABLE points (participant_id integer, group_id integer, organization_id integer, value integer,
        created_at timestamp DEFAULT now());
      CREATE TABLE attendance (id serial PRIMARY KEY, participant_id integer, date date, status varchar(20),
        organization_id integer, is_on_site boolean, departed_at timestamptz,
        UNIQUE (participant_id, date, organization_id));
      INSERT INTO participant_enrollments VALUES (1, 1, 1, 'active'), (2, 1, 1, 'active'), (3, 1, 1, 'active');
      INSERT INTO participant_group_assignments VALUES (1, 1, 7), (2, 1, 7), (3, 1, 7);
    `);
    app = express();
    app.use(express.json());
    app.use('/api/v1/attendance', require('../routes/attendance')(pool, logger));
  });

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    }
  });

  const pointsOf = async (participantId) => (await pool.query(
    'SELECT COALESCE(SUM(value), 0)::int AS total FROM points WHERE organization_id = 1 AND participant_id = $1',
    [participantId]
  )).rows[0].total;

  test('a youth marked present by several devices at once earns the day\'s point once', async () => {
    const results = await Promise.all(Array.from({ length: SIMULTANEOUS_REQUESTS }, () =>
      request(app).post('/api/v1/attendance').send({ participant_id: 1, date: '2026-07-15', status: 'present' })));

    results.forEach((result) => expect(result.status).toBe(201));
    expect(await pointsOf(1)).toBe(1);
  });

  test('a group marked present by several devices at once earns each youth the day\'s point once', async () => {
    const results = await Promise.all(Array.from({ length: SIMULTANEOUS_REQUESTS }, (_, index) =>
      request(app).post('/api/v1/attendance/update-attendance')
        // Different orders must not deadlock either.
        .send({ participant_id: index % 2 ? [2, 3] : [3, 2], date: '2026-07-16', status: 'present' })));

    results.forEach((result) => expect(result.status).toBe(200));
    expect(await pointsOf(2)).toBe(1);
    expect(await pointsOf(3)).toBe(1);
  });

  test('changing a status at the same time as a replay still nets the final status\'s points', async () => {
    await request(app).post('/api/v1/attendance').send({ participant_id: 1, date: '2026-07-17', status: 'present' }).expect(201);
    const before = await pointsOf(1);
    await Promise.all([
      request(app).post('/api/v1/attendance').send({ participant_id: 1, date: '2026-07-17', status: 'absent' }),
      request(app).post('/api/v1/attendance').send({ participant_id: 1, date: '2026-07-17', status: 'absent' }),
    ]);
    expect(await pointsOf(1)).toBe(before - 1);
  });
});
