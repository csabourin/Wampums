/**
 * Duplicate candidates — integration suite
 *
 * When two parents link, or a parent registers a child, two participant
 * records may turn out to describe one child. These tests hold that such pairs
 * reach the unit's administrators — including the case a parent is never
 * shown, a partner's child in another unit — that nothing is merged or revealed
 * to parents along the way, and that an administrator's decision sticks.
 *
 * Skipped unless SCOUT_YEAR_TEST_DATABASE_URL (or TEST_DATABASE_URL) points at
 * a disposable database holding the project schema.
 *
 * @module test/participant-duplicates.integration
 */

const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');

require('./jest-conditional-helpers');

const DATABASE_URL = process.env.SCOUT_YEAR_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL;

process.env.JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || 'participant-duplicates-integration-secret';

const sentEmails = [];

jest.mock('../utils/index', () => {
  const actual = jest.requireActual('../utils/index');
  return {
    ...actual,
    sendEmail: jest.fn(async (to, subject, message, html) => {
      // eslint-disable-next-line no-undef
      global.__duplicateTestEmails.push({ to, subject, message, html });
      return true;
    }),
  };
});

global.__duplicateTestEmails = sentEmails;

const mockContext = { userId: null, organizationId: null };

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

const { ACCESS_SOURCE, grantParticipantAccess } = require('../services/participantAccess');

