/**
 * Participant access — integration suite for the routes that link accounts to
 * children
 *
 * Every route that used to write `user_participants` directly now goes through
 * services/participantAccess. These tests hold two things at the HTTP
 * boundary, against a real database:
 *
 * - the access they grant is recorded with a reason, so a later revocation of
 *   one reason (a family link) cannot take away access that rests on another;
 * - they stay inside the caller's unit. Two of them used to reach into every
 *   unit — `associate-user` checked neither end, and `replace_all` erased the
 *   user's links everywhere.
 *
 * Skipped unless SCOUT_YEAR_TEST_DATABASE_URL (or TEST_DATABASE_URL) points at
 * a disposable database holding the project schema.
 *
 * @module test/participant-access.integration
 */

const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');

require('./jest-conditional-helpers');

const DATABASE_URL = process.env.SCOUT_YEAR_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL;

process.env.JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || 'participant-access-integration-secret';

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

describe.skipIf(!DATABASE_URL)('Participant access routes', () => {
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
   * @returns {Promise<string>} User UUID
   */
  async function member(label, organizationId, roleId) {
    const userId = await one(
      `INSERT INTO users (email, password, full_name)
       VALUES (lower($1) || '-' || gen_random_uuid() || '@access.example.test', 'x', $1) RETURNING id`,
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
   * A child enrolled this year in a unit.
   *
   * @param {string} name - First name
   * @param {number} organizationId - Unit
   * @returns {Promise<number>} Participant ID
   */
  async function child(name, organizationId) {
    const childId = await one(
      "INSERT INTO participants (first_name, last_name, date_naissance) VALUES ($1, 'Access', '2016-01-01') RETURNING id",
      [name]
    );
    await pool.query(
      `INSERT INTO participant_enrollments (participant_id, organization_id, scout_year_id)
       SELECT $1, $2, id FROM scout_years WHERE organization_id = $2 AND status = 'active'`,
      [childId, organizationId]
    );
    return childId;
  }

  /**
   * Whether an account can see a child, by the table the app reads.
   *
   * @param {string} userId - Account
   * @param {number} participantId - Child
   * @returns {Promise<boolean>} Visible or not
   */
  async function sees(userId, participantId) {
    return (await one(
      'SELECT count(*) FROM user_participants WHERE user_id = $1 AND participant_id = $2',
      [userId, participantId]
    )) === '1';
  }

  /**
   * The live grants behind one pair.
   *
   * @param {string} userId - Account
   * @param {number} participantId - Child
   * @returns {Promise<Array<Object>>} Source type and id of each live grant
   */
  async function liveGrants(userId, participantId) {
    const result = await pool.query(
      `SELECT source_type, source_id FROM participant_access_grants
        WHERE user_id = $1 AND participant_id = $2 AND revoked_at IS NULL
        ORDER BY source_type`,
      [userId, participantId]
    );
    return result.rows;
  }

  /**
   * Act as a user in a unit.
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

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });

    // The route under test requires a permission no migration defines; the
    // test supplies it so the linking behaviour can be exercised at all.
    await pool.query(
      `SELECT setval(pg_get_serial_sequence('public.permissions', 'id'),
                     COALESCE((SELECT MAX(id) FROM permissions), 0) + 1, false)`
    );
    await pool.query(
      `INSERT INTO permissions (permission_key, permission_name, category)
       VALUES ('org.register', 'Register Organization', 'organization')
       ON CONFLICT (permission_key) DO NOTHING`
    );

    ids.adminRoleId = await one(
      `INSERT INTO roles (role_name, display_name) VALUES ('access_test_admin', 'Access Test Admin')
       ON CONFLICT (role_name) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`
    );
    ids.parentRoleId = await one(
      `INSERT INTO roles (role_name, display_name) VALUES ('parent', 'Parent')
       ON CONFLICT (role_name) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`
    );
    await pool.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT $1, id FROM permissions
        WHERE permission_key IN ('participants.edit', 'users.edit', 'users.assign_roles', 'org.register')
       ON CONFLICT DO NOTHING`,
      [ids.adminRoleId]
    );

    ids.unitA = await createUnit('6A Access');
    ids.unitB = await createUnit('6B Access');
    await pool.query(
      `INSERT INTO organization_settings (organization_id, setting_key, setting_value)
       VALUES ($1, 'registration_password', '"sesame"')`,
      [ids.unitA]
    );

    ids.admin = await member('Admin A', ids.unitA, ids.adminRoleId);
    ids.parentA = await member('Parent A', ids.unitA, ids.parentRoleId);
    ids.parentB = await member('Parent B', ids.unitB, ids.parentRoleId);
    // A parent who belongs to both units.
    ids.parentBoth = await member('Parent Both', ids.unitA, ids.parentRoleId);
    await pool.query(
      `INSERT INTO user_organizations (user_id, organization_id, role_ids, status)
       VALUES ($1, $2, $3, 'active')`,
      [ids.parentBoth, ids.unitB, JSON.stringify([ids.parentRoleId])]
    );

    app = express();
    app.use(express.json());
    app.locals.pool = pool;
    app.use('/api/v1/participants', require('../routes/participants')(pool));
    app.use('/api/v1/users', require('../routes/users')(pool, console));
    app.use('/api/v1/organizations', require('../routes/organizations')(pool, console));
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  beforeEach(async () => {
    const made = await pool.query(
      'SELECT DISTINCT participant_id FROM participant_enrollments WHERE organization_id = ANY($1::int[])',
      [[ids.unitA, ids.unitB]]
    );
    const childIds = made.rows.map((row) => row.participant_id);
    if (childIds.length > 0) {
      await pool.query('DELETE FROM user_participants WHERE participant_id = ANY($1::int[])', [childIds]);
      await pool.query('DELETE FROM participant_access_grants WHERE participant_id = ANY($1::int[])', [childIds]);
      await pool.query('DELETE FROM participant_enrollments WHERE participant_id = ANY($1::int[])', [childIds]);
      await pool.query('DELETE FROM participants WHERE id = ANY($1::int[])', [childIds]);
    }
  });

  test('associate-user refuses a child from another unit', async () => {
    const elsewhere = await child('Elsewhere', ids.unitB);

    const response = await as(ids.admin).post('/api/v1/participants/associate-user')
      .send({ user_id: ids.parentA, participant_id: elsewhere });

    expect(response.status).toBe(404);
    expect(await sees(ids.parentA, elsewhere)).toBe(false);
  });

  test('associate-user refuses an account from another unit', async () => {
    const here = await child('Here', ids.unitA);

    const response = await as(ids.admin).post('/api/v1/participants/associate-user')
      .send({ user_id: ids.parentB, participant_id: here });

    expect(response.status).toBe(404);
    expect(await sees(ids.parentB, here)).toBe(false);
  });

  test('associate-user records the access as the administrator\'s', async () => {
    const here = await child('Here', ids.unitA);

    const response = await as(ids.admin).post('/api/v1/participants/associate-user')
      .send({ user_id: ids.parentA, participant_id: here });

    expect(response.status).toBe(200);
    expect(await sees(ids.parentA, here)).toBe(true);
    expect(await liveGrants(ids.parentA, here)).toEqual([{ source_type: 'admin', source_id: ids.admin }]);
  });

  test('users/associate-participant is held to the same unit', async () => {
    const elsewhere = await child('Elsewhere', ids.unitB);
    const here = await child('Here', ids.unitA);

    const refused = await as(ids.admin).post('/api/v1/users/associate-participant')
      .send({ user_id: ids.parentA, participant_id: elsewhere });
    const allowed = await as(ids.admin).post('/api/v1/users/associate-participant')
      .send({ user_id: ids.parentA, participant_id: here });

    expect(refused.status).toBe(404);
    expect(allowed.status).toBe(200);
    expect(await liveGrants(ids.parentA, here)).toEqual([{ source_type: 'admin', source_id: ids.admin }]);
  });

  test('unlinking a parent removes every reason they had, family links included', async () => {
    const here = await child('Here', ids.unitA);
    await grantParticipantAccess(pool, { participantId: here, userId: ids.parentA, sourceType: ACCESS_SOURCE.DIRECT });
    await grantParticipantAccess(pool, {
      participantId: here, userId: ids.parentA, sourceType: ACCESS_SOURCE.FAMILY_LINK, sourceId: 999,
    });

    const response = await as(ids.admin).delete(`/api/v1/participants/${here}/users/${ids.parentA}`);

    expect(response.status).toBe(200);
    expect(await sees(ids.parentA, here)).toBe(false);
    expect(await liveGrants(ids.parentA, here)).toEqual([]);
  });

  test('replace_all rewrites a parent\'s links in this unit and leaves the other unit alone', async () => {
    const oldHere = await child('Old here', ids.unitA);
    const newHere = await child('New here', ids.unitA);
    const inOtherUnit = await child('Other unit', ids.unitB);
    for (const participantId of [oldHere, inOtherUnit]) {
      // eslint-disable-next-line no-await-in-loop
      await grantParticipantAccess(pool, { participantId, userId: ids.parentBoth, sourceType: ACCESS_SOURCE.DIRECT });
    }

    const response = await as(ids.admin).post('/api/v1/participants/link-users')
      .send({ user_id: ids.parentBoth, participant_ids: [newHere], replace_all: true });

    expect(response.status).toBe(200);
    expect(await sees(ids.parentBoth, oldHere)).toBe(false);
    expect(await sees(ids.parentBoth, newHere)).toBe(true);
    // Not this administrator's unit, so not this administrator's to erase.
    expect(await sees(ids.parentBoth, inOtherUnit)).toBe(true);
    expect(await liveGrants(ids.parentBoth, newHere)).toEqual([{ source_type: 'admin', source_id: ids.admin }]);
  });

  test('users/link-participants replace_all is scoped the same way', async () => {
    const newHere = await child('New here', ids.unitA);
    const inOtherUnit = await child('Other unit', ids.unitB);
    await grantParticipantAccess(pool, {
      participantId: inOtherUnit, userId: ids.parentBoth, sourceType: ACCESS_SOURCE.DIRECT,
    });

    const response = await as(ids.admin).post('/api/v1/users/link-participants')
      .send({ user_id: ids.parentBoth, participant_ids: [newHere], replace_all: true });

    expect(response.status).toBe(200);
    expect(await sees(ids.parentBoth, newHere)).toBe(true);
    expect(await sees(ids.parentBoth, inOtherUnit)).toBe(true);
  });

  test('an administrator linking themselves holds the access directly', async () => {
    const here = await child('Here', ids.unitA);

    await as(ids.admin).post('/api/v1/participants/link-users').send({ participant_ids: [here] });

    expect(await liveGrants(ids.admin, here)).toEqual([{ source_type: 'direct', source_id: null }]);
  });

  test('registering to a unit links only that unit\'s children', async () => {
    const here = await child('Here', ids.unitA);
    const elsewhere = await child('Elsewhere', ids.unitB);
    // requirePermission reads permissions in the unit on the token, so only
    // someone already holding org.register *in this unit* can reach the route.
    // It cannot be used to join a unit one is not already in -- the linking
    // behaviour is what this test holds, so the caller is made a member first.
    const newcomer = await member('Newcomer', ids.unitA, ids.adminRoleId);

    const response = await as(newcomer, ids.unitA).post('/api/v1/organizations/register')
      .send({ registration_password: 'sesame', link_children: [here, elsewhere] });

    expect(response.status).toBe(200);
    expect(await sees(newcomer, here)).toBe(true);
    expect(await liveGrants(newcomer, here)).toEqual([{ source_type: 'direct', source_id: null }]);
    expect(await sees(newcomer, elsewhere)).toBe(false);
  });

  describe('POST /participants/save', () => {
    // Roles as the registration form meets them: parents hold
    // participants.create (the form cannot save without it), staff also hold
    // participants.edit.
    beforeAll(async () => {
      ids.saveParentRoleId = await one(
        `INSERT INTO roles (role_name, display_name) VALUES ('save_test_parent', 'Save Test Parent')
         ON CONFLICT (role_name) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`
      );
      ids.saveStaffRoleId = await one(
        `INSERT INTO roles (role_name, display_name) VALUES ('save_test_staff', 'Save Test Staff')
         ON CONFLICT (role_name) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`
      );
      await pool.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
          WHERE (r.id = $1 AND p.permission_key = 'participants.create')
             OR (r.id = $2 AND p.permission_key IN ('participants.create', 'participants.edit'))
         ON CONFLICT DO NOTHING`,
        [ids.saveParentRoleId, ids.saveStaffRoleId]
      );
      ids.saveParent = await member('Save Parent', ids.unitA, ids.saveParentRoleId);
      ids.saveStaff = await member('Save Staff', ids.unitA, ids.saveStaffRoleId);
      ids.denA = await one(
        "INSERT INTO groups (name, organization_id) VALUES ('Tanière rouge', $1) RETURNING id",
        [ids.unitA]
      );
    });

    /**
     * Save through the route as a given account.
     *
     * @param {string} userId - Acting account
     * @param {Object} body - Request body
     * @param {number} [organizationId] - Unit on the token
     * @returns {Promise<Object>} Supertest response
     */
    function save(userId, body, organizationId = ids.unitA) {
      return as(userId, organizationId).post('/api/v1/participants/save').send(body);
    }

    /**
     * A child's current name.
     *
     * @param {number} participantId - Child
     * @returns {Promise<string>} First name
     */
    function nameOf(participantId) {
      return one('SELECT first_name FROM participants WHERE id = $1', [participantId]);
    }

    test('a parent can correct their own child', async () => {
      const mine = await child('Mine', ids.unitA);
      await grantParticipantAccess(pool, { participantId: mine, userId: ids.saveParent, sourceType: ACCESS_SOURCE.DIRECT });

      const response = await save(ids.saveParent, { id: mine, first_name: 'Corrected', last_name: 'Access' });

      expect(response.status).toBe(200);
      expect(await nameOf(mine)).toBe('Corrected');
    });

    test('a parent cannot rename another family\'s child in the same unit', async () => {
      const theirs = await child('Theirs', ids.unitA);

      const response = await save(ids.saveParent, { id: theirs, first_name: 'Hijacked', last_name: 'Access' });

      expect(response.status).toBe(404);
      expect(await nameOf(theirs)).toBe('Theirs');
    });

    test('nobody can rename a child in another unit by guessing its id', async () => {
      const elsewhere = await child('Elsewhere', ids.unitB);

      const asParent = await save(ids.saveParent, { id: elsewhere, first_name: 'Hijacked', last_name: 'Access' });
      const asStaff = await save(ids.saveStaff, { id: elsewhere, first_name: 'Hijacked', last_name: 'Access' });

      expect(asParent.status).toBe(404);
      expect(asStaff.status).toBe(404);
      expect(await nameOf(elsewhere)).toBe('Elsewhere');
    });

    test('a parent linked to a child in another unit still cannot edit it from this one', async () => {
      const elsewhere = await child('Elsewhere', ids.unitB);
      await grantParticipantAccess(pool, { participantId: elsewhere, userId: ids.saveParent, sourceType: ACCESS_SOURCE.DIRECT });

      const response = await save(ids.saveParent, { id: elsewhere, first_name: 'Changed', last_name: 'Access' });

      expect(response.status).toBe(404);
      expect(await nameOf(elsewhere)).toBe('Elsewhere');
    });

    test('an unknown id and someone else\'s child get the same answer', async () => {
      const theirs = await child('Theirs', ids.unitA);

      const someoneElse = await save(ids.saveParent, { id: theirs, first_name: 'X', last_name: 'Y' });
      const nobody = await save(ids.saveParent, { id: 999999999, first_name: 'X', last_name: 'Y' });

      expect([someoneElse.status, someoneElse.body.message]).toEqual([nobody.status, nobody.body.message]);
    });

    test('staff can correct any child of their unit, and place them in a den', async () => {
      const anyChild = await child('Any', ids.unitA);

      const response = await save(ids.saveStaff, {
        id: anyChild, first_name: 'Fixed', last_name: 'Access', group_id: ids.denA,
      });

      expect(response.status).toBe(200);
      expect(await nameOf(anyChild)).toBe('Fixed');
      expect(await one(
        'SELECT group_id FROM participant_group_assignments WHERE participant_id = $1',
        [anyChild]
      )).toBe(ids.denA);
    });

    test('a parent cannot choose a den, even for their own child', async () => {
      const mine = await child('Mine', ids.unitA);
      await grantParticipantAccess(pool, { participantId: mine, userId: ids.saveParent, sourceType: ACCESS_SOURCE.DIRECT });

      const response = await save(ids.saveParent, {
        id: mine, first_name: 'Mine', last_name: 'Access', group_id: ids.denA,
      });

      expect(response.status).toBe(403);
      expect(response.body.required).toEqual(['participants.edit']);
      expect(response.body.missing).toEqual(['participants.edit']);
      expect(await one('SELECT count(*) FROM participant_group_assignments WHERE participant_id = $1', [mine]))
        .toBe('0');
    });

    test('the registration form\'s own request -- a new child, no den -- still works for a parent', async () => {
      const response = await save(ids.saveParent, {
        first_name: 'Newborn', last_name: 'Access', date_naissance: '2019-01-01',
      });

      expect(response.status).toBe(200);
      expect(response.body.data.participant_id).toEqual(expect.any(Number));
    });

    test('a malformed id is refused before it reaches the database', async () => {
      const response = await save(ids.saveStaff, { id: '1; DROP TABLE participants', first_name: 'X', last_name: 'Y' });

      expect(response.status).toBe(400);
    });
  });

});
