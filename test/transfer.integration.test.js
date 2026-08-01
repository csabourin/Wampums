/**
 * Transfer to a sister unit — integration suite
 *
 * A transfer is the only ordinary operation that moves a child's file across a
 * tenant boundary, and the decision it implements (§8.5) is entirely about who
 * comes along: the parents follow, except the one who still has a child in the
 * unit being left, who ends up belonging to both. None of that can be asserted
 * without two real organizations and real membership rows.
 *
 * Skipped unless SCOUT_YEAR_TEST_DATABASE_URL (or TEST_DATABASE_URL) points at a
 * disposable database holding the project schema.
 *
 * @module test/transfer.integration
 */

const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');

const DATABASE_URL = process.env.SCOUT_YEAR_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL;

process.env.JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || 'transfer-integration-secret';

const mockContext = { userId: null, organizationId: null };

jest.mock('../middleware/auth', () => {
  const actual = jest.requireActual('../middleware/auth');
  return {
    ...actual,
    authenticate: (req, _res, next) => {
      req.user = { id: mockContext.userId, roleNames: ['unitadmin'] };
      next();
    },
    requirePermission: () => (_req, _res, next) => next(),
    blockDemoRoles: (_req, _res, next) => next(),
    getOrganizationId: async () => mockContext.organizationId
  };
});

