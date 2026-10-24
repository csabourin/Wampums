'use strict';

/**
 * The points screen opens on the totals cached by camp preparation. Those
 * totals are the active scout year's, like the points report: a youth's
 * previous years never inflate them.
 */

const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');
const { randomUUID } = require('crypto');
require('./jest-conditional-helpers');
process.env.JWT_SECRET_KEY ||= 'offline-preparation-integration-secret';

const { signJWTToken } = require('../utils/jwt-config');

const DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!DATABASE_URL)('Camp preparation point totals', () => {
  let pool;
  let app;
  const ids = {};

  async function one(sql, params = []) {
    const result = await pool.query(sql, params);
    return Object.values(result.rows[0] || {})[0];
  }

  function prepare() {
    const token = signJWTToken({ user_id: ids.leader, organizationId: ids.unit, roleNames: [], permissions: [] });
    return request(app).post('/api/v1/offline/prepare-activity')
      .set('Authorization', `Bearer ${token}`)
      .send({ start_date: '2026-11-07', end_date: '2026-11-08' });
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    // A unit and its program section reference each other: create both in one transaction.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      ids.unit = (await client.query("INSERT INTO organizations (name) VALUES ('Offline totals unit') RETURNING id")).rows[0].id;
      await client.query("INSERT INTO organization_program_sections (organization_id, section_key, display_name) VALUES ($1, 'general', 'General')", [ids.unit]);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    ids.pastYear = await one(`INSERT INTO scout_years (organization_id, label, start_date, end_date, status)
      VALUES ($1, '2025-2026', '2025-09-01', '2026-08-31', 'closed') RETURNING id`, [ids.unit]);
    ids.year = await one(`INSERT INTO scout_years (organization_id, label, start_date, end_date, status)
      VALUES ($1, '2026-2027', '2026-09-01', '2027-08-31', 'active') RETURNING id`, [ids.unit]);

    const roleId = await one('INSERT INTO roles (role_name, display_name, data_scope) VALUES ($1, $1, \'organization\') RETURNING id',
      [`offline_${randomUUID()}`]);
    await pool.query("INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE permission_key = 'activities.view'", [roleId]);
    ids.leader = await one('INSERT INTO users (email, password, full_name) VALUES ($1, \'x\', \'Léa Tremblay\') RETURNING id',
      [`${randomUUID()}@example.test`]);
    await pool.query("INSERT INTO user_organizations (user_id, organization_id, role_ids, status) VALUES ($1, $2, $3::jsonb, 'active')",
      [ids.leader, ids.unit, JSON.stringify([roleId])]);

    ids.group = await one('INSERT INTO groups (name, organization_id) VALUES (\'Loups\', $1) RETURNING id', [ids.unit]);
    ids.veteran = await one("INSERT INTO participants (first_name, last_name, date_naissance) VALUES ('Ada', 'Lovelace', '2015-01-01') RETURNING id");
    for (const yearId of [ids.pastYear, ids.year]) {
      // eslint-disable-next-line no-await-in-loop -- Two fixture years, inserted in order.
      await pool.query(`INSERT INTO participant_enrollments (participant_id, organization_id, scout_year_id, status)
        VALUES ($1, $2, $3, $4)`, [ids.veteran, ids.unit, yearId, yearId === ids.year ? 'active' : 'graduated']);
      // eslint-disable-next-line no-await-in-loop -- Two fixture years, inserted in order.
      await pool.query(`INSERT INTO participant_group_assignments (participant_id, organization_id, scout_year_id, group_id)
        VALUES ($1, $2, $3, $4)`, [ids.veteran, ids.unit, yearId, ids.group]);
    }
    await pool.query(`INSERT INTO points (participant_id, group_id, organization_id, scout_year_id, value) VALUES
      ($1, $2, $3, $4, 40), ($1, $2, $3, $5, 3), (NULL, $2, $3, $4, 25), (NULL, $2, $3, $5, 2)`,
    [ids.veteran, ids.group, ids.unit, ids.pastYear, ids.year]);

    app = express();
    app.use(express.json());
    app.locals.pool = pool;
    app.use('/api/v1/offline', require('../routes/offline')(pool, { info: () => {}, error: () => {}, warn: () => {} }));
  });

  afterAll(async () => {
    await pool?.end();
  });

  test('a youth enrolled last year shows only this year\'s points', async () => {
    const response = await prepare().expect(200);
    const youths = response.body.data.participants.filter((youth) => youth.id === ids.veteran);
    expect(youths).toHaveLength(1);
    expect(Number(youths[0].total_points)).toBe(3);
    expect(youths[0].group_id).toBe(ids.group);
  });

  test('a group shows only this year\'s group points', async () => {
    const response = await prepare().expect(200);
    const group = response.body.data.groups.find((candidate) => candidate.id === ids.group);
    expect(Number(group.total_points)).toBe(2);
  });
});
