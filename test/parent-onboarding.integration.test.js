/**
 * Parent onboarding — integration suite
 *
 * Parents registering their own children is new authority, so the thing under
 * test is mostly its edges: that the narrow permission is what opens the door
 * (the real `requirePermission` runs against the database here), that a child
 * always lands linked to the family that made it, that two families never see
 * each other's children, and that the duplicate rule is family-shaped rather
 * than unit-shaped.
 *
 * Skipped unless SCOUT_YEAR_TEST_DATABASE_URL (or TEST_DATABASE_URL) points at
 * a disposable database holding the project schema.
 *
 * @module test/parent-onboarding.integration
 */

const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');

require('./jest-conditional-helpers');

const DATABASE_URL = process.env.SCOUT_YEAR_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL;

process.env.JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || 'parent-onboarding-integration-secret';

const mockContext = { userId: null, organizationId: null };

// Only authentication is faked. Permission checks, demo blocking and
// organization resolution are the real middleware, reading the real database.
jest.mock('../middleware/auth', () => {
  const actual = jest.requireActual('../middleware/auth');
  return {
    ...actual,
    authenticate: (req, _res, next) => {
      req.user = { id: mockContext.userId, organizationId: mockContext.organizationId };
      next();
    },
  };
});

const { CHILD_RESULT } = require('../services/parentOnboarding');

