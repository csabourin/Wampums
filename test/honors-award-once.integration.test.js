'use strict';

/**
 * A youth receives at most one honor a day, and its points once. Two leaders
 * awarding the same honor at the same moment, or awarding it again, both
 * succeed and leave a single honor.
 */

const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');
const { randomUUID } = require('crypto');
require('./jest-conditional-helpers');
process.env.JWT_SECRET_KEY ||= 'honors-award-integration-secret';

const { signJWTToken } = require('../utils/jwt-config');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SIMULTANEOUS_AWARDS = 6;
const HONOR_DATE = '2026-11-07';

describe.skipIf(!DATABASE_URL)('Awarding an honor', () => {
  let pool;
  let app;
  const ids = {};

  async function one(sql, params = []) {
    const result = await pool.query(sql, params);
    return Object.values(result.rows[0] || {})[0];
  }

  function award(body) {
    const token = signJWTToken({ user_id: ids.leader, organizationId: ids.unit });
    return request(app).post('/api/v1/honors').set('Authorization', `Bearer ${token}`).send(body);
  }

  const honorsOf = (participantId) => one(
    'SELECT COUNT(*)::int FROM honors WHERE organization_id = $1 AND participant_id = $2', [ids.unit, participantId]);
  const pointsOf = (participantId) => one(
    'SELECT COALESCE(SUM(value), 0)::int FROM points WHERE organization_id = $1 AND participant_id = $2', [ids.unit, participantId]);

  async function youth(firstName) {
    const id = await one("INSERT INTO participants (first_name, last_name, date_naissance) VALUES ($1, 'Lovelace', '2016-01-01') RETURNING id", [firstName]);
    await pool.query('INSERT INTO participant_organizations (participant_id, organization_id) VALUES ($1, $2)', [id, ids.unit]);
    return id;
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    // The unit and its section reference each other; the check is deferred to COMMIT.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      ids.unit = (await client.query("INSERT INTO organizations (name) VALUES ('Honors unit') RETURNING id")).rows[0].id;
      await client.query("INSERT INTO organization_program_sections (organization_id, section_key, display_name) VALUES ($1, 'general', 'General')", [ids.unit]);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    await pool.query("INSERT INTO scout_years (organization_id, label, start_date, end_date, status) VALUES ($1, '2026-2027', '2026-09-01', '2027-08-31', 'active')", [ids.unit]);
    const roleId = await one('INSERT INTO roles (role_name, display_name, data_scope) VALUES ($1, $1, \'organization\') RETURNING id',
      [`honors_${randomUUID()}`]);
    await pool.query('INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE permission_key = ANY($2::text[])',
      [roleId, ['honors.view', 'honors.create']]);
    ids.leader = await one('INSERT INTO users (email, password, full_name) VALUES ($1, \'x\', \'Léa Tremblay\') RETURNING id',
      [`${randomUUID()}@example.test`]);
    await pool.query("INSERT INTO user_organizations (user_id, organization_id, role_ids, status) VALUES ($1, $2, $3::jsonb, 'active')",
      [ids.leader, ids.unit, JSON.stringify([roleId])]);

    app = express();
    app.use(express.json());
    app.locals.pool = pool;
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    app.use('/api', require('../routes/honors')(pool, logger));
  });

  afterAll(async () => {
    await pool?.end();
  });

  test('two leaders awarding the same honor at the same moment leave one honor and its points once', async () => {
    const ada = await youth('Ada');
    const results = await Promise.all(Array.from({ length: SIMULTANEOUS_AWARDS }, () =>
      award({ participant_id: ada, date: HONOR_DATE })));

    results.forEach((result) => expect(result.status).toBe(200));
    expect(await honorsOf(ada)).toBe(1);
    expect(await pointsOf(ada)).toBe(5);
  });

  test('awarding an honor again the same day says it is already awarded', async () => {
    const lea = await youth('Léa');
    await award({ participant_id: lea, date: HONOR_DATE }).expect(200);
    const again = await award({ participant_id: lea, date: HONOR_DATE }).expect(200);

    expect(again.body.data.results).toEqual([expect.objectContaining({ action: 'already_awarded' })]);
    expect(await honorsOf(lea)).toBe(1);
    expect(await pointsOf(lea)).toBe(5);
  });

  test('a batch naming the same youth twice awards one honor', async () => {
    const max = await youth('Max');
    await award([{ participant_id: max, date: HONOR_DATE }, { participant_id: max, date: HONOR_DATE }]).expect(200);

    expect(await honorsOf(max)).toBe(1);
    expect(await pointsOf(max)).toBe(5);
  });
});
