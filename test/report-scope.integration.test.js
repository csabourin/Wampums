/**
 * Unit reports on a disposable database (#1338): a custom family role a unit
 * gave `reports.view` reads none of the unit's health or contact reports; the
 * unit's team does, and the family role's progress report lists only its own
 * children. Every person here is invented.
 */
const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
require('./jest-conditional-helpers');
process.env.JWT_SECRET_KEY ||= 'fictional-report-scope-integration';
const DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!DATABASE_URL)('Unit reports and family roles', () => {
  let pool; let app;
  const ids = {}; const users = []; const participants = [];
  const one = async (sql, params = []) => Object.values((await pool.query(sql, params)).rows[0] || {})[0];

  async function member(keys, name, scope) {
    const role = await one("INSERT INTO roles (role_name, display_name, data_scope, organization_id) VALUES ('report_' || gen_random_uuid(), 'Fictional', $2, $1) RETURNING id", [ids.unit, scope]);
    await pool.query('INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE permission_key = ANY($2::text[])', [role, keys]);
    const user = await one("INSERT INTO users (email, password, full_name) VALUES ('report-' || gen_random_uuid() || '@example.test', 'x', $1) RETURNING id", [name]);
    users.push(user);
    await pool.query('INSERT INTO user_organizations (organization_id, user_id, role_ids) VALUES ($1, $2, $3)', [ids.unit, user, JSON.stringify([role])]);
    return user;
  }
  async function child(first) {
    const id = await one("INSERT INTO participants (first_name, last_name) VALUES ($1, 'Fiction') RETURNING id", [first]);
    participants.push(id);
    await pool.query('INSERT INTO participant_enrollments (participant_id, organization_id, scout_year_id) VALUES ($1, $2, $3)', [id, ids.unit, ids.year]);
    return id;
  }
  const get = (path, user) => request(app).get(`/api/v1/reports/${path}`)
    .set('Authorization', `Bearer ${jwt.sign({ user_id: user, organizationId: ids.unit }, process.env.JWT_SECRET_KEY)}`);

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      ids.unit = (await db.query("INSERT INTO organizations (name) VALUES ('Fictional Report Unit') RETURNING id")).rows[0].id;
      await db.query("INSERT INTO organization_program_sections (organization_id, section_key, display_name) VALUES ($1, 'general', 'General')", [ids.unit]);
      await db.query('COMMIT');
    } finally {
      db.release();
    }
    ids.year = await one("INSERT INTO scout_years (organization_id, label, start_date, end_date, status) VALUES ($1, 'Current', CURRENT_DATE - 30, CURRENT_DATE + 300, 'active') RETURNING id", [ids.unit]);
    ids.leader = await member(['reports.view'], 'Ada Lovelace', 'organization');
    ids.family = await member(['reports.view'], 'Léa Tremblay', 'linked');
    ids.own = await child('Rosalind');
    ids.other = await child('Hedy');
    // The family's own child, linked through the access service's cache as the app reads it.
    await pool.query('INSERT INTO user_participants (user_id, participant_id) VALUES ($1, $2)', [ids.family, ids.own]);
    app = express(); app.locals.pool = pool; app.use(express.json());
    app.use('/api/v1/reports', require('../routes/reports')(pool, { info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
    app.use((err, _req, res, _next) => res.status(500).json({ success: false, message: 'internal_server_error' }));
  });

  afterAll(async () => {
    if (!pool) {return;}
    await pool.query('DELETE FROM user_participants WHERE participant_id = ANY($1::int[])', [participants]);
    await pool.query('DELETE FROM participant_enrollments WHERE organization_id = $1', [ids.unit]);
    await pool.query('DELETE FROM participants WHERE id = ANY($1::int[])', [participants]);
    await pool.query('DELETE FROM scout_years WHERE organization_id = $1', [ids.unit]);
    await pool.query('DELETE FROM organizations WHERE id = $1', [ids.unit]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    await pool.end();
  });

  test('a family role holding reports.view reads no unit-wide report; the team reads them', async () => {
    for (const report of ['health', 'allergies', 'medication', 'health-contacts', 'parent-contact-list', 'mailing-list']) {
      // eslint-disable-next-line no-await-in-loop -- each report in turn
      const refused = await get(report, ids.family);
      expect(refused.status).toBe(403);
      expect(refused.body.required).toEqual(['reports.view']);
      // eslint-disable-next-line no-await-in-loop -- each report in turn
      expect((await get(report, ids.leader)).status).toBe(200);
    }
  });

  test('the progress report lists a family role’s own child only, and the team every child', async () => {
    const mine = (await get('participant-progress', ids.family)).body.data.participants.map((row) => row.first_name);
    expect(mine).toEqual(['Rosalind']);
    const all = (await get('participant-progress', ids.leader)).body.data.participants.map((row) => row.first_name).sort();
    expect(all).toEqual(['Hedy', 'Rosalind']);
  });
});
