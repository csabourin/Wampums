/** Passwordless demo sign-in only opens accounts dedicated to that unit. */
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

require('./jest-conditional-helpers');

const DATABASE_URL = process.env.SCOUT_YEAR_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || 'demo-sign-in-integration-secret';
const logger = { info: () => {}, warn: () => {}, error: () => {} };

describe.skipIf(!DATABASE_URL)('Passwordless demo sign-in', () => {
  let pool;
  let client;
  let app;
  let demoUnitId;
  let realUnitId;
  let user;
  let demoRoleId;

  /** @returns {Promise<number>} A unit with its required program section. */
  async function createUnit() {
    const result = await client.query("INSERT INTO organizations (name) VALUES ('Demo isolation test') RETURNING id");
    const id = result.rows[0].id;
    await client.query(
      `INSERT INTO organization_program_sections (organization_id, section_key, display_name)
       VALUES ($1, 'general', 'General')`,
      [id]
    );
    return id;
  }

  /** @returns {Object} A request to the demo unit's public sign-in endpoint. */
  function signIn() {
    return request(app).post('/api/v1/auth/demo-login')
      .set('x-organization-id', String(demoUnitId)).send({ view: 'parent' });
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    client = await pool.connect();
    app = express();
    app.use(express.json());
    app.use(require('../routes/auth')(client, logger));
  });

  beforeEach(async () => {
    await client.query('BEGIN');
    demoUnitId = await createUnit();
    realUnitId = await createUnit();
    await client.query(
      "INSERT INTO organization_settings (organization_id, setting_key, setting_value) VALUES ($1, 'demo_sign_in', 'true'::jsonb)",
      [demoUnitId]
    );
    const role = await client.query(
      `INSERT INTO roles (role_name, display_name, data_scope, is_system_role)
       VALUES ('demoparent', 'Demo Parent', 'linked', TRUE)
       ON CONFLICT (role_name) DO UPDATE SET role_name = EXCLUDED.role_name
       RETURNING id`
    );
    demoRoleId = role.rows[0].id;
    const result = await client.query(
      `INSERT INTO users (email, password, full_name, is_verified)
       VALUES ('demo-isolation-' || gen_random_uuid() || '@example.test', 'unused', 'Demo Parent', TRUE)
       RETURNING id, email`
    );
    user = result.rows[0];
    await client.query(
      `INSERT INTO user_organizations (user_id, organization_id, role_ids, status)
       VALUES ($1, $2, $3, 'active')`,
      [user.id, demoUnitId, JSON.stringify([demoRoleId])]
    );
  });

  afterEach(async () => {
    await client.query('ROLLBACK');
  });

  afterAll(async () => {
    client?.release();
    await pool?.end();
  });

  test('a dedicated demo account opens the requested unit', async () => {
    const response = await signIn();

    expect(response.status).toBe(200);
    expect(jwt.verify(response.body.token, process.env.JWT_SECRET_KEY)).toMatchObject({
      user_id: user.id, organizationId: demoUnitId,
    });
  });

  test.each(['active', 'inactive'])('an account with an %s membership elsewhere cannot open without a password', async (status) => {
    // Even another demo role must not expose a different unit's families.
    await client.query(
      `INSERT INTO user_organizations (user_id, organization_id, role_ids, status)
       VALUES ($1, $2, $3, $4)`,
      [user.id, realUnitId, JSON.stringify([demoRoleId]), status]
    );

    const response = await signIn();

    expect(response.status).toBe(404);
    expect(response.body.message).toBe('demo_account_unavailable');
    expect(response.body.token).toBeUndefined();
  });
});