describe.skipIf(!DATABASE_URL)('Parent onboarding', () => {
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
   * @param {string} name - Unit name
   * @returns {Promise<number>} Organization ID
   */
  async function createOrganization(name) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const created = await client.query(
        'INSERT INTO organizations (name) VALUES ($1) RETURNING id',
        [name]
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
   * A user with an active membership in a unit under one role.
   *
   * @param {string} label - Name, and the start of a unique address
   * @param {number} organizationId - Unit
   * @param {number} roleId - Role
   * @returns {Promise<string>} User UUID
   */
  async function member(label, organizationId, roleId) {
    const userId = await one(
      `INSERT INTO users (email, password, full_name)
       VALUES ($1 || '-' || gen_random_uuid() || '@example.test', 'x', $1) RETURNING id`,
      [label]
    );
    await pool.query(
      `INSERT INTO user_organizations (user_id, organization_id, role_ids, status)
       VALUES ($1, $2, $3, 'active')`,
      [userId, organizationId, JSON.stringify([roleId])]
    );
    return userId;
  }

  /**
   * Act as a user and register a child.
   *
   * @param {string} userId - Acting parent
   * @param {Object} child - Body
   * @param {number} [organizationId] - Unit the token is for
   * @returns {Promise<Object>} Supertest response
   */
  function registerChild(userId, child, organizationId = ids.organizationId) {
    mockContext.userId = userId;
    mockContext.organizationId = organizationId;
    return request(app).post('/api/v1/parent-onboarding/children').send(child);
  }

  const LEA = { first_name: 'Léa', last_name: 'Tremblay', date_naissance: '2016-05-01' };

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });

    ids.organizationId = await createOrganization('6A Onboarding Test');
    ids.otherOrganizationId = await createOrganization('6B Onboarding Other');

    for (const orgId of [ids.organizationId, ids.otherOrganizationId]) {
      // eslint-disable-next-line no-await-in-loop
      await pool.query(
        `INSERT INTO scout_years (organization_id, label, start_date, end_date, status)
         VALUES ($1, '2026-2027', '2026-09-01', '2027-08-31', 'active'),
                ($1, '2025-2026', '2025-09-01', '2026-08-31', 'closed')`,
        [orgId]
      );
    }
    ids.activeYearId = await one(
      "SELECT id FROM scout_years WHERE organization_id = $1 AND status = 'active'",
      [ids.organizationId]
    );
    ids.lastYearId = await one(
      "SELECT id FROM scout_years WHERE organization_id = $1 AND status = 'closed'",
      [ids.organizationId]
    );

    ids.parentRoleId = await one(
      `INSERT INTO roles (role_name, display_name) VALUES ('parent', 'Parent')
       ON CONFLICT (role_name) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`
    );
    ids.leaderRoleId = await one(
      `INSERT INTO roles (role_name, display_name) VALUES ('leader', 'Leader')
       ON CONFLICT (role_name) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`
    );

    // The same grant migration 007 makes. The disposable schema had no roles
    // when the migration ran, so it is replayed here against the role above.
    await pool.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
        WHERE r.role_name = 'parent' AND p.permission_key = 'participants.create_own'
       ON CONFLICT DO NOTHING`
    );

    ids.parentId = await member('Parent A', ids.organizationId, ids.parentRoleId);
    ids.coParentId = await member('Co-parent C', ids.organizationId, ids.parentRoleId);
    ids.strangerId = await member('Unrelated B', ids.organizationId, ids.parentRoleId);
    ids.leaderId = await member('Leader L', ids.organizationId, ids.leaderRoleId);
    ids.otherUnitParentId = await member('Other unit parent', ids.otherOrganizationId, ids.parentRoleId);

    ids.parentGuardianId = await one(
      `INSERT INTO parents_guardians (nom, prenom, courriel, user_uuid)
       VALUES ('A', 'Parent', 'parent-a-' || gen_random_uuid() || '@example.test', $1) RETURNING id`,
      [ids.parentId]
    );
    ids.coParentGuardianId = await one(
      `INSERT INTO parents_guardians (nom, prenom, courriel, user_uuid)
       VALUES ('C', 'Co-parent', 'co-parent-c-' || gen_random_uuid() || '@example.test', $1) RETURNING id`,
      [ids.coParentId]
    );

    const [low, high] = [ids.parentId, ids.coParentId].sort();
    ids.familyLinkId = await one(
      `INSERT INTO family_links (organization_id, user_id_low, user_id_high)
       VALUES ($1, $2, $3) RETURNING id`,
      [ids.organizationId, low, high]
    );

    app = express();
    app.use(express.json());
    app.locals.pool = pool;
    app.use('/api/v1/parent-onboarding', require('../routes/parentOnboarding')(pool, console));
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  beforeEach(async () => {
    // Every child a test made is enrolled in one of the two test units.
    const made = await pool.query(
      'SELECT DISTINCT participant_id FROM participant_enrollments WHERE organization_id = ANY($1::int[])',
      [[ids.organizationId, ids.otherOrganizationId]]
    );
    const participantIds = made.rows.map((row) => row.participant_id);
    if (participantIds.length > 0) {
      await pool.query('DELETE FROM participant_guardians WHERE participant_id = ANY($1::int[])', [participantIds]);
      await pool.query('DELETE FROM user_participants WHERE participant_id = ANY($1::int[])', [participantIds]);
      await pool.query('DELETE FROM participant_access_grants WHERE participant_id = ANY($1::int[])', [participantIds]);
      await pool.query('DELETE FROM participant_enrollments WHERE participant_id = ANY($1::int[])', [participantIds]);
      await pool.query('DELETE FROM participants WHERE id = ANY($1::int[])', [participantIds]);
    }
    await pool.query('DELETE FROM parent_invitations WHERE organization_id = $1', [ids.organizationId]);
  });

  test('a parent registers a child, who is enrolled this year and linked to them', async () => {
    const response = await registerChild(ids.parentId, LEA);

    expect(response.status).toBe(201);
    expect(response.body.data.result).toBe(CHILD_RESULT.CREATED);
    const childId = response.body.data.participant_id;

    expect(await one('SELECT first_name FROM participants WHERE id = $1', [childId])).toBe('Léa');
    expect(await one(
      `SELECT status FROM participant_enrollments
        WHERE participant_id = $1 AND organization_id = $2 AND scout_year_id = $3`,
      [childId, ids.organizationId, ids.activeYearId]
    )).toBe('active');

    expect(await one(
      'SELECT count(*) FROM user_participants WHERE participant_id = $1 AND user_id = $2',
      [childId, ids.parentId]
    )).toBe('1');
    expect(await one(
      `SELECT source_type FROM participant_access_grants
        WHERE participant_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [childId, ids.parentId]
    )).toBe('direct');
    expect(await one(
      'SELECT count(*) FROM participant_guardians WHERE participant_id = $1 AND guardian_id = $2',
      [childId, ids.parentGuardianId]
    )).toBe('1');
  });

  test('a family-linked co-parent gets access too, traceable to the link', async () => {
    const response = await registerChild(ids.parentId, LEA);
    const childId = response.body.data.participant_id;

    const grant = await pool.query(
      `SELECT source_type, source_id FROM participant_access_grants
        WHERE participant_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [childId, ids.coParentId]
    );
    expect(grant.rows).toEqual([{ source_type: 'family_link', source_id: String(ids.familyLinkId) }]);
    expect(await one(
      'SELECT count(*) FROM user_participants WHERE participant_id = $1 AND user_id = $2',
      [childId, ids.coParentId]
    )).toBe('1');
    expect(await one(
      'SELECT count(*) FROM participant_guardians WHERE participant_id = $1 AND guardian_id = $2',
      [childId, ids.coParentGuardianId]
    )).toBe('1');
  });

  test('an unrelated family may register an identically named child, and sees only its own', async () => {
    const mine = await registerChild(ids.parentId, LEA);
    const theirs = await registerChild(ids.strangerId, LEA);

    expect(theirs.status).toBe(201);
    expect(theirs.body.data.participant_id).not.toBe(mine.body.data.participant_id);

    expect(await one(
      'SELECT count(*) FROM user_participants WHERE participant_id = $1 AND user_id = $2',
      [mine.body.data.participant_id, ids.strangerId]
    )).toBe('0');

    mockContext.userId = ids.strangerId;
    const context = await request(app).get('/api/v1/parent-onboarding/context');
    expect(context.body.data.children.map((child) => child.id)).toEqual([theirs.body.data.participant_id]);
  });

  test('the same child twice in one family is refused', async () => {
    await registerChild(ids.parentId, LEA);
    const again = await registerChild(ids.parentId, {
      ...LEA,
      first_name: '  LÉA ',
      last_name: 'tremblay',
    });

    expect(again.status).toBe(409);
    expect(again.body.code).toBe(CHILD_RESULT.DUPLICATE);
    expect(await one(
      'SELECT count(*) FROM participant_enrollments WHERE organization_id = $1',
      [ids.organizationId]
    )).toBe('1');
  });

  test('the family is what counts: a co-parent cannot register the partner\'s child again', async () => {
    await registerChild(ids.parentId, LEA);
    const fromPartner = await registerChild(ids.coParentId, LEA);

    expect(fromPartner.status).toBe(409);
    expect(fromPartner.body.code).toBe(CHILD_RESULT.DUPLICATE);
  });

  test('a returning child is put back on this year\'s roster, not duplicated', async () => {
    const childId = await one(
      "INSERT INTO participants (first_name, last_name, date_naissance) VALUES ('Léa', 'Tremblay', '2016-05-01') RETURNING id"
    );
    await pool.query(
      `INSERT INTO participant_enrollments (participant_id, organization_id, scout_year_id, status, ended_on)
       VALUES ($1, $2, $3, 'left', '2026-06-30')`,
      [childId, ids.organizationId, ids.lastYearId]
    );
    await pool.query('INSERT INTO user_participants (participant_id, user_id) VALUES ($1, $2)', [childId, ids.parentId]);

    const response = await registerChild(ids.parentId, LEA);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ result: CHILD_RESULT.REENROLLED, participant_id: childId });
    expect(await one(
      'SELECT status FROM participant_enrollments WHERE participant_id = $1 AND scout_year_id = $2',
      [childId, ids.activeYearId]
    )).toBe('active');
    expect(await one("SELECT count(*) FROM participants WHERE first_name = 'Léa' AND id >= $1", [childId])).toBe('1');
  });

  /**
   * A child already enrolled in the other test unit, visible to one user.
   *
   * @param {string} userId - Who can see the child
   * @param {Object} [child] - Name and birth date
   * @returns {Promise<number>} Participant ID
   */
  async function childInOtherUnit(userId, child = LEA) {
    const childId = await one(
      'INSERT INTO participants (first_name, last_name, date_naissance) VALUES ($1, $2, $3) RETURNING id',
      [child.first_name, child.last_name, child.date_naissance]
    );
    const otherYearId = await one(
      "SELECT id FROM scout_years WHERE organization_id = $1 AND status = 'active'",
      [ids.otherOrganizationId]
    );
    await pool.query(
      'INSERT INTO participant_enrollments (participant_id, organization_id, scout_year_id) VALUES ($1, $2, $3)',
      [childId, ids.otherOrganizationId, otherYearId]
    );
    await pool.query('INSERT INTO user_participants (participant_id, user_id) VALUES ($1, $2)', [childId, userId]);
    return childId;
  }

  test('a parent\'s child from another unit is enrolled here as the same person, not created again', async () => {
    const childId = await childInOtherUnit(ids.parentId);

    const response = await registerChild(ids.parentId, LEA);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ result: CHILD_RESULT.ENROLLED_EXISTING, participant_id: childId });
    expect(await one(
      "SELECT count(*) FROM participants WHERE first_name = 'Léa' AND last_name = 'Tremblay' AND id >= $1",
      [childId]
    )).toBe('1');

    // One person, two units.
    const units = await pool.query(
      "SELECT organization_id FROM participant_enrollments WHERE participant_id = $1 AND status = 'active' ORDER BY organization_id",
      [childId]
    );
    expect(units.rows.map((row) => row.organization_id)).toEqual([ids.organizationId, ids.otherOrganizationId]);

    // Now a child of this unit, so shared with the family made here.
    expect(await one(
      'SELECT count(*) FROM user_participants WHERE participant_id = $1 AND user_id = $2',
      [childId, ids.coParentId]
    )).toBe('1');
  });

  test('the same child registered into this unit twice is still refused after joining from another', async () => {
    await childInOtherUnit(ids.parentId);
    await registerChild(ids.parentId, LEA);

    const again = await registerChild(ids.parentId, LEA);

    expect(again.status).toBe(409);
    expect(again.body.code).toBe(CHILD_RESULT.DUPLICATE);
  });

  test('a same-name child in another unit pauses for confirmation too', async () => {
    await childInOtherUnit(ids.parentId);

    const response = await registerChild(ids.parentId, { ...LEA, date_naissance: '2019-02-14' });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe(CHILD_RESULT.SIMILAR);
  });

  test('a partner\'s children in other units are not revealed by a link made in this one', async () => {
    const partnersChild = await childInOtherUnit(ids.coParentId, {
      first_name: 'Noé', last_name: 'Gagnon', date_naissance: '2015-03-03',
    });

    mockContext.userId = ids.parentId;
    mockContext.organizationId = ids.organizationId;
    const context = await request(app).get('/api/v1/parent-onboarding/context');
    expect(context.body.data.children.map((child) => child.id)).not.toContain(partnersChild);

    // Nor does a same-name registration surface them as a "similar" match.
    const similar = await registerChild(ids.parentId, {
      first_name: 'Noé', last_name: 'Gagnon', date_naissance: '2018-08-08',
    });
    expect(similar.status).toBe(201);
    expect(JSON.stringify(similar.body)).not.toContain(String(partnersChild));
  });

  test('same name with another birth date pauses for confirmation, then goes through', async () => {
    await registerChild(ids.parentId, LEA);

    const paused = await registerChild(ids.parentId, { ...LEA, date_naissance: '2019-02-14' });

    expect(paused.status).toBe(409);
    expect(paused.body.code).toBe(CHILD_RESULT.SIMILAR);
    expect(paused.body.data.matches).toEqual([
      expect.objectContaining({ first_name: 'Léa', date_naissance: '2016-05-01' }),
    ]);

    const confirmed = await registerChild(ids.parentId, {
      ...LEA,
      date_naissance: '2019-02-14',
      confirm_similar: true,
    });

    expect(confirmed.status).toBe(201);
    expect(await one(
      'SELECT count(*) FROM participant_enrollments WHERE organization_id = $1',
      [ids.organizationId]
    )).toBe('2');
  });

  test('two identical submissions at once make one child', async () => {
    const [a, b] = await Promise.all([
      registerChild(ids.parentId, LEA),
      registerChild(ids.coParentId, LEA),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
    expect(await one(
      'SELECT count(*) FROM participant_enrollments WHERE organization_id = $1',
      [ids.organizationId]
    )).toBe('1');
  });

  test.each([
    ['a birth date in the future', { ...LEA, date_naissance: '2099-01-01' }],
    ['no birth date', { first_name: 'Léa', last_name: 'Tremblay' }],
    ['a birth date typed a century off', { ...LEA, date_naissance: '1916-05-01' }],
    ['an impossible date', { ...LEA, date_naissance: '2016-02-31' }],
    ['a blank first name', { ...LEA, first_name: '   ' }],
    ['a missing last name', { first_name: 'Léa', date_naissance: '2016-05-01' }],
  ])('refuses %s and creates nothing', async (_label, body) => {
    const response = await registerChild(ids.parentId, body);

    expect(response.status).toBe(400);
    expect(await one(
      'SELECT count(*) FROM participant_enrollments WHERE organization_id = $1',
      [ids.organizationId]
    )).toBe('0');
  });

  test('without participants.create_own the door stays shut', async () => {
    const response = await registerChild(ids.leaderId, LEA);

    expect(response.status).toBe(403);
    expect(response.body.required).toEqual(['participants.create_own']);
    expect(response.body.missing).toEqual(['participants.create_own']);
  });

  test('a parent of another unit cannot register into this one', async () => {
    // Their token says this unit; their only membership is elsewhere.
    const response = await registerChild(ids.otherUnitParentId, LEA, ids.organizationId);

    expect(response.status).toBe(403);
    expect(await one(
      'SELECT count(*) FROM participant_enrollments WHERE organization_id = $1',
      [ids.organizationId]
    )).toBe('0');
  });

  test('context resumes onboarding from the database, and completing it ends that', async () => {
    await pool.query(
      `INSERT INTO parent_invitations
         (organization_id, email, token_digest, status, expires_at, accepted_user_id, accepted_at,
          support_contact_name, support_contact_email)
       VALUES ($1, 'parent-a@example.test', md5(random()::text) || md5(random()::text), 'accepted', now() + interval '7 days',
               $2, now(), 'Akela', 'akela@example.test')`,
      [ids.organizationId, ids.parentId]
    );
    await registerChild(ids.parentId, LEA);

    mockContext.userId = ids.parentId;
    mockContext.organizationId = ids.organizationId;
    const before = await request(app).get('/api/v1/parent-onboarding/context');

    expect(before.status).toBe(200);
    expect(before.body.data).toMatchObject({
      organization_name: '6A Onboarding Test',
      scout_year: { label: '2026-2027' },
      onboarding_pending: true,
      support_contact: { name: 'Akela', email: 'akela@example.test' },
      family_size: 2,
    });
    expect(before.body.data.children).toEqual([
      expect.objectContaining({ first_name: 'Léa', enrolled_this_year: true }),
    ]);

    const done = await request(app).post('/api/v1/parent-onboarding/complete').send({});
    expect(done.body.data.completed).toBe(true);

    const after = await request(app).get('/api/v1/parent-onboarding/context');
    expect(after.body.data.onboarding_pending).toBe(false);
  });
});
