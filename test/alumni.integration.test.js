/**
 * Alumni consent — integration suite
 *
 * The feature's whole value is a negative: nobody becomes an alumnus without
 * saying so, and an alumni mailing never reaches the unit. Both are properties
 * of what is in the database and of what the recipient queries return, so they
 * are tested against a real PostgreSQL rather than a mocked pool.
 *
 * Skipped unless SCOUT_YEAR_TEST_DATABASE_URL (or TEST_DATABASE_URL) points at a
 * disposable database holding the project schema.
 *
 * @module test/alumni.integration
 */

const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');

const DATABASE_URL = process.env.SCOUT_YEAR_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL;

process.env.JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || 'alumni-integration-secret';

/** Every address the fake transport was handed, in order. */
const sentEmails = [];
/** Flip to make the transport fail, so a failed send can be told from a sent one. */
const transport = { succeeds: true };

jest.mock('../utils/index', () => {
  const actual = jest.requireActual('../utils/index');
  return {
    ...actual,
    sendEmail: jest.fn(async (to, subject, message, html) => {
      // eslint-disable-next-line no-undef
      const { sentEmails: box, transport: state } = global.__alumniTestState;
      box.push({ to, subject, message, html });
      return state.succeeds;
    }),
    getUserEmailLanguage: jest.fn(async () => 'fr')
  };
});

global.__alumniTestState = { sentEmails, transport };

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

const {
  issueAlumniToken,
  CONSENT_PURPOSE,
  UNSUBSCRIBE_PURPOSE,
  listInvitationCandidates,
  listAlumni,
  recordConsent,
  recordOptOut
} = require('../services/alumni');
const { buildRecipientsForTests } = require('../routes/announcements');

