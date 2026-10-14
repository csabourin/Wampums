/**
 * Leader invitations — integration suite
 *
 * A unit's team invites a leader the way it invites a family, and the
 * invitation carries the role the person will hold. Inviting into a role is
 * granting it, so the inviter may only choose a team role of this unit whose
 * permissions they hold (services/roleAssignment.js). Accepting gives the
 * role, makes no guardian record, and is kept in the role history.
 *
 * Skipped unless SCOUT_YEAR_TEST_DATABASE_URL (or TEST_DATABASE_URL) points at
 * a disposable database holding the project schema.
 *
 * @module test/leader-invitations.integration
 */

const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');
const { randomUUID } = require('crypto');

require('./jest-conditional-helpers');

const DATABASE_URL = process.env.SCOUT_YEAR_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL;

process.env.JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || 'leader-invitation-integration-secret';

const sentEmails = [];

jest.mock('../utils/index', () => {
  const actual = jest.requireActual('../utils/index');
  return {
    ...actual,
    sendEmail: jest.fn((to, subject, message, html) => {
      // eslint-disable-next-line no-undef
      global.__leaderInvitationEmails.push({ to, subject, message, html });
      return Promise.resolve(true);
    }),
  };
});

global.__leaderInvitationEmails = sentEmails;

const mockContext = { userId: null, organizationId: null, permissions: [] };

jest.mock('../middleware/auth', () => {
  const actual = jest.requireActual('../middleware/auth');
  return {
    ...actual,
    authenticate: (req, _res, next) => {
      req.user = { id: mockContext.userId };
      next();
    },
    // The real engine's contract: req.userPermissions, and a 403 naming what is missing
    requirePermission: (...permissions) => async (req, res, next) => {
      const required = typeof permissions[0] === 'function' ? await permissions[0](req) : permissions;
      req.userPermissions = mockContext.permissions;
      const missing = required.filter((key) => !mockContext.permissions.includes(key));
      if (missing.length === 0) {return next();}
      return res.status(403).json({ success: false, message: 'Forbidden', required, missing });
    },
    blockDemoRoles: (_req, _res, next) => next(),
    getOrganizationId: () => Promise.resolve(mockContext.organizationId),
  };
});

const { ACCEPTANCE_RESULT } = require('../services/parentInvitations');

/**
 * A new account's password, made per run: upper and lower case, a digit and
 * a symbol, as registration requires.
 * @returns {string}
 */
function newAccountPassphrase() {
  const id = randomUUID();
  return [id.toUpperCase(), id, 'Zz9#'].join('');
}
const INVITER_PERMISSIONS = ['users.invite', 'users.assign_roles', 'participants.view', 'activities.view'];

