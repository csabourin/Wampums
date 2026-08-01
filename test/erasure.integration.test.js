/**
 * Right to erasure — integration suite
 *
 * The one action in this application that genuinely destroys data, so it is
 * tested against a real PostgreSQL: what matters is what is gone afterwards,
 * and a mocked pool cannot answer that. Cascades, the tables with no foreign
 * key behind them, and the accounts that must survive are all exercised here.
 *
 * Skipped unless SCOUT_YEAR_TEST_DATABASE_URL (or TEST_DATABASE_URL) points at a
 * disposable database holding the project schema.
 *
 * @module test/erasure.integration
 */

const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');

const DATABASE_URL = process.env.SCOUT_YEAR_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL;

const mockContext = { userId: null, organizationId: null, permitted: true };

jest.mock('../middleware/auth', () => {
  process.env.JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || 'erasure-integration-secret';
  const actual = jest.requireActual('../middleware/auth');
  actual.getOrganizationId = async () => mockContext.organizationId;
  return {
    authenticate: (req, _res, next) => {
      req.user = { id: mockContext.userId, roleNames: ['unitadmin'] };
      next();
    },
    // The route re-checks the permission against the database through
    // verifyOrganizationMembership, which is left real — that second check is
    // the one that actually keeps animateurs out.
    requirePermission: () => (_req, _res, next) => next(),
    authorize: () => (_req, _res, next) => next(),
    blockDemoRoles: (_req, _res, next) => next(),
    getOrganizationId: async () => mockContext.organizationId,
    getUserDataScope: async () => 'organization',
    getScoutYear: actual.getScoutYear,
    getScoutYearId: actual.getScoutYearId,
    withScoutYear: actual.withScoutYear,
    rosterStatusesFor: actual.rosterStatusesFor
  };
});

