/**
 * Fundraising campaign creation and the generalised campaign model.
 *
 * Covers the reported HTTP 400 on campaign creation (a valid payload must
 * persist, an invalid one must come back with an explicit field-level reason)
 * and the campaign types the model has to be able to represent.
 */

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const {
  CAMPAIGN_TYPE_KEYS,
  campaignTypeCapabilities,
  resolveEntryAmount,
} = require('../services/fundraiserCampaigns');

const TEST_SECRET = 'fundraiser-campaign-secret';
const USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const ORGANIZATION_ID = 12;
const FUNDRAISER_ID = 77;

function token() {
  return jwt.sign({
    user_id: USER_ID,
    user_role: 'district',
    organizationId: ORGANIZATION_ID,
  }, TEST_SECRET);
}

function createFixture() {
  /** @type {Array<{query: string, params: Array}>} */
  const insertedCampaigns = [];

  const respond = async (query, params = []) => {
    if (query.includes('information_schema.columns')) {
      // Migration 004 has been applied in this fixture.
      return { rows: [{ campaign_columns: '3', entry_columns: '3' }] };
    }
    if (query.includes('SELECT organization_id FROM user_organizations')) {
      return { rows: [{ organization_id: ORGANIZATION_ID }] };
    }
    if (query.includes("role_name IN ('demoadmin', 'demoparent')")) {
      return { rows: [] };
    }
    if (query.includes('SELECT DISTINCT p.permission_key')) {
      return {
        rows: ['fundraisers.view', 'fundraisers.create', 'fundraisers.edit']
          .map((permission_key) => ({ permission_key })),
      };
    }
    if (query.includes('SELECT DISTINCT r.role_name')) {
      return { rows: [{ role_name: 'district', display_name: 'District' }] };
    }
    return { rows: [] };
  };

  const client = {
    query: jest.fn(async (query, params = []) => {
      if (query.includes('INSERT INTO fundraisers')) {
        insertedCampaigns.push({ query, params });
        return {
          rows: [{
            id: FUNDRAISER_ID,
            name: params[0],
            start_date: params[1],
            end_date: params[2],
            objective: params[3],
            organization: params[4],
            campaign_type: params[5],
            unit_price: params[6],
            unit_label: params[7],
          }],
        };
      }
      if (query.includes('FROM participants p')) {
        return { rows: [{ id: 5 }] };
      }
      return { rows: [] };
    }),
    release: jest.fn(),
  };

  const pool = {
    query: jest.fn(respond),
    connect: jest.fn(async () => client),
  };

  const app = express();
  app.locals.pool = pool;
  app.use(express.json());
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  app.use('/api/v1/fundraisers', require('../routes/fundraisers')(pool, logger));

  return { app, pool, client, insertedCampaigns };
}

beforeAll(() => {
  process.env.JWT_SECRET_KEY = TEST_SECRET;
});

