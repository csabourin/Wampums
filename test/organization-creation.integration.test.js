/**
 * Organization creation — integration suite
 *
 * `organizations` and `organization_program_sections` reference each other, and
 * until `fix_organizations_program_section_fk_deferrable.sql` neither constraint was
 * deferrable: the cycle had no entry point and POST /api/v1/organizations could
 * not succeed at all.
 *
 * This suite exists because the defect was invisible to every other test. The
 * older fixtures created organizations with foreign key triggers suspended
 * (`session_replication_role = 'replica'`), which is exactly the state in which
 * a broken constraint cannot be observed. Nothing here suspends anything.
 *
 * Skipped unless SCOUT_YEAR_TEST_DATABASE_URL (or TEST_DATABASE_URL) points at a
 * disposable database holding the project schema.
 *
 * @module test/organization-creation.integration
 */

const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');

const DATABASE_URL = process.env.SCOUT_YEAR_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL;

process.env.JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || 'organization-integration-secret';

const mockContext = { userId: null, permissions: [] };

jest.mock('../middleware/auth', () => {
  const actual = jest.requireActual('../middleware/auth');
  return {
    ...actual,
    authenticate: (req, _res, next) => {
      req.user = { id: mockContext.userId, roleNames: ['district'] };
      next();
    },
    requirePermission: () => (req, _res, next) => {
      req.userPermissions = mockContext.permissions;
      next();
    },
    blockDemoRoles: (_req, _res, next) => next()
  };
});

// The invitation email is sent after the unit is committed; no mail leaves the test.
jest.mock('../services/familyDelivery', () => ({
  deliverParentInvitation: jest.fn(),
  deliverFamilyRequest: jest.fn()
}));

const { deliverParentInvitation } = require('../services/familyDelivery');

/** What the unit administrator role holds in this suite, and so what the creator must hold. */
const UNIT_ADMIN_PERMISSIONS = ['participants.view'];

