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

const mockContext = { userId: null };

jest.mock('../middleware/auth', () => {
  const actual = jest.requireActual('../middleware/auth');
  return {
    ...actual,
    authenticate: (req, _res, next) => {
      req.user = { id: mockContext.userId, roleNames: ['district'] };
      next();
    },
    requirePermission: () => (_req, _res, next) => next(),
    blockDemoRoles: (_req, _res, next) => next()
  };
});

describe.skipIf(!DATABASE_URL)('Organization creation', () => {
  let pool;
  let app;
  const ids = { created: [] };

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
  });

  /**
   * Create an organization through the route.
   *
   * @param {string} name - Organization name
   * @returns {Promise<Object>} Supertest response
   */
  async function create(name) {
    const response = await request(app).post('/api/v1/organizations').send({ name });
    if (response.body?.organization_id) {
      ids.created.push(response.body.organization_id);
    }
    return response;
  }

  test('creates an organization, which the circular foreign key used to forbid', async () => {
    const response = await create('Unité créée par le test');

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ success: true });
    expect(response.body.organization_id).toEqual(expect.any(Number));
  });

  test('seeds the default program sections in the same transaction', async () => {
    const response = await create('Unité avec sections');
    const organizationId = response.body.organization_id;

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
    const organizationId = response.body.organization_id;

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

  test('rejects a nameless organization without opening a transaction', async () => {
    const response = await request(app).post('/api/v1/organizations').send({});
    expect(response.status).toBe(400);
  });

  test('deletes cleanly, which the RESTRICT side used to block', async () => {
    const response = await create('Unité éphémère');
    const organizationId = response.body.organization_id;

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
});