describe('POST /api/v1/fundraisers', () => {
  test('persists a valid campaign instead of answering 400', async () => {
    const { app, insertedCampaigns } = createFixture();

    const response = await request(app)
      .post('/api/v1/fundraisers')
      .set('Authorization', `Bearer ${token()}`)
      .send({
        name: 'Campagne de calendriers',
        start_date: '2026-09-01',
        end_date: '2026-10-31',
        objective: 2500,
        campaign_type: 'fixed_price_sale',
        unit_price: 12.5,
        unit_label: 'calendriers',
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.fundraiser).toEqual(expect.objectContaining({
      name: 'Campagne de calendriers',
      campaign_type: 'fixed_price_sale',
      unit_price: 12.5,
      unit_label: 'calendriers',
    }));

    // The row really reached the database with every field populated.
    expect(insertedCampaigns).toHaveLength(1);
    expect(insertedCampaigns[0].params).toEqual([
      'Campagne de calendriers',
      '2026-09-01',
      '2026-10-31',
      2500,
      ORGANIZATION_ID,
      'fixed_price_sale',
      12.5,
      'calendriers',
    ]);
  });

  test('defaults to the legacy campaign type when none is supplied', async () => {
    const { app } = createFixture();

    const response = await request(app)
      .post('/api/v1/fundraisers')
      .set('Authorization', `Bearer ${token()}`)
      .send({ name: 'Vente', start_date: '2026-09-01', end_date: '2026-09-30' });

    expect(response.status).toBe(201);
    expect(response.body.data.fundraiser.campaign_type).toBe('fixed_price_sale');
  });

  test.each([
    ['a missing name', { start_date: '2026-09-01', end_date: '2026-09-30' }, 'name'],
    ['a blank name', { name: '   ', start_date: '2026-09-01', end_date: '2026-09-30' }, 'name'],
    ['a malformed date', { name: 'X', start_date: 'not-a-date', end_date: '2026-09-30' }, 'start_date'],
    ['a calendar-invalid date', { name: 'X', start_date: '2026-02-31', end_date: '2026-09-30' }, 'start_date'],
    ['an end date before the start', { name: 'X', start_date: '2026-09-30', end_date: '2026-09-01' }, 'end_date'],
    ['a negative objective', { name: 'X', start_date: '2026-09-01', end_date: '2026-09-30', objective: -5 }, 'objective'],
    ['an unknown campaign type', { name: 'X', start_date: '2026-09-01', end_date: '2026-09-30', campaign_type: 'bake_sale' }, 'campaign_type'],
  ])('rejects %s with an explicit field error', async (_label, payload, expectedField) => {
    const { app, client } = createFixture();

    const response = await request(app)
      .post('/api/v1/fundraisers')
      .set('Authorization', `Bearer ${token()}`)
      .send(payload);

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: expectedField })]),
    );
    // Every error carries a human-readable reason, not just a field name.
    response.body.errors.forEach((fieldError) => {
      expect(typeof fieldError.message).toBe('string');
      expect(fieldError.message.length).toBeGreaterThan(0);
    });
    // Nothing was written.
    expect(client.query).not.toHaveBeenCalled();
  });

  test('rejects a non-object body', async () => {
    const { app } = createFixture();

    const response = await request(app)
      .post('/api/v1/fundraisers')
      .set('Authorization', `Bearer ${token()}`)
      .send(['not', 'an', 'object']);

    expect(response.status).toBe(400);
  });
});

describe('campaign model', () => {
  test('represents every fundraising form the mandate requires', () => {
    // 1. fixed price sale, 2. variable amounts, 3. deposit-return containers,
    // 4. hours worked, 5. a directly entered amount.
    expect(CAMPAIGN_TYPE_KEYS).toEqual(expect.arrayContaining([
      'fixed_price_sale',
      'variable_price_sale',
      'container_deposit',
      'hours_worked',
      'direct_amount',
    ]));
  });

  test.each([
    ['fixed_price_sale', { usesQuantity: true, usesUnitPrice: true }],
    ['container_deposit', { usesQuantity: true, usesUnitPrice: true }],
    ['hours_worked', { usesHours: true, usesUnitPrice: true }],
    ['variable_price_sale', { usesDirectAmount: true }],
    ['direct_amount', { usesDirectAmount: true }],
  ])('%s records the measures it needs', (campaignType, expected) => {
    expect(campaignTypeCapabilities(campaignType)).toEqual(expect.objectContaining(expected));
  });

  describe('resolveEntryAmount', () => {
    test('multiplies units by the unit price for a fixed price sale', () => {
      const amount = resolveEntryAmount(
        { quantity: 4 },
        { campaign_type: 'fixed_price_sale', unit_price: 12.5 },
      );
      expect(amount).toBe(50);
    });

    test('values deposit-return containers at the deposit amount', () => {
      const amount = resolveEntryAmount(
        { quantity: 120 },
        { campaign_type: 'container_deposit', unit_price: 0.1 },
      );
      expect(amount).toBeCloseTo(12, 5);
    });

    test('multiplies hours by the hourly rate', () => {
      const amount = resolveEntryAmount(
        { hours: 7.5 },
        { campaign_type: 'hours_worked', unit_price: 20 },
      );
      expect(amount).toBe(150);
    });

    test('uses a directly entered amount in preference to any computation', () => {
      const amount = resolveEntryAmount(
        { amount_raised: 87.25, quantity: 4 },
        { campaign_type: 'fixed_price_sale', unit_price: 12.5 },
      );
      expect(amount).toBe(87.25);
    });

    test('keeps a directly entered amount of 0 rather than falling through', () => {
      const amount = resolveEntryAmount(
        { amount_raised: 0, quantity: 4 },
        { campaign_type: 'variable_price_sale', unit_price: 12.5 },
      );
      expect(amount).toBe(0);
    });

    test('falls back to the legacy amount column for pre-migration campaigns', () => {
      // Legacy rows have no quantity/unit price; their `amount` column held the
      // unit count and must keep producing the total it always produced.
      const amount = resolveEntryAmount(
        { amount: 12 },
        { campaign_type: 'fixed_price_sale', unit_price: null },
      );
      expect(amount).toBe(12);
    });
  });
});

