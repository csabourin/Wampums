/**
 * A SISC import on a migrated PostgreSQL: a row the database refuses is
 * skipped alone, and the other rows are saved (#1459).
 *
 * The import runs in one transaction. Before each row had its own savepoint,
 * one refused row aborted the transaction: the import answered "completed"
 * with counters, and the final COMMIT silently saved nothing. A mocked pool
 * cannot show that; only a real database aborts a transaction.
 */
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const { ensureActiveScoutYear } = require('../services/scoutYear');
require('./jest-conditional-helpers');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET_KEY ||= 'fictional-sisc-import-rows';
const logger = { info: () => {}, warn: () => {}, error: () => {} };
/** Longer than participants.last_name (varchar 255), which the database refuses. */
const TOO_LONG_NAME = 'Lovelace'.repeat(40);

describe.skipIf(!DATABASE_URL)('SISC import, row by row', () => {
  let pool; let app; let unit; let manager;
  const one = async (sql, params = []) => Object.values((await pool.query(sql, params)).rows[0])[0];
  const enrolled = async () => (await pool.query(
    `SELECT p.first_name, p.date_naissance::text AS born FROM participants p
       JOIN participant_enrollments e ON e.participant_id = p.id AND e.organization_id = $1
      ORDER BY p.first_name`, [unit]
  )).rows;
  const importCsv = (csvContent) => request(app).post('/api/v1/import/sisc')
    .set('Authorization', `Bearer ${jwt.sign({ user_id: manager, organizationId: unit }, process.env.JWT_SECRET_KEY)}`)
    .send({ csvContent });

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      unit = (await db.query("INSERT INTO organizations (name) VALUES ('Fictional SISC Rows Unit') RETURNING id")).rows[0].id;
      await db.query("INSERT INTO organization_program_sections (organization_id, section_key, display_name) VALUES ($1, 'general', 'General')", [unit]);
      await db.query('COMMIT');
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    } finally { db.release(); }
    manager = await one("INSERT INTO users (email, password, full_name) VALUES ('sisc-rows-' || gen_random_uuid() || '@example.test', 'x', 'Fictional Import Manager') RETURNING id");
    await pool.query(`INSERT INTO user_organizations (organization_id, user_id, role_ids, status)
      SELECT $1, $2, jsonb_build_array(id), 'active' FROM roles WHERE role_name = 'district' AND organization_id IS NULL`, [unit, manager]);
    // The import grants the built-in leader and parent roles; a database built for
    // this suite alone has only the roles the baseline creates.
    await pool.query(`INSERT INTO roles (role_name, display_name, data_scope)
      VALUES ('parent', 'Parent', 'linked'), ('animation', 'Animation', 'organization')
      ON CONFLICT (role_name) DO NOTHING`);
    await ensureActiveScoutYear(pool, unit);
    app = express(); app.locals.pool = pool; app.use(express.json());
    app.use('/api/v1/import', require('../routes/import')(pool, logger));
    app.use((err, _req, res, _next) => res.status(500).json({ success: false, message: 'internal_server_error' }));
  });

  afterEach(async () => {
    const ids = (await pool.query('SELECT participant_id FROM participant_enrollments WHERE organization_id = $1', [unit])).rows
      .map((row) => row.participant_id);
    await pool.query('DELETE FROM form_submissions WHERE organization_id = $1', [unit]);
    await pool.query('DELETE FROM participant_enrollments WHERE organization_id = $1', [unit]);
    await pool.query('DELETE FROM participants WHERE id = ANY($1::int[])', [ids]);
  });

  afterAll(async () => {
    if (!pool) { return; }
    await pool.query('DELETE FROM scout_years WHERE organization_id = $1', [unit]);
    await pool.query('DELETE FROM user_organizations WHERE organization_id = $1', [unit]);
    await pool.query('DELETE FROM organizations WHERE id = $1', [unit]);
    await pool.query('DELETE FROM users WHERE id = $1', [manager]);
    await pool.end();
  });

  test('a row the database refuses is reported, and the rows before and after it are saved', async () => {
    const response = await importCsv([
      'nom;prenom;naissance',
      'Fiction;Grace;20160503',
      `${TOO_LONG_NAME};Ada;20150212`,
      'Fiction;Hedy;20141109',
    ].join('\n'));

    expect(response.status).toBe(200);
    expect(response.body.stats.errors).toEqual([{ row: 3, code: 'sisc_row_not_saved' }]);
    expect(response.body.stats.participantsCreated).toBe(2);
    expect(JSON.stringify(response.body)).not.toMatch(/too long|character varying/i);
    expect(await enrolled()).toEqual([
      { first_name: 'Grace', born: '2016-05-03' },
      { first_name: 'Hedy', born: '2014-11-09' },
    ]);
  });

  test('a birth date that is not a real day skips its row without writing anything', async () => {
    const response = await importCsv([
      'nom;prenom;naissance',
      'Fiction;Grace;20160230',
      'Fiction;Ada;2016-5-3',
      'Fiction;Hedy;',
    ].join('\n'));

    expect(response.status).toBe(200);
    expect(response.body.stats.errors).toEqual([
      { row: 2, code: 'sisc_row_invalid_birth_date' },
      { row: 3, code: 'sisc_row_invalid_birth_date' },
    ]);
    // A blank birth date stays unknown, as before.
    expect(await enrolled()).toEqual([{ first_name: 'Hedy', born: null }]);
  });
});
