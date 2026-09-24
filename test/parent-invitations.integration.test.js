/**
 * Parent invitations — integration suite
 *
 * The feature's value is mostly negative, so it is tested against a real
 * PostgreSQL rather than a mocked pool: what matters is what is *not* in the
 * database after an admin sends an invitation (no account, no membership, no
 * guardian), and which links stop working after a resend or a revocation.
 * Neither is visible through a mock that answers whatever it is asked.
 *
 * Skipped unless SCOUT_YEAR_TEST_DATABASE_URL (or TEST_DATABASE_URL) points at
 * a disposable database holding the project schema.
 *
 * @module test/parent-invitations.integration
 */

const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

require('./jest-conditional-helpers');

const DATABASE_URL = process.env.SCOUT_YEAR_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL;

process.env.JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || 'parent-invitation-integration-secret';

/** Every message the fake transport was handed, in order. */
const sentEmails = [];
/** Flip to make the transport fail, so a failed send can be told from a sent one. */
const transport = { succeeds: true };

jest.mock('../utils/index', () => {
  const actual = jest.requireActual('../utils/index');
  return {
    ...actual,
    sendEmail: jest.fn(async (to, subject, message, html) => {
      // eslint-disable-next-line no-undef
      const { sentEmails: box, transport: state } = global.__invitationTestState;
      box.push({ to, subject, message, html });
      return state.succeeds;
    }),
  };
});

global.__invitationTestState = { sentEmails, transport };

const mockContext = { userId: null, organizationId: null, permitted: true, demo: false };

jest.mock('../middleware/auth', () => {
  const actual = jest.requireActual('../middleware/auth');
  return {
    ...actual,
    authenticate: (req, _res, next) => {
      req.user = { id: mockContext.userId, roleNames: ['unitadmin'] };
      next();
    },
    requirePermission: (...permissions) => (_req, res, next) => {
      if (mockContext.permitted) return next();
      return res.status(403).json({
        success: false,
        message: 'Forbidden',
        required: permissions,
        missing: permissions,
      });
    },
    blockDemoRoles: (_req, res, next) => {
      if (!mockContext.demo) return next();
      return res.status(403).json({ success: false, message: 'Forbidden', isDemo: true });
    },
    getOrganizationId: async () => mockContext.organizationId,
  };
});

const {
  describeInvitation,
  INVITATION_STATE,
  ACCEPTANCE_RESULT,
} = require('../services/parentInvitations');