describe.skipIf(!DATABASE_URL)('Leader invitations', () => {
  let pool;
  let app;
  const ids = { ownOrganizationIds: [] };

  async function one(sql, params = []) {
    const result = await pool.query(sql, params);
    return result.rows[0] ? Object.values(result.rows[0])[0] : undefined;
  }

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
      ids.ownOrganizationIds.push(organizationId);
      return organizationId;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * A custom role of a unit, holding the given permissions.
   * @param {number} organizationId - Unit
   * @param {string} slug - Role key suffix
   * @param {string} dataScope - 'organization' or 'linked'
   * @param {string[]} permissionKeys - Permissions it carries
   * @returns {Promise<number>} Role id
   */
  async function createRole(organizationId, slug, dataScope, permissionKeys) {
    const roleId = await one(
      `INSERT INTO roles (role_name, display_name, organization_id, data_scope, is_system_role)
       VALUES ($1, $2, $3, $4, false) RETURNING id`,
      [`u${organizationId}_${slug}_${Date.now()}`, `Role ${slug}`, organizationId, dataScope]
    );
    await pool.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT $1, id FROM permissions WHERE permission_key = ANY($2::text[])
       ON CONFLICT DO NOTHING`,
      [roleId, permissionKeys]
    );
    return roleId;
  }

  function invite(body) {
    return request(app).post('/api/v1/parent-invitations').send(body);
  }

  function tokenFromLastEmail() {
    const last = sentEmails[sentEmails.length - 1];
    const match = /complete-registration\?token=([^"\s&]+)/.exec(last.message);
    if (!match) {throw new Error('no completion link in the email');}
    return decodeURIComponent(match[1]);
  }

  function accept(token, body = {}) {
    return request(app).post('/api/v1/public/parent-invitations/accept').send({ token, ...body });
  }

  beforeAll(async () => {
    process.env.PUBLIC_BASE_URL = 'https://unit.example.org';
    pool = new Pool({ connectionString: DATABASE_URL });

    ids.organizationId = await createOrganization('7A Leader Invitation Test');
    ids.otherOrganizationId = await createOrganization('7B Other Unit');
    mockContext.organizationId = ids.organizationId;

    await one(
      `INSERT INTO roles (role_name, display_name) VALUES ('parent', 'Parent')
       ON CONFLICT (role_name) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`
    );
    ids.teamRoleId = await createRole(ids.organizationId, 'team', 'organization', ['participants.view', 'activities.view']);
    ids.bigRoleId = await createRole(ids.organizationId, 'big', 'organization', ['participants.view', 'finance.manage']);
    ids.linkedRoleId = await createRole(ids.organizationId, 'family', 'linked', ['participants.view']);
    ids.otherUnitRoleId = await createRole(ids.otherOrganizationId, 'team', 'organization', ['participants.view']);

    ids.adminUserId = await one(
      `INSERT INTO users (email, password, full_name)
       VALUES ('leader-admin-' || gen_random_uuid() || '@example.test', 'x', 'Unit Admin') RETURNING id`
    );
    mockContext.userId = ids.adminUserId;

    app = express();
    app.use(express.json());
    app.use('/api/v1/parent-invitations', require('../routes/parentInvitations')(pool, console));
    app.use('/api/v1/public', require('../routes/public')(pool, console));
  });

  afterAll(async () => {
    delete process.env.PUBLIC_BASE_URL;
    if (pool) {
      await pool.query('DELETE FROM parent_invitations WHERE organization_id = ANY($1::int[])', [ids.ownOrganizationIds]);
      await pool.end();
    }
  });

  beforeEach(async () => {
    sentEmails.length = 0;
    mockContext.permissions = INVITER_PERMISSIONS;
    await pool.query('DELETE FROM parent_invitations WHERE organization_id = ANY($1::int[])', [ids.ownOrganizationIds]);
    await pool.query(
      "DELETE FROM role_assignment_audit WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@leaders.example.org')"
    );
    await pool.query(
      "DELETE FROM user_organizations WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@leaders.example.org')"
    );
    await pool.query(
      `DELETE FROM guardian_users
        WHERE guardian_id IN (SELECT id FROM parents_guardians WHERE courriel LIKE '%@leaders.example.org')`
    );
    await pool.query("DELETE FROM parents_guardians WHERE courriel LIKE '%@leaders.example.org'");
    await pool.query("DELETE FROM users WHERE email LIKE '%@leaders.example.org'");
  });

  test('a leader invitation keeps its role and is listed apart from family invitations', async () => {
    const response = await invite({ email: 'baloo@leaders.example.org', role_ids: [ids.teamRoleId] });

    expect(response.status).toBe(201);
    expect(response.body.data.email_sent).toBe(true);
    expect(sentEmails[0].message).toContain('7A Leader Invitation Test');
    expect(sentEmails[0].message).not.toMatch(/add your children|ajoutez vos enfants/i);

    const leaders = await request(app).get('/api/v1/parent-invitations').query({ kind: 'leader' });
    expect(leaders.body.data.map((row) => row.email)).toEqual(['baloo@leaders.example.org']);
    expect(leaders.body.data[0].roles).toEqual([{ id: ids.teamRoleId, display_name: 'Role team' }]);

    const families = await request(app).get('/api/v1/parent-invitations');
    expect(families.body.data).toEqual([]);
  });

  test('inviting a leader takes the permission to assign roles', async () => {
    mockContext.permissions = ['users.invite'];

    const response = await invite({ email: 'baloo@leaders.example.org', role_ids: [ids.teamRoleId] });

    expect(response.status).toBe(403);
    expect(response.body.missing).toEqual(['users.assign_roles']);
    expect(await one('SELECT count(*) FROM parent_invitations WHERE organization_id = $1', [ids.organizationId])).toBe('0');
  });

  test('editing a leader invitation, its address above all, takes the right to grant its roles', async () => {
    await invite({ email: 'baloo@leaders.example.org', role_ids: [ids.teamRoleId] });
    const invitationId = await one('SELECT id FROM parent_invitations WHERE email = $1', ['baloo@leaders.example.org']);
    sentEmails.length = 0;

    mockContext.permissions = ['users.invite'];
    const refused = await request(app).put(`/api/v1/parent-invitations/${invitationId}`)
      .send({ email: 'someone-else@leaders.example.org' });

    expect(refused.status).toBe(403);
    expect(refused.body.missing).toEqual(['users.assign_roles']);
    expect(sentEmails).toHaveLength(0);
    expect(await one('SELECT count(*) FROM parent_invitations WHERE email = $1', ['someone-else@leaders.example.org'])).toBe('0');

    mockContext.permissions = INVITER_PERMISSIONS;
    const allowed = await request(app).put(`/api/v1/parent-invitations/${invitationId}`)
      .send({ email: 'someone-else@leaders.example.org' });
    expect(allowed.status).toBe(200);
  });

  test('a role whose permissions the inviter lacks cannot be offered', async () => {
    const response = await invite({ email: 'baloo@leaders.example.org', role_ids: [ids.bigRoleId] });

    expect(response.status).toBe(403);
    expect(response.body.missing).toEqual(['finance.manage']);
    expect(response.body.required).toEqual(expect.arrayContaining(['finance.manage', 'participants.view']));
    expect(sentEmails).toHaveLength(0);
  });

  test.each([
    ['another unit\'s role', 'otherUnitRoleId'],
    ['a family (linked) role', 'linkedRoleId'],
  ])('%s is refused as a bad request', async (_label, roleKey) => {
    const response = await invite({ email: 'baloo@leaders.example.org', role_ids: [ids[roleKey]] });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('leader_invitation_role_invalid');
  });

  test('a malformed role id is a bad request', async () => {
    const response = await invite({ email: 'baloo@leaders.example.org', role_ids: ['12abc'] });
    expect(response.status).toBe(400);
  });

  test('the roles offered are the unit\'s team roles, each saying whether it may be granted', async () => {
    const response = await request(app).get('/api/v1/parent-invitations/leader-roles');

    expect(response.status).toBe(200);
    const byId = Object.fromEntries(response.body.data.map((role) => [role.id, role.assignable]));
    expect(byId[ids.teamRoleId]).toBe(true);
    expect(byId[ids.bigRoleId]).toBe(false);
    expect(byId).not.toHaveProperty(String(ids.linkedRoleId));
    expect(byId).not.toHaveProperty(String(ids.otherUnitRoleId));
  });

  test('accepting creates a team member with the role, no guardian record, and a role history entry', async () => {
    await invite({ email: 'akela@leaders.example.org', role_ids: [ids.teamRoleId], first_name: 'Ak', last_name: 'Ela' });
    const token = tokenFromLastEmail();

    const described = await request(app).get('/api/v1/public/parent-invitations/describe').query({ token });
    expect(described.body.data.invites_leader).toBe(true);

    const response = await accept(token, { first_name: 'Ak', last_name: 'Ela', password: newAccountPassphrase() });

    expect(response.status).toBe(200);
    expect(response.body.data.result).toBe(ACCEPTANCE_RESULT.ACCOUNT_CREATED);
    expect(response.body.data.as_leader).toBe(true);

    const userId = await one('SELECT id FROM users WHERE email = $1', ['akela@leaders.example.org']);
    const membership = await pool.query(
      'SELECT status, role_ids FROM user_organizations WHERE user_id = $1 AND organization_id = $2',
      [userId, ids.organizationId]
    );
    expect(membership.rows[0].status).toBe('active');
    expect(membership.rows[0].role_ids).toEqual([ids.teamRoleId]);
    expect(await one('SELECT count(*) FROM parents_guardians WHERE courriel = $1', ['akela@leaders.example.org'])).toBe('0');
    expect(await one(
      'SELECT changed_by FROM role_assignment_audit WHERE user_id = $1 AND organization_id = $2',
      [userId, ids.organizationId]
    )).toBe(ids.adminUserId);
  });

  test('an existing account of another unit joins this one with the role', async () => {
    const userId = await one(
      "INSERT INTO users (email, password, full_name, is_verified) VALUES ('bagheera@leaders.example.org', 'x', 'Bagheera', true) RETURNING id"
    );
    await invite({ email: 'bagheera@leaders.example.org', role_ids: [ids.teamRoleId] });

    const response = await accept(tokenFromLastEmail());

    expect(response.body.data.result).toBe(ACCEPTANCE_RESULT.MEMBERSHIP_ADDED);
    expect(await one(
      'SELECT role_ids FROM user_organizations WHERE user_id = $1 AND organization_id = $2',
      [userId, ids.organizationId]
    )).toEqual([ids.teamRoleId]);
  });

  test('a family invitation still makes a parent', async () => {
    const response = await invite({ email: 'family@leaders.example.org' });
    expect(response.status).toBe(201);
    const accepted = await accept(tokenFromLastEmail(), { first_name: 'Jo', last_name: 'Roy', password: newAccountPassphrase() });

    expect(accepted.body.data.as_leader).toBe(false);
    const userId = await one('SELECT id FROM users WHERE email = $1', ['family@leaders.example.org']);
    const parentRoleId = await one("SELECT id FROM roles WHERE role_name = 'parent'");
    expect(await one('SELECT role_ids FROM user_organizations WHERE user_id = $1', [userId])).toEqual([parentRoleId]);
  });
});
