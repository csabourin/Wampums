const { adaptAuthorizationMock } = require('./mock-helpers');
/**
 * GET /api/v1/fundraisers/family -- the campaigns a family sees.
 *
 * Parents hold no fundraiser permission, and the campaign screens list every
 * child in the unit. This endpoint is what the parent dashboard opens instead,
 * so three things must hold: an account without `fundraisers.view` is served,
 * "family" is not swallowed by `/:id`, and the children come from the account
 * in the session -- never from anything the client sends.
 *
 * The filtering itself (other families, other units, archived and settled
 * campaigns) is proven against a real database in
 * `family-fundraisers.integration.test.js`.
 */

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const TEST_SECRET = 'family-fundraisers-secret';
const USER_ID = '7b1d3f6e-6c1a-4b53-9d0b-0d6f3f1f2a11';
const ORGANIZATION_ID = 12;

/**
 * A session token for the parent.
 *
 * @returns {string} JWT
 */
function token() {
  return jwt.sign({ user_id: USER_ID, organizationId: ORGANIZATION_ID }, TEST_SECRET);
}

/**
 * An app serving the fundraiser routes over a scripted database.
 *
 * @param {Object} [rows] - Rows each query answers with
 * @param {Array<Object>} [rows.campaigns] - Campaign rows
 * @param {Array<Object>} [rows.entries] - Aggregated entry rows
 * @param {number} [rows.childrenCount] - Children linked to the account in the unit
 * @returns {{app: Object, pool: Object}} Express app and its pool
 */
function createFixture({ campaigns = [], entries = [], childrenCount = 0 } = {}) {
  const respond = (query) => {
    if (query.includes('information_schema.columns')) {
      return { rows: [{ campaign_columns: '3', entry_columns: '3' }] };
    }
    if (query.includes('SELECT organization_id FROM user_organizations')) {
      return { rows: [{ organization_id: ORGANIZATION_ID }] };
    }
    if (query.includes("role_name IN ('demoadmin', 'demoparent')")) {
      return { rows: [] };
    }
    if (query.includes('SELECT DISTINCT p.permission_key')) {
      // The parent bundle: no finance, budget or fundraiser key.
      return {
        rows: ['participants.view', 'participants.create_own', 'permission_slips.sign']
          .map((key) => ({ permission_key: key })),
      };
    }
    if (query.includes('SELECT DISTINCT r.role_name')) {
      return { rows: [{ role_name: 'parent', display_name: 'Parent' }] };
    }
    if (query.includes('children_count')) {
      return { rows: [{ children_count: childrenCount }] };
    }
    if (query.includes('FROM fundraiser_entries c') && query.includes('JOIN user_participants up')) {
      return { rows: entries };
    }
    if (query.includes('FROM fundraisers f') && query.includes('total_collected')) {
      return { rows: campaigns };
    }
    return { rows: [] };
  };

  const pool = { query: jest.fn((query) => Promise.resolve(respond(query))) };
  adaptAuthorizationMock(pool);

  const app = express();
  app.locals.pool = pool;
  app.use(express.json());
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  app.use('/api/v1/fundraisers', require('../routes/fundraisers')(pool, logger));

  return { app, pool };
}

/**
 * The calls that read the family's entries and children.
 *
 * @param {Object} pool - Mocked pool
 * @returns {Array<Array>} `[query, params]` pairs
 */
function familyQueries(pool) {
  return pool.query.mock.calls.filter(([query]) => typeof query === 'string' && query.includes('user_participants up'));
}

const CALENDAR_SALE = {
  id: '77',
  name: 'Vente de calendriers',
  objective: '600',
  start_date: '2026-10-01',
  end_date: '2026-11-15',
  campaign_type: 'fixed_price_sale',
  unit_price: '10.00',
  unit_label: 'calendriers',
  ended: false,
  total_collected: 220,
};

beforeAll(() => {
  process.env.JWT_SECRET_KEY = TEST_SECRET;
});