describe.skipIf(!DATABASE_URL)('Duplicate candidates', () => {
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
   * A unit with its program section and an active scout year.
   *
   * @param {string} name - Unit name
   * @returns {Promise<number>} Organization ID
   */
  async function createUnit(name) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const created = await client.query('INSERT INTO organizations (name) VALUES ($1) RETURNING id', [name]);
      const organizationId = created.rows[0].id;
      await client.query(
        `INSERT INTO organization_program_sections (organization_id, section_key, display_name)
         VALUES ($1, 'general', 'General')`,
        [organizationId]
      );
      await client.query('COMMIT');
      await pool.query(
        `INSERT INTO scout_years (organization_id, label, start_date, end_date, status)
         VALUES ($1, '2026-2027', '2026-09-01', '2027-08-31', 'active')`,
        [organizationId]
      );
      return organizationId;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * An account with an active membership under one role.
   *
   * @param {string} label - Name
   * @param {number} organizationId - Unit
   * @param {number} roleId - Role
   * @returns {Promise<{id: string, email: string}>} The account
   */
  async function member(label, organizationId, roleId) {
    const row = await pool.query(
      `INSERT INTO users (email, password, full_name)
       VALUES (lower($1) || '-' || gen_random_uuid() || '@duplicates.example.test', 'x', $1)
       RETURNING id, email`,
      [label]
    );
    await pool.query(
      `INSERT INTO user_organizations (user_id, organization_id, role_ids, status)
       VALUES ($1, $2, $3, 'active')`,
      [row.rows[0].id, organizationId, JSON.stringify([roleId])]
    );
    return row.rows[0];
  }

  /**
   * A child in a unit, held directly by one parent.
   *
   * @param {Object} details - Name and birth date
   * @param {number} organizationId - Unit
   * @param {string} parentId - Parent holding them
   * @returns {Promise<number>} Participant ID
   */
  async function childOf({ first, last = 'Dupont', born }, organizationId, parentId) {
    const childId = await one(
      'INSERT INTO participants (first_name, last_name, date_naissance) VALUES ($1, $2, $3) RETURNING id',
      [first, last, born]
    );
    await pool.query(
      `INSERT INTO participant_enrollments (participant_id, organization_id, scout_year_id)
       SELECT $1, $2, id FROM scout_years WHERE organization_id = $2 AND status = 'active'`,
      [childId, organizationId]
    );
    await grantParticipantAccess(pool, { participantId: childId, userId: parentId, sourceType: ACCESS_SOURCE.DIRECT });
    return childId;
  }

  /**
   * Act as an account in a unit.
   *
   * @param {string} userId - Acting account
   * @param {number} [organizationId] - Unit on the token
   * @returns {Object} Supertest
   */
  function as(userId, organizationId = ids.unitA) {
    mockContext.userId = userId;
    mockContext.organizationId = organizationId;
    return request(app);
  }

  /**
   * Link two parents through the real request-and-accept flow.
   *
   * @param {Object} from - Requesting parent
   * @param {Object} to - Receiving parent
   * @returns {Promise<Object>} Accept response body data
   */
  async function link(from, to) {
    const asked = await as(from.id).post('/api/v1/family-link-requests').send({ email: to.email });
    if (asked.status !== 201) throw new Error(`ask failed: ${JSON.stringify(asked.body)}`);
    const token = decodeURIComponent(/family-link\?token=([^"\s&]+)/.exec(sentEmails[sentEmails.length - 1].message)[1]);
    const accepted = await request(app).post('/api/v1/public/family-links/accept').send({ token });
    return accepted.body.data;
  }

  /**
   * Pending candidates in a unit, as pairs of participant ids.
   *
   * @param {number} organizationId - Unit
   * @returns {Promise<Array<Array<number>>>} Sorted id pairs
   */
  async function pendingPairs(organizationId) {
    const result = await pool.query(
      `SELECT participant_id_low, participant_id_high FROM participant_duplicate_candidates
        WHERE organization_id = $1 AND status = 'pending' ORDER BY id`,
      [organizationId]
    );
    return result.rows.map((row) => [row.participant_id_low, row.participant_id_high]);
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });

    ids.parentRoleId = await one(
      `INSERT INTO roles (role_name, display_name) VALUES ('parent', 'Parent')
       ON CONFLICT (role_name) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`
    );
    ids.adminRoleId = await one(
      `INSERT INTO roles (role_name, display_name) VALUES ('duplicates_test_admin', 'Duplicates Admin')
       ON CONFLICT (role_name) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`
    );
    await pool.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
        WHERE (r.role_name = 'parent' AND p.permission_key = 'participants.create_own')
           OR (r.role_name = 'duplicates_test_admin' AND p.permission_key = 'participants.edit')
       ON CONFLICT DO NOTHING`
    );

    ids.unitA = await createUnit('6A Duplicates');
    ids.unitB = await createUnit('6B Duplicates');

    ids.adminA = await member('Admin A', ids.unitA, ids.adminRoleId);
    ids.adminB = await member('Admin B', ids.unitB, ids.adminRoleId);
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  beforeEach(async () => {
    sentEmails.length = 0;
    // Fresh parents per test, so no link or child from one test leaks into the next.
    ids.alice = await member('Alice', ids.unitA, ids.parentRoleId);
    ids.carole = await member('Carole', ids.unitA, ids.parentRoleId);

    app = express();
    app.use(express.json());
    app.locals.pool = pool;
    app.use('/api/v1', require('../routes/familyLinks')(pool, console));
    app.use('/api/v1/public', require('../routes/public')(pool, console));
    app.use('/api/v1/parent-onboarding', require('../routes/parentOnboarding')(pool, console));
    app.use('/api/v1/participant-duplicates', require('../routes/participantDuplicates')(pool));

    await pool.query(
      'DELETE FROM participant_duplicate_candidates WHERE organization_id = ANY($1::int[])',
      [[ids.unitA, ids.unitB]]
    );
  });

  test('linking two parents who each registered the same child flags the pair', async () => {
    const alicesLea = await childOf({ first: 'Léa', born: '2016-05-01' }, ids.unitA, ids.alice.id);
    const carolesLea = await childOf({ first: 'léa ', born: '2016-05-01' }, ids.unitA, ids.carole.id);

    const linked = await link(ids.alice, ids.carole);

    expect(linked.result).toBe('linked');
    expect(await pendingPairs(ids.unitA)).toEqual([[alicesLea, carolesLea].sort((a, b) => a - b)]);
    // Flagged, not merged: both records still exist.
    expect(await one('SELECT count(*) FROM participants WHERE id = ANY($1::int[])', [[alicesLea, carolesLea]])).toBe('2');
    // And the parents were not told anything: the answer is exactly what any link returns.
    expect(Object.keys(linked).sort()).toEqual(['email', 'link_id', 'organization_name', 'result', 'state']);
  });

  test('a partner\'s record in another unit is flagged to this unit\'s administrators', async () => {
    await pool.query(
      `INSERT INTO user_organizations (user_id, organization_id, role_ids, status)
       VALUES ($1, $2, $3, 'active')`,
      [ids.carole.id, ids.unitB, JSON.stringify([ids.parentRoleId])]
    );
    const here = await childOf({ first: 'Noé', born: '2015-03-03' }, ids.unitA, ids.alice.id);
    await childOf({ first: 'Rémi', born: '2014-01-01' }, ids.unitA, ids.carole.id);
    const elsewhere = await childOf({ first: 'Noé', born: '2015-03-03' }, ids.unitB, ids.carole.id);

    await link(ids.alice, ids.carole);

    expect(await pendingPairs(ids.unitA)).toEqual([[here, elsewhere].sort((a, b) => a - b)]);

    const listed = await as(ids.adminA.id).get('/api/v1/participant-duplicates');
    expect(listed.status).toBe(200);
    const [candidate] = listed.body.data;
    const bySide = Object.fromEntries(candidate.participants.map((side) => [side.id, side]));
    // Alice's Noé is now shared with Carole through the link, so both are listed.
    expect(bySide[here]).toMatchObject({ in_this_unit: true, units: ['6A Duplicates'], accounts: ['Alice', 'Carole'] });
    expect(bySide[elsewhere]).toMatchObject({ in_this_unit: false, units: ['6B Duplicates'] });
    // Carole is a member of this unit, so the administrator may see she holds it.
    expect(bySide[elsewhere].accounts).toEqual(['Carole']);

    // The other unit's administrators have nothing to decide here.
    const fromB = await as(ids.adminB.id, ids.unitB).get('/api/v1/participant-duplicates');
    expect(fromB.body.data).toEqual([]);
  });

  test('registering a child who is a partner\'s child elsewhere creates the record and flags it', async () => {
    await pool.query(
      `INSERT INTO user_organizations (user_id, organization_id, role_ids, status)
       VALUES ($1, $2, $3, 'active')`,
      [ids.carole.id, ids.unitB, JSON.stringify([ids.parentRoleId])]
    );
    await childOf({ first: 'Rémi', born: '2014-01-01' }, ids.unitA, ids.carole.id);
    await childOf({ first: 'Alix', born: '2013-02-02' }, ids.unitA, ids.alice.id);
    const elsewhere = await childOf({ first: 'Éloi', born: '2012-12-12' }, ids.unitB, ids.carole.id);
    await link(ids.alice, ids.carole);

    const registered = await as(ids.alice.id).post('/api/v1/parent-onboarding/children')
      .send({ first_name: 'Éloi', last_name: 'Dupont', date_naissance: '2012-12-12' });

    // Alice is not shown Carole's record in the other unit...
    expect(registered.status).toBe(201);
    expect(registered.body.data).toEqual({ result: 'created', participant_id: expect.any(Number) });
    // ...but the unit's administrators are.
    const newId = registered.body.data.participant_id;
    expect(await pendingPairs(ids.unitA)).toEqual([[newId, elsewhere].sort((a, b) => a - b)]);
    expect(await one(
      'SELECT detected_via FROM participant_duplicate_candidates WHERE participant_id_low = $1 OR participant_id_high = $1',
      [newId]
    )).toBe('onboarding');
  });

  test('the same name with another birth date is not flagged', async () => {
    await childOf({ first: 'Léa', born: '2016-05-01' }, ids.unitA, ids.alice.id);
    await childOf({ first: 'Léa', born: '2019-09-09' }, ids.unitA, ids.carole.id);

    await link(ids.alice, ids.carole);

    expect(await pendingPairs(ids.unitA)).toEqual([]);
  });

  test('two records only in another unit are not this unit\'s to review', async () => {
    await pool.query(
      `INSERT INTO user_organizations (user_id, organization_id, role_ids, status)
       VALUES ($1, $2, $3, 'active')`,
      [ids.carole.id, ids.unitB, JSON.stringify([ids.parentRoleId])]
    );
    await childOf({ first: 'Alix', born: '2013-02-02' }, ids.unitA, ids.alice.id);
    await childOf({ first: 'Zoé', born: '2017-07-07' }, ids.unitB, ids.carole.id);
    await childOf({ first: 'Zoé', born: '2017-07-07' }, ids.unitB, ids.carole.id);

    await link(ids.alice, ids.carole);

    expect(await pendingPairs(ids.unitA)).toEqual([]);
  });

  test('a pair judged to be two children does not come back', async () => {
    await childOf({ first: 'Léa', born: '2016-05-01' }, ids.unitA, ids.alice.id);
    await childOf({ first: 'Léa', born: '2016-05-01' }, ids.unitA, ids.carole.id);
    const firstLink = await link(ids.alice, ids.carole);
    const candidateId = await one(
      'SELECT id FROM participant_duplicate_candidates WHERE organization_id = $1',
      [ids.unitA]
    );

    const decided = await as(ids.adminA.id).post(`/api/v1/participant-duplicates/${candidateId}/resolve`)
      .send({ decision: 'different', note: 'Cousins, both named after their grandmother' });
    expect(decided.status).toBe(200);
    expect(decided.body.data.status).toBe('different');

    // The family unlinks and links again.
    await as(ids.alice.id).delete(`/api/v1/family-links/${firstLink.link_id}`);
    await link(ids.alice, ids.carole);

    expect(await pendingPairs(ids.unitA)).toEqual([]);
    expect(await one('SELECT count(*) FROM participant_duplicate_candidates WHERE organization_id = $1', [ids.unitA]))
      .toBe('1');
  });

  test('only this unit\'s administrators can decide, and only between the two answers', async () => {
    await childOf({ first: 'Léa', born: '2016-05-01' }, ids.unitA, ids.alice.id);
    await childOf({ first: 'Léa', born: '2016-05-01' }, ids.unitA, ids.carole.id);
    await link(ids.alice, ids.carole);
    const candidateId = await one(
      'SELECT id FROM participant_duplicate_candidates WHERE organization_id = $1',
      [ids.unitA]
    );

    const otherUnit = await as(ids.adminB.id, ids.unitB).post(`/api/v1/participant-duplicates/${candidateId}/resolve`)
      .send({ decision: 'same_person' });
    const parent = await as(ids.alice.id).post(`/api/v1/participant-duplicates/${candidateId}/resolve`)
      .send({ decision: 'same_person' });
    const nonsense = await as(ids.adminA.id).post(`/api/v1/participant-duplicates/${candidateId}/resolve`)
      .send({ decision: 'merge_now' });

    expect(otherUnit.status).toBe(404);
    expect(parent.status).toBe(403);
    expect(nonsense.status).toBe(400);
    expect(await one('SELECT status FROM participant_duplicate_candidates WHERE id = $1', [candidateId])).toBe('pending');

    const decided = await as(ids.adminA.id).post(`/api/v1/participant-duplicates/${candidateId}/resolve`)
      .send({ decision: 'same_person' });
    expect(decided.body.data.status).toBe('same_person');
    expect(await one('SELECT resolved_by FROM participant_duplicate_candidates WHERE id = $1', [candidateId]))
      .toBe(ids.adminA.id);
  });
});
