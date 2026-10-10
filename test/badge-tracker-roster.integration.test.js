'use strict';

/**
 * The badge tracker lists the youth on the roster of the year being consulted.
 * A cub who left the pack last year must not appear this year — neither in the
 * participant list nor through their stars in the approval or delivery queues —
 * but must reappear when last year is consulted. Stars are cumulative, so a
 * cub who stayed keeps last year's stars this year.
 */

const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');
const { randomUUID } = require('crypto');
require('./jest-conditional-helpers');
process.env.JWT_SECRET_KEY ||= 'badge-tracker-roster-integration-secret';

const { signJWTToken } = require('../utils/jwt-config');

const DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!DATABASE_URL)('Badge tracker roster by scout year', () => {
  let pool;
  let app;
  const ids = {};

  async function one(sql, params = []) {
    const result = await pool.query(sql, params);
    return Object.values(result.rows[0] || {})[0];
  }

  /**
   * Create a child and enroll them in the given years.
   *
   * @param {string} firstName - Child's first name
   * @param {Array<[number, string]>} enrollments - `[scoutYearId, status]` pairs
   * @returns {Promise<number>} Participant ID
   */
  async function child(firstName, enrollments) {
    const id = await one("INSERT INTO participants (first_name, last_name, date_naissance) VALUES ($1, 'Badge', '2016-01-01') RETURNING id",
      [firstName]);
    await Promise.all(enrollments.map(([yearId, status]) => pool.query(
      'INSERT INTO participant_enrollments (participant_id, organization_id, scout_year_id, status) VALUES ($1, $2, $3, $4)',
      [id, ids.unit, yearId, status]
    )));
    return id;
  }

  function star(participantId, level, status) {
    return pool.query(`INSERT INTO badge_progress (participant_id, organization_id, badge_template_id, territoire_chasse,
        section, etoiles, status, date_obtention)
      VALUES ($1, $2, $3, 'Akela', 'general', $4, $5, '2026-01-15')`,
    [participantId, ids.unit, ids.template, level, status]);
  }

  function summary(scoutYearId = null) {
    const token = signJWTToken({ user_id: ids.leader, organizationId: ids.unit });
    const call = request(app).get('/api/v1/badges/badge-tracker-summary').set('Authorization', `Bearer ${token}`);
    return scoutYearId ? call.set('x-scout-year-id', String(scoutYearId)) : call;
  }

  const names = (rows) => [...new Set(rows.map((row) => row.first_name))].sort();

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      ids.unit = (await client.query("INSERT INTO organizations (name) VALUES ('Badge roster unit') RETURNING id")).rows[0].id;
      await client.query("INSERT INTO organization_program_sections (organization_id, section_key, display_name) VALUES ($1, 'general', 'General')", [ids.unit]);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    ids.lastYear = await one("INSERT INTO scout_years (organization_id, label, start_date, end_date, status) VALUES ($1, '2025-2026', '2025-09-01', '2026-08-31', 'closed') RETURNING id", [ids.unit]);
    ids.thisYear = await one("INSERT INTO scout_years (organization_id, label, start_date, end_date, status) VALUES ($1, '2026-2027', '2026-09-01', '2027-08-31', 'active') RETURNING id", [ids.unit]);

    const roleId = await one('INSERT INTO roles (role_name, display_name, data_scope) VALUES ($1, $1, \'organization\') RETURNING id',
      [`badges_${randomUUID()}`]);
    await pool.query("INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE permission_key = 'badges.view'", [roleId]);
    ids.leader = await one('INSERT INTO users (email, password, full_name) VALUES ($1, \'x\', \'Leader\') RETURNING id',
      [`${randomUUID()}@example.test`]);
    await pool.query("INSERT INTO user_organizations (user_id, organization_id, role_ids, status) VALUES ($1, $2, $3::jsonb, 'active')",
      [ids.leader, ids.unit, JSON.stringify([roleId])]);

    ids.template = await one("INSERT INTO badge_templates (organization_id, template_key, name) VALUES ($1, 'akela', 'Akela') RETURNING id", [ids.unit]);

    ids.stayed = await child('Stayed', [[ids.lastYear, 'active'], [ids.thisYear, 'active']]);
    ids.left = await child('Left', [[ids.lastYear, 'left']]);
    ids.newcomer = await child('Newcomer', [[ids.thisYear, 'active']]);

    await star(ids.stayed, 1, 'approved');
    await star(ids.left, 1, 'approved');
    await star(ids.left, 2, 'pending');

    app = express();
    app.use(express.json());
    app.locals.pool = pool;
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    app.use('/api/v1/badges', require('../routes/badges')(pool, logger));
  });

  afterAll(async () => {
    if (!pool) {return;}
    await pool.query('DELETE FROM badge_progress WHERE organization_id = $1', [ids.unit]);
    await pool.end();
  });

  test('this year lists only the youth enrolled this year', async () => {
    const response = await summary();
    expect(response.status).toBe(200);
    expect(names(response.body.data.participants)).toEqual(['Newcomer', 'Stayed']);
  });

  test('stars of a youth who left do not reach this year\'s queues or stats', async () => {
    const response = await summary();
    expect(names(response.body.data.badges)).toEqual(['Stayed']);
    expect(response.body.data.stats).toMatchObject({
      totalParticipants: 2,
      totalApproved: 1,
      pendingApproval: 0,
      awaitingDelivery: 1
    });
  });

  test('consulting last year shows the youth enrolled then, with their stars', async () => {
    const response = await summary(ids.lastYear);
    expect(response.status).toBe(200);
    expect(names(response.body.data.participants)).toEqual(['Left', 'Stayed']);
    expect(names(response.body.data.badges)).toEqual(['Left', 'Stayed']);
    expect(response.body.data.stats.pendingApproval).toBe(1);
  });

  test('a year from another unit is refused', async () => {
    const response = await summary(2147483647);
    expect(response.status).toBe(400);
  });
});
