/**
 * Family links — integration suite
 *
 * A family link moves access to children between two people, so what is under
 * test is who can see which child at each step. Assertions read
 * `user_participants` — what the rest of the app trusts — and the grants behind
 * it.
 *
 * The properties that matter most are negatives: opening the email grants
 * nothing, declining grants nothing, access does not travel along a chain of
 * links, a link made in one unit does not expose another unit's children, and
 * ending a link takes back only what it gave.
 *
 * Skipped unless SCOUT_YEAR_TEST_DATABASE_URL (or TEST_DATABASE_URL) points at
 * a disposable database holding the project schema.
 *
 * @module test/family-links.integration
 */

const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');

require('./jest-conditional-helpers');

const DATABASE_URL = process.env.SCOUT_YEAR_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL;

process.env.JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || 'family-links-integration-secret';

const sentEmails = [];
const transport = { succeeds: true };

jest.mock('../utils/index', () => {
  const actual = jest.requireActual('../utils/index');
  return {
    ...actual,
    sendEmail: jest.fn(async (to, subject, message, html) => {
      // eslint-disable-next-line no-undef
      const { sentEmails: box, transport: state } = global.__familyLinkTestState;
      box.push({ to, subject, message, html });
      return state.succeeds;
    }),
  };
});

global.__familyLinkTestState = { sentEmails, transport };

const mockContext = { userId: null, organizationId: null };

// Only authentication is faked; permissions are checked against the database.
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

const { FAMILY_LINK_STATE, FAMILY_LINK_RESULT } = require('../services/familyLinks');
const { ACCESS_SOURCE, grantParticipantAccess } = require('../services/participantAccess');

