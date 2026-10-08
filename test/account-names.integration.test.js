/**
 * One name per person — integration suite
 *
 * A family member's account and their contact record carry the same name.
 * The contact record (the one the unit calls in an emergency) owns it: the
 * account screens show it, and a save on either side brings the other in line.
 * A parent who typed their child's name at sign-up no longer appears as their
 * child's parent once their own contact record names them.
 *
 * Skipped unless SCOUT_YEAR_TEST_DATABASE_URL (or TEST_DATABASE_URL) points at
 * a disposable database holding the project schema and permission catalog.
 *
 * @module test/account-names.integration
 */

const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');

require('./jest-conditional-helpers');

const DATABASE_URL = process.env.SCOUT_YEAR_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL;

process.env.JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || 'account-names-integration-secret';

const mockContext = { userId: null, organizationId: null };

// Only authentication is faked; permissions and scope come from the database.
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

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

describe.skipIf(!DATABASE_URL)('One name per person', () => {
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
   * A role with the given scope and permissions.
   *
   * @param {string} name - Role name prefix
   * @param {string} dataScope - 'organization' or 'linked'
   * @param {string[]} permissionKeys - Permissions granted
   * @returns {Promise<number>} Role ID
   */
  async function role(name, dataScope, permissionKeys) {
    const roleId = await one(
      'INSERT INTO roles (role_name, display_name, data_scope) VALUES ($1, $1, $2) RETURNING id',
      [`${name}_${suffix}`, dataScope]
    );
    await pool.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT $1, id FROM permissions WHERE permission_key = ANY($2::text[])`,
      [roleId, permissionKeys]
    );
    return roleId;
  }

  /**
   * An account with an active membership in the unit.
   *
   * @param {string} fullName - Name on the account
   * @param {number} roleId - Role
   * @returns {Promise<{id: string, email: string}>} The user
   */
  async function member(fullName, roleId) {
    const row = await pool.query(
      `INSERT INTO users (email, password, full_name)
       VALUES ('names-' || gen_random_uuid() || '@example.test', 'x', $1)
       RETURNING id, email`,
      [fullName]
    );
    await pool.query(
      `INSERT INTO user_organizations (user_id, organization_id, role_ids, status)
       VALUES ($1, $2, $3, 'active')`,
      [row.rows[0].id, ids.unit, JSON.stringify([roleId])]
    );
    return row.rows[0];
  }

  /**
   * A child enrolled in the unit this year.
   *
   * @param {string} firstName - Given name
   * @param {string} lastName - Surname
   * @returns {Promise<number>} Participant ID
   */
  async function child(firstName, lastName) {
    const childId = await one(
      "INSERT INTO participants (first_name, last_name, date_naissance) VALUES ($1, $2, '2016-01-01') RETURNING id",
      [firstName, lastName]
    );
    await pool.query(
      'INSERT INTO participant_enrollments (participant_id, organization_id, scout_year_id) VALUES ($1, $2, $3)',
      [childId, ids.unit, ids.year]
    );
    return childId;
  }

  /**
   * A contact record owned by an account.
   *
   * @param {{id: string, email: string}} account - Owner
   * @param {string} prenom - Given name
   * @param {string} nom - Surname
   * @returns {Promise<number>} Guardian ID
   */
  function contact(account, prenom, nom) {
    return one(
      `INSERT INTO parents_guardians (nom, prenom, courriel, user_uuid)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [nom, prenom, account.email, account.id]
    );
  }

  /**
   * Act as a user.
   *
   * @param {string} userId - Acting user
   * @returns {Object} Supertest agent
   */
  function as(userId) {
    mockContext.userId = userId;
    mockContext.organizationId = ids.unit;
    return request(app);
  }

  /**
   * The name on an account.
   *
   * @param {string} userId - Account
   * @returns {Promise<string>} users.full_name
   */
  function accountName(userId) {
    return one('SELECT full_name FROM users WHERE id = $1', [userId]);
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });

    // The program section and its unit reference each other; the key is
    // checked at commit.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const created = await client.query("INSERT INTO organizations (name) VALUES ('Names unit') RETURNING id");
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

    ids.family = await role('names_family', 'linked', ['participants.view', 'guardians.view', 'guardians.manage']);
    ids.staffRole = await role('names_staff', 'organization', ['participants.view', 'guardians.view', 'guardians.manage']);
    ids.staff = await member('Akela Staff', ids.staffRole);

    app = express();
    app.use(express.json());
    app.locals.pool = pool;
    app.use('/api/v1/guardians', require('../routes/guardians')(pool));
    app.use('/api/v1/participants', require('../routes/participants')(pool));
    app.use('/api/v1/users/me', require('../routes/userProfile')(pool, silentLogger));
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  test('a parent who signed up under their child\'s name is listed under their own', async () => {
    const parent = await member('Léo Bouchard', ids.family);
    await contact(parent, 'Julie', 'Bouchard');
    const leo = await child('Léo', 'Bouchard');
    await grantParticipantAccess(pool, { participantId: leo, userId: parent.id, sourceType: ACCESS_SOURCE.DIRECT });

    const response = await as(ids.staff.id).get('/api/v1/participants/with-users');

    expect(response.status).toBe(200);
    const row = response.body.data.participants.find((p) => p.id === leo);
    expect(row).toMatchObject({ user_id: parent.id, user_full_name: 'Julie Bouchard' });
    // Nothing was rewritten by reading.
    expect(await accountName(parent.id)).toBe('Léo Bouchard');
  });

  test('an account without a contact record keeps its own name', async () => {
    const staffName = await one('SELECT display_name FROM account_display_names WHERE user_id = $1', [ids.staff.id]);
    expect(staffName).toBe('Akela Staff');
  });

  test('saving one\'s own record on the guardian form renames the account', async () => {
    const parent = await member('Mia Lavoie', ids.family);
    const record = await contact(parent, 'Mia', 'Lavoie');
    const mia = await child('Mia', 'Lavoie');
    await grantParticipantAccess(pool, { participantId: mia, userId: parent.id, sourceType: ACCESS_SOURCE.DIRECT });

    const response = await as(parent.id).post('/api/v1/guardians').send({
      participant_id: mia, guardian_id: record, prenom: 'Sophie', nom: 'Lavoie', courriel: parent.email,
    });

    expect(response.status).toBe(200);
    expect(await accountName(parent.id)).toBe('Sophie Lavoie');
  });

  test('a contact without an account renames nobody', async () => {
    const parent = await member('Paul Côté', ids.family);
    const paulChild = await child('Zoé', 'Côté');
    await grantParticipantAccess(pool, { participantId: paulChild, userId: parent.id, sourceType: ACCESS_SOURCE.DIRECT });

    const response = await as(ids.staff.id).post('/api/v1/guardians').send({
      participant_id: paulChild, prenom: 'Grand', nom: 'Maman', courriel: `grandmaman-${suffix}@example.test`,
    });

    expect(response.status).toBe(200);
    expect(await one('SELECT user_uuid FROM parents_guardians WHERE courriel = $1', [`grandmaman-${suffix}@example.test`]))
      .toBeNull();
    expect(await accountName(parent.id)).toBe('Paul Côté');
    expect(await accountName(ids.staff.id)).toBe('Akela Staff');
  });

  test('the profile name saves, and the contact record keeps its surname whole', async () => {
    const parent = await member('Anne Tremblay Roy', ids.family);
    const record = await contact(parent, 'Anne', 'Tremblay Roy');

    const response = await as(parent.id).patch('/api/v1/users/me/name').send({ fullName: 'Anne-Marie Tremblay Roy' });

    expect(response.status).toBe(200);
    expect(response.body.data.full_name).toBe('Anne-Marie Tremblay Roy');
    const saved = await pool.query('SELECT prenom, nom FROM parents_guardians WHERE id = $1', [record]);
    expect(saved.rows[0]).toEqual({ prenom: 'Anne-Marie', nom: 'Tremblay Roy' });
  });

  test('a single word cannot rename someone who has a contact record', async () => {
    const parent = await member('Luc Gagnon', ids.family);
    const record = await contact(parent, 'Luc', 'Gagnon');

    const response = await as(parent.id).patch('/api/v1/users/me/name').send({ fullName: 'Lucien' });

    expect(response.status).toBe(400);
    expect(await accountName(parent.id)).toBe('Luc Gagnon');
    expect(await one('SELECT prenom FROM parents_guardians WHERE id = $1', [record])).toBe('Luc');
  });

  test('without a contact record, the profile name is the account\'s alone', async () => {
    const response = await as(ids.staff.id).patch('/api/v1/users/me/name').send({ fullName: 'Akela' });

    expect(response.status).toBe(200);
    expect(await accountName(ids.staff.id)).toBe('Akela');
    await pool.query("UPDATE users SET full_name = 'Akela Staff' WHERE id = $1", [ids.staff.id]);
  });

  test('the account page stores the first name as the first name', async () => {
    const parent = await member('Noah Fortin', ids.family);
    const noah = await child('Noah', 'Fortin');
    await grantParticipantAccess(pool, { participantId: noah, userId: parent.id, sourceType: ACCESS_SOURCE.DIRECT });

    const response = await as(parent.id).patch('/api/v1/users/me/guardian-profile')
      .send({ firstName: 'Chloé', lastName: 'Fortin' });

    expect(response.status).toBe(200);
    const saved = await pool.query('SELECT prenom, nom FROM parents_guardians WHERE user_uuid = $1', [parent.id]);
    expect(saved.rows).toEqual([{ prenom: 'Chloé', nom: 'Fortin' }]);
    expect(await accountName(parent.id)).toBe('Chloé Fortin');
  });
});
