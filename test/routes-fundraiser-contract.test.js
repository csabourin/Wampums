const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const TEST_SECRET = 'fundraiser-contract-secret';
const USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const ORGANIZATION_ID = 12;
const FUNDRAISER_ID = 41;
const ENTRY_ID = 93;

function token() {
  return jwt.sign({
    user_id: USER_ID,
    user_role: 'district',
    organizationId: ORGANIZATION_ID,
  }, TEST_SECRET);
}

function createFixture() {
  const queryLog = [];
  const fundraiser = {
    id: FUNDRAISER_ID,
    name: 'Fall campaign',
    organization: ORGANIZATION_ID,
    archived: false,
  };
  const entry = {
    id: ENTRY_ID,
    fundraiser: FUNDRAISER_ID,
    participant_id: 5,
    first_name: 'Alex',
    last_name: 'Tremblay',
    amount: 12,
    amount_paid: 0,
    paid: false,
  };

  const executeQuery = async (query, params = []) => {
    queryLog.push({ query, params });

    if (query.includes('SELECT organization_id FROM user_organizations')) {
      return { rows: [{ organization_id: ORGANIZATION_ID }] };
    }
    if (query.includes("role_name IN ('demoadmin', 'demoparent')")) {
      return { rows: [] };
    }
    if (query.includes('SELECT DISTINCT p.permission_key')) {
      return {
        rows: [
          'fundraisers.view',
          'fundraisers.create',
          'fundraisers.edit',
          'finance.view',
          'finance.manage',
        ].map((permission_key) => ({ permission_key })),
      };
    }
    if (query.includes('SELECT DISTINCT r.role_name')) {
      return { rows: [{ role_name: 'district', display_name: 'District' }] };
    }
    if (query.includes('SELECT f.*') && query.includes('GROUP BY f.id')) {
      return { rows: [fundraiser] };
    }
    if (query.includes('UPDATE fundraisers') && query.includes('SET name')) {
      Object.assign(fundraiser, {
        name: params[0] ?? fundraiser.name,
        objective: params[3] ?? fundraiser.objective,
      });
      return { rows: [{ ...fundraiser }] };
    }
    if (query.includes('UPDATE fundraisers') && query.includes('SET archived')) {
      fundraiser.archived = params[0];
      return { rows: [{ ...fundraiser }] };
    }
    // The entries endpoint also reads the campaign shape (type/unit price) so
    // it can tell the client which measures the campaign records.
    if (query.includes('FROM fundraisers WHERE id')) {
      return {
        rows: [{
          id: FUNDRAISER_ID,
          campaign_type: 'fixed_price_sale',
          unit_price: null,
          unit_label: null,
        }],
      };
    }
    if (query.includes('FROM fundraiser_entries c') && query.includes('JOIN participants')) {
      return { rows: [{ ...entry }] };
    }
    if (query.includes('SELECT c.* FROM fundraiser_entries')) {
      return { rows: [{ ...entry }] };
    }
    if (query.includes('UPDATE fundraiser_entries')) {
      // Measures are sent as (was it provided?, value) pairs so a field can be
      // cleared, and so `false`/`0` are not mistaken for "not sent".
      const applyMeasure = (key, pairIndex) => {
        if (params[pairIndex * 2]) {
          entry[key] = params[pairIndex * 2 + 1];
        }
      };
      applyMeasure('amount', 0);
      applyMeasure('amount_paid', 1);
      applyMeasure('paid', 2);
      applyMeasure('quantity', 3);
      applyMeasure('hours', 4);
      applyMeasure('amount_raised', 5);
      return { rows: [{ ...entry }] };
    }

    return { rows: [] };
  };

  const client = {
    query: jest.fn(async (query, params = []) => {
      queryLog.push({ query, params });
      if (query.includes('INSERT INTO fundraisers')) {
        Object.assign(fundraiser, {
          name: params[0],
          start_date: params[1],
          end_date: params[2],
          objective: params[3],
        });
        return { rows: [{ ...fundraiser }] };
      }
      if (query.includes('FROM participants p')) {
        return { rows: [{ id: entry.participant_id }] };
      }
      return { rows: [] };
    }),
    release: jest.fn(),
  };
  const pool = {
    query: jest.fn(executeQuery),
    connect: jest.fn(async () => client),
  };

  const app = express();
  app.locals.pool = pool;
  app.use(express.json());
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  app.use('/api/v1/fundraisers', require('../routes/fundraisers')(pool, logger));
  app.use('/api/v1/calendars', require('../routes/calendars')(pool, logger));

  return { app, queryLog, client };
}

beforeAll(() => {
  process.env.JWT_SECRET_KEY = TEST_SECRET;
});

test('creates, opens, edits, archives, restores, opens entries, and updates an entry', async () => {
  const { app, queryLog, client } = createFixture();
  const authorization = `Bearer ${token()}`;

  const created = await request(app)
    .post('/api/v1/fundraisers')
    .set('Authorization', authorization)
    .send({
      name: 'Fall campaign',
      start_date: '2026-09-01',
      end_date: '2026-10-31',
      objective: 2500,
    });
  const opened = await request(app)
    .get(`/api/v1/fundraisers/${FUNDRAISER_ID}`)
    .set('Authorization', authorization);
  const edited = await request(app)
    .put(`/api/v1/fundraisers/${FUNDRAISER_ID}`)
    .set('Authorization', authorization)
    .send({ name: 'Updated campaign', objective: 3000 });
  const archived = await request(app)
    .put(`/api/v1/fundraisers/${FUNDRAISER_ID}/archive`)
    .set('Authorization', authorization)
    .send({ archived: true });
  const restored = await request(app)
    .put(`/api/v1/fundraisers/${FUNDRAISER_ID}/archive`)
    .set('Authorization', authorization)
    .send({ archived: false });
  const entries = await request(app)
    .get(`/api/v1/calendars?fundraiser_id=${FUNDRAISER_ID}`)
    .set('Authorization', authorization);
  const updatedEntry = await request(app)
    .put(`/api/v1/calendars/${ENTRY_ID}`)
    .set('Authorization', authorization)
    .send({ amount: 20, amount_paid: 20, paid: true });

  expect(created.status).toBe(201);
  expect(opened.body.data.fundraiser.id).toBe(FUNDRAISER_ID);
  expect(edited.body.data.fundraiser).toEqual(expect.objectContaining({
    name: 'Updated campaign',
    objective: 3000,
  }));
  expect(archived.body.data.fundraiser.archived).toBe(true);
  expect(restored.body.data.fundraiser.archived).toBe(false);
  expect(entries.body.data.fundraiser_entries).toHaveLength(1);
  expect(updatedEntry.body.data).toEqual(expect.objectContaining({
    id: ENTRY_ID,
    amount: 20,
    amount_paid: 20,
    paid: true,
  }));
  expect(client.query).toHaveBeenCalledWith('COMMIT');

  const tenantQueries = queryLog.filter(({ query }) => (
    query.includes('fundraisers') && !query.includes('permission_key')
  ));
  expect(tenantQueries.some(({ params }) => params.includes(ORGANIZATION_ID))).toBe(true);
});

test('archive endpoint is not double-prefixed', async () => {
  const { app } = createFixture();
  const response = await request(app)
    .put(`/api/v1/fundraisers/fundraisers/${FUNDRAISER_ID}/archive`)
    .set('Authorization', `Bearer ${token()}`)
    .send({ archived: true });

  expect(response.status).toBe(404);
});
