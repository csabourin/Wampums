/**
 * Scout Year Rollback — integration suite
 *
 * Runs the transition and its rollback against a real PostgreSQL, because the
 * whole point of the feature is what the database ends up containing: an
 * assertion against a mocked pool would prove nothing about whether the replay
 * is actually exact.
 *
 * Skipped unless SCOUT_YEAR_TEST_DATABASE_URL (or TEST_DATABASE_URL) points at a
 * disposable database holding the project schema.
 *
 * @module test/scout-year-rollback.integration
 */

const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');

const DATABASE_URL = process.env.SCOUT_YEAR_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL;

const mockContext = { userId: null, organizationId: null };

jest.mock('../middleware/auth', () => {
  // The real module refuses to load without one, and it is loaded below.
  process.env.JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || 'scout-year-integration-secret';
  const actual = jest.requireActual('../middleware/auth');
  // `getScoutYear` looks its organization up through the module's own export, so
  // replacing it here is what lets the real year resolution run against the
  // stubbed organization instead of a JWT.
  actual.getOrganizationId = async () => mockContext.organizationId;
  return {
    authenticate: (req, _res, next) => {
      req.user = { id: mockContext.userId, roleNames: ['animation'] };
      next();
    },
    requirePermission: () => (_req, _res, next) => next(),
    authorize: () => (_req, _res, next) => next(),
    blockDemoRoles: (_req, _res, next) => next(),
    getOrganizationId: async () => mockContext.organizationId,
    getUserDataScope: async () => 'organization',
    // The year resolution itself is under test, so it stays real — only the
    // organization it reads is stubbed above.
    getScoutYear: actual.getScoutYear,
    getScoutYearId: actual.getScoutYearId,
    withScoutYear: actual.withScoutYear
  };
});

const logger = { info: () => {}, warn: () => {}, error: () => {} };