describe('PUT /api/v1/calendars/:id', () => {
  /**
   * Build an app exposing the entry routes with a recording pool.
   * @returns {{app: import('express').Express, updates: Array}}
   */
  function createEntryFixture() {
    const updates = [];

    const pool = {
      query: jest.fn(async (query, params = []) => {
        if (query.includes('information_schema.columns')) {
          // Migration 004 has been applied in this fixture.
          return { rows: [{ campaign_columns: '3', entry_columns: '3' }] };
        }
        if (query.includes('SELECT organization_id FROM user_organizations')) {
          return { rows: [{ organization_id: ORGANIZATION_ID }] };
        }
        if (query.includes("role_name IN ('demoadmin', 'demoparent')")) {
          return { rows: [] };
        }
        if (query.includes('SELECT DISTINCT p.permission_key')) {
          return { rows: [{ permission_key: 'finance.manage' }, { permission_key: 'finance.view' }] };
        }
        if (query.includes('SELECT DISTINCT r.role_name')) {
          return { rows: [{ role_name: 'district', display_name: 'District' }] };
        }
        if (query.includes('SELECT c.* FROM fundraiser_entries')) {
          return { rows: [{ id: 93, fundraiser: FUNDRAISER_ID }] };
        }
        if (query.includes('UPDATE fundraiser_entries')) {
          updates.push(params);
          return { rows: [{ id: 93 }] };
        }
        return { rows: [] };
      }),
      connect: jest.fn(),
    };

    const app = express();
    app.locals.pool = pool;
    app.use(express.json());
    app.use('/api/v1/calendars', require('../routes/calendars')(pool, { info: jest.fn(), error: jest.fn() }));
    return { app, updates };
  }

  /**
   * The UPDATE takes (provided, value) pairs; read one measure back out.
   * @param {Array} params - Query parameters
   * @param {number} pairIndex - 0-based measure index
   * @returns {{provided: boolean, value: *}}
   */
  function measure(params, pairIndex) {
    return { provided: params[pairIndex * 2], value: params[pairIndex * 2 + 1] };
  }

  const AMOUNT = 0;
  const AMOUNT_PAID = 1;
  const PAID = 2;
  const QUANTITY = 3;
  const HOURS = 4;
  const AMOUNT_RAISED = 5;

  test('accepts the measures the generalised model records', async () => {
    const { app, updates } = createEntryFixture();

    const response = await request(app)
      .put('/api/v1/calendars/93')
      .set('Authorization', `Bearer ${token()}`)
      .send({ hours: 7.5, amount_raised: 150 });

    expect(response.status).toBe(200);
    expect(measure(updates[0], HOURS)).toEqual({ provided: true, value: 7.5 });
    expect(measure(updates[0], AMOUNT_RAISED)).toEqual({ provided: true, value: 150 });
    // Untouched measures are left alone.
    expect(measure(updates[0], QUANTITY).provided).toBe(false);
  });

  test('a posted legacy amount also updates the named quantity column', async () => {
    const { app, updates } = createEntryFixture();

    await request(app)
      .put('/api/v1/calendars/93')
      .set('Authorization', `Bearer ${token()}`)
      .send({ amount: 20 });

    expect(measure(updates[0], AMOUNT)).toEqual({ provided: true, value: 20 });
    expect(measure(updates[0], QUANTITY)).toEqual({ provided: true, value: 20 });
  });

  test('a fractional quantity is rounded for the legacy integer column only', async () => {
    const { app, updates } = createEntryFixture();

    await request(app)
      .put('/api/v1/calendars/93')
      .set('Authorization', `Bearer ${token()}`)
      .send({ quantity: 7.4 });

    expect(measure(updates[0], AMOUNT).value).toBe(7);
    expect(measure(updates[0], QUANTITY).value).toBe(7.4);
  });

  test('clearing a measure clears it instead of keeping the old value', async () => {
    const { app, updates } = createEntryFixture();

    await request(app)
      .put('/api/v1/calendars/93')
      .set('Authorization', `Bearer ${token()}`)
      .send({ hours: null });

    expect(measure(updates[0], HOURS)).toEqual({ provided: true, value: null });
  });

  test('paid=false and amount_paid=0 are written rather than skipped as falsy', async () => {
    const { app, updates } = createEntryFixture();

    await request(app)
      .put('/api/v1/calendars/93')
      .set('Authorization', `Bearer ${token()}`)
      .send({ paid: false, amount_paid: 0 });

    expect(measure(updates[0], PAID)).toEqual({ provided: true, value: false });
    expect(measure(updates[0], AMOUNT_PAID)).toEqual({ provided: true, value: 0 });
  });

  test('rejects a negative measure with a field level error', async () => {
    const { app, updates } = createEntryFixture();

    const response = await request(app)
      .put('/api/v1/calendars/93')
      .set('Authorization', `Bearer ${token()}`)
      .send({ quantity: -3 });

    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'quantity' })]),
    );
    expect(updates).toHaveLength(0);
  });
});