describe.skipIf(!DATABASE_URL)('Organization creation', () => {
  let pool;
  let app;
  const ids = { created: [] };
  let sequence = 0;

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
   * Remove the organizations this suite created.
   *
   * Deliberately a plain DELETE with no trigger suspension: cleaning up has to
   * work through the same constraints the application lives with, or it would
   * hide the very cycle this suite is about.
   *
   * @returns {Promise<void>}
   */
  async function cleanup() {
    if (ids.created.length > 0) {
      await pool.query('DELETE FROM parent_invitations WHERE organization_id = ANY($1::int[])', [ids.created]);
      await pool.query('DELETE FROM organization_domains WHERE organization_id = ANY($1::int[])', [ids.created]);
      await pool.query('DELETE FROM user_organizations WHERE organization_id = ANY($1::int[])', [ids.created]);
      await pool.query('DELETE FROM organization_settings WHERE organization_id = ANY($1::int[])', [ids.created]);
      await pool.query('DELETE FROM organization_form_formats WHERE organization_id = ANY($1::int[])', [ids.created]);
      await pool.query('DELETE FROM organizations WHERE id = ANY($1::int[])', [ids.created]);
      ids.created = [];
    }
    if (ids.userId) {
      await pool.query('DELETE FROM users WHERE id = $1', [ids.userId]);
      ids.userId = null;
    }
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    app = express();
    app.use(express.json());
    app.use('/api/v1/organizations', require('../routes/organizations')(pool, {
      info: () => {}, error: () => {}, warn: () => {}
    }));
    // eslint-disable-next-line no-unused-vars
    app.use((err, _req, res, _next) => {
      res.status(500).json({ success: false, message: err.message });
    });

    await pool.query(
      `INSERT INTO roles (role_name, display_name) VALUES ('district', 'District')
       ON CONFLICT (role_name) DO NOTHING`
    );
    await pool.query(
      `INSERT INTO roles (role_name, display_name, data_scope) VALUES ('unitadmin', 'Unit administrator', 'organization')
       ON CONFLICT (role_name) DO NOTHING`
    );
    await pool.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT r.id, p.id FROM roles r, permissions p
        WHERE r.role_name = 'unitadmin' AND r.organization_id IS NULL AND p.permission_key = ANY($1::text[])
       ON CONFLICT DO NOTHING`,
      [UNIT_ADMIN_PERMISSIONS]
    );
  });

  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  beforeEach(async () => {
    await cleanup();
    ids.userId = await one(
      `INSERT INTO users (email, password, full_name)
       VALUES ('org-creator-' || gen_random_uuid() || '@example.test', 'x', 'Créatrice')
       RETURNING id`
    );
    mockContext.userId = ids.userId;
    mockContext.permissions = ['org.create', ...UNIT_ADMIN_PERMISSIONS];
    deliverParentInvitation.mockReset();
    deliverParentInvitation.mockResolvedValue(true);
  });

  /**
   * A subdomain no other run of this suite holds.
   *
   * @returns {string} Label before .wampums.app
   */
  function freshSubdomain() {
    sequence += 1;
    return `test-unit-${process.pid}-${Date.now().toString(36)}-${sequence}`;
  }

  /**
   * Everything a unit is created with, around the given fields.
   *
   * @param {Object} fields - Fields to set or override
   * @returns {Object} Request body
   */
  function unitBody(fields = {}) {
    return {
      subdomain: freshSubdomain(),
      program_section: 'cubs',
      leader_email: `ada-${freshSubdomain()}@example.test`,
      ...fields,
    };
  }

  /**
   * Post a unit and remember it for cleanup.
   *
   * @param {Object} body - Request body
   * @returns {Promise<Object>} Supertest response
   */
  async function post(body) {
    const response = await request(app).post('/api/v1/organizations').send(body);
    if (response.body?.data?.organization_id) {
      ids.created.push(response.body.data.organization_id);
    }
    return response;
  }

  /**
   * Create an organization through the route.
   *
   * @param {string} name - Organization name
   * @param {Object} [fields] - Other fields
   * @returns {Promise<Object>} Supertest response
   */
  function create(name, fields = {}) {
    return post(unitBody({ name, ...fields }));
  }

  test('creates an organization, which the circular foreign key used to forbid', async () => {
    const response = await create('Unité créée par le test');

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ success: true });
    expect(response.body.data.organization_id).toEqual(expect.any(Number));
  });

  test('seeds the default program sections in the same transaction', async () => {
    const response = await create('Unité avec sections', { program_section: 'general' });
    const organizationId = response.body.data.organization_id;

    const sections = await pool.query(
      'SELECT section_key FROM organization_program_sections WHERE organization_id = $1 ORDER BY section_key',
      [organizationId]
    );

    // The organization's own program_section defaults to 'general', so that row
    // in particular has to exist or the deferred constraint would fail at COMMIT.
    expect(sections.rows.map(row => row.section_key)).toEqual(
      expect.arrayContaining(['general', 'beavers', 'cubs', 'scouts', 'pioneers', 'rovers'])
    );
    expect(await one('SELECT program_section FROM organizations WHERE id = $1', [organizationId]))
      .toBe('general');
  });

  test('makes the creator a district member of the new unit', async () => {
    const response = await create('Unité avec propriétaire');
    const organizationId = response.body.data.organization_id;

    const districtRoleId = await one("SELECT id FROM roles WHERE role_name = 'district'");
    const roleIds = await one(
      'SELECT role_ids FROM user_organizations WHERE user_id = $1 AND organization_id = $2',
      [ids.userId, organizationId]
    );

    expect(roleIds.map(Number)).toEqual([districtRoleId]);
  });

  test('still refuses an organization whose section was never seeded', async () => {
    // Deferring says *when* the constraint is checked, not *whether*. An
    // organization committed without its default section would be a row the
    // application could never read back consistently.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("INSERT INTO organizations (name) VALUES ('Unité orpheline')");
      await expect(client.query('COMMIT')).rejects.toThrow(
        /organizations_program_section_fk/
      );
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }

    expect(await one("SELECT COUNT(*)::int FROM organizations WHERE name = 'Unité orpheline'")).toBe(0);
  });

  test('a new unit receives the default starter activities, once, created by its creator', async () => {
    const { selectDefaultStarterKeys } = require('../services/activityLibraryStarter');
    const expected = selectDefaultStarterKeys(null);
    const response = await create('Unité avec activités de départ', { program_section: 'general' });
    const organizationId = response.body.data.organization_id;

    const copies = await pool.query(
      `SELECT metadata ->> 'starter_key' AS key, created_by, metadata ->> 'starter_language' AS language
       FROM activity_library WHERE organization_id = $1 ORDER BY id`,
      [organizationId]
    );

    // A new unit's section is "general": the activities suited to every branch,
    // meeting blocks included, and none needing close supervision.
    expect(copies.rows.map(row => row.key)).toEqual(expected);
    expect(expected).toEqual(expect.arrayContaining(['block_arrival', 'block_water_break', 'block_closing']));
    expect(expected).not.toContain('expression_campfire');
    expect(new Set(copies.rows.map(row => row.created_by))).toEqual(new Set([ids.userId]));
    expect(new Set(copies.rows.map(row => row.language))).toEqual(new Set(['fr']));
  });

  test('rejects a nameless organization without opening a transaction', async () => {
    const response = await request(app).post('/api/v1/organizations').send(unitBody());
    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual([expect.objectContaining({ field: 'name' })]);
  });

  test('a new unit receives the unit information form, closed to parents', async () => {
    const response = await create('Unité avec fiche d’unité');
    const organizationId = response.body.data.organization_id;

    const format = await pool.query(
      `SELECT id, status, display_context, current_version_id
       FROM organization_form_formats
       WHERE organization_id = $1 AND form_type = 'organization_info'`,
      [organizationId]
    );
    expect(format.rows).toHaveLength(1);
    expect(format.rows[0]).toMatchObject({ status: 'published', current_version_id: expect.any(Number) });
    expect(format.rows[0].display_context).toEqual(expect.arrayContaining(['organization']));

    const parentAccess = await one(
      `SELECT COUNT(*)::int FROM form_permissions fp JOIN roles r ON r.id = fp.role_id
       WHERE fp.form_format_id = $1 AND r.role_name = 'parent'`,
      [format.rows[0].id]
    );
    expect(parentAccess).toBe(0);
  });

  test('keeps only the unit fields it knows, and refuses a logo that is not a web address', async () => {
    const refused = await request(app).post('/api/v1/organizations')
      .send(unitBody({ name: 'Unité au logo local', logo: 'C:\\fakepath\\logo.png' }));
    expect(refused.status).toBe(400);
    expect(refused.body.errors).toEqual([expect.objectContaining({ field: 'logo' })]);
    expect(await one("SELECT COUNT(*)::int FROM organizations WHERE name = 'Unité au logo local'")).toBe(0);

    const response = await post(unitBody({
      name: '  Unité complète  ',
      unit: '12e Saint-Bivouac',
      meeting_day: 'Tuesday',
      logo: 'https://example.test/logo.png',
      program_sections: ['not', 'a', 'unit', 'field'],
    }));
    expect(response.status).toBe(201);

    const info = await one(
      `SELECT setting_value FROM organization_settings
       WHERE organization_id = $1 AND setting_key = 'organization_info'`,
      [response.body.data.organization_id]
    );
    expect(info).toEqual({
      name: 'Unité complète',
      unit: '12e Saint-Bivouac',
      meeting_day: 'Tuesday',
      logo: 'https://example.test/logo.png',
    });
  });

  test('the migration gives a unit its missing information form without restoring a form it removed', async () => {
    const response = await create('Unité sans fiche d’unité');
    const organizationId = response.body.data.organization_id;
    await pool.query(
      `DELETE FROM organization_form_formats
       WHERE organization_id = $1 AND form_type IN ('organization_info', 'acceptation_risque')`,
      [organizationId]
    );

    const migration = require('../migrations/046_install_organization_info_format');
    const client = await pool.connect();
    try {
      await migration.up(client, { organizationIds: [organizationId] });
      await migration.up(client, { organizationIds: [organizationId] });
    } finally {
      client.release();
    }

    const formTypes = await pool.query(
      'SELECT form_type FROM organization_form_formats WHERE organization_id = $1 ORDER BY form_type',
      [organizationId]
    );
    const types = formTypes.rows.map((row) => row.form_type);
    expect(types.filter((type) => type === 'organization_info')).toHaveLength(1);
    expect(types).not.toContain('acceptation_risque');
  });

  test('deletes cleanly, which the RESTRICT side used to block', async () => {
    const response = await create('Unité éphémère');
    const organizationId = response.body.data.organization_id;

    await pool.query('DELETE FROM user_organizations WHERE organization_id = $1', [organizationId]);
    await pool.query('DELETE FROM organization_settings WHERE organization_id = $1', [organizationId]);
    await pool.query('DELETE FROM organization_form_formats WHERE organization_id = $1', [organizationId]);
    await expect(
      pool.query('DELETE FROM organizations WHERE id = $1', [organizationId])
    ).resolves.toMatchObject({ rowCount: 1 });

    expect(await one(
      'SELECT COUNT(*)::int FROM organization_program_sections WHERE organization_id = $1',
      [organizationId]
    )).toBe(0);

    ids.created = ids.created.filter(id => id !== organizationId);
  });
  test('a new unit answers at its subdomain, which no other unit may then take, whatever its case', async () => {
    const subdomain = freshSubdomain();
    const response = await create('Meute à son adresse', { subdomain: `  ${subdomain.toUpperCase()} ` });
    expect(response.status).toBe(201);
    expect(response.body.data.domain).toBe(`${subdomain}.wampums.app`);
    expect(await one(
      'SELECT domain FROM organization_domains WHERE organization_id = $1',
      [response.body.data.organization_id]
    )).toBe(`${subdomain}.wampums.app`);

    const taken = await create('Meute en double', { subdomain: subdomain.toUpperCase() });
    expect(taken.status).toBe(409);
    expect(taken.body).toMatchObject({ success: false, message: 'subdomain_taken' });
    expect(taken.body.errors).toEqual([{ field: 'subdomain', msg: 'subdomain_taken' }]);
    expect(await one("SELECT COUNT(*)::int FROM organizations WHERE name = 'Meute en double'")).toBe(0);
  });

  test('a unit created at the same moment as another for the same subdomain is refused, leaving nothing behind', async () => {
    const subdomain = freshSubdomain();
    const [first, second] = await Promise.all([
      create('Meute rapide A', { subdomain }),
      create('Meute rapide B', { subdomain }),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    expect(await one(
      "SELECT COUNT(*)::int FROM organizations WHERE name IN ('Meute rapide A', 'Meute rapide B')"
    )).toBe(1);
  });

  test('a unit needs a usable subdomain, a branch and its administrator\'s address', async () => {
    const response = await post({
      name: 'Meute incomplète',
      subdomain: 'www',
      program_section: 'dragons',
      leader_email: 'pas-une-adresse',
    });

    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual(expect.arrayContaining([
      { field: 'subdomain', msg: 'subdomain_reserved' },
      { field: 'program_section', msg: 'program_section_required' },
      { field: 'leader_email', msg: 'leader_email_invalid' },
    ]));

    const malformed = await post(unitBody({ name: 'Meute mal nommée', subdomain: 'meute_ada!' }));
    expect(malformed.body.errors).toEqual([{ field: 'subdomain', msg: 'subdomain_invalid' }]);
    const missing = await post(unitBody({ name: 'Meute sans adresse', subdomain: undefined }));
    expect(missing.body.errors).toEqual([{ field: 'subdomain', msg: 'subdomain_required' }]);
    expect(await one("SELECT COUNT(*)::int FROM organizations WHERE name LIKE 'Meute %' AND name IN ('Meute incomplète', 'Meute mal nommée', 'Meute sans adresse')")).toBe(0);
  });

  test('a unit is created for its branch, with that branch\'s starter activities', async () => {
    const { selectDefaultStarterKeys } = require('../services/activityLibraryStarter');
    const response = await create('Colonie Ada', { program_section: 'beavers' });
    const organizationId = response.body.data.organization_id;

    expect(await one('SELECT program_section FROM organizations WHERE id = $1', [organizationId])).toBe('beavers');
    const copies = await pool.query(
      `SELECT metadata ->> 'starter_key' AS key FROM activity_library WHERE organization_id = $1 ORDER BY id`,
      [organizationId]
    );
    expect(copies.rows.map((row) => row.key)).toEqual(selectDefaultStarterKeys('beavers'));
  });

  test('the unit administrator is invited by email into the new unit, with no account made for them', async () => {
    const leaderEmail = `Lea.Tremblay-${freshSubdomain()}@Example.test`;
    const response = await create('Meute avec responsable', { leader_email: leaderEmail, language: 'en' });
    const organizationId = response.body.data.organization_id;

    expect(response.status).toBe(201);
    expect(response.body.data.leader_invitation).toEqual({
      email: leaderEmail.toLowerCase(),
      invited: true,
      email_sent: true,
    });
    const invitation = await pool.query(
      'SELECT email, role_ids, status, language, invited_by FROM parent_invitations WHERE organization_id = $1',
      [organizationId]
    );
    const unitAdminRoleId = await one("SELECT id FROM roles WHERE role_name = 'unitadmin' AND organization_id IS NULL");
    expect(invitation.rows).toEqual([{
      email: leaderEmail.toLowerCase(),
      role_ids: [unitAdminRoleId],
      status: 'pending',
      language: 'en',
      invited_by: ids.userId,
    }]);
    expect(await one('SELECT COUNT(*)::int FROM users WHERE lower(email) = lower($1)', [leaderEmail])).toBe(0);
    expect(deliverParentInvitation).toHaveBeenCalledWith(pool, expect.objectContaining({
      invitation: expect.objectContaining({ organization_id: organizationId }),
      token: expect.any(String),
    }));
  });

  test('a unit stays created when its invitation email could not be sent, and says so', async () => {
    deliverParentInvitation.mockResolvedValue(false);
    const response = await create('Meute au courriel perdu');

    expect(response.status).toBe(201);
    expect(response.body.data.leader_invitation).toMatchObject({ invited: true, email_sent: false });
    expect(await one(
      "SELECT COUNT(*)::int FROM parent_invitations WHERE organization_id = $1 AND status = 'pending'",
      [response.body.data.organization_id]
    )).toBe(1);
  });

  test('a creator naming their own address as administrator is not invited into a unit they already run', async () => {
    const creatorEmail = await one('SELECT email FROM users WHERE id = $1', [ids.userId]);
    const response = await create('Meute de la créatrice', { leader_email: creatorEmail.toUpperCase() });

    expect(response.status).toBe(201);
    expect(response.body.data.leader_invitation).toMatchObject({ invited: false, email_sent: false });
    expect(await one(
      'SELECT COUNT(*)::int FROM parent_invitations WHERE organization_id = $1',
      [response.body.data.organization_id]
    )).toBe(0);
    expect(deliverParentInvitation).not.toHaveBeenCalled();
  });

  test('someone lacking the unit administrator\'s permissions cannot create a unit to hand them out', async () => {
    mockContext.permissions = ['org.create'];
    const response = await create('Meute refusée');

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ required: UNIT_ADMIN_PERMISSIONS, missing: UNIT_ADMIN_PERMISSIONS });
    expect(await one("SELECT COUNT(*)::int FROM organizations WHERE name = 'Meute refusée'")).toBe(0);
  });
});
