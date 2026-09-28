/**
 * Guardians of a child — integration suite
 *
 * The Parent/Guardian section of a child's form, and the emergency contacts
 * built from it, list the child's guardians. The people who registered the
 * child, or were given access to it, are its parents too: they are offered
 * pre-filled from their accounts until their contact record is linked.
 *
 * A parent reads and saves the guardians of their own children only. Holding
 * guardians.view or guardians.manage on a role limited to its own children
 * does not open another family's contacts.
 *
 * Skipped unless SCOUT_YEAR_TEST_DATABASE_URL (or TEST_DATABASE_URL) points at
 * a disposable database holding the project schema and permission catalog.
 *
 * @module test/guardians-access.integration
 */

const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');

require('./jest-conditional-helpers');

const DATABASE_URL = process.env.SCOUT_YEAR_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL;

process.env.JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || 'guardians-access-integration-secret';

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

describe.skipIf(!DATABASE_URL)('Guardians of a child', () => {
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
   * @param {string} fullName - Display name
   * @param {number} roleId - Role
   * @returns {Promise<{id: string, email: string}>} The user
   */
  async function member(fullName, roleId) {
    const row = await pool.query(
      `INSERT INTO users (email, password, full_name)
       VALUES (lower(split_part($1, ' ', 1)) || '-' || gen_random_uuid() || '@example.test', 'x', $1)
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
   * A child enrolled in the unit.
   *
   * @param {string} firstName - Name
   * @returns {Promise<number>} Participant ID
   */
  async function child(firstName) {
    const childId = await one(
      "INSERT INTO participants (first_name, last_name, date_naissance) VALUES ($1, 'Test', '2016-01-01') RETURNING id",
      [firstName]
    );
    await pool.query(
      'INSERT INTO participant_enrollments (participant_id, organization_id, scout_year_id) VALUES ($1, $2, $3)',
      [childId, ids.unit, ids.year]
    );
    return childId;
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

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });

    // The program section and its unit reference each other; the key is
    // checked at commit.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const created = await client.query("INSERT INTO organizations (name) VALUES ('Guardians unit') RETURNING id");
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

    const family = await role('family_g', 'linked', ['participants.view']);
    // Holds the guardian permissions, but only sees its own children.
    const familyWithGuardians = await role('family_gp', 'linked', ['guardians.view', 'guardians.manage']);
    const staff = await role('staff_g', 'organization', ['guardians.view', 'guardians.manage']);

    ids.alice = await member('Alice Tremblay', family);
    ids.carole = await member('Carole Gagnon', family);
    ids.bob = await member('Bob Roy', familyWithGuardians);
    ids.staff = await member('Akela Staff', staff);

    // Alice registered: her contact record exists and knows her account, but
    // was never linked to the child. Carole was given access and has no record.
    ids.aliceRecord = await one(
      `INSERT INTO parents_guardians (nom, prenom, courriel, telephone_cellulaire, user_uuid)
       VALUES ('Tremblay', 'Alice', $1, '819-555-0100', $2) RETURNING id`,
      [ids.alice.email, ids.alice.id]
    );

    ids.lea = await child('Léa');
    ids.noe = await child('Noé');
    await grantParticipantAccess(pool, { participantId: ids.lea, userId: ids.alice.id, sourceType: ACCESS_SOURCE.DIRECT });
    await grantParticipantAccess(pool, { participantId: ids.lea, userId: ids.carole.id, sourceType: ACCESS_SOURCE.DIRECT });
    await grantParticipantAccess(pool, { participantId: ids.noe, userId: ids.bob.id, sourceType: ACCESS_SOURCE.DIRECT });

    app = express();
    app.use(express.json());
    app.locals.pool = pool;
    app.use('/api/v1/guardians', require('../routes/guardians')(pool));
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  test('a parent sees the child\'s account holders, pre-filled, before any record is linked', async () => {
    const response = await as(ids.alice.id).get('/api/v1/guardians').query({ participant_id: ids.lea });

    expect(response.status).toBe(200);
    const byEmail = Object.fromEntries(response.body.data.map((g) => [g.courriel, g]));
    expect(Object.keys(byEmail).sort()).toEqual([ids.alice.email, ids.carole.email].sort());

    // From her contact record.
    expect(byEmail[ids.alice.email]).toMatchObject({
      guardian_id: ids.aliceRecord, nom: 'Tremblay', prenom: 'Alice', telephone_cellulaire: '819-555-0100', linked: false,
    });
    // From her account alone.
    expect(byEmail[ids.carole.email]).toMatchObject({
      guardian_id: null, nom: 'Gagnon', prenom: 'Carole', linked: false,
    });
  });

  test('saving an account holder links their record to the child, once', async () => {
    const response = await as(ids.alice.id).post('/api/v1/guardians').send({
      participant_id: ids.lea,
      guardian_id: ids.aliceRecord,
      nom: 'Tremblay',
      prenom: 'Alice',
      courriel: ids.alice.email,
      telephone_cellulaire: '819-555-0100',
      is_emergency_contact: true,
      lien: 'mère',
    });

    expect(response.status).toBe(200);
    const listed = await as(ids.alice.id).get('/api/v1/guardians').query({ participant_id: ids.lea });
    const alice = listed.body.data.filter((g) => g.courriel === ids.alice.email);
    expect(alice).toHaveLength(1);
    expect(alice[0]).toMatchObject({ guardian_id: ids.aliceRecord, linked: true, lien: 'mère', is_emergency_contact: true });
  });

  test('saving an account holder with no record creates one tied to their account', async () => {
    const response = await as(ids.alice.id).post('/api/v1/guardians').send({
      participant_id: ids.lea,
      nom: 'Gagnon',
      prenom: 'Carole',
      courriel: ids.carole.email,
    });

    expect(response.status).toBe(200);
    expect(await one('SELECT user_uuid FROM parents_guardians WHERE id = $1', [response.body.data.guardian_id]))
      .toBe(ids.carole.id);
    expect(await one(
      'SELECT count(*) FROM participant_guardians WHERE guardian_id = $1 AND participant_id = $2',
      [response.body.data.guardian_id, ids.lea]
    )).toBe('1');
  });

  test('another family cannot read the child\'s guardians, even holding guardians.view', async () => {
    const response = await as(ids.bob.id).get('/api/v1/guardians').query({ participant_id: ids.lea });

    expect(response.status).toBe(403);
    expect(response.body.missing).toEqual(['guardians.view']);
  });

  test('another family cannot write to the child\'s guardians, even holding guardians.manage', async () => {
    const response = await as(ids.bob.id).post('/api/v1/guardians').send({
      participant_id: ids.lea, guardian_id: ids.aliceRecord, nom: 'X', prenom: 'Y',
    });

    expect(response.status).toBe(403);
    expect(await one('SELECT nom FROM parents_guardians WHERE id = $1', [ids.aliceRecord])).toBe('Tremblay');
  });

  test('a parent cannot edit another family\'s guardian through their own child', async () => {
    const response = await as(ids.bob.id).post('/api/v1/guardians').send({
      participant_id: ids.noe, guardian_id: ids.aliceRecord, nom: 'X', prenom: 'Y',
    });

    expect(response.status).toBe(403);
    expect(await one('SELECT nom FROM parents_guardians WHERE id = $1', [ids.aliceRecord])).toBe('Tremblay');
  });

  test('an id that is not a positive integer is a 400, not a 500', async () => {
    const read = await as(ids.alice.id).get('/api/v1/guardians').query({ participant_id: 'abc' });
    const write = await as(ids.alice.id).post('/api/v1/guardians').send({
      participant_id: ids.lea, guardian_id: '1.5', nom: 'X', prenom: 'Y',
    });

    expect(read.status).toBe(400);
    expect(write.status).toBe(400);
  });

  test('an inactive member keeps no access through their child link', async () => {
    const family = await one('SELECT role_ids->>0 FROM user_organizations WHERE user_id = $1', [ids.alice.id]);
    const former = await member('Former Member', Number(family));
    await grantParticipantAccess(pool, { participantId: ids.lea, userId: former.id, sourceType: ACCESS_SOURCE.DIRECT });
    await pool.query("UPDATE user_organizations SET status = 'inactive' WHERE user_id = $1", [former.id]);

    const response = await as(former.id).get('/api/v1/guardians').query({ participant_id: ids.lea });

    expect(response.status).toBe(403);
  });

  test('an address that moved to another account does not hand over the first account\'s record', async () => {
    const family = await one('SELECT role_ids->>0 FROM user_organizations WHERE user_id = $1', [ids.alice.id]);
    // Denise's record keeps her old address after she changed her login email.
    const denise = await member('Denise Old', Number(family));
    const oldAddress = `old-${suffix}@example.test`;
    const deniseRecord = await one(
      `INSERT INTO parents_guardians (nom, prenom, courriel, telephone_cellulaire, user_uuid)
       VALUES ('Old', 'Denise', $1, '819-555-0199', $2) RETURNING id`,
      [oldAddress, denise.id]
    );
    // Another account now signs in with that address and has access to Léa.
    const newcomer = await member('Newcomer Account', Number(family));
    await pool.query('UPDATE users SET email = $1 WHERE id = $2', [oldAddress, newcomer.id]);
    await grantParticipantAccess(pool, { participantId: ids.lea, userId: newcomer.id, sourceType: ACCESS_SOURCE.DIRECT });

    const listed = await as(newcomer.id).get('/api/v1/guardians').query({ participant_id: ids.lea });
    const offered = listed.body.data.find((g) => g.courriel === oldAddress);
    expect(offered).toMatchObject({ guardian_id: null, prenom: 'Newcomer' });
    expect(offered.telephone_cellulaire).toBeFalsy();

    const write = await as(newcomer.id).post('/api/v1/guardians').send({
      participant_id: ids.lea, guardian_id: deniseRecord, nom: 'Taken', prenom: 'Over',
    });
    expect(write.status).toBe(403);
    expect(await one('SELECT nom FROM parents_guardians WHERE id = $1', [deniseRecord])).toBe('Old');
  });

  test('a new record is tied only to an account that is an active member of this unit', async () => {
    const family = await one('SELECT role_ids->>0 FROM user_organizations WHERE user_id = $1', [ids.alice.id]);
    const elsewhere = await member('Elsewhere Only', Number(family));
    await pool.query("UPDATE user_organizations SET status = 'inactive' WHERE user_id = $1", [elsewhere.id]);
    await grantParticipantAccess(pool, { participantId: ids.lea, userId: elsewhere.id, sourceType: ACCESS_SOURCE.DIRECT });

    const response = await as(ids.alice.id).post('/api/v1/guardians').send({
      participant_id: ids.lea, nom: 'Only', prenom: 'Elsewhere', courriel: elsewhere.email,
    });

    expect(response.status).toBe(200);
    expect(await one('SELECT user_uuid FROM parents_guardians WHERE id = $1', [response.body.data.guardian_id]))
      .toBeNull();
  });

  test('staff who see the whole unit read any child\'s guardians', async () => {
    const response = await as(ids.staff.id).get('/api/v1/guardians').query({ participant_id: ids.lea });

    expect(response.status).toBe(200);
    expect(response.body.data.length).toBeGreaterThan(0);
  });
});
