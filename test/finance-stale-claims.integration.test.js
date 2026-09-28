/**
 * Finance access with a stale token — integration suite
 *
 * A JWT carries the permission list taken at sign-in and stays valid for
 * days. When a finance permission is taken away from a role (migration 010
 * took finance.view from parents), a parent still holding an old token must
 * lose the staff paths at once: another family's statement, and paying
 * another family's fee. Their own child stays reachable.
 *
 * Skipped unless SCOUT_YEAR_TEST_DATABASE_URL (or TEST_DATABASE_URL) points at
 * a disposable database holding the project schema and permission catalog.
 *
 * @module test/finance-stale-claims.integration
 */

const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');

require('./jest-conditional-helpers');

const DATABASE_URL = process.env.SCOUT_YEAR_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL;

process.env.JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || 'finance-stale-claims-secret';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_not_called';

const mockContext = { userId: null, organizationId: null };

// The token still claims the finance permissions the role no longer has.
jest.mock('../middleware/auth', () => {
  const actual = jest.requireActual('../middleware/auth');
  return {
    ...actual,
    authenticate: (req, _res, next) => {
      req.user = {
        id: mockContext.userId,
        organizationId: mockContext.organizationId,
        permissions: ['finance.view', 'finance.manage'],
      };
      next();
    },
  };
});

const { ACCESS_SOURCE, grantParticipantAccess } = require('../services/participantAccess');

describe.skipIf(!DATABASE_URL)('Finance access with a stale token', () => {
  let pool;
  let app;
  const ids = {};
  const suffix = Date.now();

  /**
   * Read a single value.
   *
   * @param {string} sql - Query returning one row and one column
   * @param {Array} params - Query parameters
   * @returns {Promise<*>} The value, or undefined
   */
  async function one(sql, params = []) {
    const result = await pool.query(sql, params);
    return result.rows[0] ? Object.values(result.rows[0])[0] : undefined;
  }

  /**
   * A child enrolled in the unit, with one unpaid fee.
   *
   * @param {string} firstName - Name
   * @returns {Promise<{childId: number, feeId: number}>} Child and fee
   */
  async function childWithFee(firstName) {
    const childId = await one(
      "INSERT INTO participants (first_name, last_name, date_naissance) VALUES ($1, 'Test', '2016-01-01') RETURNING id",
      [firstName]
    );
    await pool.query(
      'INSERT INTO participant_enrollments (participant_id, organization_id, scout_year_id) VALUES ($1, $2, $3)',
      [childId, ids.unit, ids.year]
    );
    const feeId = await one(
      `INSERT INTO participant_fees (participant_id, organization_id, fee_definition_id, total_registration_fee, total_membership_fee)
       VALUES ($1, $2, $3, 40, 60) RETURNING id`,
      [childId, ids.unit, ids.feeDefinition]
    );
    return { childId, feeId };
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });

    // The program section and its unit reference each other; the key is
    // checked at commit.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const created = await client.query("INSERT INTO organizations (name) VALUES ('Stale claims unit') RETURNING id");
      ids.unit = created.rows[0].id;
      await client.query(
        `INSERT INTO organization_program_sections (organization_id, section_key, display_name)
         VALUES ($1, 'general', 'General')`,
        [ids.unit]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    ids.year = await one(
      `INSERT INTO scout_years (organization_id, label, start_date, end_date, status)
       VALUES ($1, '2026-2027', '2026-09-01', '2027-08-31', 'active') RETURNING id`,
      [ids.unit]
    );
    ids.feeDefinition = await one(
      `INSERT INTO fee_definitions (organization_id, registration_fee, membership_fee, year_start, year_end)
       VALUES ($1, 40, 60, '2026-09-01', '2027-08-31') RETURNING id`,
      [ids.unit]
    );

    // A role that only sees its own children and holds no finance permission.
    const familyRole = await one(
      `INSERT INTO roles (role_name, display_name, data_scope, is_system_role)
       VALUES ($1, 'Family', 'linked', false) RETURNING id`,
      [`family_stale_${suffix}`]
    );
    ids.parent = await one(
      `INSERT INTO users (email, password, full_name)
       VALUES ('stale-parent-' || gen_random_uuid() || '@example.test', 'x', 'Parent') RETURNING id`
    );
    await pool.query(
      `INSERT INTO user_organizations (user_id, organization_id, role_ids, status)
       VALUES ($1, $2, $3, 'active')`,
      [ids.parent, ids.unit, JSON.stringify([familyRole])]
    );

    ids.own = await childWithFee('Léa');
    ids.other = await childWithFee('Noé');
    await grantParticipantAccess(pool, {
      participantId: ids.own.childId,
      userId: ids.parent,
      sourceType: ACCESS_SOURCE.DIRECT,
    });

    mockContext.userId = ids.parent;
    mockContext.organizationId = ids.unit;

    app = express();
    app.use(express.json());
    app.locals.pool = pool;
    app.use('/api', require('../routes/finance')(pool, console));
    app.use('/api', require('../routes/stripe')(pool, console));
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  test('another family\'s statement is refused', async () => {
    const response = await request(app).get(`/api/v1/finance/participants/${ids.other.childId}/statement`);

    expect(response.status).toBe(403);
  });

  test('their own child\'s statement is still served', async () => {
    const response = await request(app).get(`/api/v1/finance/participants/${ids.own.childId}/statement`);

    expect(response.status).toBe(200);
  });

  test('another family\'s fee cannot be paid', async () => {
    const response = await request(app)
      .post('/api/v1/stripe/create-payment-intent')
      .send({ participant_fee_id: ids.other.feeId, amount: 10 });

    expect(response.status).toBe(404);
  });
});