describe.skipIf(!DATABASE_URL)('Right to erasure', () => {
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
   * @returns {Promise<number>} Organization ID
   */
  async function createOrganization() {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const created = await client.query(
        "INSERT INTO organizations (name) VALUES ('Erasure Test Unit') RETURNING id"
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
   * Grant a permission to a role, creating both if needed.
   *
   * @param {number} roleId - Role receiving the permission
   * @param {string} permissionKey - Permission to grant
   * @returns {Promise<void>}
   */
  async function grant(roleId, permissionKey) {
    const permissionId = await one(
      `INSERT INTO permissions (permission_key, permission_name, category)
       VALUES ($1, $1, 'participants')
       ON CONFLICT (permission_key) DO UPDATE SET permission_name = EXCLUDED.permission_name
       RETURNING id`,
      [permissionKey]
    );
    await pool.query(
      'INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [roleId, permissionId]
    );
  }

  /**
   * A family of two children sharing one parent, plus a second family whose
   * parent is also a leader.
   *
   * @returns {Promise<void>}
   */
  async function seed() {
    ids.organizationId = await createOrganization();
    mockContext.organizationId = ids.organizationId;

    ids.scoutYearId = await one(
      `INSERT INTO scout_years (organization_id, label, start_date, end_date, status)
       VALUES ($1, '2025-2026', '2025-09-01', '2026-08-31', 'active')
       RETURNING id`,
      [ids.organizationId]
    );

    ids.adminRoleId = await one(
      `INSERT INTO roles (role_name, display_name) VALUES ('unitadmin', 'Unit Admin')
       ON CONFLICT (role_name) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`
    );
    ids.parentRoleId = await one(
      `INSERT INTO roles (role_name, display_name) VALUES ('parent', 'Parent')
       ON CONFLICT (role_name) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`
    );
    ids.animationRoleId = await one(
      `INSERT INTO roles (role_name, display_name) VALUES ('animation', 'Animation')
       ON CONFLICT (role_name) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`
    );
    await grant(ids.adminRoleId, 'participants.erase');

    const makeUser = async (name) => one(
      `INSERT INTO users (email, password, full_name)
       VALUES ($1 || '-' || gen_random_uuid() || '@example.test', 'x', $1) RETURNING id`,
      [name]
    );

    ids.adminUserId = await makeUser('Administratrice');
    mockContext.userId = ids.adminUserId;
    await pool.query(
      `INSERT INTO user_organizations (user_id, organization_id, role_ids, status)
       VALUES ($1, $2, to_jsonb(ARRAY[$3::text]), 'active')`,
      [ids.adminUserId, ids.organizationId, String(ids.adminRoleId)]
    );

    // Family A: one parent, two children. Erasing one child must not touch the
    // parent, because the other child is still enrolled.
    ids.parentAId = await makeUser('Parent A');
    await pool.query(
      `INSERT INTO user_organizations (user_id, organization_id, role_ids, status)
       VALUES ($1, $2, to_jsonb(ARRAY[$3::text]), 'active')`,
      [ids.parentAId, ids.organizationId, String(ids.parentRoleId)]
    );

    // Family B: one parent, one child. Both go.
    ids.parentBId = await makeUser('Parent B');
    await pool.query(
      `INSERT INTO user_organizations (user_id, organization_id, role_ids, status)
       VALUES ($1, $2, to_jsonb(ARRAY[$3::text]), 'active')`,
      [ids.parentBId, ids.organizationId, String(ids.parentRoleId)]
    );

    // Family C: the parent is also a leader, so their account survives.
    ids.parentLeaderId = await makeUser('Parent animatrice');
    await pool.query(
      `INSERT INTO user_organizations (user_id, organization_id, role_ids, status)
       VALUES ($1, $2, to_jsonb(ARRAY[$3::text, $4::text]), 'active')`,
      [ids.parentLeaderId, ids.organizationId,
        String(ids.parentRoleId), String(ids.animationRoleId)]
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
         VALUES ($1, $2, $3, '2025-09-05', 'active')`,
        [participantId, ids.organizationId, ids.scoutYearId]
      );
      await pool.query(
        'INSERT INTO user_participants (user_id, participant_id) VALUES ($1, $2)',
        [userId, participantId]
      );
      const guardianId = await one(
        `INSERT INTO parents_guardians (nom, prenom, courriel)
         VALUES ($1, $2, 'g-' || gen_random_uuid() || '@example.test') RETURNING id`,
        [last, first]
      );
      await pool.query(
        'INSERT INTO participant_guardians (guardian_id, participant_id) VALUES ($1, $2)',
        [guardianId, participantId]
      );
      await pool.query(
        'INSERT INTO guardian_users (guardian_id, user_id) VALUES ($1, $2)',
        [guardianId, userId]
      );
      return { participantId, guardianId };
    };

    ({ participantId: ids.childA1, guardianId: ids.guardianA1 } =
      await makeChild('Alice', 'Aubert', ids.parentAId));
    ({ participantId: ids.childA2, guardianId: ids.guardianA2 } =
      await makeChild('Antoine', 'Aubert', ids.parentAId));
    ({ participantId: ids.childB, guardianId: ids.guardianB } =
      await makeChild('Bruno', 'Bergeron', ids.parentBId));
    ({ participantId: ids.childC, guardianId: ids.guardianC } =
      await makeChild('Camille', 'Caron', ids.parentLeaderId));

    // Trails of every kind attached to Bruno.
    await pool.query(
      `INSERT INTO points (participant_id, value, organization_id, scout_year_id)
       VALUES ($1, 30, $2, $3)`,
      [ids.childB, ids.organizationId, ids.scoutYearId]
    );
    await pool.query(
      `INSERT INTO attendance (participant_id, date, status, organization_id)
       VALUES ($1, '2025-11-02', 'present', $2)`,
      [ids.childB, ids.organizationId]
    );
    await pool.query(
      `INSERT INTO honors (participant_id, date, organization_id)
       VALUES ($1, '2025-11-02', $2)`,
      [ids.childB, ids.organizationId]
    );
    await pool.query(
      `INSERT INTO form_submissions
              (organization_id, participant_id, form_type, submission_data, scout_year_id)
       VALUES ($1, $2, 'fiche_sante', '{"allergie": "noix"}'::jsonb, $3)`,
      [ids.organizationId, ids.childB, ids.scoutYearId]
    );
    ids.groupId = await one(
      "INSERT INTO groups (name, organization_id) VALUES ('Rouge', $1) RETURNING id",
      [ids.organizationId]
    );
    await pool.query(
      `INSERT INTO participant_group_assignments
              (participant_id, group_id, organization_id, scout_year_id)
       VALUES ($1, $2, $3, $4)`,
      [ids.childB, ids.groupId, ids.organizationId, ids.scoutYearId]
    );

    // The money trail, which refuses to cascade on its own.
    ids.feeDefinitionId = await one(
      `INSERT INTO fee_definitions
              (organization_id, registration_fee, membership_fee, year_start, year_end)
       VALUES ($1, 50, 25, '2025-09-01', '2026-08-31') RETURNING id`,
      [ids.organizationId]
    );
    ids.feeId = await one(
      `INSERT INTO participant_fees
              (participant_id, organization_id, fee_definition_id,
               total_registration_fee, total_membership_fee)
       VALUES ($1, $2, $3, 50, 25) RETURNING id`,
      [ids.childB, ids.organizationId, ids.feeDefinitionId]
    );
    await pool.query(
      `INSERT INTO payments (participant_fee_id, amount, payment_date)
       VALUES ($1, 75, CURRENT_DATE)`,
      [ids.feeId]
    );

    // A badge, whose table carries participant_id with no foreign key behind it.
    ids.badgeTemplateId = await one(
      `INSERT INTO badge_templates (name, template_key, organization_id)
       VALUES ('Cuisinier', 'cuisinier-' || gen_random_uuid(), $1) RETURNING id`,
      [ids.organizationId]
    );
    await pool.query(
      `INSERT INTO badge_progress
              (participant_id, organization_id, badge_template_id, status,
               territoire_chasse, section)
       VALUES ($1, $2, $3, 'approved', 'test', 'louveteaux')`,
      [ids.childB, ids.organizationId, ids.badgeTemplateId]
    );
  }

  /**
   * Remove everything the seed created.
   *
   * @returns {Promise<void>}
   */
  async function cleanup() {
    if (!ids.organizationId) {
      return;
    }
    const org = ids.organizationId;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL session_replication_role = 'replica'");
      // Payments and plans hang off a fee rather than an organization.
      await client.query(
        `DELETE FROM payments WHERE participant_fee_id IN
           (SELECT id FROM participant_fees WHERE organization_id = $1)`, [org]);
      await client.query(
        `DELETE FROM payment_plans WHERE participant_fee_id IN
           (SELECT id FROM participant_fees WHERE organization_id = $1)`, [org]);

      for (const table of [
        'erasure_log', 'participant_fees', 'fee_definitions',
        'badge_progress', 'badge_templates', 'form_submissions', 'points', 'attendance',
        'honors', 'participant_group_assignments', 'groups', 'participant_enrollments',
        'user_organizations', 'organization_settings', 'scout_years'
      ]) {
        // Table names come from this literal list, never from a request.
        // eslint-disable-next-line no-await-in-loop
        await client.query(`DELETE FROM ${table} WHERE organization_id = $1`, [org]);
      }
      await client.query('DELETE FROM guardian_users WHERE user_id = ANY($1::uuid[])',
        [[ids.parentAId, ids.parentBId, ids.parentLeaderId].filter(Boolean)]);
      await client.query('DELETE FROM participant_guardians WHERE participant_id = ANY($1::int[])',
        [[ids.childA1, ids.childA2, ids.childB, ids.childC].filter(Boolean)]);
      await client.query('DELETE FROM parents_guardians WHERE id = ANY($1::int[])',
        [[ids.guardianA1, ids.guardianA2, ids.guardianB, ids.guardianC].filter(Boolean)]);
      await client.query('DELETE FROM user_participants WHERE participant_id = ANY($1::int[])',
        [[ids.childA1, ids.childA2, ids.childB, ids.childC].filter(Boolean)]);
      await client.query('DELETE FROM participants WHERE id = ANY($1::int[])',
        [[ids.childA1, ids.childA2, ids.childB, ids.childC].filter(Boolean)]);
      await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])',
        [[ids.adminUserId, ids.parentAId, ids.parentBId, ids.parentLeaderId].filter(Boolean)]);
      await client.query('DELETE FROM organization_program_sections WHERE organization_id = $1', [org]);
      await client.query('DELETE FROM organizations WHERE id = $1', [org]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    ids.organizationId = null;
  }

  /**
   * Ask for a participant to be erased.
   *
   * @param {number} participantId - Participant to erase
   * @param {string} confirmation - Full name typed as confirmation
   * @returns {Promise<Object>} Supertest response
   */
  function erase(participantId, confirmation) {
    return request(app)
      .delete(`/api/v1/participants/${participantId}/erasure`)
      .send({ confirm_full_name: confirmation });
  }

  beforeAll(() => {
    pool = new Pool({ connectionString: DATABASE_URL });
    app = express();
    app.use(express.json());
    app.use('/api/v1/participants', require('../routes/participants')(pool, { info: () => {} }));
    // Surface the real error instead of an opaque 500: a failing erasure has to
    // say why, both here and in production.
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

  test('erases the child, every trail, and the parent left with nobody', async () => {
    const response = await erase(ids.childB, 'Bruno Bergeron');
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      participants_erased: 1,
      guardians_erased: 1,
      users_erased: 1,
      users_retained: []
    });

    // The participant and everything that cascades.
    expect(await one('SELECT COUNT(*)::int FROM participants WHERE id = $1', [ids.childB])).toBe(0);
    for (const table of ['points', 'attendance', 'honors', 'form_submissions',
      'participant_group_assignments', 'participant_enrollments', 'user_participants',
      'participant_guardians']) {
      expect(await one(
        `SELECT COUNT(*)::int FROM ${table} WHERE participant_id = $1`, [ids.childB]
      )).toBe(0);
    }

    // The money trail, which no cascade would have removed.
    expect(await one(
      'SELECT COUNT(*)::int FROM participant_fees WHERE participant_id = $1', [ids.childB]
    )).toBe(0);
    expect(await one(
      'SELECT COUNT(*)::int FROM payments WHERE participant_fee_id = $1', [ids.feeId]
    )).toBe(0);

    // And the badge, whose table has no foreign key behind participant_id: a
    // cascade would have left it orphaned rather than erased.
    expect(await one(
      'SELECT COUNT(*)::int FROM badge_progress WHERE participant_id = $1', [ids.childB]
    )).toBe(0);

    // The guardian and the parent account are gone.
    expect(await one(
      'SELECT COUNT(*)::int FROM parents_guardians WHERE id = $1', [ids.guardianB]
    )).toBe(0);
    expect(await one('SELECT COUNT(*)::int FROM users WHERE id = $1', [ids.parentBId])).toBe(0);
  });

  test('keeps a parent who still has another child enrolled', async () => {
    const response = await erase(ids.childA1, 'Alice Aubert');
    expect(response.status).toBe(200);
    expect(response.body.data.users_erased).toBe(0);
    expect(response.body.data.users_retained).toEqual(['has_other_child']);

    expect(await one('SELECT COUNT(*)::int FROM participants WHERE id = $1', [ids.childA1])).toBe(0);
    // Antoine and the parent are untouched: only Alice was asked for.
    expect(await one('SELECT COUNT(*)::int FROM participants WHERE id = $1', [ids.childA2])).toBe(1);
    expect(await one('SELECT COUNT(*)::int FROM users WHERE id = $1', [ids.parentAId])).toBe(1);
    expect(await one(
      'SELECT COUNT(*)::int FROM user_participants WHERE user_id = $1', [ids.parentAId]
    )).toBe(1);
  });

  test('keeps a parent who is also a leader, and says so', async () => {
    const response = await erase(ids.childC, 'Camille Caron');
    expect(response.status).toBe(200);
    expect(response.body.data.users_retained).toEqual(['holds_staff_role']);

    // Deleting it would tear out the unit's own records, which are not the
    // family's to erase.
    expect(await one('SELECT COUNT(*)::int FROM users WHERE id = $1', [ids.parentLeaderId])).toBe(1);
    expect(await one('SELECT COUNT(*)::int FROM participants WHERE id = $1', [ids.childC])).toBe(0);
  });

  test('refuses without the exact name, and changes nothing', async () => {
    const wrong = await erase(ids.childB, 'Bruno');
    expect(wrong.status).toBe(400);
    expect(wrong.body.message).toMatch(/confirmation/i);

    const missing = await erase(ids.childB, '');
    expect(missing.status).toBe(400);

    expect(await one('SELECT COUNT(*)::int FROM participants WHERE id = $1', [ids.childB])).toBe(1);
  });

  test('accepts the name whatever the casing', async () => {
    const response = await erase(ids.childB, '  bruno BERGERON ');
    expect(response.status).toBe(200);
  });

  test('refuses an animateur, who does not hold the permission', async () => {
    // The route re-checks against the database, so demoting the account here is
    // enough to exercise the real gate.
    await pool.query(
      'UPDATE user_organizations SET role_ids = to_jsonb(ARRAY[$3::text]) WHERE user_id = $1 AND organization_id = $2',
      [ids.adminUserId, ids.organizationId, String(ids.animationRoleId)]
    );

    const response = await erase(ids.childB, 'Bruno Bergeron');
    expect(response.status).toBe(403);
    expect(await one('SELECT COUNT(*)::int FROM participants WHERE id = $1', [ids.childB])).toBe(1);
  });

  test('refuses a participant from another unit', async () => {
    const otherOrg = await createOrganization();
    const otherYear = await one(
      `INSERT INTO scout_years (organization_id, label, start_date, end_date, status)
       VALUES ($1, '2025-2026', '2025-09-01', '2026-08-31', 'active') RETURNING id`,
      [otherOrg]
    );
    const stranger = await one(
      `INSERT INTO participants (first_name, last_name) VALUES ('Étranger', 'Ailleurs') RETURNING id`
    );
    await pool.query(
      `INSERT INTO participant_enrollments
              (participant_id, organization_id, scout_year_id, inscription_date, status)
       VALUES ($1, $2, $3, CURRENT_DATE, 'active')`,
      [stranger, otherOrg, otherYear]
    );

    const response = await erase(stranger, 'Étranger Ailleurs');
    expect(response.status).toBe(404);
    expect(await one('SELECT COUNT(*)::int FROM participants WHERE id = $1', [stranger])).toBe(1);

    await pool.query('DELETE FROM participant_enrollments WHERE participant_id = $1', [stranger]);
    await pool.query('DELETE FROM participants WHERE id = $1', [stranger]);
    await pool.query('DELETE FROM scout_years WHERE id = $1', [otherYear]);
    const client = await pool.connect();
    await client.query('BEGIN');
    await client.query("SET LOCAL session_replication_role = 'replica'");
    await client.query('DELETE FROM organization_program_sections WHERE organization_id = $1', [otherOrg]);
    await client.query('DELETE FROM organizations WHERE id = $1', [otherOrg]);
    await client.query('COMMIT');
    client.release();
  });

  test('records each owning unit approval and erases after the final approval', async () => {
    // `participants` is a global row, so deleting it would cascade through the
    // other unit's enrollments, attendance and forms — records the requesting
    // unit has no standing to destroy.
    const otherOrg = await createOrganization();
    const otherYear = await one(
      `INSERT INTO scout_years (organization_id, label, start_date, end_date, status)
       VALUES ($1, '2025-2026', '2025-09-01', '2026-08-31', 'active') RETURNING id`,
      [otherOrg]
    );
    await pool.query(
      `INSERT INTO participant_enrollments
              (participant_id, organization_id, scout_year_id, inscription_date, status)
       VALUES ($1, $2, $3, CURRENT_DATE, 'transferred')`,
      [ids.childB, otherOrg, otherYear]
    );

    const response = await erase(ids.childB, 'Bruno Bergeron');
    expect(response.status).toBe(409);
    expect(response.body.errors).toEqual([
      expect.objectContaining({ organization_id: otherOrg })
    ]);

    // Nothing was touched, in either unit.
    expect(await one('SELECT COUNT(*)::int FROM participants WHERE id = $1', [ids.childB])).toBe(1);
    expect(await one(
      'SELECT COUNT(*)::int FROM participant_enrollments WHERE participant_id = $1', [ids.childB]
    )).toBe(2);
    expect(await one('SELECT COUNT(*)::int FROM erasure_log WHERE organization_id = $1',
      [ids.organizationId])).toBe(0);

    expect(await one(
      `SELECT COUNT(*)::int FROM participant_erasure_approvals
        WHERE participant_id = $1 AND organization_id = $2`,
      [ids.childB, ids.organizationId]
    )).toBe(1);

    // The route can approve only the organization in its authenticated
    // context; it cannot approve on another unit's behalf.
    await pool.query(
      `INSERT INTO user_organizations (user_id, organization_id, role_ids, status)
       SELECT user_id, $2, role_ids, 'active'
         FROM user_organizations
        WHERE user_id = $1 AND organization_id = $3`,
      [ids.adminUserId, otherOrg, ids.organizationId]
    );
    mockContext.organizationId = otherOrg;

    const finalApproval = await erase(ids.childB, 'Bruno Bergeron');
    expect(finalApproval.status).toBe(200);
    expect(await one('SELECT COUNT(*)::int FROM participants WHERE id = $1', [ids.childB])).toBe(0);
    expect(await one(
      'SELECT COUNT(*)::int FROM participant_erasure_approvals WHERE participant_id = $1',
      [ids.childB]
    )).toBe(0);

    mockContext.organizationId = ids.organizationId;

    await pool.query('DELETE FROM erasure_log WHERE organization_id = $1', [otherOrg]);
    await pool.query('DELETE FROM user_organizations WHERE organization_id = $1', [otherOrg]);
    await pool.query('DELETE FROM scout_years WHERE id = $1', [otherYear]);
    const client = await pool.connect();
    await client.query('BEGIN');
    await client.query("SET LOCAL session_replication_role = 'replica'");
    await client.query('DELETE FROM organization_program_sections WHERE organization_id = $1', [otherOrg]);
    await client.query('DELETE FROM organizations WHERE id = $1', [otherOrg]);
    await client.query('COMMIT');
    client.release();
  });

  test('leaves a ledger entry with counts and no personal data', async () => {
    await erase(ids.childB, 'Bruno Bergeron');

    const entry = await pool.query(
      'SELECT * FROM erasure_log WHERE organization_id = $1', [ids.organizationId]
    );
    expect(entry.rows).toHaveLength(1);
    expect(entry.rows[0]).toMatchObject({
      participants_erased: 1,
      guardians_erased: 1,
      users_erased: 1,
      users_retained: 0,
      performed_by: ids.adminUserId
    });

    // Nothing in the row may identify the person it was written about.
    const serialised = JSON.stringify(entry.rows[0]).toLowerCase();
    expect(serialised).not.toContain('bruno');
    expect(serialised).not.toContain('bergeron');
    expect(Object.keys(entry.rows[0])).not.toContain('participant_id');
  });

  test('a participant erased in one unit is gone from the roster of every year', async () => {
    // The row is destroyed, not hidden: consulting an archived year must not
    // bring the family back.
    const previousYear = await one(
      `INSERT INTO scout_years (organization_id, label, start_date, end_date, status)
       VALUES ($1, '2024-2025', '2024-09-01', '2025-08-31', 'closed') RETURNING id`,
      [ids.organizationId]
    );
    await pool.query(
      `INSERT INTO participant_enrollments
              (participant_id, organization_id, scout_year_id, inscription_date, status)
       VALUES ($1, $2, $3, '2024-09-05', 'graduated')`,
      [ids.childB, ids.organizationId, previousYear]
    );

    await erase(ids.childB, 'Bruno Bergeron');

    expect(await one(
      'SELECT COUNT(*)::int FROM participant_enrollments WHERE participant_id = $1', [ids.childB]
    )).toBe(0);
  });
});