describe.skipIf(!DATABASE_URL)('Scout year rollback', () => {
  let pool;
  let app;
  const ids = {};

  /**
   * Read a single value from the database.
   *
   * @param {string} sql - Query returning one row and one column
   * @param {Array} params - Query parameters
   * @returns {Promise<*>} The value, or undefined when no row matched
   */
  async function one(sql, params = []) {
    const result = await pool.query(sql, params);
    return result.rows[0] ? Object.values(result.rows[0])[0] : undefined;
  }

  /**
   * Create an organization and its program section.
   *
   * `organizations.(id, program_section)` and
   * `organization_program_sections.organization_id` reference each other, so
   * neither row can be inserted first. Foreign key triggers are suspended for
   * the pair — a superuser-only trick, acceptable because this suite only ever
   * runs against a disposable database.
   *
   * @returns {Promise<number>} Organization ID
   */
  async function createOrganization() {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL session_replication_role = 'replica'");
      const created = await client.query(
        "INSERT INTO organizations (name) VALUES ('Rollback Test Unit') RETURNING id"
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
   * Delete an organization and its program section, same circularity.
   *
   * @param {number} organizationId - Organization ID
   * @returns {Promise<void>}
   */
  async function deleteOrganization(organizationId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL session_replication_role = 'replica'");
      await client.query(
        'DELETE FROM organization_program_sections WHERE organization_id = $1',
        [organizationId]
      );
      await client.query('DELETE FROM organizations WHERE id = $1', [organizationId]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Seed a unit with a roster, a parent, a required form and an authorization.
   *
   * Recreated before every test so each one starts from the same known state.
   *
   * @returns {Promise<void>}
   */
  async function seed() {
    ids.organizationId = await createOrganization();
    await pool.query(
      `INSERT INTO organization_settings (organization_id, setting_key, setting_value)
       VALUES ($1, 'fiscal_year', '{"start_month": 9, "start_day": 1}'::jsonb)`,
      [ids.organizationId]
    );

    ids.parentRoleId = await one(
      `INSERT INTO roles (role_name, display_name) VALUES ('parent', 'Parent')
       ON CONFLICT (role_name) DO UPDATE SET display_name = EXCLUDED.display_name
       RETURNING id`
    );

    ids.leaderUserId = await one(
      `INSERT INTO users (email, password, full_name)
       VALUES ('leader-' || gen_random_uuid() || '@example.test', 'x', 'Animatrice')
       RETURNING id`
    );
    ids.parentUserId = await one(
      `INSERT INTO users (email, password, full_name)
       VALUES ('parent-' || gen_random_uuid() || '@example.test', 'x', 'Parent de Béatrice')
       RETURNING id`
    );
    ids.parentMembershipId = await one(
      `INSERT INTO user_organizations (user_id, organization_id, role_ids, status)
       VALUES ($1, $2, to_jsonb(ARRAY[$3::text]), 'active')
       RETURNING id`,
      [ids.parentUserId, ids.organizationId, String(ids.parentRoleId)]
    );

    // The leader's own membership and permissions are real, not stubbed: the
    // handlers check them through verifyOrganizationMembership, and a test that
    // mocked that away would stop proving the endpoints are reachable at all.
    ids.leaderRoleId = await one(
      `INSERT INTO roles (role_name, display_name) VALUES ('animation', 'Animation')
       ON CONFLICT (role_name) DO UPDATE SET display_name = EXCLUDED.display_name
       RETURNING id`
    );
    for (const permissionKey of ['participants.view', 'participants.edit', 'participants.delete']) {
      const permissionId = await one(
        `INSERT INTO permissions (permission_key, permission_name, category)
         VALUES ($1, $1, 'participants')
         ON CONFLICT (permission_key) DO UPDATE SET permission_name = EXCLUDED.permission_name
         RETURNING id`,
        [permissionKey]
      );
      await pool.query(
        `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [ids.leaderRoleId, permissionId]
      );
    }
    await pool.query(
      `INSERT INTO user_organizations (user_id, organization_id, role_ids, status)
       VALUES ($1, $2, to_jsonb(ARRAY[$3::text]), 'active')`,
      [ids.leaderUserId, ids.organizationId, String(ids.leaderRoleId)]
    );

    // The year in progress. Today falls inside it, and its nominal end is still
    // months away — so the transition below is an "early" one and has to clamp
    // the boundaries, which is exactly what the rollback must undo.
    ids.currentYearId = await one(
      `INSERT INTO scout_years (organization_id, label, start_date, end_date, status)
       VALUES ($1, '2025-2026', '2025-09-01', '2026-08-31', 'active')
       RETURNING id`,
      [ids.organizationId]
    );

    const makeParticipant = async (first, last, birthDate) => one(
      `INSERT INTO participants (first_name, last_name, date_naissance)
       VALUES ($1, $2, $3::date) RETURNING id`,
      [first, last, birthDate]
    );

    // Amélie stays, Béatrice reaches the age limit, Chloé stays.
    ids.stayingId = await makeParticipant('Amélie', 'Tremblay', '2017-04-02');
    ids.leavingId = await makeParticipant('Béatrice', 'Roy', '2014-02-11');
    ids.otherStayingId = await makeParticipant('Chloé', 'Gagnon', '2018-10-20');

    for (const participantId of [ids.stayingId, ids.leavingId, ids.otherStayingId]) {
      await pool.query(
        `INSERT INTO participant_enrollments
                (participant_id, organization_id, scout_year_id, inscription_date, status)
         VALUES ($1, $2, $3, '2025-09-05', 'active')`,
        [participantId, ids.organizationId, ids.currentYearId]
      );
    }

    await pool.query(
      'INSERT INTO user_participants (user_id, participant_id) VALUES ($1, $2)',
      [ids.parentUserId, ids.leavingId]
    );

    // Points, attendance and honors recorded during the year about to close.
    await pool.query(
      `INSERT INTO points (participant_id, value, organization_id, scout_year_id, created_at)
       VALUES ($1, 25, $2, $3, '2025-11-02')`,
      [ids.stayingId, ids.organizationId, ids.currentYearId]
    );
    await pool.query(
      `INSERT INTO attendance (participant_id, date, status, organization_id)
       VALUES ($1, '2025-11-02', 'present', $3),
              ($2, '2025-11-02', 'present', $3)`,
      [ids.stayingId, ids.leavingId, ids.organizationId]
    );
    await pool.query(
      `INSERT INTO honors (participant_id, date, organization_id)
       VALUES ($1, '2025-11-02', $2)`,
      [ids.leavingId, ids.organizationId]
    );

    // Dens: Béatrice leads the Reds, Amélie is in it too.
    ids.groupId = await one(
      `INSERT INTO groups (name, organization_id) VALUES ('Rouge', $1) RETURNING id`,
      [ids.organizationId]
    );
    await pool.query(
      `INSERT INTO participant_group_assignments
              (participant_id, group_id, organization_id, scout_year_id, first_leader)
       VALUES ($1, $3, $4, $5, FALSE), ($2, $3, $4, $5, TRUE)`,
      [ids.stayingId, ids.leavingId, ids.groupId, ids.organizationId, ids.currentYearId]
    );

    await pool.query(
      `INSERT INTO organization_form_formats (organization_id, form_type, form_structure, is_required)
       VALUES ($1, 'fiche_sante', '{}'::jsonb, TRUE),
              ($1, 'sortie_ponctuelle', '{}'::jsonb, FALSE)`,
      [ids.organizationId]
    );
    ids.requiredFormId = await one(
      `INSERT INTO form_submissions
              (organization_id, participant_id, form_type, submission_data, scout_year_id, review_state)
       VALUES ($1, $2, 'fiche_sante', '{"allergies": "arachides"}'::jsonb, $3, 'current')
       RETURNING id`,
      [ids.organizationId, ids.stayingId, ids.currentYearId]
    );
    ids.optionalFormId = await one(
      `INSERT INTO form_submissions
              (organization_id, participant_id, form_type, submission_data, scout_year_id, review_state)
       VALUES ($1, $2, 'sortie_ponctuelle', '{}'::jsonb, $3, 'current')
       RETURNING id`,
      [ids.organizationId, ids.stayingId, ids.currentYearId]
    );

    ids.guardianId = await one(
      `INSERT INTO parents_guardians (nom, prenom, courriel)
       VALUES ($1, $2, $3) RETURNING id`,
      ['Roy', 'Parent de Béatrice', 'guardian@example.test']
    );
    ids.authorizationId = await one(
      `INSERT INTO medication_treatment_authorizations
              (organization_id, participant_id, guardian_id, status, scout_year_id)
       VALUES ($1, $2, $3, 'signed', $4)
       RETURNING id`,
      [ids.organizationId, ids.stayingId, ids.guardianId, ids.currentYearId]
    );

    mockContext.organizationId = ids.organizationId;
    mockContext.userId = ids.leaderUserId;
  }

  /**
   * Remove everything the seed created, newest dependency first.
   *
   * @returns {Promise<void>}
   */
  async function cleanup() {
    if (!ids.organizationId) {
      return;
    }
    const org = ids.organizationId;
    await pool.query('DELETE FROM scout_year_transitions WHERE organization_id = $1', [org]);
    await pool.query('DELETE FROM medication_treatment_authorizations WHERE organization_id = $1', [org]);
    await pool.query('DELETE FROM medication_admin_authorizations WHERE organization_id = $1', [org]);
    await pool.query('DELETE FROM form_submissions WHERE organization_id = $1', [org]);
    await pool.query('DELETE FROM organization_form_formats WHERE organization_id = $1', [org]);
    await pool.query('DELETE FROM points WHERE organization_id = $1', [org]);
    await pool.query('DELETE FROM attendance WHERE organization_id = $1', [org]);
    await pool.query('DELETE FROM honors WHERE organization_id = $1', [org]);
    await pool.query('DELETE FROM participant_group_assignments WHERE organization_id = $1', [org]);
    await pool.query('DELETE FROM groups WHERE organization_id = $1', [org]);
    await pool.query('DELETE FROM participant_enrollments WHERE organization_id = $1', [org]);
    await pool.query(
      'DELETE FROM user_participants WHERE participant_id = ANY($1::int[])',
      [[ids.stayingId, ids.leavingId, ids.otherStayingId].filter(Boolean)]
    );
    await pool.query('DELETE FROM participant_guardians WHERE guardian_id = $1', [ids.guardianId]);
    await pool.query('DELETE FROM parents_guardians WHERE id = $1', [ids.guardianId]);
    await pool.query(
      'DELETE FROM participants WHERE id = ANY($1::int[])',
      [[ids.stayingId, ids.leavingId, ids.otherStayingId].filter(Boolean)]
    );
    await pool.query('DELETE FROM user_organizations WHERE organization_id = $1', [org]);
    await pool.query('DELETE FROM organization_settings WHERE organization_id = $1', [org]);
    // Years reference the user who closed them, so they have to go first.
    await pool.query('DELETE FROM scout_years WHERE organization_id = $1', [org]);
    await pool.query(
      'DELETE FROM users WHERE id = ANY($1::uuid[])',
      [[ids.leaderUserId, ids.parentUserId].filter(Boolean)]
    );
    await deleteOrganization(org);
    ids.organizationId = null;
  }

  /**
   * Run the transition that graduates Béatrice and deactivates her parent.
   *
   * @returns {Promise<Object>} Supertest response
   */
  async function runTransition() {
    return request(app)
      .post('/api/v1/scout-years/transition')
      .send({
        graduating_participant_ids: [ids.leavingId],
        deactivate_membership_ids: [ids.parentMembershipId],
        exceptions: []
      });
  }

  beforeAll(() => {
    pool = new Pool({ connectionString: DATABASE_URL });
    app = express();
    app.use(express.json());
    app.use('/api/v1/scout-years', require('../routes/scoutYears')(pool, logger));
    app.use('/api/v1/participants', require('../routes/participants')(pool, logger));
    app.use('/api/v1/attendance', require('../routes/attendance')(pool, logger));
    app.use('/api/v1/reports', require('../routes/reports')(pool, logger));
    app.use('/api', require('../routes/honors')(pool, logger));
  });

  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  beforeEach(async () => {
    await cleanup();
    await seed();
  });

  test('a transition is undone completely while the new year is still empty', async () => {
    const transitionResponse = await runTransition();
    expect(transitionResponse.status).toBe(201);

    const transitionId = transitionResponse.body.data.transition_id;
    const newYearId = transitionResponse.body.data.new_year.id;

    // The transition did what it says before we undo it.
    expect(await one(
      "SELECT status FROM participant_enrollments WHERE participant_id = $1 AND scout_year_id = $2",
      [ids.leavingId, ids.currentYearId]
    )).toBe('graduated');
    expect(await one(
      'SELECT COUNT(*)::int FROM participant_enrollments WHERE scout_year_id = $1',
      [newYearId]
    )).toBe(2);
    expect(await one(
      'SELECT status FROM user_organizations WHERE id = $1', [ids.parentMembershipId]
    )).toBe('inactive');
    expect(await one(
      'SELECT review_state FROM form_submissions WHERE id = $1', [ids.requiredFormId]
    )).toBe('needs_review');
    expect(await one(
      'SELECT review_state FROM form_submissions WHERE id = $1', [ids.optionalFormId]
    )).toBe('current');
    expect(await one(
      'SELECT status FROM medication_treatment_authorizations WHERE id = $1', [ids.authorizationId]
    )).toBe('expired');

    // The offer to undo is there.
    const listed = await request(app).get('/api/v1/scout-years/transitions');
    expect(listed.status).toBe(200);
    expect(listed.body.data[0].rollback_blockers).toEqual([]);
    expect(listed.body.data[0]).toMatchObject({ id: transitionId, can_rollback: true });

    const rollback = await request(app)
      .post(`/api/v1/scout-years/transitions/${transitionId}/rollback`);
    expect(rollback.status).toBe(200);
    expect(rollback.body.data.summary).toMatchObject({
      enrollments_removed: 2,
      enrollments_reopened: 1,
      memberships_reactivated: 1,
      forms_unflagged: 1,
      medication_authorizations_restored: 1
    });

    // Everything is back where it was.
    expect(await one(
      'SELECT status FROM scout_years WHERE id = $1', [ids.currentYearId]
    )).toBe('active');
    expect(await one(
      'SELECT end_date::text FROM scout_years WHERE id = $1', [ids.currentYearId]
    )).toBe('2026-08-31');
    expect(await one(
      'SELECT closed_at FROM scout_years WHERE id = $1', [ids.currentYearId]
    )).toBeNull();
    expect(await one(
      'SELECT status FROM scout_years WHERE id = $1', [newYearId]
    )).toBe('planning');
    expect(await one(
      'SELECT start_date::text FROM scout_years WHERE id = $1', [newYearId]
    )).toBe('2026-09-01');
    expect(await one(
      'SELECT COUNT(*)::int FROM participant_enrollments WHERE scout_year_id = $1', [newYearId]
    )).toBe(0);
    expect(await one(
      `SELECT COUNT(*)::int FROM participant_enrollments
        WHERE scout_year_id = $1 AND status = 'active'`,
      [ids.currentYearId]
    )).toBe(3);
    expect(await one(
      'SELECT ended_on FROM participant_enrollments WHERE participant_id = $1 AND scout_year_id = $2',
      [ids.leavingId, ids.currentYearId]
    )).toBeNull();
    expect(await one(
      'SELECT status FROM user_organizations WHERE id = $1', [ids.parentMembershipId]
    )).toBe('active');
    expect(await one(
      'SELECT deactivated_at FROM user_organizations WHERE id = $1', [ids.parentMembershipId]
    )).toBeNull();
    expect(await one(
      'SELECT review_state FROM form_submissions WHERE id = $1', [ids.requiredFormId]
    )).toBe('current');
    expect(await one(
      'SELECT flagged_for_review_at FROM form_submissions WHERE id = $1', [ids.requiredFormId]
    )).toBeNull();
    expect(await one(
      'SELECT status FROM medication_treatment_authorizations WHERE id = $1', [ids.authorizationId]
    )).toBe('signed');
    expect(await one(
      'SELECT rolled_back_at IS NOT NULL FROM scout_year_transitions WHERE id = $1', [transitionId]
    )).toBe(true);

    // Nothing was destroyed on the way: the season's points are untouched and
    // still attached to the year they were awarded in.
    expect(await one(
      'SELECT COUNT(*)::int FROM points WHERE organization_id = $1 AND scout_year_id = $2',
      [ids.organizationId, ids.currentYearId]
    )).toBe(1);
  });

  test('the same transition cannot be undone twice', async () => {
    const transitionId = (await runTransition()).body.data.transition_id;

    const first = await request(app)
      .post(`/api/v1/scout-years/transitions/${transitionId}/rollback`);
    expect(first.status).toBe(200);

    const second = await request(app)
      .post(`/api/v1/scout-years/transitions/${transitionId}/rollback`);
    expect(second.status).toBe(409);
    expect(second.body.message).toMatch(/already been undone/i);
  });

  test('a point awarded in the new year blocks the rollback and says so', async () => {
    const transition = await runTransition();
    const transitionId = transition.body.data.transition_id;
    const newYearId = transition.body.data.new_year.id;

    await pool.query(
      `INSERT INTO points (participant_id, value, organization_id, scout_year_id)
       VALUES ($1, 10, $2, $3)`,
      [ids.stayingId, ids.organizationId, newYearId]
    );

    const listed = await request(app).get('/api/v1/scout-years/transitions');
    expect(listed.body.data[0].can_rollback).toBe(false);
    expect(listed.body.data[0].rollback_blockers)
      .toContainEqual({ reason: 'points_awarded', count: 1 });

    const rollback = await request(app)
      .post(`/api/v1/scout-years/transitions/${transitionId}/rollback`);
    expect(rollback.status).toBe(409);
    expect(rollback.body.blockers).toContainEqual({ reason: 'points_awarded', count: 1 });

    // Refusing changed nothing.
    expect(await one('SELECT status FROM scout_years WHERE id = $1', [newYearId])).toBe('active');
    expect(await one(
      'SELECT status FROM user_organizations WHERE id = $1', [ids.parentMembershipId]
    )).toBe('inactive');
  });

  test('a family registered in the new year blocks the rollback', async () => {
    const transition = await runTransition();
    const newYearId = transition.body.data.new_year.id;

    const newcomerId = await one(
      `INSERT INTO participants (first_name, last_name, date_naissance)
       VALUES ('Damien', 'Côté', '2019-01-15') RETURNING id`
    );
    await pool.query(
      `INSERT INTO participant_enrollments
              (participant_id, organization_id, scout_year_id, inscription_date, status)
       VALUES ($1, $2, $3, CURRENT_DATE, 'active')`,
      [newcomerId, ids.organizationId, newYearId]
    );

    const listed = await request(app).get('/api/v1/scout-years/transitions');
    expect(listed.body.data[0].rollback_blockers)
      .toContainEqual({ reason: 'participants_enrolled', count: 1 });

    await pool.query('DELETE FROM participant_enrollments WHERE participant_id = $1', [newcomerId]);
    await pool.query('DELETE FROM participants WHERE id = $1', [newcomerId]);
  });

  test('a parent who already re-read a flagged form blocks the rollback', async () => {
    const transition = await runTransition();

    await pool.query(
      `UPDATE form_submissions
          SET review_state = 'current', flagged_for_review_at = NULL, last_reviewed_at = now()
        WHERE id = $1`,
      [ids.requiredFormId]
    );

    const listed = await request(app).get('/api/v1/scout-years/transitions');
    expect(listed.body.data[0].can_rollback).toBe(false);
    expect(listed.body.data[0].rollback_blockers)
      .toContainEqual({ reason: 'forms_reviewed', count: 1 });

    const rollback = await request(app)
      .post(`/api/v1/scout-years/transitions/${transition.body.data.transition_id}/rollback`);
    expect(rollback.status).toBe(409);
  });

  test('undoing then re-running the transition lands in the same place', async () => {
    const first = await runTransition();
    const firstNewYearId = first.body.data.new_year.id;
    await request(app)
      .post(`/api/v1/scout-years/transitions/${first.body.data.transition_id}/rollback`);

    const second = await runTransition();
    expect(second.status).toBe(201);
    // The same year row is reused rather than a duplicate label being created.
    expect(second.body.data.new_year.id).toBe(firstNewYearId);
    expect(second.body.data.summary).toMatchObject({ graduated: 1, carried_over: 2 });
    expect(await one(
      'SELECT COUNT(*)::int FROM scout_years WHERE organization_id = $1', [ids.organizationId]
    )).toBe(2);

    // And it is still undoable, restoring the year row to the state the first
    // rollback left it in rather than to nothing.
    const rollback = await request(app)
      .post(`/api/v1/scout-years/transitions/${second.body.data.transition_id}/rollback`);
    expect(rollback.status).toBe(200);
    expect(await one('SELECT status FROM scout_years WHERE id = $1', [firstNewYearId])).toBe('planning');
    expect(await one('SELECT status FROM scout_years WHERE id = $1', [ids.currentYearId])).toBe('active');
  });
  // ------------------------------------------------ consulting a past season

  test('an archived year still shows the participant who left', async () => {
    await runTransition();

    // By default every endpoint answers for the season now in progress.
    const current = await request(app).get('/api/v1/participants');
    expect(current.status).toBe(200);
    expect(current.body.data.map(p => p.first_name).sort()).toEqual(['Amélie', 'Chloé']);

    // Pointed at the closed year, the roster is the one that existed then.
    const archived = await request(app)
      .get('/api/v1/participants')
      .query({ scout_year_id: ids.currentYearId });
    expect(archived.status).toBe(200);
    expect(archived.body.data.map(p => p.first_name).sort())
      .toEqual(['Amélie', 'Béatrice', 'Chloé']);

    // The header does the same job, which is how the year selector works.
    const viaHeader = await request(app)
      .get('/api/v1/participants')
      .set('x-scout-year-id', String(ids.currentYearId));
    expect(viaHeader.body.data).toHaveLength(3);
  });

  test('attendance and honors belong to the season they were recorded in', async () => {
    await runTransition();

    const currentAttendance = await request(app).get('/api/v1/attendance');
    expect(currentAttendance.status).toBe(200);
    expect(currentAttendance.body.data).toHaveLength(0);

    const archivedAttendance = await request(app)
      .get('/api/v1/attendance')
      .query({ scout_year_id: ids.currentYearId });
    expect(archivedAttendance.body.data).toHaveLength(2);

    // The honor given to the participant who left is still reachable, and no
    // longer counted in the season now in progress.
    const currentHonors = await request(app).get('/api/v1/honors');
    expect(currentHonors.body.data.honors).toHaveLength(0);
    expect(currentHonors.body.data.participants.map(p => p.first_name).sort())
      .toEqual(['Amélie', 'Chloé']);

    const archivedHonors = await request(app)
      .get('/api/v1/honors')
      .query({ scout_year_id: ids.currentYearId });
    expect(archivedHonors.body.data.honors).toHaveLength(1);
    expect(archivedHonors.body.data.honors[0].participant_id).toBe(ids.leavingId);
    expect(archivedHonors.body.data.availableDates).toEqual(['2025-11-02']);
  });

  test('a report follows the year it is asked for', async () => {
    await runTransition();

    const current = await request(app).get('/api/v1/reports/points');
    expect(current.status).toBe(200);
    expect(current.body.data).toHaveLength(2);
    expect(current.body.data.every(row => Number(row.total_points) === 0)).toBe(true);

    const archived = await request(app)
      .get('/api/v1/reports/points')
      .query({ scout_year_id: ids.currentYearId });
    expect(archived.body.data).toHaveLength(3);
    const amelie = archived.body.data.find(row => row.first_name === 'Amélie');
    expect(Number(amelie.total_points)).toBe(25);
    const beatrice = archived.body.data.find(row => row.first_name === 'Béatrice');
    expect(Number(beatrice.honors_count)).toBe(1);
  });

  test('a year belonging to nobody is refused rather than silently ignored', async () => {
    const foreignYear = await one(
      `INSERT INTO scout_years (organization_id, label, start_date, end_date, status)
       VALUES ($1, '1999-2000', '1999-09-01', '2000-08-31', 'closed')
       RETURNING id`,
      [await createOrganization()]
    );

    const response = await request(app)
      .get('/api/v1/participants')
      .query({ scout_year_id: foreignYear });
    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/unknown scout year/i);

    const otherOrg = await one('SELECT organization_id FROM scout_years WHERE id = $1', [foreignYear]);
    await pool.query('DELETE FROM scout_years WHERE id = $1', [foreignYear]);
    await deleteOrganization(otherOrg);
  });

  // ------------------------------------------------------- yearly dens

  test('dens start empty in the new year and stay readable in the old one', async () => {
    await runTransition();

    // Nothing was carried over: September starts with a clean slate.
    expect(await one(
      `SELECT COUNT(*)::int FROM participant_group_assignments
        WHERE organization_id = $1 AND scout_year_id <> $2`,
      [ids.organizationId, ids.currentYearId]
    )).toBe(0);

    const current = await request(app).get('/api/v1/participants');
    expect(current.body.data.every(p => p.group_name === null)).toBe(true);

    // Last year's dens are intact, den leader included.
    const archived = await request(app)
      .get('/api/v1/participants')
      .query({ scout_year_id: ids.currentYearId });
    const beatrice = archived.body.data.find(p => p.first_name === 'Béatrice');
    expect(beatrice.group_name).toBe('Rouge');
    expect(beatrice.first_leader).toBe(true);
    const amelie = archived.body.data.find(p => p.first_name === 'Amélie');
    expect(amelie.group_name).toBe('Rouge');
    expect(amelie.first_leader).toBe(false);
  });

  test('assigning a den writes into the year in progress, not the one consulted', async () => {
    const transition = await runTransition();
    const newYearId = transition.body.data.new_year.id;

    const assigned = await request(app)
      .patch(`/api/v1/participants/${ids.stayingId}/group-membership`)
      .send({ group_id: ids.groupId, first_leader: true });
    expect(assigned.status).toBe(200);

    expect(await one(
      `SELECT scout_year_id FROM participant_group_assignments
        WHERE participant_id = $1 AND organization_id = $2 AND scout_year_id = $3`,
      [ids.stayingId, ids.organizationId, newYearId]
    )).toBe(newYearId);

    // The old year's row is untouched — a new assignment is not a rewrite of
    // last year's history.
    expect(await one(
      `SELECT first_leader FROM participant_group_assignments
        WHERE participant_id = $1 AND scout_year_id = $2`,
      [ids.stayingId, ids.currentYearId]
    )).toBe(false);
  });

  test('a den assigned in the new year blocks the rollback', async () => {
    const transition = await runTransition();

    await request(app)
      .patch(`/api/v1/participants/${ids.stayingId}/group-membership`)
      .send({ group_id: ids.groupId });

    const listed = await request(app).get('/api/v1/scout-years/transitions');
    expect(listed.body.data[0].rollback_blockers)
      .toContainEqual({ reason: 'dens_assigned', count: 1 });

    const rollback = await request(app)
      .post(`/api/v1/scout-years/transitions/${transition.body.data.transition_id}/rollback`);
    expect(rollback.status).toBe(409);
  });

  test('the compatibility view still answers for the year in progress', async () => {
    // The ~68 read sites not yet made year-aware go through this view.
    const rows = await pool.query(
      'SELECT participant_id, group_id, first_leader FROM participant_groups WHERE organization_id = $1',
      [ids.organizationId]
    );
    expect(rows.rows).toHaveLength(2);

    await runTransition();

    // After the transition the active year has no assignments, so the view is
    // empty — which is exactly what "dens start over" means for those sites.
    const afterwards = await pool.query(
      'SELECT participant_id FROM participant_groups WHERE organization_id = $1',
      [ids.organizationId]
    );
    expect(afterwards.rows).toHaveLength(0);
  });

  // ------------------------------------------- budget revenue and enrollments

  test('a fee is counted once, whatever the participant enrollment history', async () => {
    // Amélie has been enrolled for two years by the time she pays.
    const previousYearId = await one(
      `INSERT INTO scout_years (organization_id, label, start_date, end_date, status)
       VALUES ($1, '2024-2025', '2024-09-01', '2025-08-31', 'closed')
       RETURNING id`,
      [ids.organizationId]
    );
    await pool.query(
      `INSERT INTO participant_enrollments
              (participant_id, organization_id, scout_year_id, inscription_date, status)
       VALUES ($1, $2, $3, '2024-09-05', 'graduated')`,
      [ids.stayingId, ids.organizationId, previousYearId]
    );

    const feeDefinitionId = await one(
      `INSERT INTO fee_definitions
              (organization_id, registration_fee, membership_fee, year_start, year_end)
       VALUES ($1, 50, 25, '2025-09-01', '2026-08-31')
       RETURNING id`,
      [ids.organizationId]
    );
    const participantFeeId = await one(
      `INSERT INTO participant_fees
              (participant_id, organization_id, fee_definition_id,
               total_registration_fee, total_membership_fee)
       VALUES ($1, $2, $3, 50, 25)
       RETURNING id`,
      [ids.stayingId, ids.organizationId, feeDefinitionId]
    );
    await pool.query(
      `INSERT INTO payments (participant_fee_id, amount, payment_date)
       VALUES ($1, 75, CURRENT_DATE)`,
      [participantFeeId]
    );

    // One payment, one revenue line — not one per enrollment year. Joining the
    // enrollment table here used to multiply every fee by the number of seasons
    // the family had been around.
    const lines = await pool.query(
      `SELECT organization_id, amount FROM v_budget_revenue
        WHERE revenue_source = 'participant_fee' AND source_id IS NOT NULL
          AND organization_id = $1`,
      [ids.organizationId]
    );
    expect(lines.rows).toHaveLength(1);
    expect(Number(lines.rows[0].amount)).toBe(75);

    // And it is attributed to the organization that charged it.
    expect(lines.rows[0].organization_id).toBe(ids.organizationId);

    await pool.query('DELETE FROM payments WHERE participant_fee_id = $1', [participantFeeId]);
    await pool.query('DELETE FROM participant_fees WHERE id = $1', [participantFeeId]);
    await pool.query('DELETE FROM fee_definitions WHERE id = $1', [feeDefinitionId]);
  });
});