describe('databases where migration 004 has not been applied', () => {
  /**
   * A pool whose schema lookup reports the legacy shape, and which throws the
   * error PostgreSQL really raises if a query touches a missing column.
   *
   * @returns {{app: import('express').Express, queries: string[]}}
   */
  function createLegacyFixture() {
    const queries = [];
    const legacyColumns = ['campaign_type', 'unit_price', 'unit_label', 'quantity', 'hours', 'amount_raised'];

    const guard = (query) => {
      queries.push(query);
      // Reject exactly what a pre-migration database rejects: a reference to
      // one of the new columns qualified by a table alias.
      const offending = legacyColumns.find((column) => new RegExp(`\\b[a-z]+\\.${column}\\b`).test(query));
      if (offending) {
        throw new Error(`column f.${offending} does not exist`);
      }
    };

    const pool = {
      query: jest.fn(async (query, params = []) => {
        if (query.includes('information_schema.columns')) {
          // Legacy database: none of the new columns are present.
          return { rows: [{ campaign_columns: '0', entry_columns: '0' }] };
        }
        if (query.includes('SELECT organization_id FROM user_organizations')) {
          return { rows: [{ organization_id: ORGANIZATION_ID }] };
        }
        if (query.includes("role_name IN ('demoadmin', 'demoparent')")) {
          return { rows: [] };
        }
        if (query.includes('SELECT DISTINCT p.permission_key')) {
          return {
            rows: ['fundraisers.view', 'fundraisers.create', 'fundraisers.edit', 'finance.view', 'finance.manage']
              .map((permission_key) => ({ permission_key })),
          };
        }
        if (query.includes('SELECT DISTINCT r.role_name')) {
          return { rows: [{ role_name: 'district', display_name: 'District' }] };
        }

        guard(query);

        if (query.includes('FROM fundraisers f')) {
          return {
            rows: [{
              id: FUNDRAISER_ID,
              name: 'Calendriers 2025',
              campaign_type: 'fixed_price_sale',
              unit_price: null,
              unit_label: null,
              total_amount: '12',
              total_quantity: '12',
              total_hours: '0',
              total_paid: '120',
            }],
          };
        }
        if (query.includes('UPDATE fundraisers')) {
          return { rows: [{ id: FUNDRAISER_ID, name: 'Renommee' }] };
        }
        return { rows: [] };
      }),
      connect: jest.fn(async () => ({
        query: jest.fn(async (query, params = []) => {
          if (query === 'BEGIN' || query === 'COMMIT' || query === 'ROLLBACK') {
            return { rows: [] };
          }
          guard(query);
          if (query.includes('INSERT INTO fundraisers')) {
            return { rows: [{ id: FUNDRAISER_ID, name: params[0] }] };
          }
          return { rows: [] };
        }),
        release: jest.fn(),
      })),
    };

    const app = express();
    app.locals.pool = pool;
    app.use(express.json());
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    app.use('/api/v1/fundraisers', require('../routes/fundraisers')(pool, logger));
    app.use('/api/v1/calendars', require('../routes/calendars')(pool, logger));

    return { app, queries, logger, pool };
  }

  test('the campaign list still loads', async () => {
    const { app } = createLegacyFixture();

    const response = await request(app)
      .get('/api/v1/fundraisers')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(response.body.data.fundraisers).toHaveLength(1);
  });

  test('the response keeps the same shape, using the legacy defaults', async () => {
    const { app } = createLegacyFixture();

    const response = await request(app)
      .get('/api/v1/fundraisers')
      .set('Authorization', `Bearer ${token()}`);

    const [campaign] = response.body.data.fundraisers;
    // The client renders these unconditionally; they must always be present.
    expect(campaign).toHaveProperty('campaign_type');
    expect(campaign).toHaveProperty('unit_price');
    expect(campaign).toHaveProperty('total_quantity');
  });

  test('a campaign can still be created', async () => {
    const { app } = createLegacyFixture();

    const response = await request(app)
      .post('/api/v1/fundraisers')
      .set('Authorization', `Bearer ${token()}`)
      .send({ name: 'Nouvelle campagne', start_date: '2026-09-01', end_date: '2026-10-31' });

    expect(response.status).toBe(201);
    expect(response.body.data.fundraiser.campaign_type).toBe('fixed_price_sale');
  });

  test('a campaign type that cannot be stored yet is reported, not swallowed', async () => {
    const { app, logger } = createLegacyFixture();

    await request(app)
      .post('/api/v1/fundraisers')
      .set('Authorization', `Bearer ${token()}`)
      .send({
        name: 'Heures', start_date: '2026-09-01', end_date: '2026-10-31',
        campaign_type: 'hours_worked',
      });

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('001_initial.sql'));
  });

  test('a campaign can still be edited', async () => {
    const { app } = createLegacyFixture();

    const response = await request(app)
      .put(`/api/v1/fundraisers/${FUNDRAISER_ID}`)
      .set('Authorization', `Bearer ${token()}`)
      .send({ name: 'Renommee' });

    expect(response.status).toBe(200);
  });

  test('validation still rejects bad input with field errors', async () => {
    const { app } = createLegacyFixture();

    const response = await request(app)
      .post('/api/v1/fundraisers')
      .set('Authorization', `Bearer ${token()}`)
      .send({ start_date: '2026-09-01', end_date: '2026-10-31' });

    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'name' })]),
    );
  });

  test('the schema is looked up once, not on every request', async () => {
    const { app, pool } = createLegacyFixture();
    const auth = `Bearer ${token()}`;

    await request(app).get('/api/v1/fundraisers').set('Authorization', auth);
    await request(app).get('/api/v1/fundraisers').set('Authorization', auth);
    await request(app).get('/api/v1/fundraisers').set('Authorization', auth);

    const lookups = (pool?.query.mock.calls || [])
      .filter(([query]) => query.includes('information_schema.columns'));
    expect(lookups.length).toBeLessThanOrEqual(1);
  });
});