describe.skipIf(!DATABASE_URL)('Family links', () => {
  let pool;
  let app;
  const ids = {};
  const GOOD_PASSWORD = 'Famille2026!';

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
   * Create an organization, its program section and an active scout year.
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
   * A parent with an active membership in a unit.
   *
   * @param {string} label - Name, also the start of the address
   * @param {number} organizationId - Unit
   * @returns {Promise<{id: string, email: string}>} The user
   */
  async function parent(label, organizationId) {
    const row = await pool.query(
      `INSERT INTO users (email, password, full_name)
       VALUES (lower($1) || '-' || gen_random_uuid() || '@example.test', 'x', $1)
       RETURNING id, email`,
      [label]
    );
    await pool.query(
      `INSERT INTO user_organizations (user_id, organization_id, role_ids, status)
       VALUES ($1, $2, $3, 'active')`,
      [row.rows[0].id, organizationId, JSON.stringify([ids.parentRoleId])]
    );
    return row.rows[0];
  }

  /**
   * A child enrolled in a unit.
   *
   * @param {string} firstName - Name
   * @param {number} organizationId - Unit
   * @returns {Promise<number>} Participant ID
   */
  async function child(firstName, organizationId) {
    const childId = await one(
      "INSERT INTO participants (first_name, last_name, date_naissance) VALUES ($1, 'Test', '2016-01-01') RETURNING id",
      [firstName]
    );
    const yearId = await one(
      "SELECT id FROM scout_years WHERE organization_id = $1 AND status = 'active'",
      [organizationId]
    );
    await pool.query(
      'INSERT INTO participant_enrollments (participant_id, organization_id, scout_year_id) VALUES ($1, $2, $3)',
      [childId, organizationId, yearId]
    );
    return childId;
  }

  /**
   * Whether a user can see a child, by the table the app actually reads.
   *
   * @param {string} userId - User
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
   * Act as a parent.
   *
   * @param {string} userId - Acting user
   * @param {number} [organizationId] - Unit on their token
   * @returns {Object} Supertest agent-like helpers
   */
  function as(userId, organizationId = ids.unitA) {
    mockContext.userId = userId;
    mockContext.organizationId = organizationId;
    return request(app);
  }

  /**
   * Ask for a link, returning the token mailed out.
   *
   * @param {string} fromUserId - Requesting parent
   * @param {string} email - Target address
   * @returns {Promise<string>} Raw token
   */
  async function askToLink(fromUserId, email) {
    const response = await as(fromUserId).post('/api/v1/family-link-requests').send({ email });
    if (response.status !== 201) {
      throw new Error(`request failed: ${response.status} ${JSON.stringify(response.body)}`);
    }
    return tokenFromLastEmail();
  }

  /**
   * The token out of the most recent email.
   *
   * @returns {string} Raw token
   */
  function tokenFromLastEmail() {
    const last = sentEmails[sentEmails.length - 1];
    const match = /family-link\?token=([^"\s&]+)/.exec(last.message);
    if (!match) throw new Error('no review link in the email');
    return decodeURIComponent(match[1]);
  }

  /**
   * Accept a link from the public endpoint.
   *
   * @param {string} token - Raw token
   * @param {Object} [body] - Form fields
   * @returns {Promise<Object>} Supertest response
   */
  function accept(token, body = {}) {
    return request(app).post('/api/v1/public/family-links/accept').send({ token, ...body });
  }

  beforeAll(async () => {
    process.env.PUBLIC_BASE_URL = 'https://unit.example.org';
    pool = new Pool({ connectionString: DATABASE_URL });

    ids.parentRoleId = await one(
      `INSERT INTO roles (role_name, display_name) VALUES ('parent', 'Parent')
       ON CONFLICT (role_name) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`
    );
    // The grant migration 007 makes, replayed: the disposable schema had no
    // roles when it ran.
    await pool.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
        WHERE r.role_name = 'parent' AND p.permission_key = 'participants.create_own'
       ON CONFLICT DO NOTHING`
    );

    ids.unitA = await createUnit('6A Family Links');
    ids.unitB = await createUnit('6B Family Links');

    ids.a = await parent('Alice', ids.unitA);
    ids.c = await parent('Carole', ids.unitA);
    ids.d = await parent('Denis', ids.unitA);
    ids.childless = await parent('Nobody', ids.unitA);

    ids.aliceChild = await child('Léa', ids.unitA);
    ids.caroleChild = await child('Noé', ids.unitA);
    ids.denisChild = await child('Zoé', ids.unitA);
    ids.carolesOtherUnitChild = await child('Éloi', ids.unitB);

  });

  /**
   * A fresh app per test. The request limiter lives with the router, so each
   * test starts with an empty hour instead of inheriting the previous tests'.
   *
   * @returns {Object} Express app
   */
  function buildApp() {
    const built = express();
    built.use(express.json());
    built.locals.pool = pool;
    built.use('/api/v1', require('../routes/familyLinks')(pool, console));
    built.use('/api/v1/public', require('../routes/public')(pool, console));
    return built;
  }

  afterAll(async () => {
    delete process.env.PUBLIC_BASE_URL;
    if (pool) await pool.end();
  });

  beforeEach(async () => {
    app = buildApp();
    sentEmails.length = 0;
    transport.succeeds = true;
    const units = [ids.unitA, ids.unitB];

    await pool.query('DELETE FROM family_links WHERE organization_id = ANY($1::int[])', [units]);
    await pool.query('DELETE FROM family_link_requests WHERE organization_id = ANY($1::int[])', [units]);

    // Put every fixture child back to "visible to its own parent only".
    const children = [ids.aliceChild, ids.caroleChild, ids.denisChild, ids.carolesOtherUnitChild];
    await pool.query('DELETE FROM participant_access_grants WHERE participant_id = ANY($1::int[])', [children]);
    await pool.query('DELETE FROM user_participants WHERE participant_id = ANY($1::int[])', [children]);
    const owners = [
      [ids.aliceChild, ids.a.id],
      [ids.caroleChild, ids.c.id],
      [ids.denisChild, ids.d.id],
      [ids.carolesOtherUnitChild, ids.c.id],
    ];
    for (const [participantId, userId] of owners) {
      // eslint-disable-next-line no-await-in-loop
      await grantParticipantAccess(pool, { participantId, userId, sourceType: ACCESS_SOURCE.DIRECT });
    }

    // Accounts made by acceptance use this suite's own domain. Other suites
    // share the database and clean up their own addresses, so a shared pattern
    // would let one suite delete another's accounts mid-test.
    await pool.query(
      `DELETE FROM participant_access_grants
        WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@family-links.example.org')`
    );
    await pool.query(
      `DELETE FROM user_participants
        WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@family-links.example.org')`
    );
    await pool.query(
      `DELETE FROM user_organizations
        WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@family-links.example.org')`
    );
    await pool.query(
      `DELETE FROM guardian_users
        WHERE guardian_id IN (SELECT id FROM parents_guardians WHERE courriel LIKE '%@family-links.example.org')`
    );
    await pool.query("DELETE FROM parents_guardians WHERE courriel LIKE '%@family-links.example.org'");
    await pool.query("DELETE FROM users WHERE email LIKE '%@family-links.example.org'");

    await pool.query(
      "UPDATE user_organizations SET status = 'active', deactivated_at = NULL, deactivated_reason = NULL WHERE user_id = ANY($1::uuid[])",
      [[ids.a.id, ids.c.id, ids.d.id]]
    );
  });

  test('asking mails a link and shares nothing yet', async () => {
    const token = await askToLink(ids.a.id, ids.c.email);

    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toBe(ids.c.email);
    expect(sentEmails[0].subject).toContain('Alice');

    expect(await sees(ids.c.id, ids.aliceChild)).toBe(false);
    expect(await sees(ids.a.id, ids.caroleChild)).toBe(false);

    const described = await request(app).get('/api/v1/public/family-links/describe').query({ token });
    expect(described.body.data).toMatchObject({
      state: FAMILY_LINK_STATE.READY_EXISTING_ACCOUNT,
      requester_name: 'Alice',
      organization_name: '6A Family Links',
      shared_children_count: 1,
      // Alice set no preference, so the unit's default -- the email's language.
      language: 'fr',
    });
    // A count, never names: the link may have reached the wrong inbox.
    expect(JSON.stringify(described.body)).not.toContain('Léa');

    // Describing is not consenting.
    expect(await sees(ids.c.id, ids.aliceChild)).toBe(false);
    expect(await one('SELECT status FROM family_link_requests WHERE target_email = $1', [ids.c.email])).toBe('pending');
  });

  test('accepting shares each side\'s children in this unit, both ways, through the link', async () => {
    const token = await askToLink(ids.a.id, ids.c.email);

    const response = await accept(token);

    expect(response.body.data.result).toBe(FAMILY_LINK_RESULT.LINKED);
    expect(await sees(ids.c.id, ids.aliceChild)).toBe(true);
    expect(await sees(ids.a.id, ids.caroleChild)).toBe(true);

    const grant = await pool.query(
      'SELECT source_type, source_id FROM participant_access_grants WHERE user_id = $1 AND participant_id = $2 AND revoked_at IS NULL',
      [ids.c.id, ids.aliceChild]
    );
    expect(grant.rows).toEqual([{ source_type: 'family_link', source_id: String(response.body.data.link_id) }]);
  });

  test('a link made in 6A does not expose a partner\'s children in 6B', async () => {
    await accept(await askToLink(ids.a.id, ids.c.email));

    expect(await sees(ids.a.id, ids.carolesOtherUnitChild)).toBe(false);
  });

  test('access does not travel along a chain of links', async () => {
    await accept(await askToLink(ids.a.id, ids.c.email));
    await accept(await askToLink(ids.c.id, ids.d.email));

    // Carole shares her own child with Denis, and nothing she only holds through Alice.
    expect(await sees(ids.d.id, ids.caroleChild)).toBe(true);
    expect(await sees(ids.d.id, ids.aliceChild)).toBe(false);
    expect(await sees(ids.a.id, ids.denisChild)).toBe(false);
  });

  test('a new address gets an account, a membership and a contact record, then the children', async () => {
    const token = await askToLink(ids.a.id, 'new.coparent@family-links.example.org');

    const described = await request(app).get('/api/v1/public/family-links/describe').query({ token });
    expect(described.body.data.state).toBe(FAMILY_LINK_STATE.READY_NEW_ACCOUNT);

    const missing = await accept(token, { first_name: 'Nadia' });
    expect(missing.status).toBe(400);

    const response = await accept(token, { first_name: 'Nadia', last_name: 'Roy', password: GOOD_PASSWORD });
    expect(response.body.data.result).toBe(FAMILY_LINK_RESULT.LINKED);

    const newId = await one('SELECT id FROM users WHERE email = $1', ['new.coparent@family-links.example.org']);
    expect(await one('SELECT is_verified FROM users WHERE id = $1', [newId])).toBe(true);
    expect(await one(
      'SELECT status FROM user_organizations WHERE user_id = $1 AND organization_id = $2',
      [newId, ids.unitA]
    )).toBe('active');
    expect(await one('SELECT user_uuid FROM parents_guardians WHERE courriel = $1', ['new.coparent@family-links.example.org']))
      .toBe(newId);
    expect(await sees(newId, ids.aliceChild)).toBe(true);
  });

  test('declining shares nothing, and the link cannot be accepted afterwards', async () => {
    const token = await askToLink(ids.a.id, ids.c.email);

    const declined = await request(app).post('/api/v1/public/family-links/decline').send({ token });
    expect(declined.body.data.declined).toBe(true);

    const late = await accept(token);
    expect(late.body.data.state).toBe(FAMILY_LINK_STATE.DECLINED);
    expect(await sees(ids.c.id, ids.aliceChild)).toBe(false);
    expect(await one('SELECT count(*) FROM family_links WHERE organization_id = $1', [ids.unitA])).toBe('0');
  });

  test('ending a link takes back what it gave and nothing else', async () => {
    const accepted = await accept(await askToLink(ids.a.id, ids.c.email));
    const linkId = accepted.body.data.link_id;

    // Carole is also on Léa's file for an independent reason: an admin linked her.
    await grantParticipantAccess(pool, {
      participantId: ids.aliceChild,
      userId: ids.c.id,
      sourceType: ACCESS_SOURCE.ADMIN,
      sourceId: ids.d.id,
    });

    const ended = await as(ids.c.id).delete(`/api/v1/family-links/${linkId}`);

    expect(ended.status).toBe(200);
    expect(await sees(ids.a.id, ids.caroleChild)).toBe(false);
    // Survives: it never rested on the link.
    expect(await sees(ids.c.id, ids.aliceChild)).toBe(true);
    // Each parent keeps their own child.
    expect(await sees(ids.a.id, ids.aliceChild)).toBe(true);
    expect(await sees(ids.c.id, ids.caroleChild)).toBe(true);
  });

  test('only the two linked parents can end their link', async () => {
    const accepted = await accept(await askToLink(ids.a.id, ids.c.email));

    const outsider = await as(ids.d.id).delete(`/api/v1/family-links/${accepted.body.data.link_id}`);

    expect(outsider.status).toBe(404);
    expect(await sees(ids.c.id, ids.aliceChild)).toBe(true);
  });

  test('refuses to ask oneself, to ask with no child, and to ask twice', async () => {
    const self = await as(ids.a.id).post('/api/v1/family-link-requests').send({ email: ids.a.email.toUpperCase() });
    const childless = await as(ids.childless.id).post('/api/v1/family-link-requests').send({ email: ids.c.email });
    await askToLink(ids.a.id, ids.c.email);
    const twice = await as(ids.a.id).post('/api/v1/family-link-requests').send({ email: ids.c.email });

    expect([self.status, self.body.code]).toEqual([400, 'self']);
    expect([childless.status, childless.body.code]).toEqual([400, 'no_children']);
    expect([twice.status, twice.body.code]).toEqual([409, 'already_requested']);
    expect(sentEmails).toHaveLength(1);
  });

  test('refuses to ask again once linked', async () => {
    await accept(await askToLink(ids.a.id, ids.c.email));

    const again = await as(ids.a.id).post('/api/v1/family-link-requests').send({ email: ids.c.email });

    expect([again.status, again.body.code]).toEqual([409, 'already_linked']);
  });

  test('a parent\'s request cannot readmit someone an administrator removed', async () => {
    await pool.query(
      "UPDATE user_organizations SET status = 'inactive', deactivated_at = now(), deactivated_reason = 'removed_by_admin' WHERE user_id = $1",
      [ids.c.id]
    );
    const token = await askToLink(ids.a.id, ids.c.email);

    const response = await accept(token);

    expect(response.body.data.error).toBe('membership_blocked');
    expect(await one('SELECT status FROM user_organizations WHERE user_id = $1', [ids.c.id])).toBe('inactive');
    expect(await sees(ids.c.id, ids.aliceChild)).toBe(false);
    expect(await one('SELECT status FROM family_link_requests WHERE target_email = $1', [ids.c.email])).toBe('pending');
  });

  test('a request from a parent who has since left the unit cannot be accepted', async () => {
    const token = await askToLink(ids.a.id, ids.c.email);
    await pool.query(
      "UPDATE user_organizations SET status = 'inactive', deactivated_reason = 'no_enrolled_child' WHERE user_id = $1",
      [ids.a.id]
    );

    const described = await request(app).get('/api/v1/public/family-links/describe').query({ token });
    const response = await accept(token);

    expect(described.body.data.state).toBe(FAMILY_LINK_STATE.UNAVAILABLE);
    expect(response.body.data.state).toBe(FAMILY_LINK_STATE.UNAVAILABLE);
    expect(await sees(ids.c.id, ids.aliceChild)).toBe(false);
  });

  test('resending kills the old link; withdrawing kills the request', async () => {
    const first = await askToLink(ids.a.id, ids.c.email);
    const requestId = await one('SELECT id FROM family_link_requests WHERE target_email = $1', [ids.c.email]);

    await as(ids.a.id).post(`/api/v1/family-link-requests/${requestId}/resend`).send({});
    const second = tokenFromLastEmail();

    expect((await accept(first)).body.data.state).toBe(FAMILY_LINK_STATE.INVALID);

    await as(ids.a.id).post(`/api/v1/family-link-requests/${requestId}/revoke`).send({});
    expect((await accept(second)).body.data.state).toBe(FAMILY_LINK_STATE.REVOKED);
    expect(await sees(ids.c.id, ids.aliceChild)).toBe(false);
  });

  test('two simultaneous acceptances make one link', async () => {
    const token = await askToLink(ids.a.id, ids.c.email);

    const [x, y] = await Promise.all([accept(token), accept(token)]);

    const results = [x.body.data, y.body.data];
    expect(results.filter((r) => r.result === FAMILY_LINK_RESULT.LINKED)).toHaveLength(1);
    expect(await one("SELECT count(*) FROM family_links WHERE organization_id = $1 AND status = 'active'", [ids.unitA]))
      .toBe('1');
  });

  test('lists a parent\'s links and requests, without token digests', async () => {
    await accept(await askToLink(ids.a.id, ids.c.email));
    await askToLink(ids.a.id, 'pending.person@family-links.example.org');

    const response = await as(ids.a.id).get('/api/v1/family-links');

    expect(response.body.data.links).toEqual([
      expect.objectContaining({ partner_id: ids.c.id, partner_name: 'Carole' }),
    ]);
    expect(response.body.data.requests.map((r) => r.state).sort()).toEqual(['accepted', 'pending']);
    expect(JSON.stringify(response.body)).not.toContain('token_digest');
  });

  test('the requester\'s name is escaped in the email HTML', async () => {
    await pool.query('UPDATE users SET full_name = $1 WHERE id = $2', ['<script>x</script>', ids.a.id]);
    try {
      await askToLink(ids.a.id, ids.c.email);
      expect(sentEmails[0].html).not.toContain('<script>');
      expect(sentEmails[0].html).toContain('&lt;script&gt;');
    } finally {
      await pool.query("UPDATE users SET full_name = 'Alice' WHERE id = $1", [ids.a.id]);
    }
  });
});
