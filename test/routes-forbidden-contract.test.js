/**
 * Refusals keep to the 403 contract, and another unit's records read as missing.
 *
 * Every 403 goes through forbidden(), so it names what was required and what is
 * missing; the SPA reads those to explain the refusal. A record belonging to
 * another unit answers 404, as if it did not exist, rather than confirming it
 * does.
 *
 * @module test/routes-forbidden-contract
 */

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { closeServerResources } = require('./test-helpers');

jest.mock('pg', () => {
  const mClient = { query: jest.fn(), release: jest.fn() };
  const mPool = {
    connect: jest.fn(() => Promise.resolve(mClient)),
    query: jest.fn(),
    on: jest.fn()
  };
  return { Pool: jest.fn(() => mPool), __esModule: true, __mClient: mClient, __mPool: mPool };
});

const { mockQueryImplementation } = require('./mock-helpers');

const TEST_SECRET = 'testsecret';
const ORG_ID = 1;
const OTHER_ORG_ID = 2;
const USER_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_USER_ID = '00000000-0000-4000-8000-000000000002';

let app;
let queries;

/**
 * @param {string[]} permissions - Permissions the account holds
 * @returns {string} A signed token for USER_ID in ORG_ID
 */
function tokenWith(permissions) {
  return jwt.sign({ user_id: USER_ID, organizationId: ORG_ID, roleIds: [1], roleNames: ['leader'], permissions }, TEST_SECRET);
}

/**
 * Answer the permission lookup with `permissions`, then `handler`, recording every query.
 *
 * @param {string[]} permissions - Permissions the account holds
 * @param {Function} handler - (query, params) => result or undefined
 */
function mockDatabase(permissions, handler) {
  const { __mClient, __mPool } = require('pg');
  mockQueryImplementation(__mClient, __mPool, (query, params) => {
    if (query.includes('permission_key')) {
      return { rows: permissions.map((key) => ({ permission_key: key })) };
    }
    queries.push(query);
    return handler(query, params);
  });
}

beforeAll(() => {
  process.env.JWT_SECRET_KEY = TEST_SECRET;
  process.env.ORGANIZATION_ID = ORG_ID.toString();
  app = require('../api');
});

beforeEach(() => {
  queries = [];
});

afterAll((done) => {
  closeServerResources(app, done);
});

describe('403 responses', () => {
  it('no route answers a 403 without saying what was required and what is missing', () => {
    const routesDir = path.join(__dirname, '..', 'routes');
    const offenders = fs.readdirSync(routesDir)
      .filter((file) => file.endsWith('.js'))
      .flatMap((file) => fs.readFileSync(path.join(routesDir, file), 'utf8')
        .split('\n')
        .map((line, index) => ({ where: `routes/${file}:${index + 1}`, line }))
        .filter(({ line }) => /\berror(Response)?\(res,.*,\s*403\s*\)/.test(line)))
      .map(({ where }) => where);

    expect(offenders).toEqual([]);
  });

  it('a family cannot change another family\'s carpool offer, and is told carpools.manage would allow it', async () => {
    mockDatabase(['carpools.view'], (query) => {
      if (query.includes('FROM carpool_offers')) {
        return { rows: [{ user_id: OTHER_USER_ID }] };
      }
      return undefined;
    });

    const res = await request(app)
      .put('/api/v1/carpools/offers/5')
      .set('Authorization', `Bearer ${tokenWith(['carpools.view'])}`)
      .send({ seats_available: 3 });

    expect(res.status).toBe(403);
    expect(res.body.required).toEqual(['carpools.manage']);
    expect(res.body.missing).toEqual(['carpools.manage']);
    expect(queries.some((query) => /UPDATE carpool_offers/.test(query))).toBe(false);
  });

  it('a former member of a unit cannot copy its forms', async () => {
    mockDatabase(['forms.manage'], (query, params) => {
      if (query.includes('FROM user_organizations') && params?.[1] === OTHER_ORG_ID) {
        // Still listed in the other unit, but no longer active there.
        return { rows: query.includes("status = 'active'") ? [] : [{ '?column?': 1 }] };
      }
      return undefined;
    });

    const res = await request(app)
      .post(`/api/v1/form-builder/form-formats/${OTHER_ORG_ID}/fiche_sante/copy`)
      .set('Authorization', `Bearer ${tokenWith(['forms.manage'])}`)
      .send({});

    expect(res.status).toBe(403);
    expect(Array.isArray(res.body.required)).toBe(true);
    expect(Array.isArray(res.body.missing)).toBe(true);
    expect(queries.some((query) => /SELECT form_structure/.test(query))).toBe(false);
  });
});

describe('another unit\'s records', () => {
  it('another unit\'s payment plan reads as not found, and is not deleted', async () => {
    mockDatabase(['finance.manage'], (query) => {
      if (query.includes('FROM payment_plans pp')) {
        return { rows: [{ id: 9, organization_id: OTHER_ORG_ID }] };
      }
      return undefined;
    });

    const res = await request(app)
      .delete('/api/v1/finance/payment-plans/9')
      .set('Authorization', `Bearer ${tokenWith(['finance.manage'])}`);

    expect(res.status).toBe(404);
    expect(res.body.message).not.toMatch(/organization/i);
    expect(queries.some((query) => /DELETE FROM payment_plans/.test(query))).toBe(false);
  });

  it('another unit\'s payment reads as not found, and is not changed', async () => {
    mockDatabase(['finance.manage'], (query) => {
      if (query.includes('FROM payments pay')) {
        return { rows: [{ id: 4, organization_id: OTHER_ORG_ID }] };
      }
      return undefined;
    });

    const res = await request(app)
      .put('/api/v1/finance/payments/4')
      .set('Authorization', `Bearer ${tokenWith(['finance.manage'])}`)
      .send({ amount: 10, payment_date: '2026-10-01' });

    expect(res.status).toBe(404);
    expect(queries.some((query) => /UPDATE payments/.test(query))).toBe(false);
  });

  it('another unit\'s permission slip is looked up within this unit only', async () => {
    mockDatabase(['activities.edit', 'permission_slips.manage'], (query, params) => {
      if (query.includes('FROM permission_slips WHERE id = $1')) {
        // The slip exists, but in the other unit: a query scoped to this unit finds nothing.
        return { rows: params?.[1] === ORG_ID ? [] : [{ organization_id: OTHER_ORG_ID, email_sent: false }] };
      }
      return undefined;
    });

    const res = await request(app)
      .delete('/api/v1/resources/permission-slips/12')
      .set('Authorization', `Bearer ${tokenWith(['activities.edit', 'permission_slips.manage'])}`);

    expect(res.status).toBe(404);
    expect(queries.some((query) => /DELETE FROM permission_slips/.test(query))).toBe(false);
  });
});