describe('GET /api/v1/fundraisers/family', () => {
  test('requires a session', async () => {
    const { app } = createFixture();

    const response = await request(app).get('/api/v1/fundraisers/family');

    expect(response.status).toBe(401);
    expect(response.body.message).toMatch(/authentication required/i);
  });

  test('serves a parent who holds no fundraiser permission', async () => {
    const { app } = createFixture({ campaigns: [CALENDAR_SALE], childrenCount: 1 });

    const family = await request(app)
      .get('/api/v1/fundraisers/family')
      .set('Authorization', `Bearer ${token()}`);
    const unitWide = await request(app)
      .get('/api/v1/fundraisers')
      .set('Authorization', `Bearer ${token()}`);

    expect(family.status).toBe(200);
    expect(family.body.success).toBe(true);
    // The unit-wide list stays closed to the same account.
    expect(unitWide.status).toBe(403);
    expect(unitWide.body.missing).toEqual(['fundraisers.view']);
  });

  test('twelve calendars at ten dollars: what is expected, handed in and left', async () => {
    const { app } = createFixture({
      campaigns: [CALENDAR_SALE],
      childrenCount: 1,
      entries: [{
        fundraiser: '77',
        participant_id: 4,
        first_name: 'Léa',
        last_name: 'Parent',
        quantity: '12.00',
        hours: null,
        amount_due: '120.00',
        amount_paid: 40,
        paid: false,
      }],
    });

    const response = await request(app)
      .get('/api/v1/fundraisers/family')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.body.data).toEqual({
      children_count: 1,
      campaigns: [{
        id: 77,
        name: 'Vente de calendriers',
        start_date: '2026-10-01',
        end_date: '2026-11-15',
        campaign_type: 'fixed_price_sale',
        unit_price: 10,
        unit_label: 'calendriers',
        unit_progress: { objective: 600, collected: 220 },
        children: [{
          participant_id: 4,
          first_name: 'Léa',
          last_name: 'Parent',
          quantity: 12,
          hours: null,
          amount_due: 120,
          amount_paid: 40,
          balance: 80,
          paid: false,
        }],
      }],
    });
  });

  test('the children are those of the account in the session, in its unit', async () => {
    const { app, pool } = createFixture({ campaigns: [CALENDAR_SALE] });

    await request(app)
      .get('/api/v1/fundraisers/family?user_id=someone-else&organization_id=99&participant_id=5')
      .set('Authorization', `Bearer ${token()}`)
      .set('x-organization-id', '99');

    const calls = familyQueries(pool);
    expect(calls).toHaveLength(2);
    calls.forEach(([query, params]) => {
      expect(params).toEqual([ORGANIZATION_ID, USER_ID]);
      // A child can be enrolled in several units; the link alone is not enough.
      expect(query).toContain('JOIN participant_organizations po');
      expect(query).not.toMatch(/\$\{/);
    });
  });

  test('a campaign that ended is kept only while the family owes money on it', async () => {
    const ended = (id) => ({ ...CALENDAR_SALE, id, ended: true, objective: null });
    const entry = (fundraiser, amountPaid) => ({
      fundraiser,
      participant_id: 4,
      first_name: 'Léa',
      last_name: 'Parent',
      quantity: '12',
      hours: null,
      amount_due: '120',
      amount_paid: amountPaid,
      paid: amountPaid >= 120,
    });
    const { app } = createFixture({
      campaigns: [ended('1'), ended('2'), ended('3')],
      entries: [entry('1', 40), entry('2', 120)],
      childrenCount: 1,
    });

    const response = await request(app)
      .get('/api/v1/fundraisers/family')
      .set('Authorization', `Bearer ${token()}`);

    // 1: still owing. 2: settled. 3: ended and nothing recorded for the family.
    expect(response.body.data.campaigns.map((campaign) => campaign.id)).toEqual([1]);
  });

  test('the unit total is sent only against an objective, and a float remainder is not a balance', async () => {
    const { app } = createFixture({
      campaigns: [{ ...CALENDAR_SALE, objective: null, total_collected: 220 }],
      childrenCount: 1,
      entries: [{
        fundraiser: '77',
        participant_id: 4,
        first_name: 'Léa',
        last_name: 'Parent',
        quantity: '3',
        hours: null,
        amount_due: '30.30',
        // 10.1 + 20.2 in double precision
        amount_paid: 30.299999999999997,
        paid: true,
      }],
    });

    const response = await request(app)
      .get('/api/v1/fundraisers/family')
      .set('Authorization', `Bearer ${token()}`);

    const [campaign] = response.body.data.campaigns;
    expect(campaign.unit_progress).toBeNull();
    expect(campaign.children[0]).toEqual(expect.objectContaining({ amount_paid: 30.3, balance: 0 }));
  });
});
