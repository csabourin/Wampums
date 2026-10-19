'use strict';

/**
 * A leader records the badge levels a youth earned before the unit tracked
 * them. The levels are approved history: no points, no duplicate of a level
 * already recorded, even when two leaders save at the same time.
 */

const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');
const { randomUUID } = require('crypto');
require('./jest-conditional-helpers');
process.env.JWT_SECRET_KEY ||= 'badge-history-integration-secret';

const { signJWTToken } = require('../utils/jwt-config');

const DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!DATABASE_URL)('Badge history', () => {
  let pool;
  let app;
  const ids = {};

  async function one(sql, params = []) {
    const result = await pool.query(sql, params);
    return Object.values(result.rows[0] || {})[0];
  }

  async function unit(name) {
    // The unit and its section reference each other; the check is deferred to COMMIT.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { id } = (await client.query('INSERT INTO organizations (name) VALUES ($1) RETURNING id', [name])).rows[0];
      await client.query("INSERT INTO organization_program_sections (organization_id, section_key, display_name) VALUES ($1, 'general', 'General')", [id]);
      await client.query('COMMIT');
      await pool.query("INSERT INTO scout_years (organization_id, label, start_date, end_date, status) VALUES ($1, '2026-2027', '2026-09-01', '2027-08-31', 'active')", [id]);
      return id;
    } finally {
      client.release();
    }
  }

  async function child(organizationId) {
    const id = await one("INSERT INTO participants (first_name, last_name, date_naissance) VALUES ('Alix', 'History', '2016-01-01') RETURNING id");
    await pool.query('INSERT INTO participant_organizations (participant_id, organization_id) VALUES ($1, $2)', [id, organizationId]);
    return id;
  }

  async function member(keys) {
    const roleId = await one('INSERT INTO roles (role_name, display_name, data_scope) VALUES ($1, $1, \'organization\') RETURNING id',
      [`history_${randomUUID()}`]);
    await pool.query('INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE permission_key = ANY($2::text[])',
      [roleId, keys]);
    const id = await one('INSERT INTO users (email, password, full_name) VALUES ($1, \'x\', \'Leader\') RETURNING id',
      [`${randomUUID()}@example.test`]);
    await pool.query("INSERT INTO user_organizations (user_id, organization_id, role_ids, status) VALUES ($1, $2, $3::jsonb, 'active')",
      [id, ids.unit, JSON.stringify([roleId])]);
    return id;
  }

  function save(body, as = ids.leader) {
    const token = signJWTToken({ user_id: as, organizationId: ids.unit });
    return request(app).post('/api/v1/badges/history').set('Authorization', `Bearer ${token}`).send(body);
  }

  const levels = (participantId) => one(
    `SELECT COUNT(*)::int FROM badge_progress
      WHERE participant_id = $1 AND organization_id = $2 AND badge_template_id = $3`,
    [participantId, ids.unit, ids.template]
  );

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    ids.unit = await unit('Badge history unit');
    ids.otherUnit = await unit('Other badge history unit');
    ids.template = await one("INSERT INTO badge_templates (organization_id, template_key, name, level_count) VALUES ($1, 'history-akela', 'Akela', 3) RETURNING id", [ids.unit]);
    ids.leader = await member(['badges.view', 'badges.manage']);
    ids.viewer = await member(['badges.view']);

    app = express();
    app.use(express.json());
    app.locals.pool = pool;
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    app.use('/api/v1/badges', require('../routes/badges')(pool, logger));
  });

  afterAll(async () => {
    if (!pool) {return;}
    await pool.query('DELETE FROM badge_progress WHERE organization_id = ANY($1::int[])', [[ids.unit, ids.otherUnit]]);
    await pool.end();
  });

  test('a leader records earned levels as approved history, without points', async () => {
    const participantId = await child(ids.unit);
    const pointsBefore = await one('SELECT COUNT(*)::int FROM points WHERE participant_id = $1', [participantId]);

    const response = await save({
      participant_id: participantId,
      date: '2025-05-10',
      entries: [{ badge_template_id: ids.template, level: 1 }, { badge_template_id: ids.template, level: 2 }],
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, data: { skipped: [] } });
    expect(response.body.data.inserted).toHaveLength(2);
    expect(response.body.timestamp).toEqual(expect.any(String));
    expect(await one(
      `SELECT COUNT(*)::int FROM badge_progress
        WHERE participant_id = $1 AND status = 'approved' AND source_type = 'historical'`,
      [participantId]
    )).toBe(2);
    expect(await one('SELECT COUNT(*)::int FROM points WHERE participant_id = $1', [participantId])).toBe(pointsBefore);
  });

  test('two leaders saving the same level at once record it once', async () => {
    const participantId = await child(ids.unit);
    const body = { participant_id: participantId, entries: [{ badge_template_id: ids.template, level: 1 }] };

    const responses = await Promise.all([save(body), save(body)]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(await levels(participantId)).toBe(1);
  });

  test('a malformed participant id is refused as bad input', async () => {
    const participantId = await child(ids.unit);

    const response = await save({ participant_id: `${participantId}abc`, entries: [{ badge_template_id: ids.template, level: 1 }] });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(await levels(participantId)).toBe(0);
  });

  test('a badge template id beyond the integer range is refused as bad input', async () => {
    const participantId = await child(ids.unit);

    const response = await save({ participant_id: participantId, entries: [{ badge_template_id: 99999999999, level: 1 }] });

    expect(response.status).toBe(400);
    expect(response.body.timestamp).toEqual(expect.any(String));
  });

  test('a child of another unit is not found', async () => {
    const participantId = await child(ids.otherUnit);

    const response = await save({ participant_id: participantId, entries: [{ badge_template_id: ids.template, level: 1 }] });

    expect(response.status).toBe(404);
    expect(await one('SELECT COUNT(*)::int FROM badge_progress WHERE participant_id = $1', [participantId])).toBe(0);
  });

  test('someone who may only view badges cannot record history', async () => {
    const participantId = await child(ids.unit);

    const response = await save({ participant_id: participantId, entries: [{ badge_template_id: ids.template, level: 1 }] }, ids.viewer);

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ required: ['badges.manage'], missing: ['badges.manage'] });
  });
});
