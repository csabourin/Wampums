/**
 * Unit fees on a migrated PostgreSQL: what a mocked pool cannot show, the
 * foreign keys, the uniqueness of a youth's fee and the status that follows
 * the payments (#1460).
 */
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const { ensureActiveScoutYear } = require('../services/scoutYear');
require('./jest-conditional-helpers');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET_KEY ||= 'fictional-finance';
const logger = { info: () => {}, warn: () => {}, error: () => {} };

describe.skipIf(!DATABASE_URL)('unit fees', () => {
  let pool; let app; let unit; let admin; let token;
  const youths = [];
  const one = async (sql, params = []) => Object.values((await pool.query(sql, params)).rows[0] || {})[0];
  const call = (method, path) => request(app)[method](`/api/v1/finance${path}`).set('Authorization', token);
  const feeOf = (definition, youth) => one(
    'SELECT id FROM participant_fees WHERE fee_definition_id = $1 AND participant_id = $2', [definition, youth]);
  const statusOf = (fee) => one('SELECT status FROM participant_fees WHERE id = $1', [fee]);
  const definition = async (start) => (await call('post', '/fee-definitions')
    .send({ registration_fee: 50, membership_fee: 30, year_start: start, year_end: `${Number(start.slice(0, 4)) + 1}-08-31` })).body.data.id;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      unit = (await db.query("INSERT INTO organizations (name) VALUES ('Fictional finance unit') RETURNING id")).rows[0].id;
      await db.query("INSERT INTO organization_program_sections (organization_id, section_key, display_name) VALUES ($1, 'general', 'General')", [unit]);
      await db.query('COMMIT');
    } finally { db.release(); }
    admin = await one("INSERT INTO users (email, password, full_name) VALUES ('finance-' || gen_random_uuid() || '@example.test', 'x', 'Ada Treasurer') RETURNING id");
    await pool.query(`INSERT INTO user_organizations (organization_id, user_id, role_ids, status)
      SELECT $1, $2, jsonb_build_array(id), 'active' FROM roles WHERE role_name = 'district' AND organization_id IS NULL`, [unit, admin]);
    const year = (await ensureActiveScoutYear(pool, unit)).id;
    for (const name of ['Grace', 'Hedy']) {
      // eslint-disable-next-line no-await-in-loop -- two fixtures, in order
      const id = await one("INSERT INTO participants (first_name, last_name) VALUES ($1, 'Fiction') RETURNING id", [name]);
      // eslint-disable-next-line no-await-in-loop -- two fixtures, in order
      await pool.query("INSERT INTO participant_enrollments (organization_id, participant_id, scout_year_id, status) VALUES ($1, $2, $3, 'active')", [unit, id, year]);
      youths.push(id);
    }
    token = `Bearer ${jwt.sign({ user_id: admin, organizationId: unit }, process.env.JWT_SECRET_KEY)}`;
    app = express(); app.locals.pool = pool; app.use(express.json());
    app.use('/api', require('../routes/finance')(pool, logger));
    app.use((err, _req, res, _next) => res.status(500).json({ success: false, message: 'internal_server_error' }));
  });

  afterAll(async () => {
    if (!pool) { return; }
    await pool.query('DELETE FROM payments WHERE participant_fee_id IN (SELECT id FROM participant_fees WHERE organization_id = $1)', [unit]);
    await pool.query('DELETE FROM payment_plans WHERE participant_fee_id IN (SELECT id FROM participant_fees WHERE organization_id = $1)', [unit]);
    for (const table of ['participant_fees', 'fee_definitions', 'participant_enrollments', 'scout_years', 'user_organizations']) {
      // eslint-disable-next-line no-await-in-loop -- dependants first
      await pool.query(`DELETE FROM ${table} WHERE organization_id = $1`, [unit]);
    }
    await pool.query('DELETE FROM participants WHERE id = ANY($1::int[])', [youths]);
    await pool.query('DELETE FROM organizations WHERE id = $1', [unit]);
    await pool.query('DELETE FROM users WHERE id = $1', [admin]);
    await pool.end();
  });

  test('a fee definition is given to every youth, and its status follows the payments', async () => {
    const def = await definition('2026-09-01');
    const fee = await feeOf(def, youths[0]);
    expect(await statusOf(fee)).toBe('unpaid');

    await call('post', `/participant-fees/${fee}/payments`).send({ amount: 30, payment_date: '2026-10-01' }).expect(201);
    expect(await statusOf(fee)).toBe('partial');
    await call('post', `/participant-fees/${fee}/payments`).send({ amount: 50, payment_date: '2026-10-02' }).expect(201);
    expect(await statusOf(fee)).toBe('paid');

    // A paid fee that grows is no longer paid; a status sent with it is ignored.
    await call('put', `/participant-fees/${fee}`).send({ total_registration_fee: 70, status: 'paid' }).expect(200);
    expect(await statusOf(fee)).toBe('partial');
  });

  test('a fee definition without payments can be deleted, its fees with it; one with a payment stays', async () => {
    const unpaid = await definition('2027-09-01');
    const paid = await definition('2028-09-01');
    await call('post', `/participant-fees/${await feeOf(paid, youths[1])}/payments`).send({ amount: 5, payment_date: '2028-10-01' }).expect(201);

    await call('delete', `/fee-definitions/${unpaid}`).expect(200);
    const refused = await call('delete', `/fee-definitions/${paid}`);

    expect(await one('SELECT COUNT(*)::int FROM participant_fees WHERE fee_definition_id = $1', [unpaid])).toBe(0);
    expect(refused.status).toBe(409);
    expect(refused.body.message).toBe('fee_definition_has_payments');
    expect(await one('SELECT COUNT(*)::int FROM fee_definitions WHERE id = $1', [paid])).toBe(1);
  });

  test('a second fee for the same youth and definition is a conflict, not a server error', async () => {
    const def = await definition('2029-09-01');
    const res = await call('post', '/participant-fees')
      .send({ participant_id: youths[0], fee_definition_id: def, total_registration_fee: 1, total_membership_fee: 1 });

    expect(res.status).toBe(409);
    expect(res.body.message).toBe('participant_fee_exists');
  });

  test('a payment can name only a payment plan of its own fee, and a year must not end before it starts', async () => {
    const def = await definition('2030-09-01');
    const fee = await feeOf(def, youths[0]);
    const otherFee = await feeOf(def, youths[1]);
    const plan = (await call('post', `/participant-fees/${otherFee}/payment-plans`)
      .send({ number_of_payments: 2, amount_per_payment: 40, start_date: '2030-10-01', frequency: 'monthly' })).body.data.id;

    const payment = await call('post', `/participant-fees/${fee}/payments`).send({ amount: 5, payment_date: '2030-10-01', payment_plan_id: plan });
    const backwards = await call('post', '/fee-definitions').send({ registration_fee: 1, membership_fee: 1, year_start: '2031-09-01', year_end: '2031-01-01' });

    expect(payment.status).toBe(400);
    expect(backwards.status).toBe(400);
  });
});
