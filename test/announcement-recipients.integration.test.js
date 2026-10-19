/**
 * Writing to a den — integration suite
 *
 * A leader may write to the families of one den alone, without picking a
 * role, and a den chosen with roles narrows the families reached to that den
 * while leaders stay reached as their role was chosen. A family account whose
 * invitation the unit withdrew is neither listed nor written to. Who receives a message
 * is a property of the recipient queries, so it is tested against a real
 * PostgreSQL rather than a mocked pool.
 *
 * Skipped unless SCOUT_YEAR_TEST_DATABASE_URL (or TEST_DATABASE_URL) points at
 * a disposable database holding the project schema and migrations.
 *
 * @module test/announcement-recipients.integration
 */

const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');

require('./jest-conditional-helpers');

const DATABASE_URL = process.env.SCOUT_YEAR_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL;

process.env.JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || 'announcement-recipients-integration-secret';

const mockContext = { userId: null, organizationId: null };

jest.mock('../utils/index', () => {
  const actual = jest.requireActual('../utils/index');
  return {
    ...actual,
    sendEmail: jest.fn(() => Promise.resolve(true)),
    getUserEmailLanguage: jest.fn(() => Promise.resolve('fr')),
  };
});

jest.mock('../middleware/auth', () => {
  const actual = jest.requireActual('../middleware/auth');
  return {
    ...actual,
    authenticate: (req, _res, next) => {
      req.user = { id: mockContext.userId, organizationId: mockContext.organizationId, permissions: [] };
      next();
    },
    requirePermission: () => (_req, _res, next) => next(),
    blockDemoRoles: (_req, _res, next) => next(),
    getOrganizationId: () => Promise.resolve(mockContext.organizationId),
  };
});

const { sendEmail } = require('../utils/index');
const { buildRecipientsForTests } = require('../routes/announcements');
const { grantParticipantAccess, ACCESS_SOURCE } = require('../services/participantAccess');

