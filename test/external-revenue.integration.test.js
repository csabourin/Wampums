const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');
const { randomUUID } = require('crypto');
const { signJWTToken } = require('../utils/jwt-config');

process.env.JWT_SECRET_KEY ||= 'external-revenue-integration-secret';
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const OPTIONAL_FIELDS = ['payment_method', 'reference_number', 'receipt_url', 'notes'];

describe.skipIf(!DATABASE_URL)('External revenue updates', () => {
  let pool;
  let app;
  let token;
  const ids = {};

  async function one(sql, params = []) {
    const result = await pool.query(sql, params);
    return Object.values(result.rows[0])[0];
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query("INSERT INTO organizations (name) VALUES ('Revenue test unit') RETURNING id");
      ids.unit = result.rows[0].id;
      await client.query("INSERT INTO organization_program_sections (organization_id, section_key, display_name) VALUES ($1, 'general', 'General')", [ids.unit]);
      const other = await client.query("INSERT INTO organizations (name) VALUES ('Other revenue test unit') RETURNING id");
      ids.otherUnit = other.rows[0].id;
      await client.query("INSERT INTO organization_program_sections (organization_id, section_key, display_name) VALUES ($1, 'general', 'General')", [ids.otherUnit]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    ids.role = await one('INSERT INTO roles (role_name, display_name, data_scope, organization_id) VALUES ($1, $1, $2, $3) RETURNING id', [`revenue_${randomUUID()}`, 'organization', ids.unit]);
    await pool.query('INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE permission_key = ANY($2::text[])', [ids.role, ['finance.view', 'finance.manage']]);
    ids.user = await one("INSERT INTO users (email, password, full_name) VALUES ($1, 'x', 'Revenue Test') RETURNING id", [`revenue_${randomUUID()}@example.test`]);
    await pool.query("INSERT INTO user_organizations (user_id, organization_id, role_ids, status) VALUES ($1, $2, $3::jsonb, 'active')", [ids.user, ids.unit, JSON.stringify([ids.role])]);
    ids.category = await one("INSERT INTO budget_categories (organization_id, name) VALUES ($1, 'Test category') RETURNING id", [ids.unit]);
    ids.foreignCategory = await one("INSERT INTO budget_categories (organization_id, name) VALUES ($1, 'Private category from another unit') RETURNING id", [ids.otherUnit]);
    token = signJWTToken({ user_id: ids.user, organizationId: ids.unit });
    app = express();
    app.locals.pool = pool;
    app.use(express.json());
    app.use('/api', require('../routes/external-revenue')(pool, { info: jest.fn(), error: jest.fn() }));
    app.use((err, req, res, _next) => res.status(500).json({ success: false }));
  });

  afterAll(async () => {
    if (pool) {
      if (ids.unit) {await pool.query('DELETE FROM organizations WHERE id = ANY($1::int[])', [[ids.unit, ids.otherUnit]]);}
      if (ids.user) {await pool.query('DELETE FROM users WHERE id = $1', [ids.user]);}
      await pool.end();
    }
  });

  beforeEach(async () => {
    ids.revenue = await one(`INSERT INTO budget_revenues
      (organization_id, budget_category_id, amount, revenue_date, description, payment_method, reference_number, receipt_url, notes)
      VALUES ($1, $2, 20, '2026-11-04', 'Test donation', 'transfer', 'REF', 'https://example.test/receipt', 'Original notes') RETURNING id`, [ids.unit, ids.category]);
  });

  const update = (body) => request(app).put(`/api/v1/revenue/external/${ids.revenue}`)
    .set('Authorization', `Bearer ${token}`).send(body);
  const saved = async () => (await pool.query('SELECT * FROM budget_revenues WHERE id = $1', [ids.revenue])).rows[0];

  test('creating a revenue cannot reference another unit category', async () => {
    const response = await request(app).post('/api/v1/revenue/external')
      .set('Authorization', `Bearer ${token}`).send({ budget_category_id: ids.foreignCategory, amount: 40, revenue_date: '2026-11-04', description: 'Refused test donation' });
    expect(response.status).toBe(400);
    expect(await one('SELECT count(*)::int FROM budget_revenues WHERE organization_id = $1 AND budget_category_id = $2', [ids.unit, ids.foreignCategory])).toBe(0);
  });

  test('updating a revenue cannot reference another unit category', async () => {
    expect((await update({ budget_category_id: ids.foreignCategory, amount: 999 })).status).toBe(400);
    expect(await saved()).toMatchObject({ budget_category_id: ids.category, amount: '20.00' });
  });

  test('existing foreign category links reveal no category name in the list or summary', async () => {
    await pool.query('UPDATE budget_revenues SET budget_category_id = $1 WHERE id = $2', [ids.foreignCategory, ids.revenue]);
    const list = await request(app).get('/api/v1/revenue/external').set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.data.find((row) => row.id === ids.revenue).category_name).toBeNull();
    const summary = await request(app).get('/api/v1/revenue/external/summary').set('Authorization', `Bearer ${token}`);
    expect(summary.status).toBe(200);
    expect(JSON.stringify(summary.body)).not.toContain('Private category from another unit');
  });

  test('creating and reading a revenue with a category in the current unit still works', async () => {
    const response = await request(app).post('/api/v1/revenue/external').set('Authorization', `Bearer ${token}`)
      .send({ budget_category_id: ids.category, amount: 40, revenue_date: '2026-11-04', description: 'Accepted test donation' });
    expect(response.status).toBe(201);
    const list = await request(app).get('/api/v1/revenue/external').set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.data.find((row) => row.id === response.body.data.id).category_name).toBe('Test category');
  });

  test.each([null, ''])('a category explicitly cleared with %s is removed', async (value) => {
    expect((await update({ budget_category_id: value })).status).toBe(200);
    expect((await saved()).budget_category_id).toBeNull();
  });

  test('omitting optional fields preserves their saved values while updating the amount', async () => {
    expect((await update({ amount: 30 })).status).toBe(200);
    expect(await saved()).toMatchObject({ budget_category_id: ids.category, amount: '30.00', payment_method: 'transfer', reference_number: 'REF', receipt_url: 'https://example.test/receipt', notes: 'Original notes' });
  });

  test.each(OPTIONAL_FIELDS)('an explicit null clears %s', async (field) => {
    expect((await update({ [field]: null })).status).toBe(200);
    expect((await saved())[field]).toBeNull();
  });

  test.each(OPTIONAL_FIELDS)('an empty string clears %s', async (field) => {
    expect((await update({ [field]: '' })).status).toBe(200);
    expect((await saved())[field]).toBe('');
  });
});