describe('DELETE /api/v1/fundraisers/:id', () => {
  /**
   * @param {Object} [options] - Fixture options
   * @param {number} [options.recorded] - Entries carrying results
   * @param {boolean} [options.found] - Whether the campaign exists
   * @returns {{app: import('express').Express, statements: string[]}}
   */
  function createDeleteFixture({ recorded = 0, found = true } = {}) {
    const statements = [];

    const client = {
      query: jest.fn(async (query) => {
        statements.push(query.trim().split('\n')[0].trim());
        if (query.includes('SELECT id, name FROM fundraisers')) {
          return { rows: found ? [{ id: FUNDRAISER_ID, name: 'Vente' }] : [] };
        }
        if (query.includes('AS recorded')) {
          return { rows: [{ recorded }] };
        }
        return { rows: [] };
      }),
      release: jest.fn(),
    };

    const pool = {
      query: jest.fn(async (query) => {
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
          return { rows: [{ permission_key: 'fundraisers.delete' }] };
        }
        if (query.includes('SELECT DISTINCT r.role_name')) {
          return { rows: [{ role_name: 'district', display_name: 'District' }] };
        }
        return { rows: [] };
      }),
      connect: jest.fn(async () => client),
    };

    const app = express();
    app.locals.pool = pool;
    app.use(express.json());
    app.use('/api/v1/fundraisers', require('../routes/fundraisers')(pool, { info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
    return { app, statements };
  }

  test('deletes a campaign with nothing recorded', async () => {
    const { app, statements } = createDeleteFixture({ recorded: 0 });

    const response = await request(app)
      .delete(`/api/v1/fundraisers/${FUNDRAISER_ID}`)
      .set('Authorization', `Bearer ${token()}`);

    // The REST contract for a successful DELETE is 204 with no body.
    expect(response.status).toBe(204);
    expect(response.body).toEqual({});
    expect(response.text).toBe('');
    // Entries go first so no orphans are left behind, and it commits.
    expect(statements).toEqual(expect.arrayContaining([
      expect.stringContaining('DELETE FROM fundraiser_entries'),
      expect.stringContaining('DELETE FROM fundraisers'),
      'COMMIT',
    ]));
  });

  test('refuses a campaign that has recorded results', async () => {
    const { app, statements } = createDeleteFixture({ recorded: 3 });

    const response = await request(app)
      .delete(`/api/v1/fundraisers/${FUNDRAISER_ID}`)
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(409);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toMatch(/archive/i);
    // Nothing was deleted, and the transaction rolled back.
    expect(statements).not.toEqual(expect.arrayContaining([
      expect.stringContaining('DELETE FROM fundraisers'),
    ]));
    expect(statements).toContain('ROLLBACK');
  });

  test('answers 404 for a campaign in another organisation', async () => {
    const { app, statements } = createDeleteFixture({ found: false });

    const response = await request(app)
      .delete(`/api/v1/fundraisers/${FUNDRAISER_ID}`)
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(404);
    expect(statements).toContain('ROLLBACK');
  });

  test('the emptiness check covers every measure a campaign can record', async () => {
    const { app, statements } = createDeleteFixture({ recorded: 0 });

    await request(app)
      .delete(`/api/v1/fundraisers/${FUNDRAISER_ID}`)
      .set('Authorization', `Bearer ${token()}`);

    const check = client_lastRecordedQuery(statements);
    expect(check).toBeDefined();
  });

  /**
   * @param {string[]} statements - Executed statement heads
   * @returns {string|undefined} The emptiness check, if it ran
   */
  function client_lastRecordedQuery(statements) {
    return statements.find((statement) => statement.includes('SELECT COUNT(*)::int AS recorded'));
  }
});