describe.skipIf(!DATABASE_URL)('Writing to a den', () => {
  let pool;
  let app;
  const ids = {};
  const emails = {};

  async function one(sql, params = []) {
    const result = await pool.query(sql, params);
    return result.rows[0] ? Object.values(result.rows[0])[0] : undefined;
  }

  async function makeUser(label) {
    const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
    const userId = await one(
      "INSERT INTO users (email, password, full_name) VALUES ($1, 'x', $2) RETURNING id",
      [email, label]
    );
    emails[label] = email;
    return userId;
  }

  async function addMember(userId, roleIds) {
    await pool.query(
      `INSERT INTO user_organizations (user_id, organization_id, role_ids, status)
       VALUES ($1, $2, to_jsonb($3::text[]), 'active')`,
      [userId, ids.unit, roleIds.map(String)]
    );
  }

  async function makeYouth(firstName, groupId, guardianLabel) {
    const participantId = await one(
      "INSERT INTO participants (first_name, last_name) VALUES ($1, 'Test') RETURNING id",
      [firstName]
    );
    await pool.query(
      'INSERT INTO participant_organizations (participant_id, organization_id) VALUES ($1, $2)',
      [participantId, ids.unit]
    );
    await pool.query(
      'INSERT INTO participant_groups (participant_id, group_id, organization_id) VALUES ($1, $2, $3)',
      [participantId, groupId, ids.unit]
    );
    const guardianEmail = `${guardianLabel}-${Date.now()}@example.test`;
    emails[guardianLabel] = guardianEmail;
    const guardianId = await one(
      "INSERT INTO parents_guardians (nom, prenom, courriel) VALUES ('Test', $1, $2) RETURNING id",
      [guardianLabel, guardianEmail]
    );
    await pool.query(
      'INSERT INTO participant_guardians (guardian_id, participant_id) VALUES ($1, $2)',
      [guardianId, participantId]
    );
    return { participantId, guardianId };
  }

  async function seed() {
    // A unit needs its program section in the same transaction (deferred key).
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const created = await client.query("INSERT INTO organizations (name) VALUES ('Den Mail Unit') RETURNING id");
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
    mockContext.organizationId = ids.unit;
    await pool.query(
      `INSERT INTO scout_years (organization_id, label, start_date, end_date, status)
       VALUES ($1, '2026-2027', '2026-09-01', '2027-08-31', 'active')`,
      [ids.unit]
    );

    ids.familyRoleId = await one(
      `INSERT INTO roles (role_name, display_name, organization_id, data_scope)
       VALUES ('u' || $1 || '_famille', 'Famille', $1::int, 'linked') RETURNING id`,
      [ids.unit]
    );
    ids.leaderRoleId = await one(
      `INSERT INTO roles (role_name, display_name, organization_id, data_scope)
       VALUES ('u' || $1 || '_animation', 'Animation', $1::int, 'organization') RETURNING id`,
      [ids.unit]
    );
    ids.familyRole = `u${ids.unit}_famille`;
    ids.leaderRole = `u${ids.unit}_animation`;

    ids.red = await one("INSERT INTO groups (name, organization_id) VALUES ('Rouge', $1) RETURNING id", [ids.unit]);
    ids.blue = await one("INSERT INTO groups (name, organization_id) VALUES ('Bleue', $1) RETURNING id", [ids.unit]);

    ids.redYouth = await makeYouth('Rouge', ids.red, 'guardian-red');
    ids.blueYouth = await makeYouth('Bleu', ids.blue, 'guardian-blue');

    ids.leader = await makeUser('leader');
    await addMember(ids.leader, [ids.leaderRoleId]);
    mockContext.userId = ids.leader;

    ids.redParent = await makeUser('parent-red');
    await addMember(ids.redParent, [ids.familyRoleId]);
    await grantParticipantAccess(pool, {
      participantId: ids.redYouth.participantId, userId: ids.redParent, sourceType: ACCESS_SOURCE.ADMIN,
    });

    ids.blueParent = await makeUser('parent-blue');
    await addMember(ids.blueParent, [ids.familyRoleId]);
    await grantParticipantAccess(pool, {
      participantId: ids.blueYouth.participantId, userId: ids.blueParent, sourceType: ACCESS_SOURCE.ADMIN,
    });

    // Push reaches the accounts the email reaches, den filter included.
    for (const [userId, label] of [[ids.redParent, 'red'], [ids.blueParent, 'blue'], [ids.leader, 'leader']]) {
      // eslint-disable-next-line no-await-in-loop
      await pool.query(
        `INSERT INTO subscribers (endpoint, p256dh, auth, organization_id, user_id)
         VALUES ($1, 'k', 'a', $2, $3)`,
        [`https://push.example.test/${ids.unit}/${label}`, ids.unit, userId]
      );
    }
  }

  async function cleanup() {
    if (!ids.unit) {
      return;
    }
    const client = await pool.connect();
    const youth = [ids.redYouth, ids.blueYouth].filter(Boolean);
    const participantIds = youth.map((entry) => entry.participantId);
    const guardianIds = youth.map((entry) => entry.guardianId);
    const userIds = [ids.leader, ids.redParent, ids.blueParent, ...(ids.extraUsers || [])].filter(Boolean);
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL session_replication_role = 'replica'");
      await client.query(
        'DELETE FROM announcement_logs WHERE announcement_id IN (SELECT id FROM announcements WHERE organization_id = $1)',
        [ids.unit]
      );
      for (const table of [
        'announcements', 'subscribers', 'participant_groups', 'groups', 'parent_invitations',
        'participant_organizations', 'user_organizations', 'user_messages', 'roles',
        'scout_years', 'organization_program_sections',
      ]) {
        // Table names come from this literal list, never from a request.
        // eslint-disable-next-line no-await-in-loop
        await client.query(`DELETE FROM ${table} WHERE organization_id = $1`, [ids.unit]);
      }
      await client.query('DELETE FROM participant_access_grants WHERE participant_id = ANY($1::int[])', [participantIds]);
      await client.query('DELETE FROM user_participants WHERE participant_id = ANY($1::int[])', [participantIds]);
      await client.query('DELETE FROM participant_guardians WHERE participant_id = ANY($1::int[])', [participantIds]);
      await client.query('DELETE FROM parents_guardians WHERE id = ANY($1::int[])', [guardianIds]);
      await client.query('DELETE FROM participants WHERE id = ANY($1::int[])', [participantIds]);
      await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);
      await client.query('DELETE FROM organizations WHERE id = $1', [ids.unit]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    Object.keys(ids).forEach((key) => delete ids[key]);
  }

  const pushedTo = (recipients) => recipients.subscribers.map((row) => row.user_id).sort();

  beforeAll(() => {
    pool = new Pool({ connectionString: DATABASE_URL });
    const quiet = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
    app = express();
    app.use(express.json());
    app.use('/api', require('../routes/announcements')(pool, quiet));
    app.use('/api/v1/reports', require('../routes/reports')(pool, quiet));
  });

  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  beforeEach(async () => {
    await cleanup();
    await seed();
    sendEmail.mockClear();
  });

  /**
   * Record a family invitation from the unit to an address.
   *
   * @param {string} email - Invited address
   * @param {string} status - `pending`, `accepted` or `revoked`
   * @param {string} createdAt - When it was sent
   * @returns {Promise<void>}
   */
  async function recordInvitation(email, status, createdAt) {
    await pool.query(
      `INSERT INTO parent_invitations (organization_id, email, token_digest, status, expires_at, created_at,
                                       revoked_at, accepted_at)
       VALUES ($1, $2, encode(sha256(gen_random_uuid()::text::bytea), 'hex'), $3, now() + interval '7 days',
               $4::timestamptz,
               CASE WHEN $3 = 'revoked' THEN now() END,
               CASE WHEN $3 = 'accepted' THEN now() END)`,
      [ids.unit, email.toLowerCase(), status, createdAt]
    );
  }

  /**
   * A family account of the unit with no child linked to it: someone who
   * signed up on their own.
   *
   * @param {string} label - Address label
   * @returns {Promise<string>} User id
   */
  async function makeChildlessFamily(label) {
    const userId = await makeUser(label);
    await addMember(userId, [ids.familyRoleId]);
    ids.extraUsers = [...(ids.extraUsers || []), userId];
    return userId;
  }

  /**
   * The family addresses "Écrire aux familles" lists.
   *
   * @returns {Promise<string[]>} Addresses
   */
  async function listedFamilyAddresses() {
    const response = await request(app).get('/api/v1/reports/mailing-list');
    expect(response.status).toBe(200);
    return (response.body.emails_by_role[ids.familyRole] || []).map((entry) => (
      typeof entry === 'string' ? entry : entry.email
    ));
  }

  test('a den chosen alone reaches its families, and only them', async () => {
    const recipients = await buildRecipientsForTests(pool, ids.unit, [], [ids.red], 'members');

    expect(recipients.emails.sort()).toEqual([emails['guardian-red'], emails['parent-red']].sort());
    expect(pushedTo(recipients)).toEqual([ids.redParent]);
  });

  test('a den chosen with roles narrows families to the den and keeps the leaders', async () => {
    const recipients = await buildRecipientsForTests(
      pool, ids.unit, ['parent', ids.familyRole, ids.leaderRole], [ids.red], 'members'
    );

    expect(recipients.emails.sort()).toEqual(
      [emails['guardian-red'], emails['parent-red'], emails.leader].sort()
    );
    expect(pushedTo(recipients)).toEqual([ids.leader, ids.redParent].sort());
  });

  test('without a den, a role reaches every family of the unit', async () => {
    const recipients = await buildRecipientsForTests(pool, ids.unit, ['parent', ids.familyRole], [], 'members');

    expect(recipients.emails.sort()).toEqual([
      emails['guardian-blue'], emails['guardian-red'], emails['parent-blue'], emails['parent-red'],
    ].sort());
  });

  test('a leader can send a message to one den without ticking a role', async () => {
    const response = await request(app).post('/api/v1/announcements').send({
      subject: 'Sortie',
      message: 'Bonjour la tanière rouge',
      recipient_roles: [],
      recipient_group_ids: [ids.red],
      send_now: true,
    });

    expect(response.status).toBe(200);
    const sentTo = sendEmail.mock.calls.map(([to]) => to).sort();
    expect(sentTo).toEqual([emails['guardian-red'], emails['parent-red']].sort());
  });

  test('a message to a den that no longer exists, or another unit\'s, is refused and sends nothing', async () => {
    const otherUnitDen = await one(
      "INSERT INTO groups (name, organization_id) VALUES ('Ailleurs', NULL) RETURNING id"
    );
    try {
      for (const groupIds of [[otherUnitDen], [2147483000]]) {
        // eslint-disable-next-line no-await-in-loop
        const response = await request(app).post('/api/v1/announcements').send({
          subject: 'Sortie', message: 'Bonjour', recipient_roles: [], recipient_group_ids: groupIds, send_now: true,
        });
        expect(response.status).toBe(400);
        expect(response.body.message).toBe('announcement_groups_not_found');
      }
      expect(sendEmail).not.toHaveBeenCalled();
    } finally {
      await pool.query('DELETE FROM groups WHERE id = $1', [otherUnitDen]);
    }
  });

  test('a message with neither role nor den is refused, naming what is missing', async () => {
    const response = await request(app).post('/api/v1/announcements').send({
      subject: 'Sortie',
      message: 'Bonjour',
      recipient_roles: [],
      recipient_group_ids: [],
    });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/announcement_recipients_required/);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  describe('a withdrawn family invitation', () => {
    test('takes a family account with no child off the list and out of messages', async () => {
      await makeChildlessFamily('withdrawn');
      await recordInvitation(emails.withdrawn, 'revoked', '2026-09-10');

      const recipients = await buildRecipientsForTests(pool, ids.unit, ['parent', ids.familyRole], [], 'members');

      expect(recipients.emails).not.toContain(emails.withdrawn.toLowerCase());
      expect(await listedFamilyAddresses()).not.toContain(emails.withdrawn.toLowerCase());
    });

    test('a family account with no child and no withdrawn invitation stays reached', async () => {
      await makeChildlessFamily('signed-up');

      const recipients = await buildRecipientsForTests(pool, ids.unit, ['parent', ids.familyRole], [], 'members');

      expect(recipients.emails).toContain(emails['signed-up'].toLowerCase());
      expect(await listedFamilyAddresses()).toContain(emails['signed-up'].toLowerCase());
    });

    test('an address invited again after the withdrawal is reached', async () => {
      await makeChildlessFamily('reinvited');
      await recordInvitation(emails.reinvited, 'revoked', '2026-09-10');
      await recordInvitation(emails.reinvited, 'accepted', '2026-09-20');

      const recipients = await buildRecipientsForTests(pool, ids.unit, ['parent', ids.familyRole], [], 'members');

      expect(recipients.emails).toContain(emails.reinvited.toLowerCase());
      expect(await listedFamilyAddresses()).toContain(emails.reinvited.toLowerCase());
    });

    test('a parent with a child in the unit stays reached', async () => {
      await recordInvitation(emails['parent-red'], 'revoked', '2026-09-10');

      const recipients = await buildRecipientsForTests(pool, ids.unit, ['parent', ids.familyRole], [], 'members');

      expect(recipients.emails).toContain(emails['parent-red'].toLowerCase());
      expect(await listedFamilyAddresses()).toContain(emails['parent-red'].toLowerCase());
    });

    test('a leader stays reached through the team role', async () => {
      await pool.query(
        'UPDATE user_organizations SET role_ids = to_jsonb($2::text[]) WHERE user_id = $1 AND organization_id = $3',
        [ids.leader, [String(ids.leaderRoleId), String(ids.familyRoleId)], ids.unit]
      );
      await recordInvitation(emails.leader, 'revoked', '2026-09-10');

      const recipients = await buildRecipientsForTests(
        pool, ids.unit, ['parent', ids.familyRole, ids.leaderRole], [], 'members'
      );

      expect(recipients.emails).toContain(emails.leader.toLowerCase());
    });
  });

  describe('"Écrire aux familles" lists each family under its children', () => {
    /**
     * The parent entries the mailing list shows, for one address.
     *
     * @param {string} email - Address
     * @returns {Promise<Array<Object>>} `{ email, participants }` entries
     */
    async function familyEntriesFor(email) {
      const response = await request(app).get('/api/v1/reports/mailing-list');
      expect(response.status).toBe(200);
      return (response.body.emails_by_role.parent || []).filter((entry) => entry.email === email.toLowerCase());
    }

    // The built-in parent role, which is what fills the families section. It is
    // limited to the holder's own children in a real unit; other suites create
    // it without a scope, so it is set for these tests and put back after.
    let previousParentScope;

    beforeEach(async () => {
      ids.parentRoleId = await one(
        `INSERT INTO roles (role_name, display_name) VALUES ('parent', 'Parent')
         ON CONFLICT (role_name) DO UPDATE SET display_name = roles.display_name RETURNING id`
      );
      previousParentScope = await one('SELECT data_scope FROM roles WHERE id = $1', [ids.parentRoleId]);
      await pool.query("UPDATE roles SET data_scope = 'linked' WHERE id = $1", [ids.parentRoleId]);
    });

    afterEach(async () => {
      await pool.query('UPDATE roles SET data_scope = $2 WHERE id = $1', [ids.parentRoleId, previousParentScope]);
    });

    test('a co-parent seen through a family link is listed under the child, not as an unknown child', async () => {
      // The first parent typed the second one's address on the form; the
      // second parent signed up with another one, and was linked as family.
      const coParent = await makeUser('coparent-red');
      ids.extraUsers = [...(ids.extraUsers || []), coParent];
      await addMember(coParent, [ids.parentRoleId]);
      await grantParticipantAccess(pool, {
        participantId: ids.redYouth.participantId, userId: coParent, sourceType: ACCESS_SOURCE.FAMILY_LINK,
      });

      expect(await familyEntriesFor(emails['coparent-red'])).toEqual([
        { email: emails['coparent-red'].toLowerCase(), participants: 'Rouge Test' },
      ]);
      expect(await familyEntriesFor(emails['guardian-red'])).toEqual([
        { email: emails['guardian-red'].toLowerCase(), participants: 'Rouge Test' },
      ]);
    });

    test('a parent account with no child this year is still listed, without a child', async () => {
      const lone = await makeUser('lone-parent');
      ids.extraUsers = [...(ids.extraUsers || []), lone];
      await addMember(lone, [ids.parentRoleId]);

      expect(await familyEntriesFor(emails['lone-parent'])).toEqual([
        { email: emails['lone-parent'].toLowerCase(), participants: null },
      ]);
    });
  });
});
