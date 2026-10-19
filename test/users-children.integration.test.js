/**
 * Members listed with their children — integration suite
 *
 * The district space shows a parent with the names of their children, so two
 * parents with similar names can be told apart. Only the unit's own children
 * are named: a child the same account can see in another unit stays out.
 *
 * Skipped unless TEST_DATABASE_URL points at a disposable database holding the
 * project schema and migrations.
 *
 * @module test/users-children.integration
 */

const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');

require('./jest-conditional-helpers');

const DATABASE_URL = process.env.TEST_DATABASE_URL;

process.env.JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || 'users-children-integration-secret';

const mockContext = { userId: null, organizationId: null };

jest.mock('../middleware/auth', () => {
  const actual = jest.requireActual('../middleware/auth');
  return {
    ...actual,
    authenticate: (req, _res, next) => {
      req.user = { id: mockContext.userId, organizationId: mockContext.organizationId, permissions: [] };
      next();
    },
    requirePermission: () => (_req, _res, next) => next(),
    blockDemoRoles: (_req, _res, next) => next(),
    getOrganizationId: () => Promise.resolve(mockContext.organizationId),
  };
});

const { grantParticipantAccess, ACCESS_SOURCE } = require('../services/participantAccess');

describe.skipIf(!DATABASE_URL)('Members listed with their children', () => {
  let pool;
  let app;
  const ids = { units: [], users: [], participants: [] };

  async function one(sql, params = []) {
    const result = await pool.query(sql, params);
    return result.rows[0] ? Object.values(result.rows[0])[0] : undefined;
  }

  /**
   * A unit with its program section and an active scout year.
   *
   * @param {string} name - Unit name
   * @returns {Promise<number>} Unit id
   */
  async function makeUnit(name) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const created = await client.query('INSERT INTO organizations (name) VALUES ($1) RETURNING id', [name]);
      const unitId = created.rows[0].id;
      await client.query(
        `INSERT INTO organization_program_sections (organization_id, section_key, display_name)
         VALUES ($1, 'general', 'General')`,
        [unitId]
      );
      await client.query('COMMIT');
      ids.units.push(unitId);
      await pool.query(
        `INSERT INTO scout_years (organization_id, label, start_date, end_date, status)
         VALUES ($1, '2026-2027', '2026-09-01', '2027-08-31', 'active')`,
        [unitId]
      );
      return unitId;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * A child enrolled in a unit, visible to an account.
   *
   * @param {string} firstName - Child's first name
   * @param {number} unitId - Unit enrolling the child
   * @param {string} userId - Account that sees the child
   * @returns {Promise<number>} Participant id
   */
  async function makeChild(firstName, unitId, userId) {
    const participantId = await one(
      "INSERT INTO participants (first_name, last_name) VALUES ($1, 'Tremblay') RETURNING id",
      [firstName]
    );
    ids.participants.push(participantId);
    await pool.query(
      'INSERT INTO participant_organizations (participant_id, organization_id) VALUES ($1, $2)',
      [participantId, unitId]
    );
    await grantParticipantAccess(pool, { participantId, userId, sourceType: ACCESS_SOURCE.ADMIN });
    return participantId;
  }

  async function cleanup() {
    if (!pool) {return;}
    await pool.query('DELETE FROM participant_access_grants WHERE participant_id = ANY($1::int[])', [ids.participants]);
    await pool.query('DELETE FROM user_participants WHERE participant_id = ANY($1::int[])', [ids.participants]);
    await pool.query('DELETE FROM participant_organizations WHERE participant_id = ANY($1::int[])', [ids.participants]);
    await pool.query('DELETE FROM participant_enrollments WHERE participant_id = ANY($1::int[])', [ids.participants]);
    await pool.query('DELETE FROM participants WHERE id = ANY($1::int[])', [ids.participants]);
    await pool.query('DELETE FROM user_organizations WHERE organization_id = ANY($1::int[])', [ids.units]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids.users]);
    await pool.query('DELETE FROM scout_years WHERE organization_id = ANY($1::int[])', [ids.units]);
    // The unit and its program section reference each other (a deferred key):
    // they go together, in one transaction.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM organizations WHERE id = ANY($1::int[])', [ids.units]);
      await client.query('DELETE FROM organization_program_sections WHERE organization_id = ANY($1::int[])', [ids.units]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    const quiet = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
    app = express();
    app.use(express.json());
    app.use('/api/v1/users', require('../routes/users')(pool, quiet));

    ids.unit = await makeUnit('Children Listing Unit');
    ids.otherUnit = await makeUnit('Children Listing Other Unit');
    mockContext.organizationId = ids.unit;

    ids.parent = await one(
      "INSERT INTO users (email, password, full_name) VALUES ('kids-' || gen_random_uuid() || '@example.test', 'x', 'Marie') RETURNING id"
    );
    ids.leader = await one(
      "INSERT INTO users (email, password, full_name) VALUES ('nokids-' || gen_random_uuid() || '@example.test', 'x', 'Akela') RETURNING id"
    );
    ids.users.push(ids.parent, ids.leader);
    mockContext.userId = ids.leader;
    for (const userId of [ids.parent, ids.leader]) {
      // eslint-disable-next-line no-await-in-loop
      await pool.query(
        `INSERT INTO user_organizations (user_id, organization_id, role_ids, status)
         VALUES ($1, $2, '[]'::jsonb, 'active')`,
        [userId, ids.unit]
      );
    }

    await makeChild('Léa', ids.unit, ids.parent);
    await makeChild('Zoé', ids.unit, ids.parent);
    await makeChild('Ailleurs', ids.otherUnit, ids.parent);
  });

  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  test('a parent is listed with the unit\'s children linked to their account, and only those', async () => {
    const response = await request(app).get('/api/v1/users');

    expect(response.status).toBe(200);
    const byId = Object.fromEntries(response.body.data.map((user) => [user.id, user]));
    expect(byId[ids.parent].children.map((child) => child.first_name)).toEqual(['Léa', 'Zoé']);
    expect(byId[ids.parent].children[0]).toEqual(expect.objectContaining({ last_name: 'Tremblay', nickname: null }));
  });

  test('a member with no child in the unit has an empty list', async () => {
    const response = await request(app).get('/api/v1/users');

    const leader = response.body.data.find((user) => user.id === ids.leader);
    expect(leader.children).toEqual([]);
  });
});
