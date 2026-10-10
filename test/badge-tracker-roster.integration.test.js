'use strict';

/**
 * Every tab of the Progression page (Badges and Programme) lists the youth on
 * the roster of the year being consulted. A cub who left the pack last year
 * must not appear this year — neither in the participant list nor through
 * their stars in the approval or delivery queues, the programme stream or the
 * unprocessed-achievements backlog — but must reappear when last year is
 * consulted. Stars are cumulative, so a cub who stayed keeps last year's stars
 * this year.
 */

const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');
const { randomUUID } = require('crypto');
require('./jest-conditional-helpers');
process.env.JWT_SECRET_KEY ||= 'badge-tracker-roster-integration-secret';

const { signJWTToken } = require('../utils/jwt-config');
const { grantParticipantAccess, ACCESS_SOURCE } = require('../services/participantAccess');

const DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!DATABASE_URL)('Progression roster by scout year', () => {
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

  /**
   * GET a path as a user, optionally for an archived year.
   *
   * @param {string} path - API path
   * @param {Object} [options] - `{ as, scoutYearId }`
   * @returns {Object} supertest request
   */
  function get(path, { as = ids.leader, scoutYearId = null } = {}) {
    const token = signJWTToken({ user_id: as, organizationId: ids.unit });
    const call = request(app).get(path).set('Authorization', `Bearer ${token}`);
    return scoutYearId ? call.set('x-scout-year-id', String(scoutYearId)) : call;
  }

  const summary = (scoutYearId = null) => get('/api/v1/badges/badge-tracker-summary', { scoutYearId });

  async function role(keys, scope) {
    const id = await one('INSERT INTO roles (role_name, display_name, data_scope) VALUES ($1, $1, $2) RETURNING id',
      [`progression_${randomUUID()}`, scope]);
    await pool.query('INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE permission_key = ANY($2::text[])',
      [id, keys]);
    return id;
  }

  async function member(roleId) {
    const id = await one('INSERT INTO users (email, password, full_name) VALUES ($1, \'x\', \'Member\') RETURNING id',
      [`${randomUUID()}@example.test`]);
    await pool.query("INSERT INTO user_organizations (user_id, organization_id, role_ids, status) VALUES ($1, $2, $3::jsonb, 'active')",
      [id, ids.unit, JSON.stringify([roleId])]);
    return id;
  }

  /**
   * Add a past meeting with an unprocessed badge activity for the given youth.
   *
   * @param {string} date - Meeting date (ISO)
   * @param {Array<number>} participantIds - Youth planned to earn the star
   * @returns {Promise<void>}
   */
  async function backlogMeeting(date, participantIds) {
    const meetingId = await one('INSERT INTO year_plan_meetings (organization_id, meeting_date) VALUES ($1, $2) RETURNING id',
      [ids.unit, date]);
    await pool.query(`INSERT INTO year_plan_meeting_activities (organization_id, meeting_id, name, badge_template_id, metadata)
      VALUES ($1, $2, 'Star', $3, $4::jsonb)`,
    [ids.unit, meetingId, ids.template, JSON.stringify({ legacy: { star_type: 'proie', participant_ids: participantIds } })]);
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

    ids.leader = await member(await role(['badges.view', 'participants.view', 'meetings.view'], 'organization'));
    ids.parent = await member(await role(['participants.view'], 'linked'));

    ids.template = await one("INSERT INTO badge_templates (organization_id, template_key, name) VALUES ($1, 'akela', 'Akela') RETURNING id", [ids.unit]);

    ids.stayed = await child('Stayed', [[ids.lastYear, 'active'], [ids.thisYear, 'active']]);
    ids.left = await child('Left', [[ids.lastYear, 'left']]);
    ids.newcomer = await child('Newcomer', [[ids.thisYear, 'active']]);

    await star(ids.stayed, 1, 'approved');
    await star(ids.left, 1, 'approved');
    await star(ids.left, 2, 'pending');

    // The parent's two children: one stayed, one left.
    await grantParticipantAccess(pool, { participantId: ids.stayed, userId: ids.parent, sourceType: ACCESS_SOURCE.DIRECT });
    await grantParticipantAccess(pool, { participantId: ids.left, userId: ids.parent, sourceType: ACCESS_SOURCE.DIRECT });

    await backlogMeeting('2026-01-15', [ids.left, ids.stayed]);
    await backlogMeeting('2026-09-15', [ids.stayed]);

    app = express();
    app.use(express.json());
    app.locals.pool = pool;
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    app.use('/api/v1/badges', require('../routes/badges')(pool, logger));
    app.use('/api/v1/program-progress', require('../routes/programProgress')(pool, logger));
    app.use('/api/v1/meetings', require('../routes/meetings')(pool, logger));
  });

  afterAll(async () => {
    if (!pool) {return;}
    await pool.query('DELETE FROM badge_progress WHERE organization_id = $1', [ids.unit]);
    await pool.query('DELETE FROM year_plan_meetings WHERE organization_id = $1', [ids.unit]);
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

  describe('Programme tab', () => {
    const stream = (options) => get('/api/v1/program-progress/stream', options);
    const streamNames = (body) => [...new Set(body.data.items.map((item) => item.participant_name))].sort();

    test('this year streams only the youth enrolled this year', async () => {
      const response = await stream();
      expect(response.status).toBe(200);
      expect(names(response.body.data.participants)).toEqual(['Newcomer', 'Stayed']);
      expect(streamNames(response.body)).toEqual(['Stayed Badge']);
    });

    test('consulting last year streams the youth enrolled then', async () => {
      const response = await stream({ scoutYearId: ids.lastYear });
      expect(response.status).toBe(200);
      expect(names(response.body.data.participants)).toEqual(['Left', 'Stayed']);
      expect(streamNames(response.body)).toEqual(['Left Badge', 'Stayed Badge']);
    });

    test('a parent sees only their children on the roster of the year consulted', async () => {
      const thisYear = await stream({ as: ids.parent });
      expect(thisYear.status).toBe(200);
      expect(names(thisYear.body.data.participants)).toEqual(['Stayed']);
      expect(streamNames(thisYear.body)).toEqual(['Stayed Badge']);

      const lastYear = await stream({ as: ids.parent, scoutYearId: ids.lastYear });
      expect(names(lastYear.body.data.participants)).toEqual(['Left', 'Stayed']);
    });

    test('a year from another unit is refused', async () => {
      const response = await stream({ scoutYearId: 2147483647 });
      expect(response.status).toBe(400);
    });
  });

  describe('Unprocessed achievements backlog', () => {
    const backlogDates = (body) => body.data.map((meeting) => meeting.date);

    test('this year lists only this year\'s meetings', async () => {
      const response = await get('/api/v1/meetings/achievements/unprocessed');
      expect(response.status).toBe(200);
      expect(backlogDates(response.body)).toEqual(['2026-09-15']);
    });

    test('consulting last year lists last year\'s meetings', async () => {
      const response = await get('/api/v1/meetings/achievements/unprocessed', { scoutYearId: ids.lastYear });
      expect(response.status).toBe(200);
      expect(backlogDates(response.body)).toEqual(['2026-01-15']);
    });
  });
});