describe.skipIf(!DATABASE_URL)('Parent invitations', () => {
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
   * the organization side of the cycle is checked at COMMIT.
   *
   * @param {string} name - Unit name
   * @returns {Promise<number>} Organization ID
   */
  async function createOrganization(name) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const created = await client.query(
        'INSERT INTO organizations (name, default_language) VALUES ($1, $2) RETURNING id',
        [name, 'fr']
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
   * The token out of the most recent email.
   *
   * Reading it back out of the message is deliberate: it is the only place the
   * raw token exists after creation, which is the property being relied on.
   *
   * @returns {string} Raw invitation token
   */
  function tokenFromLastEmail() {
    const last = sentEmails[sentEmails.length - 1];
    const match = /complete-registration\?token=([^"\s&]+)/.exec(last.message);
    if (!match) throw new Error('no completion link in the email');
    return decodeURIComponent(match[1]);
  }

  /**
   * Send an invitation through the HTTP boundary.
   *
   * @param {Object} body - Request body
   * @returns {Promise<Object>} Supertest response
   */
  function invite(body) {
    return request(app).post('/api/v1/parent-invitations').send(body);
  }

  beforeAll(async () => {
    process.env.PUBLIC_BASE_URL = 'https://unit.example.org';
    pool = new Pool({ connectionString: DATABASE_URL });

    ids.organizationId = await createOrganization('6A Invitation Test');
    ids.otherOrganizationId = await createOrganization('6B Other Unit');
    mockContext.organizationId = ids.organizationId;

    await one(
      `INSERT INTO roles (role_name, display_name) VALUES ('parent', 'Parent')
       ON CONFLICT (role_name) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`
    );

    ids.adminUserId = await one(
      `INSERT INTO users (email, password, full_name)
       VALUES ('admin-' || gen_random_uuid() || '@example.test', 'x', 'Unit Admin') RETURNING id`
    );
    mockContext.userId = ids.adminUserId;

    app = express();
    app.use(express.json());
    app.use('/api/v1/parent-invitations', require('../routes/parentInvitations')(pool, console));
    app.use('/api/v1/public', require('../routes/public')(pool, console));
  });

  afterAll(async () => {
    delete process.env.PUBLIC_BASE_URL;
    if (pool) await pool.end();
  });

  beforeEach(async () => {
    sentEmails.length = 0;
    transport.succeeds = true;
    mockContext.permitted = true;
    mockContext.demo = false;
    mockContext.organizationId = ids.organizationId;
    await pool.query('DELETE FROM parent_invitations');
    // Test addresses all end in example.org; the seeded admin is example.test,
    // so this clears what a previous test (or a previous failed run) left behind
    // without touching the fixtures built in beforeAll.
    await pool.query(
      `DELETE FROM user_organizations
        WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@example.org')`
    );
    await pool.query(
      `DELETE FROM guardian_users
        WHERE guardian_id IN (SELECT id FROM parents_guardians WHERE courriel LIKE '%@example.org')`
    );
    await pool.query("DELETE FROM parents_guardians WHERE courriel LIKE '%@example.org'");
    await pool.query("DELETE FROM users WHERE email LIKE '%@example.org'");
  });

  test('creates a pending invitation and mails a working link', async () => {
    const response = await invite({
      email: 'New.Parent@Example.ORG',
      first_name: 'Ada',
      last_name: 'Lovelace',
      telephone_cellulaire: '819-555-0100',
      language: 'en',
    });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      email: 'new.parent@example.org',
      first_name: 'Ada',
      status: 'pending',
      email_sent: true,
    });

    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toBe('new.parent@example.org');
    expect(sentEmails[0].subject).toContain('6A Invitation Test');

    const described = await describeInvitation(pool, tokenFromLastEmail());
    expect(described.state).toBe(INVITATION_STATE.READY_NEW_ACCOUNT);
    expect(described.email).toBe('new.parent@example.org');
    expect(described.first_name).toBe('Ada');
  });

  test('creates no account, membership or guardian record — only a pending invitation', async () => {
    await invite({ email: 'nobody@example.org' });

    expect(await one('SELECT count(*) FROM users WHERE email = $1', ['nobody@example.org'])).toBe('0');
    expect(await one(
      `SELECT count(*) FROM user_organizations uo
        JOIN users u ON u.id = uo.user_id
       WHERE u.email = $1`,
      ['nobody@example.org']
    )).toBe('0');
    expect(await one('SELECT count(*) FROM parents_guardians WHERE courriel = $1', ['nobody@example.org'])).toBe('0');
    expect(await one('SELECT count(*) FROM parent_invitations WHERE email = $1', ['nobody@example.org'])).toBe('1');
  });

  test('stores only the digest, and never returns it', async () => {
    const response = await invite({ email: 'digest@example.org' });
    const token = tokenFromLastEmail();

    expect(JSON.stringify(response.body)).not.toContain('token_digest');
    expect(JSON.stringify(response.body)).not.toContain(token);

    const stored = await one('SELECT token_digest FROM parent_invitations WHERE email = $1', ['digest@example.org']);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(stored).not.toContain(token);
  });

  test('refuses an address that already belongs to an active member', async () => {
    const memberId = await one(
      `INSERT INTO users (email, password, full_name)
       VALUES ('existing.member@example.org', 'x', 'Existing Member') RETURNING id`
    );
    await pool.query(
      `INSERT INTO user_organizations (user_id, organization_id, role_ids, status)
       VALUES ($1, $2, '[]'::jsonb, 'active')`,
      [memberId, ids.organizationId]
    );

    const response = await invite({ email: 'existing.member@example.org' });

    expect(response.status).toBe(409);
    expect(sentEmails).toHaveLength(0);
  });

  test('refuses a second live invitation for the same address', async () => {
    await invite({ email: 'twice@example.org' });
    const second = await invite({ email: 'twice@example.org' });

    expect(second.status).toBe(409);
    expect(sentEmails).toHaveLength(1);
  });

  test('a failed send leaves a pending, unsent invitation that can be retried', async () => {
    transport.succeeds = false;

    const response = await invite({ email: 'unreachable@example.org' });

    // Created, but honest about not having reached anyone.
    expect(response.status).toBe(201);
    expect(response.body.data.email_sent).toBe(false);

    const row = await pool.query(
      'SELECT status, sent_at FROM parent_invitations WHERE email = $1',
      ['unreachable@example.org']
    );
    expect(row.rows[0].status).toBe('pending');
    expect(row.rows[0].sent_at).toBeNull();

    transport.succeeds = true;
    const invitationId = await one('SELECT id FROM parent_invitations WHERE email = $1', ['unreachable@example.org']);
    const resend = await request(app).post(`/api/v1/parent-invitations/${invitationId}/resend`).send({});

    expect(resend.status).toBe(200);
    expect(resend.body.data.email_sent).toBe(true);
    expect(await one('SELECT sent_at FROM parent_invitations WHERE id = $1', [invitationId])).not.toBeNull();
  });

  test('resending rotates the token, so the first link stops working', async () => {
    await invite({ email: 'rotate@example.org' });
    const firstToken = tokenFromLastEmail();
    const invitationId = await one('SELECT id FROM parent_invitations WHERE email = $1', ['rotate@example.org']);

    await request(app).post(`/api/v1/parent-invitations/${invitationId}/resend`).send({});
    const secondToken = tokenFromLastEmail();

    expect(secondToken).not.toBe(firstToken);
    expect((await describeInvitation(pool, firstToken)).state).toBe(INVITATION_STATE.INVALID);
    expect((await describeInvitation(pool, secondToken)).state).toBe(INVITATION_STATE.READY_NEW_ACCOUNT);
    expect(await one('SELECT resend_count FROM parent_invitations WHERE id = $1', [invitationId])).toBe(1);
  });

  test('revoking kills the link but keeps the record', async () => {
    await invite({ email: 'revoked@example.org' });
    const token = tokenFromLastEmail();
    const invitationId = await one('SELECT id FROM parent_invitations WHERE email = $1', ['revoked@example.org']);

    const response = await request(app).post(`/api/v1/parent-invitations/${invitationId}/revoke`).send({});

    expect(response.status).toBe(200);
    expect((await describeInvitation(pool, token)).state).toBe(INVITATION_STATE.REVOKED);
    expect(await one('SELECT count(*) FROM parent_invitations WHERE id = $1', [invitationId])).toBe('1');
    expect(await one('SELECT revoked_by FROM parent_invitations WHERE id = $1', [invitationId])).toBe(ids.adminUserId);
  });

  test('a revoked address can be invited again', async () => {
    await invite({ email: 'again@example.org' });
    const invitationId = await one('SELECT id FROM parent_invitations WHERE email = $1', ['again@example.org']);
    await request(app).post(`/api/v1/parent-invitations/${invitationId}/revoke`).send({});

    const response = await invite({ email: 'again@example.org' });

    expect(response.status).toBe(201);
    expect(await one('SELECT count(*) FROM parent_invitations WHERE email = $1', ['again@example.org'])).toBe('2');
  });

  test('an expired invitation reads as expired, and resending revives it', async () => {
    await invite({ email: 'stale@example.org' });
    const token = tokenFromLastEmail();
    const invitationId = await one('SELECT id FROM parent_invitations WHERE email = $1', ['stale@example.org']);
    await pool.query(
      "UPDATE parent_invitations SET expires_at = now() - interval '1 day' WHERE id = $1",
      [invitationId]
    );

    expect((await describeInvitation(pool, token)).state).toBe(INVITATION_STATE.EXPIRED);

    await request(app).post(`/api/v1/parent-invitations/${invitationId}/resend`).send({});

    expect((await describeInvitation(pool, tokenFromLastEmail())).state)
      .toBe(INVITATION_STATE.READY_NEW_ACCOUNT);
  });

  test('an invitation belonging to another unit cannot be resent or revoked', async () => {
    await invite({ email: 'theirs@example.org' });
    const invitationId = await one('SELECT id FROM parent_invitations WHERE email = $1', ['theirs@example.org']);

    // Same admin, now acting for a different unit.
    mockContext.organizationId = ids.otherOrganizationId;

    const resend = await request(app).post(`/api/v1/parent-invitations/${invitationId}/resend`).send({});
    const revoke = await request(app).post(`/api/v1/parent-invitations/${invitationId}/revoke`).send({});
    const list = await request(app).get('/api/v1/parent-invitations');

    expect(resend.status).toBe(404);
    expect(revoke.status).toBe(404);
    expect(list.body.data).toHaveLength(0);
    expect(sentEmails).toHaveLength(1);
  });

  test('lists a unit\'s invitations with their current state', async () => {
    await invite({ email: 'listed.pending@example.org' });
    await invite({ email: 'listed.revoked@example.org' });
    const revokedId = await one('SELECT id FROM parent_invitations WHERE email = $1', ['listed.revoked@example.org']);
    await request(app).post(`/api/v1/parent-invitations/${revokedId}/revoke`).send({});

    const response = await request(app).get('/api/v1/parent-invitations');

    expect(response.status).toBe(200);
    const byEmail = Object.fromEntries(response.body.data.map((row) => [row.email, row]));
    expect(byEmail['listed.pending@example.org'].state).toBe('pending');
    expect(byEmail['listed.revoked@example.org'].state).toBe('revoked');
    expect(byEmail['listed.pending@example.org'].invited_by_name).toBe('Unit Admin');
    expect(JSON.stringify(response.body)).not.toContain('token_digest');
  });

  test('an invalid address is refused before anything is created', async () => {
    const response = await invite({ email: 'not-an-address' });

    expect(response.status).toBe(400);
    expect(response.body.errors).toBeDefined();
    expect(await one('SELECT count(*) FROM parent_invitations')).toBe('0');
    expect(sentEmails).toHaveLength(0);
  });

  test('a demo account cannot invite, and lacking users.invite blocks it too', async () => {
    mockContext.demo = true;
    const demoResponse = await invite({ email: 'demo@example.org' });
    expect(demoResponse.status).toBe(403);
    expect(demoResponse.body.isDemo).toBe(true);

    mockContext.demo = false;
    mockContext.permitted = false;
    const forbidden = await invite({ email: 'forbidden@example.org' });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.required).toContain('users.invite');
    expect(forbidden.body.missing).toContain('users.invite');

    expect(sentEmails).toHaveLength(0);
    expect(await one('SELECT count(*) FROM parent_invitations')).toBe('0');
  });

  test('the email is written in the language the admin chose', async () => {
    await invite({ email: 'french@example.org', first_name: 'Ada', language: 'fr' });
    expect(sentEmails[0].subject).toContain('Complétez votre inscription');
    expect(sentEmails[0].message).toContain('Bonjour Ada,');

    await pool.query('DELETE FROM parent_invitations');
    await invite({ email: 'english@example.org', language: 'en' });
    expect(sentEmails[1].subject).toContain('Complete your registration');
  });

  test('escapes unit and contact names on their way into the email HTML', async () => {
    const injectedId = await createOrganization('<script>alert(1)</script> Unit');
    mockContext.organizationId = injectedId;

    await invite({
      email: 'escaped@example.org',
      first_name: '<img src=x onerror=alert(1)>',
      support_contact_name: '"><b>Bold</b>',
      support_contact_email: 'help@example.org',
    });

    expect(sentEmails[0].html).not.toContain('<script>');
    expect(sentEmails[0].html).not.toContain('<img src=x');
    expect(sentEmails[0].html).toContain('&lt;script&gt;');
  });

  describe('completing an invitation', () => {
    const GOOD_PASSWORD = 'Tresor2026!';

    /**
     * Follow a link the way the completion page does.
     *
     * @param {string} token - Raw token from the email
     * @param {Object} [body] - What the parent filled in
     * @returns {Promise<Object>} Supertest response
     */
    function accept(token, body = {}) {
      return request(app).post('/api/v1/public/parent-invitations/accept').send({ token, ...body });
    }

    /**
     * Invite an address and return the token that was mailed to it.
     *
     * @param {string} email - Address to invite
     * @param {Object} [extra] - Extra invitation fields
     * @returns {Promise<string>} Raw token
     */
    async function inviteAndGetToken(email, extra = {}) {
      await invite({ email, ...extra });
      return tokenFromLastEmail();
    }

    test('describing a link over HTTP writes nothing', async () => {
      const token = await inviteAndGetToken('describe.me@example.org');

      const response = await request(app)
        .get('/api/v1/public/parent-invitations/describe')
        .query({ token });

      expect(response.status).toBe(200);
      expect(response.body.data.state).toBe(INVITATION_STATE.READY_NEW_ACCOUNT);
      expect(response.body.data.email).toBe('describe.me@example.org');

      // A scanner opening the mail must not have spent the invitation.
      expect(await one('SELECT status FROM parent_invitations WHERE email = $1', ['describe.me@example.org']))
        .toBe('pending');
      expect(await one('SELECT count(*) FROM users WHERE email = $1', ['describe.me@example.org'])).toBe('0');
    });

    test('creates the account, the membership and the guardian record together', async () => {
      const token = await inviteAndGetToken('complete@example.org', {
        first_name: 'Ada',
        last_name: 'Lovelace',
      });

      const response = await accept(token, {
        first_name: 'Ada',
        last_name: 'Lovelace-Byron',
        telephone_cellulaire: '819-555-0199',
        password: GOOD_PASSWORD,
      });

      expect(response.status).toBe(200);
      expect(response.body.data.result).toBe(ACCEPTANCE_RESULT.ACCOUNT_CREATED);

      const userId = await one('SELECT id FROM users WHERE email = $1', ['complete@example.org']);
      expect(userId).toBeDefined();

      // Verified on the strength of the token: reading the mail proved the address.
      expect(await one('SELECT is_verified FROM users WHERE id = $1', [userId])).toBe(true);
      // What the parent typed beats what the admin guessed.
      expect(await one('SELECT full_name FROM users WHERE id = $1', [userId])).toBe('Ada Lovelace-Byron');

      const membership = await pool.query(
        'SELECT status, role_ids FROM user_organizations WHERE user_id = $1 AND organization_id = $2',
        [userId, ids.organizationId]
      );
      expect(membership.rows[0].status).toBe('active');
      const parentRoleId = await one("SELECT id FROM roles WHERE role_name = 'parent'");
      expect(membership.rows[0].role_ids).toContain(parentRoleId);

      const guardianId = await one('SELECT id FROM parents_guardians WHERE courriel = $1', ['complete@example.org']);
      expect(guardianId).toBeDefined();
      expect(await one('SELECT user_uuid FROM parents_guardians WHERE id = $1', [guardianId])).toBe(userId);
      expect(await one('SELECT prenom FROM parents_guardians WHERE id = $1', [guardianId])).toBe('Ada');
      // Both mappings, because read paths still join through the older one.
      expect(await one('SELECT count(*) FROM guardian_users WHERE guardian_id = $1 AND user_id = $2', [guardianId, userId]))
        .toBe('1');
    });

    test('the password becomes a real, working credential', async () => {
      const token = await inviteAndGetToken('hashed@example.org');
      await accept(token, { first_name: 'Rosa', last_name: 'Parks', password: GOOD_PASSWORD });

      const stored = await one('SELECT password FROM users WHERE email = $1', ['hashed@example.org']);

      expect(stored).not.toBe(GOOD_PASSWORD);
      expect(await bcrypt.compare(GOOD_PASSWORD, stored)).toBe(true);
    });

    test('the address comes from the invitation, not from the form', async () => {
      const token = await inviteAndGetToken('locked@example.org');

      await accept(token, {
        email: 'attacker@example.org',
        first_name: 'Mallory',
        last_name: 'Smith',
        password: GOOD_PASSWORD,
      });

      expect(await one('SELECT count(*) FROM users WHERE email = $1', ['attacker@example.org'])).toBe('0');
      expect(await one('SELECT count(*) FROM users WHERE email = $1', ['locked@example.org'])).toBe('1');
    });

    test('spends the invitation once, so a second click creates nothing', async () => {
      const token = await inviteAndGetToken('once@example.org');

      const first = await accept(token, { first_name: 'Grace', last_name: 'Hopper', password: GOOD_PASSWORD });
      const second = await accept(token, { first_name: 'Grace', last_name: 'Hopper', password: GOOD_PASSWORD });

      expect(first.body.data.result).toBe(ACCEPTANCE_RESULT.ACCOUNT_CREATED);
      expect(second.body.data.state).toBe(INVITATION_STATE.ACCEPTED);
      expect(second.body.data.result).toBeUndefined();
      expect(await one('SELECT count(*) FROM users WHERE email = $1', ['once@example.org'])).toBe('1');
    });

    test('two simultaneous submissions settle into one account', async () => {
      const token = await inviteAndGetToken('race@example.org');

      const [a, b] = await Promise.all([
        accept(token, { first_name: 'Ada', last_name: 'Lovelace', password: GOOD_PASSWORD }),
        accept(token, { first_name: 'Ada', last_name: 'Lovelace', password: GOOD_PASSWORD }),
      ]);

      const outcomes = [a.body.data, b.body.data];
      expect(outcomes.filter((o) => o.result === ACCEPTANCE_RESULT.ACCOUNT_CREATED)).toHaveLength(1);
      expect(await one('SELECT count(*) FROM users WHERE email = $1', ['race@example.org'])).toBe('1');
      expect(await one('SELECT count(*) FROM user_organizations uo JOIN users u ON u.id = uo.user_id WHERE u.email = $1', ['race@example.org']))
        .toBe('1');
    });

    test('refuses a new account without a password, and a weak one', async () => {
      const token = await inviteAndGetToken('nopassword@example.org');

      const missing = await accept(token, { first_name: 'Ada', last_name: 'Lovelace' });
      expect(missing.status).toBe(400);
      expect(missing.body.message).toBe('password_required');

      const weak = await accept(token, { first_name: 'Ada', last_name: 'Lovelace', password: 'short' });
      expect(weak.status).toBe(400);
      expect(weak.body.errors).toBeDefined();

      expect(await one('SELECT count(*) FROM users WHERE email = $1', ['nopassword@example.org'])).toBe('0');
      expect(await one('SELECT status FROM parent_invitations WHERE email = $1', ['nopassword@example.org']))
        .toBe('pending');
    });

    test('an existing account joins the unit without its password being touched', async () => {
      const originalHash = await bcrypt.hash('TheirOwnPassword1!', 4);
      const existingId = await one(
        'INSERT INTO users (email, password, full_name) VALUES ($1, $2, $3) RETURNING id',
        ['veteran@example.org', originalHash, 'Existing Person']
      );

      const token = await inviteAndGetToken('veteran@example.org', { first_name: 'Wrong', last_name: 'Guess' });
      const described = await describeInvitation(pool, token);
      expect(described.state).toBe(INVITATION_STATE.READY_EXISTING_ACCOUNT);

      const response = await accept(token, { password: GOOD_PASSWORD, first_name: 'Wrong' });

      expect(response.body.data.result).toBe(ACCEPTANCE_RESULT.MEMBERSHIP_ADDED);
      // Neither the credential nor the profile is an invitation's to rewrite.
      expect(await one('SELECT password FROM users WHERE id = $1', [existingId])).toBe(originalHash);
      expect(await one('SELECT full_name FROM users WHERE id = $1', [existingId])).toBe('Existing Person');
      expect(await one(
        'SELECT status FROM user_organizations WHERE user_id = $1 AND organization_id = $2',
        [existingId, ids.organizationId]
      )).toBe('active');
    });

    test('a routine year-transition deactivation is simply restored', async () => {
      const existingId = await one(
        "INSERT INTO users (email, password, full_name) VALUES ('returning@example.org', 'x', 'Returning') RETURNING id"
      );
      await pool.query(
        `INSERT INTO user_organizations (user_id, organization_id, role_ids, status, deactivated_at, deactivated_reason)
         VALUES ($1, $2, '[]'::jsonb, 'inactive', now(), 'no_enrolled_child')`,
        [existingId, ids.organizationId]
      );

      const token = await inviteAndGetToken('returning@example.org');
      const response = await accept(token, {});

      expect(response.body.data.result).toBe(ACCEPTANCE_RESULT.MEMBERSHIP_ADDED);
      const membership = await pool.query(
        'SELECT status, deactivated_reason FROM user_organizations WHERE user_id = $1',
        [existingId]
      );
      expect(membership.rows[0].status).toBe('active');
      expect(membership.rows[0].deactivated_reason).toBeNull();
    });

    /**
     * An account whose membership in the test unit was closed by hand.
     *
     * @param {string} email - Address
     * @returns {Promise<string>} User UUID
     */
    async function handDeactivatedMember(email) {
      const userId = await one(
        "INSERT INTO users (email, password, full_name) VALUES ($1, 'x', 'Removed Person') RETURNING id",
        [email]
      );
      await pool.query(
        `INSERT INTO user_organizations (user_id, organization_id, role_ids, status, deactivated_at, deactivated_reason)
         VALUES ($1, $2, '[]'::jsonb, 'inactive', '2026-03-01T12:00:00Z', 'removed_by_admin')`,
        [userId, ids.organizationId]
      );
      return userId;
    }

    test('inviting a hand-deactivated member stops and shows the admin what they would undo', async () => {
      await handDeactivatedMember('removed@example.org');

      const response = await invite({ email: 'removed@example.org' });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('manually_deactivated');
      expect(response.body.data.deactivated_reason).toBe('removed_by_admin');
      expect(new Date(response.body.data.deactivated_at).toISOString()).toBe('2026-03-01T12:00:00.000Z');
      expect(sentEmails).toHaveLength(0);
      expect(await one('SELECT count(*) FROM parent_invitations WHERE email = $1', ['removed@example.org'])).toBe('0');
    });

    test('confirming without a reason is refused', async () => {
      await handDeactivatedMember('noreason@example.org');

      const response = await invite({ email: 'noreason@example.org', confirm_reactivation: true });
      const blank = await invite({ email: 'noreason@example.org', confirm_reactivation: true, reactivation_reason: '   ' });

      expect(response.status).toBe(400);
      expect(blank.status).toBe(400);
      expect(await one('SELECT count(*) FROM parent_invitations WHERE email = $1', ['noreason@example.org'])).toBe('0');
    });

    test('once confirmed with a reason, the invitation wins and restores the membership', async () => {
      const userId = await handDeactivatedMember('forgiven@example.org');

      const created = await invite({
        email: 'forgiven@example.org',
        confirm_reactivation: true,
        reactivation_reason: 'Spoke with the family; the dispute is resolved.',
      });

      expect(created.status).toBe(201);
      expect(created.body.data.deactivation_override_reason)
        .toBe('Spoke with the family; the dispute is resolved.');
      expect(created.body.data.deactivation_override_at).not.toBeNull();

      const response = await accept(tokenFromLastEmail(), {});

      expect(response.body.data.result).toBe(ACCEPTANCE_RESULT.MEMBERSHIP_ADDED);
      const membership = await pool.query(
        `SELECT status, deactivated_at, deactivated_reason, reactivation_requested_at
           FROM user_organizations WHERE user_id = $1`,
        [userId]
      );
      expect(membership.rows[0].status).toBe('active');
      expect(membership.rows[0].deactivated_at).toBeNull();
      expect(membership.rows[0].deactivated_reason).toBeNull();
      expect(membership.rows[0].reactivation_requested_at).toBeNull();
    });

    test('a reason given for a member who was never removed restores nothing extra', async () => {
      const created = await invite({
        email: 'fresh@example.org',
        confirm_reactivation: true,
        reactivation_reason: 'Just in case',
      });

      // Recorded only when it overrides something; otherwise it would sit on the
      // invitation waiting to restore a removal that happens later.
      expect(created.status).toBe(201);
      expect(created.body.data.deactivation_override_reason).toBeNull();
      expect(created.body.data.deactivation_override_at).toBeNull();
    });

    test('a removal made after the invitation went out still queues for a human', async () => {
      const userId = await one(
        "INSERT INTO users (email, password, full_name) VALUES ('later@example.org', 'x', 'Later') RETURNING id"
      );
      const token = await inviteAndGetToken('later@example.org');

      // Nobody confirmed anything about this removal: it did not exist yet.
      await pool.query(
        `INSERT INTO user_organizations (user_id, organization_id, role_ids, status, deactivated_at, deactivated_reason)
         VALUES ($1, $2, '[]'::jsonb, 'inactive', now(), 'removed_by_admin')`,
        [userId, ids.organizationId]
      );

      const response = await accept(token, {});

      expect(response.body.data.result).toBe(ACCEPTANCE_RESULT.PENDING_APPROVAL);
      const membership = await pool.query(
        'SELECT status, reactivation_requested_at FROM user_organizations WHERE user_id = $1',
        [userId]
      );
      expect(membership.rows[0].status).toBe('inactive');
      expect(membership.rows[0].reactivation_requested_at).not.toBeNull();
    });

    test('an expired or revoked link creates nothing', async () => {
      const expiredToken = await inviteAndGetToken('lapsed@example.org');
      await pool.query(
        "UPDATE parent_invitations SET expires_at = now() - interval '1 day' WHERE email = $1",
        ['lapsed@example.org']
      );
      const expired = await accept(expiredToken, { first_name: 'Ada', password: GOOD_PASSWORD });

      const revokedToken = await inviteAndGetToken('withdrawn@example.org');
      const revokedId = await one('SELECT id FROM parent_invitations WHERE email = $1', ['withdrawn@example.org']);
      await request(app).post(`/api/v1/parent-invitations/${revokedId}/revoke`).send({});
      const revoked = await accept(revokedToken, { first_name: 'Ada', password: GOOD_PASSWORD });

      expect(expired.body.data.state).toBe(INVITATION_STATE.EXPIRED);
      expect(revoked.body.data.state).toBe(INVITATION_STATE.REVOKED);
      expect(await one("SELECT count(*) FROM users WHERE email IN ('lapsed@example.org','withdrawn@example.org')"))
        .toBe('0');
    });

    test('a garbled or absent token is refused the same way as an unknown one', async () => {
      for (const token of ['', 'nonsense', null, undefined]) {
        const response = await accept(token, { first_name: 'Ada', last_name: 'Lovelace', password: GOOD_PASSWORD });
        expect(response.status).toBe(200);
        expect(response.body.data).toEqual({ state: INVITATION_STATE.INVALID });
      }
    });

    test('an old link cannot be replayed after a resend', async () => {
      const firstToken = await inviteAndGetToken('replayed@example.org');
      const invitationId = await one('SELECT id FROM parent_invitations WHERE email = $1', ['replayed@example.org']);
      await request(app).post(`/api/v1/parent-invitations/${invitationId}/resend`).send({});

      const response = await accept(firstToken, { first_name: 'Ada', password: GOOD_PASSWORD });

      expect(response.body.data.state).toBe(INVITATION_STATE.INVALID);
      expect(await one('SELECT count(*) FROM users WHERE email = $1', ['replayed@example.org'])).toBe('0');
    });

    test('links the guardian record without overwriting what was already known', async () => {
      await pool.query(
        `INSERT INTO parents_guardians (nom, prenom, courriel, telephone_residence)
         VALUES ('Imported', 'Name', 'imported@example.org', '819-555-0001')`
      );
      const existingId = await one(
        "INSERT INTO users (email, password, full_name) VALUES ('imported@example.org', 'x', 'Imported Name') RETURNING id"
      );

      const token = await inviteAndGetToken('imported@example.org');
      await accept(token, {});

      const guardian = await pool.query(
        'SELECT nom, prenom, telephone_residence, user_uuid FROM parents_guardians WHERE courriel = $1',
        ['imported@example.org']
      );
      expect(guardian.rows[0].nom).toBe('Imported');
      expect(guardian.rows[0].telephone_residence).toBe('819-555-0001');
      expect(guardian.rows[0].user_uuid).toBe(existingId);
      expect(await one('SELECT count(*) FROM parents_guardians WHERE courriel = $1', ['imported@example.org']))
        .toBe('1');
    });
  });
});
