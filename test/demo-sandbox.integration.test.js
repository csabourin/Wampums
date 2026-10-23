'use strict';

/**
 * The demo unit lets visitors try what writes no text, and the night reset
 * puts it back. Runs against a real database (TEST_DATABASE_URL).
 */

const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');
const { randomUUID } = require('crypto');
require('./jest-conditional-helpers');
process.env.JWT_SECRET_KEY ||= 'demo-sandbox-integration-secret';

const { signJWTToken } = require('../utils/jwt-config');
const { captureBaseline } = require('../services/demoSandbox');
const { run: runReset } = require('../scripts/demo/reset-demo-sandbox');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
const SANDBOX_KEYS = ['points.view', 'points.manage', 'attendance.view', 'attendance.manage', 'honors.view', 'honors.create'];

describe.skipIf(!DATABASE_URL)('Demo sandbox', () => {
  let pool;
  let app;
  const ids = {};

  async function one(sql, params = []) {
    const result = await pool.query(sql, params);
    return Object.values(result.rows[0] || {})[0];
  }

  /** @returns {Promise<number>} A unit with a section and an active year. */
  async function unit(label, demo) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const id = (await client.query('INSERT INTO organizations (name) VALUES ($1) RETURNING id', [label])).rows[0].id;
      await client.query("INSERT INTO organization_program_sections (organization_id, section_key, display_name) VALUES ($1, 'general', 'General')", [id]);
      await client.query('COMMIT');
      await pool.query(`INSERT INTO scout_years (organization_id, label, start_date, end_date, status)
        VALUES ($1, 'Demo year', CURRENT_DATE - 100, CURRENT_DATE + 200, 'active')`, [id]);
      if (demo) {
        await pool.query("INSERT INTO organization_settings (organization_id, setting_key, setting_value) VALUES ($1, 'demo_sign_in', 'true'::jsonb)", [id]);
      }
      return id;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async function member(roleId, organizationId) {
    const id = await one("INSERT INTO users (email, password, full_name) VALUES ($1, 'x', 'Akela Demo') RETURNING id", [`${randomUUID()}@example.test`]);
    await pool.query("INSERT INTO user_organizations (user_id, organization_id, role_ids, status) VALUES ($1, $2, $3::jsonb, 'active')", [id, organizationId, JSON.stringify([roleId])]);
    return id;
  }

  async function child(organizationId, firstName) {
    const id = await one("INSERT INTO participants (first_name, last_name, date_naissance) VALUES ($1, 'Tremblay', '2016-01-01') RETURNING id", [firstName]);
    await pool.query(`INSERT INTO participant_enrollments (participant_id, organization_id, scout_year_id)
      SELECT $1, $2, id FROM scout_years WHERE organization_id = $2 AND status = 'active'`, [id, organizationId]);
    await pool.query('INSERT INTO participant_organizations (participant_id, organization_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, organizationId]);
    return id;
  }

  function post(path, userId, organizationId, body) {
    const token = signJWTToken({ user_id: userId, organizationId, roleNames: ['demoadmin'], permissions: [] });
    return request(app).post(path).set('Authorization', `Bearer ${token}`).send(body);
  }

  async function demoPointsTotal(organizationId = ids.demoUnit) {
    return Number(await one('SELECT COALESCE(SUM(value), 0) FROM points WHERE organization_id = $1', [organizationId]));
  }

  async function reset(options = {}) {
    const client = await pool.connect();
    try {
      return await runReset(client, { capture: false, dryRun: false, ...options });
    } finally {
      client.release();
    }
  }

  const today = () => new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    // Earlier runs leave their demo units behind; only this run's may be one.
    await pool.query("DELETE FROM organization_settings WHERE setting_key = 'demo_sign_in' AND organization_id IN (SELECT id FROM organizations WHERE name LIKE 'Saint-Bivouac test%')");
    ids.demoUnit = await unit(`Saint-Bivouac test ${randomUUID()}`, true);
    ids.realUnit = await unit(`Real unit test ${randomUUID()}`, false);
    ids.demoRole = await one("SELECT id FROM roles WHERE role_name = 'demoadmin'")
      || await one("INSERT INTO roles (role_name, display_name, data_scope, is_system_role) VALUES ('demoadmin', 'Demo Admin', 'organization', TRUE) RETURNING id");
    // Migration 041 grants these in production, where demoadmin exists.
    await pool.query(`INSERT INTO role_permissions (role_id, permission_id)
      SELECT $1, id FROM permissions WHERE permission_key = ANY($2::text[]) ON CONFLICT DO NOTHING`, [ids.demoRole, SANDBOX_KEYS]);
    ids.visitor = await member(ids.demoRole, ids.demoUnit);
    ids.realDemo = await member(ids.demoRole, ids.realUnit);
    ids.annie = await child(ids.demoUnit, 'Annie');
    ids.realChild = await child(ids.realUnit, 'Léa');
    await pool.query('INSERT INTO points (participant_id, value, organization_id) VALUES ($1, 7, $2)', [ids.annie, ids.demoUnit]);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await captureBaseline(client, ids.demoUnit, { replace: true });
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    app = express();
    app.use(express.json());
    app.locals.pool = pool;
    app.use('/api/v1/points', require('../routes/points')(pool, logger));
    app.use('/api/v1/attendance', require('../routes/attendance')(pool, logger));
    app.use('/api', require('../routes/honors')(pool, logger));
  });

  afterAll(async () => {
    await pool.query("DELETE FROM organization_settings WHERE organization_id = $1 AND setting_key = 'demo_sign_in'", [ids.demoUnit]);
    await pool.end();
  });

  test('a demo visitor can award points in the demo unit', async () => {
    const response = await post('/api/v1/points', ids.visitor, ids.demoUnit, [{ type: 'individual', id: ids.annie, points: 5 }]);

    expect(response.status).toBe(200);
    expect(await demoPointsTotal()).toBe(12);
  });

  test('a demo visitor can take attendance in the demo unit', async () => {
    const response = await post('/api/v1/attendance', ids.visitor, ids.demoUnit, {
      participant_id: ids.annie, date: today(), status: 'present',
    });

    expect(response.status).toBe(201);
    expect(await one('SELECT status FROM attendance WHERE participant_id = $1 AND date = $2', [ids.annie, today()])).toBe('present');
  });

  test('a demo visitor can award an honor, but cannot write its reason', async () => {
    const written = await post('/api/v1/honors', ids.visitor, ids.demoUnit, [{ participantId: ids.annie, date: today(), reason: 'Defaced by a visitor' }]);
    expect(written.status).toBe(403);
    expect(written.body).toMatchObject({ isDemo: true, code: 'demo_read_only', required: [], missing: [] });

    const plain = await post('/api/v1/honors', ids.visitor, ids.demoUnit, [{ participantId: ids.annie, date: today() }]);
    expect(plain.status).toBe(200);
    expect(await one('SELECT COUNT(*)::int FROM honors WHERE participant_id = $1', [ids.annie])).toBe(1);
  });

  test('a demo visitor cannot give a child a million points', async () => {
    const response = await post('/api/v1/points', ids.visitor, ids.demoUnit, [{ type: 'individual', id: ids.annie, points: 1000000 }]);

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('demo_read_only');
  });

  test('a demo account in an ordinary unit stays read-only', async () => {
    const response = await post('/api/v1/points', ids.realDemo, ids.realUnit, [{ type: 'individual', id: ids.realChild, points: 5 }]);

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ isDemo: true, code: 'demo_read_only' });
    expect(await demoPointsTotal(ids.realUnit)).toBe(0);
  });

  test('a dry run of the night reset changes nothing', async () => {
    const before = await demoPointsTotal();

    await reset({ dryRun: true });

    expect(await demoPointsTotal()).toBe(before);
  });

  test('the night reset puts the demo unit back and leaves other units alone', async () => {
    await pool.query('INSERT INTO points (participant_id, value, organization_id) VALUES ($1, 3, $2)', [ids.realChild, ids.realUnit]);
    await post('/api/v1/points', ids.visitor, ids.demoUnit, [{ type: 'individual', id: ids.annie, points: 50 }]);

    const outcomes = await reset();

    expect(outcomes).toContainEqual({ organizationId: ids.demoUnit, restored: { points: 1, attendance: 0, honors: 0 } });
    expect(await demoPointsTotal()).toBe(7);
    expect(await one('SELECT COUNT(*)::int FROM attendance WHERE organization_id = $1', [ids.demoUnit])).toBe(0);
    expect(await one('SELECT COUNT(*)::int FROM honors WHERE organization_id = $1', [ids.demoUnit])).toBe(0);
    expect(await demoPointsTotal(ids.realUnit)).toBe(3);
  });

  test('an ordinary unit can never be captured as a demo baseline', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await expect(captureBaseline(client, ids.realUnit, { replace: true })).rejects.toThrow(/not the demo unit/);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
