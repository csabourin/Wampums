'use strict';

/**
 * A badge level grants its earn points once. Approving it a second time,
 * editing it once approved, or approving it again after a rejection awards
 * nothing more.
 */

const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');
const { randomUUID } = require('crypto');
require('./jest-conditional-helpers');
process.env.JWT_SECRET_KEY ||= 'badge-approval-integration-secret';

const { signJWTToken } = require('../utils/jwt-config');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SIMULTANEOUS_APPROVALS = 4;

describe.skipIf(!DATABASE_URL)('Badge approval points', () => {
  let pool;
  let app;
  const ids = {};

  async function one(sql, params = []) {
    const result = await pool.query(sql, params);
    return Object.values(result.rows[0] || {})[0];
  }

  function as(method, path, body) {
    const token = signJWTToken({ user_id: ids.leader, organizationId: ids.unit });
    return request(app)[method](`/api/v1/badges${path}`).set('Authorization', `Bearer ${token}`).send(body);
  }

  const pointsOf = (participantId) => one(
    'SELECT COALESCE(SUM(value), 0)::int FROM points WHERE organization_id = $1 AND participant_id = $2',
    [ids.unit, participantId]
  );

  function pendingLevel(level) {
    return one(`INSERT INTO badge_progress (participant_id, organization_id, badge_template_id, territoire_chasse, section, etoiles, status)
      VALUES ($1, $2, $3, 'Akela', 'general', $4, 'pending') RETURNING id`, [ids.youth, ids.unit, ids.template, level]);
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    // The unit and its section reference each other; the check is deferred to COMMIT.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      ids.unit = (await client.query("INSERT INTO organizations (name) VALUES ('Badge approval unit') RETURNING id")).rows[0].id;
      await client.query("INSERT INTO organization_program_sections (organization_id, section_key, display_name) VALUES ($1, 'general', 'General')", [ids.unit]);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    await pool.query("INSERT INTO scout_years (organization_id, label, start_date, end_date, status) VALUES ($1, '2026-2027', '2026-09-01', '2027-08-31', 'active')", [ids.unit]);
    ids.template = await one("INSERT INTO badge_templates (organization_id, template_key, name, level_count) VALUES ($1, 'approval-akela', 'Akela', 3) RETURNING id", [ids.unit]);
    ids.youth = await one("INSERT INTO participants (first_name, last_name, date_naissance) VALUES ('Ada', 'Lovelace', '2016-01-01') RETURNING id");
    await pool.query('INSERT INTO participant_organizations (participant_id, organization_id) VALUES ($1, $2)', [ids.youth, ids.unit]);

    const roleId = await one('INSERT INTO roles (role_name, display_name, data_scope) VALUES ($1, $1, \'organization\') RETURNING id',
      [`approval_${randomUUID()}`]);
    await pool.query('INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE permission_key = ANY($2::text[])',
      [roleId, ['badges.view', 'badges.manage', 'badges.approve']]);
    ids.leader = await one('INSERT INTO users (email, password, full_name) VALUES ($1, \'x\', \'Léa Tremblay\') RETURNING id',
      [`${randomUUID()}@example.test`]);
    await pool.query("INSERT INTO user_organizations (user_id, organization_id, role_ids, status) VALUES ($1, $2, $3::jsonb, 'active')",
      [ids.leader, ids.unit, JSON.stringify([roleId])]);

    app = express();
    app.use(express.json());
    app.locals.pool = pool;
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    app.use('/api/v1/badges', require('../routes/badges')(pool, logger));
  });

  afterAll(async () => {
    await pool?.end();
  });

  test('approving a level twice, even at the same moment, grants its points once', async () => {
    const level = await pendingLevel(1);
    const before = await pointsOf(ids.youth);
    const results = await Promise.all(Array.from({ length: SIMULTANEOUS_APPROVALS }, () =>
      as('post', '/approve', { badge_id: level })));
    results.forEach((result) => expect(result.status).toBe(200));
    await as('post', '/approve', { badge_id: level }).expect(200);
    expect(await pointsOf(ids.youth)).toBe(before + 5);
  });

  test('editing an approved level, or approving it again after a rejection, grants nothing more', async () => {
    const level = await pendingLevel(2);
    const before = await pointsOf(ids.youth);
    await as('put', `/badge-progress/${level}`, { status: 'approved' }).expect(200);
    await as('put', `/badge-progress/${level}`, { status: 'approved', description: 'Bravo' }).expect(200);
    await as('post', '/reject', { badge_id: level }).expect(200);
    await as('post', '/approve', { badge_id: level }).expect(200);
    expect(await pointsOf(ids.youth)).toBe(before + 5);
  });

  test('a review comment, which badges do not store, no longer breaks an edit', async () => {
    const level = await pendingLevel(3);
    await as('put', `/badge-progress/${level}`, { reviewer_comments: 'Bravo' }).expect(400);
    const edited = await as('put', `/badge-progress/${level}`, { description: 'Bravo', reviewer_comments: 'Bravo' }).expect(200);
    expect(edited.body.data.description).toBe('Bravo');
  });
});
