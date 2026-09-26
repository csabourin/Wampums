/**
 * Walk-in children — integration suite
 *
 * A child shows up at a meeting before anyone in their family has an account.
 * A leader enters them -- name, birth date, one parent address -- so the unit
 * can take attendance from the first evening, and the parent is invited. When
 * the parent accepts, they find the child already in their file.
 *
 * Held here against a real database, with the real permission middleware:
 * leaders can do this without holding users.invite, parents cannot do it at
 * all, siblings share one invitation, an existing parent is linked on the spot,
 * a corrected address withdraws the wrong invitation, and a hand-removed member
 * is not quietly readmitted by a leader.
 *
 * Skipped unless SCOUT_YEAR_TEST_DATABASE_URL (or TEST_DATABASE_URL) points at
 * a disposable database holding the project schema.
 *
 * @module test/walk-in-children.integration
 */

const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');

require('./jest-conditional-helpers');

const DATABASE_URL = process.env.SCOUT_YEAR_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL;

process.env.JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || 'walk-in-integration-secret';

const sentEmails = [];

jest.mock('../utils/index', () => {
  const actual = jest.requireActual('../utils/index');
  return {
    ...actual,
    sendEmail: jest.fn(async (to, subject, message, html) => {
      // eslint-disable-next-line no-undef
      global.__walkInTestEmails.push({ to, subject, message, html });
      return true;
    }),
  };
});

global.__walkInTestEmails = sentEmails;

const mockContext = { userId: null, organizationId: null };

// Only authentication is faked; permissions are read from the database.
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