describe.skipIf(!DATABASE_URL)('Alumni consent', () => {
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
        "INSERT INTO organizations (name) VALUES ('Alumni Test Unit') RETURNING id"
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
   * One departed parent, one still-enrolled parent, one departed leader.
   *
   * @returns {Promise<void>}
   */
  async function seed() {
    ids.organizationId = await createOrganization();
    mockContext.organizationId = ids.organizationId;

    ids.scoutYearId = await one(
      `INSERT INTO scout_years (organization_id, label, start_date, end_date, status)
       VALUES ($1, '2025-2026', '2025-09-01', '2026-08-31', 'active') RETURNING id`,
      [ids.organizationId]
    );

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

    const addMembership = async (userId, roleIds, status) => one(
      `INSERT INTO user_organizations (user_id, organization_id, role_ids, status, deactivated_at)
       VALUES ($1, $2, to_jsonb($3::text[]), $4, CASE WHEN $4 = 'inactive' THEN now() END)
       RETURNING id`,
      [userId, ids.organizationId, roleIds.map(String), status]
    );

    ids.adminUserId = await makeUser('Administratrice');
    mockContext.userId = ids.adminUserId;

    // Departed: a parent and nothing more. The only candidate.
    ids.departedUserId = await makeUser('Parent parti');
    ids.departedMembershipId = await addMembership(
      ids.departedUserId, [ids.parentRoleId], 'inactive'
    );

    // Still here: must never be invited.
    ids.currentUserId = await makeUser('Parent present');
    ids.currentMembershipId = await addMembership(
      ids.currentUserId, [ids.parentRoleId], 'active'
    );

    // Departed, but a leader: their account answers for the unit's own records.
    ids.leaderUserId = await makeUser('Animatrice partie');
    ids.leaderMembershipId = await addMembership(
      ids.leaderUserId, [ids.parentRoleId, ids.animationRoleId], 'inactive'
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
      await client.query('DELETE FROM announcement_logs WHERE announcement_id IN (SELECT id FROM announcements WHERE organization_id = $1)', [org]);
      for (const table of ['announcements', 'user_organizations', 'organization_settings', 'scout_years']) {
        // Table names come from this literal list, never from a request.
        // eslint-disable-next-line no-await-in-loop
        await client.query(`DELETE FROM ${table} WHERE organization_id = $1`, [org]);
      }
      await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
        [ids.adminUserId, ids.departedUserId, ids.currentUserId, ids.leaderUserId].filter(Boolean)
      ]);
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
   * Mint a link token for the departed parent's membership.
   *
   * @param {string} purpose - CONSENT_PURPOSE or UNSUBSCRIBE_PURPOSE
   * @returns {string} Signed token
   */
  function tokenForDeparted(purpose) {
    return issueAlumniToken({
      membership_id: ids.departedMembershipId,
      user_id: ids.departedUserId,
      organization_id: ids.organizationId
    }, purpose);
  }

  /**
   * Read a membership's alumni columns.
   *
   * @param {number} membershipId - Membership to read
   * @returns {Promise<Object>} Status and consent timestamps
   */
  async function membership(membershipId) {
    const result = await pool.query(
      `SELECT status, alumni_invited_at, alumni_consent_at, alumni_opted_out_at
         FROM user_organizations WHERE id = $1`,
      [membershipId]
    );
    return result.rows[0];
  }

  beforeAll(() => {
    pool = new Pool({ connectionString: DATABASE_URL });
    app = express();
    app.use(express.json());
    app.use('/api/v1/alumni', require('../routes/alumni')(pool, { error: () => {} }));
    app.use('/api/v1/public', require('../routes/public')(pool, { error: () => {}, info: () => {} }));
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
    sentEmails.length = 0;
    transport.succeeds = true;
  });

  test('offers the invitation only to a departed parent, never to a leader or a current family', async () => {
    const candidates = await listInvitationCandidates(pool, ids.organizationId);
    expect(candidates.map(row => row.membership_id)).toEqual([ids.departedMembershipId]);
  });

  test('sends the invitation once and never a second time', async () => {
    const first = await request(app).post('/api/v1/alumni/invitations').send({});
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ invited: 1, failed: 0 });
    expect(sentEmails).toHaveLength(1);
    expect((await membership(ids.departedMembershipId)).alumni_invited_at).not.toBeNull();

    // Silence is a valid answer; asking again would turn a courtesy into a
    // nuisance.
    sentEmails.length = 0;
    const second = await request(app).post('/api/v1/alumni/invitations').send({});
    expect(second.body.data).toMatchObject({ invited: 0 });
    expect(sentEmails).toHaveLength(0);
  });

  test('leaves the membership invitable when the email fails to go out', async () => {
    transport.succeeds = false;
    const response = await request(app).post('/api/v1/alumni/invitations').send({});

    expect(response.body.data).toMatchObject({ invited: 0, failed: 1 });
    expect((await membership(ids.departedMembershipId)).alumni_invited_at).toBeNull();
    expect(await listInvitationCandidates(pool, ids.organizationId)).toHaveLength(1);
  });

  test('the consent link, and only a click on it, makes an alumnus', async () => {
    expect((await membership(ids.departedMembershipId)).status).toBe('inactive');

    const response = await request(app)
      .post('/api/v1/public/alumni/consent')
      .send({ token: tokenForDeparted(CONSENT_PURPOSE) });

    expect(response.status).toBe(200);
    expect(response.body.data.state).toBe('consented');

    const after = await membership(ids.departedMembershipId);
    expect(after.status).toBe('alumni');
    expect(after.alumni_consent_at).not.toBeNull();
  });

  test('refuses a token that was minted for the other purpose', async () => {
    const response = await request(app)
      .post('/api/v1/public/alumni/consent')
      .send({ token: tokenForDeparted(UNSUBSCRIBE_PURPOSE) });

    expect(response.body.data.state).toBe('invalid');
    expect((await membership(ids.departedMembershipId)).status).toBe('inactive');
  });

  test('refuses a garbled or absent token without saying which', async () => {
    expect((await recordConsent(pool, 'not-a-token')).state).toBe('invalid');
    expect((await recordConsent(pool, undefined)).state).toBe('invalid');
  });

  test('never downgrades a family that came back', async () => {
    await pool.query(
      "UPDATE user_organizations SET status = 'active' WHERE id = $1",
      [ids.departedMembershipId]
    );

    const result = await recordConsent(pool, tokenForDeparted(CONSENT_PURPOSE));

    expect(result.state).toBe('membership_active');
    expect((await membership(ids.departedMembershipId)).status).toBe('active');
  });

  test('unsubscribing puts the membership back where it started', async () => {
    await recordConsent(pool, tokenForDeparted(CONSENT_PURPOSE));

    const response = await request(app)
      .post('/api/v1/public/alumni/unsubscribe')
      .send({ token: tokenForDeparted(UNSUBSCRIBE_PURPOSE) });

    expect(response.body.data.state).toBe('unsubscribed');
    const after = await membership(ids.departedMembershipId);
    expect(after.status).toBe('inactive');
    expect(after.alumni_consent_at).toBeNull();
    expect(after.alumni_opted_out_at).not.toBeNull();
  });

  test('unsubscribing twice is not an error', async () => {
    await recordConsent(pool, tokenForDeparted(CONSENT_PURPOSE));
    const token = tokenForDeparted(UNSUBSCRIBE_PURPOSE);

    expect((await recordOptOut(pool, token)).state).toBe('unsubscribed');
    expect((await recordOptOut(pool, token)).state).toBe('unsubscribed');
    expect((await membership(ids.departedMembershipId)).status).toBe('inactive');
  });

  test('the database refuses an alumni status nobody consented to', async () => {
    await expect(pool.query(
      "UPDATE user_organizations SET status = 'alumni' WHERE id = $1",
      [ids.departedMembershipId]
    )).rejects.toThrow(/user_organizations_alumni_requires_consent/);
  });

  test('an alumnus is listed as one only after consenting', async () => {
    expect(await listAlumni(pool, ids.organizationId)).toHaveLength(0);
    await recordConsent(pool, tokenForDeparted(CONSENT_PURPOSE));
    const alumni = await listAlumni(pool, ids.organizationId);
    expect(alumni.map(row => row.membership_id)).toEqual([ids.departedMembershipId]);
  });

  describe('audience separation', () => {
    /**
     * Read an address by user id.
     *
     * @param {string} userId - User to read
     * @returns {Promise<string>} Lowercased email
     */
    async function emailOf(userId) {
      return one('SELECT LOWER(email) FROM users WHERE id = $1', [userId]);
    }

    test('an alumnus is never reached by a send to the unit', async () => {
      await recordConsent(pool, tokenForDeparted(CONSENT_PURPOSE));

      const recipients = await buildRecipientsForTests(
        pool, ids.organizationId, ['parent'], [], 'members'
      );

      expect(recipients.emails).not.toContain(await emailOf(ids.departedUserId));
      expect(recipients.emails).toContain(await emailOf(ids.currentUserId));
    });

    test('a send to the alumni reaches them and nobody else, by email only', async () => {
      await recordConsent(pool, tokenForDeparted(CONSENT_PURPOSE));

      const recipients = await buildRecipientsForTests(
        pool, ids.organizationId, ['parent'], [], 'alumni'
      );

      expect(recipients.emails).toEqual([await emailOf(ids.departedUserId)]);
      // No push and no WhatsApp: those belong to an account that is closed.
      expect(recipients.subscribers).toEqual([]);
      expect(recipients.whatsappNumbers).toEqual([]);
    });

    test('the alumni audience ignores role and den filters entirely', async () => {
      await recordConsent(pool, tokenForDeparted(CONSENT_PURPOSE));

      const filtered = await buildRecipientsForTests(
        pool, ids.organizationId, ['admin'], [999999], 'alumni'
      );

      expect(filtered.emails).toEqual([await emailOf(ids.departedUserId)]);
    });

    test('an inactive membership that never consented is reached by neither', async () => {
      const departedEmail = await emailOf(ids.departedUserId);

      const members = await buildRecipientsForTests(
        pool, ids.organizationId, ['parent'], [], 'members'
      );
      const alumni = await buildRecipientsForTests(
        pool, ids.organizationId, [], [], 'alumni'
      );

      expect(members.emails).not.toContain(departedEmail);
      expect(alumni.emails).not.toContain(departedEmail);
    });
  });
});