describe.skipIf(!DATABASE_URL)('Transfer to a sister unit', () => {
  let pool;
  let app;
  const ids = {};

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
   * Create an organization and its program section.
   *
   * The two tables reference each other, so both rows go in one transaction and
   * the organization side of the cycle is checked at COMMIT
   * (`fix_organizations_program_section_fk_deferrable.sql`). No trigger is suspended: doing
   * so is what let a genuinely uncreatable organization look creatable.
   *
   * @param {string} name - Organization name
   * @returns {Promise<number>} Organization ID
   */
  async function createOrganization(name) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const created = await client.query(
        'INSERT INTO organizations (name) VALUES ($1) RETURNING id', [name]
      );
      const organizationId = created.rows[0].id;
      await client.query(
        `INSERT INTO organization_program_sections (organization_id, section_key, display_name)
         VALUES ($1, 'general', 'General')`,
        [organizationId]
      );
      await client.query('COMMIT');
      return organizationId;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Two sibling units in one local group, plus an unrelated third.
   *
   * The origin holds a family of two children — one moving, one staying — so
   * the parent who belongs to both ends is exercised, and a second family whose
   * only child moves, so the parent who leaves entirely is too.
   *
   * @returns {Promise<void>}
   */
  async function seed() {
    ids.originId = await createOrganization('Transfer Origin');
    ids.targetId = await createOrganization('Transfer Target');
    ids.strangerId = await createOrganization('Transfer Stranger');
    mockContext.organizationId = ids.originId;

    ids.localGroupId = await one(
      `INSERT INTO local_groups (name, slug)
       VALUES ('Groupe test', 'groupe-test-' || gen_random_uuid()) RETURNING id`
    );
    await pool.query(
      `INSERT INTO organization_local_groups (organization_id, local_group_id)
       VALUES ($1, $3), ($2, $3)`,
      [ids.originId, ids.targetId, ids.localGroupId]
    );

    const makeYear = async (organizationId) => one(
      `INSERT INTO scout_years (organization_id, label, start_date, end_date, status)
       VALUES ($1, '2025-2026', '2025-09-01', '2026-08-31', 'active') RETURNING id`,
      [organizationId]
    );
    ids.originYearId = await makeYear(ids.originId);
    ids.targetYearId = await makeYear(ids.targetId);

    ids.parentRoleId = await one(
      `INSERT INTO roles (role_name, display_name) VALUES ('parent', 'Parent')
       ON CONFLICT (role_name) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`
    );
    ids.animationRoleId = await one(
      `INSERT INTO roles (role_name, display_name) VALUES ('animation', 'Animation')
       ON CONFLICT (role_name) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`
    );

    const makeUser = async (name) => one(
      `INSERT INTO users (email, password, full_name)
       VALUES ($1 || '-' || gen_random_uuid() || '@example.test', 'x', $1) RETURNING id`,
      [name]
    );
    const addMembership = async (userId, organizationId, roleIds) => one(
      `INSERT INTO user_organizations (user_id, organization_id, role_ids, status)
       VALUES ($1, $2, to_jsonb($3::text[]), 'active') RETURNING id`,
      [userId, organizationId, roleIds.map(String)]
    );

    ids.adminUserId = await makeUser('Administratrice');
    mockContext.userId = ids.adminUserId;

    ids.parentTwoKidsId = await makeUser('Parent deux enfants');
    ids.parentTwoKidsMembershipId = await addMembership(
      ids.parentTwoKidsId, ids.originId, [ids.parentRoleId]
    );

    ids.parentOneKidId = await makeUser('Parent un enfant');
    ids.parentOneKidMembershipId = await addMembership(
      ids.parentOneKidId, ids.originId, [ids.parentRoleId]
    );

    ids.parentLeaderId = await makeUser('Parent animatrice');
    ids.parentLeaderMembershipId = await addMembership(
      ids.parentLeaderId, ids.originId, [ids.parentRoleId, ids.animationRoleId]
    );

    const makeChild = async (first, last, userId) => {
      const participantId = await one(
        `INSERT INTO participants (first_name, last_name, date_naissance)
         VALUES ($1, $2, '2016-05-05') RETURNING id`,
        [first, last]
      );
      await pool.query(
        `INSERT INTO participant_enrollments
                (participant_id, organization_id, scout_year_id, inscription_date, status)
         VALUES ($1, $2, $3, '2023-09-05', 'active')`,
        [participantId, ids.originId, ids.originYearId]
      );
      await pool.query(
        'INSERT INTO user_participants (user_id, participant_id) VALUES ($1, $2)',
        [userId, participantId]
      );
      return participantId;
    };

    ids.movingChildId = await makeChild('Mathilde', 'Moreau', ids.parentTwoKidsId);
    ids.stayingChildId = await makeChild('Marc', 'Moreau', ids.parentTwoKidsId);
    ids.onlyChildId = await makeChild('Olivier', 'Ouellet', ids.parentOneKidId);
    ids.leaderChildId = await makeChild('Lea', 'Lemay', ids.parentLeaderId);

    await pool.query(
      `INSERT INTO form_submissions
              (organization_id, participant_id, form_type, submission_data, scout_year_id)
       VALUES ($1, $2, 'fiche_sante', '{"allergie": "noix"}'::jsonb, $3)`,
      [ids.originId, ids.movingChildId, ids.originYearId]
    );
  }

  /**
   * Remove everything the seed created.
   *
   * @returns {Promise<void>}
   */
  async function cleanup() {
    if (!ids.originId) {
      return;
    }
    const orgs = [ids.originId, ids.targetId, ids.strangerId].filter(Boolean);
    const participants = [
      ids.movingChildId, ids.stayingChildId, ids.onlyChildId, ids.leaderChildId
    ].filter(Boolean);
    const users = [
      ids.adminUserId, ids.parentTwoKidsId, ids.parentOneKidId, ids.parentLeaderId
    ].filter(Boolean);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL session_replication_role = 'replica'");
      for (const table of [
        'form_submissions', 'participant_group_assignments', 'participant_enrollments',
        'user_organizations', 'organization_local_groups', 'organization_settings', 'scout_years'
      ]) {
        // Table names come from this literal list, never from a request.
        // eslint-disable-next-line no-await-in-loop
        await client.query(`DELETE FROM ${table} WHERE organization_id = ANY($1::int[])`, [orgs]);
      }
      await client.query('DELETE FROM user_participants WHERE participant_id = ANY($1::int[])', [participants]);
      await client.query('DELETE FROM participants WHERE id = ANY($1::int[])', [participants]);
      await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
      await client.query('DELETE FROM local_groups WHERE id = $1', [ids.localGroupId]);
      await client.query('DELETE FROM organization_program_sections WHERE organization_id = ANY($1::int[])', [orgs]);
      await client.query('DELETE FROM organizations WHERE id = ANY($1::int[])', [orgs]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    ids.originId = null;
  }

  /**
   * Ask for a transfer.
   *
   * @param {number} participantId - Participant to move
   * @param {number} targetOrganizationId - Destination
   * @returns {Promise<Object>} Supertest response
   */
  function transfer(participantId, targetOrganizationId) {
    return request(app).post('/api/v1/transfers').send({
      participant_id: participantId,
      target_organization_id: targetOrganizationId
    });
  }

  /**
   * Read an enrollment row.
   *
   * @param {number} participantId - Participant
   * @param {number} organizationId - Organization
   * @returns {Promise<Object>} Enrollment
   */
  async function enrollment(participantId, organizationId) {
    const result = await pool.query(
      `SELECT status, ended_on, exit_reason, inscription_date,
              transferred_to_organization_id, transferred_at, transferred_by
         FROM participant_enrollments
        WHERE participant_id = $1 AND organization_id = $2`,
      [participantId, organizationId]
    );
    return result.rows[0];
  }

  /**
   * Read a membership's status.
   *
   * @param {string} userId - User
   * @param {number} organizationId - Organization
   * @returns {Promise<Object>} Membership status and reason
   */
  async function membership(userId, organizationId) {
    const result = await pool.query(
      `SELECT status, deactivated_reason FROM user_organizations
        WHERE user_id = $1 AND organization_id = $2`,
      [userId, organizationId]
    );
    return result.rows[0];
  }

  beforeAll(() => {
    pool = new Pool({ connectionString: DATABASE_URL });
    app = express();
    app.use(express.json());
    app.use('/api/v1/transfers', require('../routes/transfers')(pool, { info: () => {} }));
    // eslint-disable-next-line no-unused-vars
    app.use((err, _req, res, _next) => {
      res.status(500).json({ success: false, message: err.message });
    });
  });

  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  beforeEach(async () => {
    await cleanup();
    await seed();
  });

  test('offers only the units of the same local group as destinations', async () => {
    const response = await request(app).get('/api/v1/transfers/destinations');

    expect(response.status).toBe(200);
    expect(response.body.data.map(row => row.id)).toEqual([ids.targetId]);
  });

  test('closes the origin enrollment and opens the destination one, keeping seniority', async () => {
    const response = await transfer(ids.movingChildId, ids.targetId);
    expect(response.status).toBe(200);

    const left = await enrollment(ids.movingChildId, ids.originId);
    expect(left).toMatchObject({
      status: 'transferred',
      exit_reason: 'transfer',
      transferred_to_organization_id: ids.targetId,
      transferred_by: ids.adminUserId
    });
    expect(left.ended_on).not.toBeNull();
    expect(left.transferred_at).not.toBeNull();

    const arrived = await enrollment(ids.movingChildId, ids.targetId);
    expect(arrived.status).toBe('active');
    // The child's seniority is theirs, not the unit's.
    expect(arrived.inscription_date).toEqual(left.inscription_date);
  });

  test('takes the parent along', async () => {
    await transfer(ids.onlyChildId, ids.targetId);

    expect(await membership(ids.parentOneKidId, ids.targetId))
      .toMatchObject({ status: 'active' });
  });

  test('closes the origin membership of a parent with nobody left there', async () => {
    await transfer(ids.onlyChildId, ids.targetId);

    expect(await membership(ids.parentOneKidId, ids.originId))
      .toMatchObject({ status: 'inactive', deactivated_reason: 'transferred' });
  });

  test('gives a parent with children in both units a membership of each', async () => {
    await transfer(ids.movingChildId, ids.targetId);

    // Marc is still enrolled at the origin, so his parent keeps that access as
    // well as gaining the destination's — an addition, not a move.
    expect(await membership(ids.parentTwoKidsId, ids.originId))
      .toMatchObject({ status: 'active' });
    expect(await membership(ids.parentTwoKidsId, ids.targetId))
      .toMatchObject({ status: 'active' });
  });

  test('never closes the origin membership of a parent who is also a leader', async () => {
    await transfer(ids.leaderChildId, ids.targetId);

    expect(await membership(ids.parentLeaderId, ids.originId))
      .toMatchObject({ status: 'active' });
  });

  test('reactivates an existing destination membership instead of duplicating it', async () => {
    await pool.query(
      `INSERT INTO user_organizations (user_id, organization_id, role_ids, status, deactivated_at)
       VALUES ($1, $2, to_jsonb(ARRAY[$3::text]), 'inactive', now())`,
      [ids.parentOneKidId, ids.targetId, String(ids.parentRoleId)]
    );

    const response = await transfer(ids.onlyChildId, ids.targetId);

    expect(response.body.data).toMatchObject({ memberships_created: 0, memberships_reactivated: 1 });
    expect(await one(
      'SELECT COUNT(*)::int FROM user_organizations WHERE user_id = $1 AND organization_id = $2',
      [ids.parentOneKidId, ids.targetId]
    )).toBe(1);
  });

  test('leaves the forms with the unit that collected them, and says how many', async () => {
    const response = await transfer(ids.movingChildId, ids.targetId);

    expect(response.body.data.forms_left_behind).toBe(1);
    expect(await one(
      'SELECT COUNT(*)::int FROM form_submissions WHERE participant_id = $1 AND organization_id = $2',
      [ids.movingChildId, ids.originId]
    )).toBe(1);
    expect(await one(
      'SELECT COUNT(*)::int FROM form_submissions WHERE participant_id = $1 AND organization_id = $2',
      [ids.movingChildId, ids.targetId]
    )).toBe(0);
  });

  test('previews without changing anything', async () => {
    const response = await request(app).post('/api/v1/transfers/preview').send({
      participant_id: ids.movingChildId,
      target_organization_id: ids.targetId
    });

    expect(response.status).toBe(200);
    expect(response.body.data.parents).toEqual([
      expect.objectContaining({ user_id: ids.parentTwoKidsId, keeps_origin_membership: true })
    ]);
    expect(response.body.data.forms_left_behind).toBe(1);

    expect((await enrollment(ids.movingChildId, ids.originId)).status).toBe('active');
    expect(await enrollment(ids.movingChildId, ids.targetId)).toBeUndefined();
  });

  test('refuses a unit outside the local group, and changes nothing', async () => {
    const response = await transfer(ids.movingChildId, ids.strangerId);

    expect(response.status).toBe(403);
    expect((await enrollment(ids.movingChildId, ids.originId)).status).toBe('active');
  });

  test('refuses the current unit as a destination', async () => {
    const response = await transfer(ids.movingChildId, ids.originId);
    expect(response.status).toBe(400);
  });

  test('refuses a participant who is not enrolled this year', async () => {
    await pool.query(
      "UPDATE participant_enrollments SET status = 'left' WHERE participant_id = $1 AND organization_id = $2",
      [ids.movingChildId, ids.originId]
    );

    const response = await transfer(ids.movingChildId, ids.targetId);
    expect(response.status).toBe(404);
  });

  test('refuses a destination whose scout year is not open', async () => {
    await pool.query(
      "UPDATE scout_years SET status = 'closed' WHERE id = $1", [ids.targetYearId]
    );

    const response = await transfer(ids.movingChildId, ids.targetId);

    expect(response.status).toBe(409);
    // The origin enrollment is untouched: the whole thing is one transaction.
    expect((await enrollment(ids.movingChildId, ids.originId)).status).toBe('active');
    expect(await enrollment(ids.movingChildId, ids.targetId)).toBeUndefined();
  });
});