describe.skipIf(!DATABASE_URL)('Walk-in children', () => {
  let pool;
  let app;
  const ids = {};
  const DOMAIN = 'walk-in.example.org';

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
      const created = await client.query("INSERT INTO organizations (name, default_language) VALUES ($1, 'fr') RETURNING id", [name]);
      const organizationId = created.rows[0].id;
      await client.query(
        "INSERT INTO organization_program_sections (organization_id, section_key, display_name) VALUES ($1, 'general', 'General')",
        [organizationId]
      );
      await client.query('COMMIT');
      await pool.query(
        "INSERT INTO scout_years (organization_id, label, start_date, end_date, status) VALUES ($1, '2026-2027', '2026-09-01', '2027-08-31', 'active')",
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
   * A role with exactly these permissions.
   *
   * @param {string} name - Role name
   * @param {Array<string>} keys - Permission keys
   * @param {string} [scope] - Data scope
   * @returns {Promise<number>} Role id
   */
  async function role(name, keys, scope = 'organization') {
    const roleId = await one(
      `INSERT INTO roles (role_name, display_name, data_scope) VALUES ($1, $1, $2)
       ON CONFLICT (role_name) DO UPDATE SET data_scope = EXCLUDED.data_scope RETURNING id`,
      [name, scope]
    );
    await pool.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);
    await pool.query(
      'INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE permission_key = ANY($2::text[])',
      [roleId, keys]
    );
    return roleId;
  }

  /**
   * An account with an active membership in the test unit.
   *
   * @param {string} label - Name and address prefix
   * @param {number} roleId - Role
   * @returns {Promise<{id: string, email: string}>} The account
   */
  async function member(label, roleId) {
    const email = `${label.toLowerCase().replace(/\s+/g, '.')}-${Date.now()}-${Math.round(Math.random() * 1e6)}@${DOMAIN}`;
    const userId = await one(
      "INSERT INTO users (email, password, full_name) VALUES ($1, 'x', $2) RETURNING id",
      [email, label]
    );
    await pool.query(
      "INSERT INTO user_organizations (user_id, organization_id, role_ids, status) VALUES ($1, $2, $3, 'active')",
      [userId, ids.unit, JSON.stringify([roleId])]
    );
    return { id: userId, email };
  }

  /**
   * Act as an account.
   *
   * @param {string} userId - Acting account
   * @returns {Object} Supertest
   */
  function as(userId) {
    mockContext.userId = userId;
    mockContext.organizationId = ids.unit;
    return request(app);
  }

  /**
   * Add a walk-in child as someone.
   *
   * @param {string} userId - Acting account
   * @param {Object} body - Request body
   * @returns {Promise<Object>} Supertest response
   */
  function walkIn(userId, body) {
    return as(userId).post('/api/v1/walk-in-children').send({
      first_name: 'Noah',
      last_name: 'Walker',
      date_naissance: '2016-04-04',
      ...body,
    });
  }

  /** @returns {string} The token in the most recent invitation email */
  function lastToken() {
    const last = sentEmails[sentEmails.length - 1];
    return decodeURIComponent(/complete-registration\?token=([^"\s&]+)/.exec(last.message)[1]);
  }

  /**
   * Whether an account can see a child.
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

  beforeAll(async () => {
    process.env.PUBLIC_BASE_URL = 'https://unit.example.org';
    pool = new Pool({ connectionString: DATABASE_URL });

    ids.unit = await createUnit('6A Walk-in Test');
    // What production looks like: leaders create and edit participants and got
    // walk_in from migration 008; admins also invite; parents hold create --
    // the paperwork form needs it -- but nothing else of the kind.
    ids.leaderRole = await role('walk_in_test_leader', ['participants.view', 'participants.create', 'participants.edit', 'participants.walk_in']);
    ids.adminRole = await role('walk_in_test_admin', ['participants.view', 'participants.create', 'participants.edit', 'participants.walk_in', 'users.invite']);
    ids.parentRole = await role('parent', ['participants.view', 'participants.create', 'participants.create_own'], 'linked');

    ids.leader = await member('Leader Lea', ids.leaderRole);
    ids.admin = await member('Admin Ada', ids.adminRole);
    ids.parent = await member('Existing Parent', ids.parentRole);

    app = express();
    app.use(express.json());
    app.locals.pool = pool;
    app.use('/api/v1/walk-in-children', require('../routes/walkInChildren')(pool, console));
    app.use('/api/v1/public', require('../routes/public')(pool, console));
    app.use('/api/v1/parent-onboarding', require('../routes/parentOnboarding')(pool, console));
  });

  afterAll(async () => {
    delete process.env.PUBLIC_BASE_URL;
    if (pool) await pool.end();
  });

  beforeEach(async () => {
    sentEmails.length = 0;
    const made = await pool.query(
      'SELECT DISTINCT participant_id FROM participant_enrollments WHERE organization_id = $1',
      [ids.unit]
    );
    const childIds = made.rows.map((row) => row.participant_id);
    if (childIds.length) {
      for (const table of ['participant_guardians', 'user_participants', 'participant_access_grants', 'participant_duplicate_candidates', 'participant_enrollments']) {
        const column = table === 'participant_duplicate_candidates' ? 'participant_id_low' : 'participant_id';
        // Table names come from this literal list.
        // eslint-disable-next-line no-await-in-loop
        await pool.query(`DELETE FROM ${table} WHERE ${column} = ANY($1::int[])`, [childIds]);
      }
      await pool.query('DELETE FROM participants WHERE id = ANY($1::int[])', [childIds]);
    }
    await pool.query('DELETE FROM parent_invitations WHERE organization_id = $1', [ids.unit]);
    await pool.query(`DELETE FROM user_organizations WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@new.${DOMAIN}')`);
    await pool.query(`DELETE FROM guardian_users WHERE guardian_id IN (SELECT id FROM parents_guardians WHERE courriel LIKE '%@new.${DOMAIN}')`);
    await pool.query(`DELETE FROM parents_guardians WHERE courriel LIKE '%@new.${DOMAIN}'`);
    await pool.query(`DELETE FROM users WHERE email LIKE '%@new.${DOMAIN}'`);
  });

  test('a leader enters a child and the parent is invited, without users.invite', async () => {
    const response = await walkIn(ids.leader.id, { parent_email: `maman@new.${DOMAIN}` });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ parent: 'invited', email_sent: true });
    const childId = response.body.data.participant_id;

    // On this year's roster from the first evening.
    expect(await one(
      "SELECT count(*) FROM participant_enrollments pe JOIN scout_years sy ON sy.id = pe.scout_year_id WHERE pe.participant_id = $1 AND sy.status = 'active'",
      [childId]
    )).toBe('1');
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toBe(`maman@new.${DOMAIN}`);
  });

  test('the email says it is for a child but never names the child', async () => {
    await walkIn(ids.leader.id, { first_name: 'Hortense', parent_email: `maman@new.${DOMAIN}`, language: 'fr' });

    const { message, html } = sentEmails[0];
    expect(message).toContain('votre enfant');
    expect(message).not.toContain('Hortense');
    expect(html).not.toContain('Hortense');
  });

  test('the child is listed as waiting for a parent, with the invitation', async () => {
    const added = await walkIn(ids.leader.id, { parent_email: `maman@new.${DOMAIN}` });

    const list = await as(ids.leader.id).get('/api/v1/walk-in-children');

    expect(list.status).toBe(200);
    expect(list.body.data).toEqual([
      expect.objectContaining({
        id: added.body.data.participant_id,
        first_name: 'Noah',
        invitation: expect.objectContaining({ email: `maman@new.${DOMAIN}`, state: 'pending' }),
      }),
    ]);
  });

  test('siblings under one address share one invitation and one email', async () => {
    const first = await walkIn(ids.leader.id, { first_name: 'Noah', parent_email: `maman@new.${DOMAIN}` });
    const second = await walkIn(ids.leader.id, { first_name: 'Emma', parent_email: `maman@new.${DOMAIN}` });

    expect(second.body.data.parent).toBe('added_to_invitation');
    expect(second.body.data.email_sent).toBeNull();
    expect(sentEmails).toHaveLength(1);
    expect(await one('SELECT count(*) FROM parent_invitations WHERE organization_id = $1', [ids.unit])).toBe('1');
    expect(await one(
      'SELECT count(*) FROM parent_invitation_participants WHERE participant_id = ANY($1::int[])',
      [[first.body.data.participant_id, second.body.data.participant_id]]
    )).toBe('2');
  });

  test('accepting links the parent to every child the invitation was for', async () => {
    const first = await walkIn(ids.leader.id, { first_name: 'Noah', parent_email: `maman@new.${DOMAIN}` });
    const second = await walkIn(ids.leader.id, { first_name: 'Emma', parent_email: `maman@new.${DOMAIN}` });

    const accepted = await request(app).post('/api/v1/public/parent-invitations/accept')
      .send({ token: lastToken(), first_name: 'Marie', last_name: 'Walker', password: 'Walkin2026!' });
    expect(accepted.body.data.result).toBe('account_created');

    const parentId = await one('SELECT id FROM users WHERE email = $1', [`maman@new.${DOMAIN}`]);
    expect(await sees(parentId, first.body.data.participant_id)).toBe(true);
    expect(await sees(parentId, second.body.data.participant_id)).toBe(true);
    // Recorded as the leader's grant: it can be traced, and removed on its own.
    expect(await one(
      "SELECT source_id FROM participant_access_grants WHERE user_id = $1 AND participant_id = $2 AND source_type = 'admin'",
      [parentId, first.body.data.participant_id]
    )).toBe(ids.leader.id);
    // The parent is this child's guardian contact, not merely someone who may see the file.
    expect(await one(
      'SELECT count(*) FROM participant_guardians pg JOIN parents_guardians g ON g.id = pg.guardian_id WHERE g.user_uuid = $1',
      [parentId]
    )).toBe('2');

    // They land on "register your children" already seeing both.
    mockContext.userId = parentId;
    const context = await request(app).get('/api/v1/parent-onboarding/context');
    expect(context.body.data.children.map((c) => c.first_name).sort()).toEqual(['Emma', 'Noah']);

    // And the children leave the waiting list.
    const list = await as(ids.leader.id).get('/api/v1/walk-in-children');
    expect(list.body.data).toEqual([]);
  });

  test('an address that is already a parent here is linked at once, with no invitation', async () => {
    const response = await walkIn(ids.leader.id, { parent_email: ids.parent.email });

    expect(response.status).toBe(201);
    expect(response.body.data.parent).toBe('linked_existing_account');
    expect(sentEmails).toHaveLength(0);
    expect(await sees(ids.parent.id, response.body.data.participant_id)).toBe(true);
    expect(await one('SELECT count(*) FROM parent_invitations WHERE organization_id = $1', [ids.unit])).toBe('0');
  });

  test('a child already in the unit is refused, and the existing record is named', async () => {
    const first = await walkIn(ids.leader.id, { parent_email: `maman@new.${DOMAIN}` });

    const again = await walkIn(ids.leader.id, { first_name: ' noah ', last_name: 'WALKER', parent_email: `papa@new.${DOMAIN}` });

    expect(again.status).toBe(409);
    expect(again.body.code).toBe('duplicate_child');
    expect(again.body.data.existing.id).toBe(first.body.data.participant_id);
  });

  test('a parent cannot enter walk-ins, though they hold participants.create', async () => {
    const response = await walkIn(ids.parent.id, { parent_email: `someone@new.${DOMAIN}` });

    expect(response.status).toBe(403);
    expect(response.body.missing).toEqual(['participants.walk_in']);
    expect(sentEmails).toHaveLength(0);
  });

  test('correcting a mistyped address moves the child and withdraws the wrong link', async () => {
    const added = await walkIn(ids.leader.id, { parent_email: `mamman@new.${DOMAIN}` });
    const wrongInvitation = await one('SELECT id FROM parent_invitations WHERE email = $1', [`mamman@new.${DOMAIN}`]);

    const corrected = await as(ids.leader.id)
      .post(`/api/v1/walk-in-children/${added.body.data.participant_id}/invite`)
      .send({ parent_email: `maman@new.${DOMAIN}` });

    expect(corrected.status).toBe(200);
    expect(corrected.body.data).toMatchObject({ parent: 'invited', email_sent: true });
    expect(await one('SELECT status FROM parent_invitations WHERE id = $1', [wrongInvitation])).toBe('revoked');
    const list = await as(ids.leader.id).get('/api/v1/walk-in-children');
    expect(list.body.data[0].invitation.email).toBe(`maman@new.${DOMAIN}`);
  });

  test('a child who already has a parent account is not re-invited', async () => {
    const added = await walkIn(ids.leader.id, { parent_email: ids.parent.email });

    const response = await as(ids.leader.id)
      .post(`/api/v1/walk-in-children/${added.body.data.participant_id}/invite`)
      .send({ parent_email: `other@new.${DOMAIN}` });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('already_has_parent');
  });

  test('a leader cannot readmit someone an administrator removed; an admin can, with a reason', async () => {
    const removed = await one(
      "INSERT INTO users (email, password, full_name) VALUES ($1, 'x', 'Removed') RETURNING id",
      [`removed@new.${DOMAIN}`]
    );
    await pool.query(
      "INSERT INTO user_organizations (user_id, organization_id, role_ids, status, deactivated_reason) VALUES ($1, $2, '[]', 'inactive', 'removed_by_admin')",
      [removed, ids.unit]
    );

    const byLeader = await walkIn(ids.leader.id, {
      parent_email: `removed@new.${DOMAIN}`,
      confirm_reactivation: true,
      reactivation_reason: 'I think it is fine',
    });
    expect(byLeader.status).toBe(409);
    expect(byLeader.body.code).toBe('manually_deactivated');
    expect(byLeader.body.data.can_override).toBe(false);
    // Nothing was created: not the child, not an invitation.
    expect(await one('SELECT count(*) FROM participant_enrollments WHERE organization_id = $1', [ids.unit])).toBe('0');

    const byAdmin = await walkIn(ids.admin.id, {
      parent_email: `removed@new.${DOMAIN}`,
      confirm_reactivation: true,
      reactivation_reason: 'Family returning, discussed with the committee',
    });
    expect(byAdmin.status).toBe(201);
    expect(await one('SELECT deactivation_override_reason FROM parent_invitations WHERE email = $1', [`removed@new.${DOMAIN}`]))
      .toBe('Family returning, discussed with the committee');
  });

  test('leaders may resend a walk-in invitation, and only those', async () => {
    await walkIn(ids.leader.id, { parent_email: `maman@new.${DOMAIN}` });
    const walkInInvitation = await one('SELECT id FROM parent_invitations WHERE email = $1', [`maman@new.${DOMAIN}`]);
    const plainInvitation = await one(
      `INSERT INTO parent_invitations (organization_id, email, token_digest, expires_at)
       VALUES ($1, $2, md5(random()::text) || md5(random()::text), now() + interval '7 days') RETURNING id`,
      [ids.unit, `plain@new.${DOMAIN}`]
    );

    const allowed = await as(ids.leader.id).post(`/api/v1/walk-in-children/invitations/${walkInInvitation}/resend`).send({});
    const refused = await as(ids.leader.id).post(`/api/v1/walk-in-children/invitations/${plainInvitation}/resend`).send({});

    expect(allowed.status).toBe(200);
    expect(allowed.body.data.email_sent).toBe(true);
    expect(refused.status).toBe(404);
  });

  test('joining a lapsed invitation refreshes it and mails the new link', async () => {
    await walkIn(ids.leader.id, { first_name: 'Noah', parent_email: `maman@new.${DOMAIN}` });
    await pool.query("UPDATE parent_invitations SET expires_at = now() - interval '1 day' WHERE email = $1", [`maman@new.${DOMAIN}`]);
    sentEmails.length = 0;

    const sibling = await walkIn(ids.leader.id, { first_name: 'Emma', parent_email: `maman@new.${DOMAIN}` });

    expect(sibling.body.data).toMatchObject({ parent: 'added_to_invitation', email_sent: true });
    expect(await one('SELECT expires_at > now() FROM parent_invitations WHERE email = $1', [`maman@new.${DOMAIN}`])).toBe(true);
  });

  test('refuses an unusable child or address before anything is created', async () => {
    const noBirthDate = await walkIn(ids.leader.id, { date_naissance: '', parent_email: `maman@new.${DOMAIN}` });
    const badAddress = await walkIn(ids.leader.id, { parent_email: 'not-an-address' });

    expect(noBirthDate.status).toBe(400);
    expect(badAddress.status).toBe(400);
    expect(await one('SELECT count(*) FROM participant_enrollments WHERE organization_id = $1', [ids.unit])).toBe('0');
  });
});
