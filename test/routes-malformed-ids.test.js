/**
 * Malformed ids in the URL are refused before anything reaches the database.
 *
 * Finance, inventory, permission slips, honors, the yearly planner, incidents,
 * the form builder, forms, medication and participants read their ids with parseInt, which takes "12abc" for 12 and acts on record 12, or pass
 * them to PostgreSQL as typed, where "abc" fails with a 500. Each id must be an
 * integer from 1 to 2147483647 (validateIdParam), or the request answers 400.
 *
 * @module test/routes-malformed-ids
 */

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
const PERMISSIONS = [
  'finance.manage', 'finance.view', 'inventory.manage', 'inventory.view',
  'permission_slips.manage', 'permission_slips.view', 'permission_slips.sign',
  'inventory.reserve', 'activities.edit', 'honors.create', 'honors.manage', 'meetings.manage',
  'meetings.view', 'meetings.delete', 'activities.manage',
  'incidents.view', 'incidents.manage', 'forms.view', 'forms.manage', 'forms.submit',
  'medication.view', 'medication.manage', 'participants.view', 'participants.edit', 'participants.erase'
];
const MALFORMED_IDS = ['abc', '12abc', '0', '-3', '3000000000'];

let app;
let businessQueries;
let databaseRefusal;

/** @returns {string} A staff token holding every permission these routes require */
function staffToken() {
  return jwt.sign({
    user_id: '00000000-0000-4000-8000-000000000001',
    organizationId: ORG_ID,
    roleIds: [1],
    roleNames: ['district'],
    permissions: PERMISSIONS
  }, TEST_SECRET);
}

const ROUTES = [
  ['delete', '/api/v1/finance/payment-plans/:id'],
  ['put', '/api/v1/finance/payments/:id'],
  ['get', '/api/v1/finance/participants/:id/statement'],
  ['get', '/api/v1/finance/participant-fees/:id/payments'],
  ['delete', '/api/v1/resources/equipment/:id'],
  ['patch', '/api/v1/resources/equipment/reservations/:id'],
  ['patch', '/api/v1/resources/permission-slips/:id/archive'],
  ['patch', '/api/v1/honors/:id'],
  ['delete', '/api/v1/honors/:id'],
  ['get', '/api/v1/yearly-planner/plans/:id'],
  ['delete', '/api/v1/yearly-planner/meetings/:id'],
  ['post', '/api/v1/yearly-planner/meetings/:id/schedule/copy-from/1'],
  ['get', '/api/v1/incidents/prefill/participant/:id'],
  ['get', '/api/v1/incidents/prefill/activity/:id'],
  ['patch', '/api/v1/incidents/escalation-contacts/:id'],
  ['delete', '/api/v1/incidents/escalation-contacts/:id'],
  ['get', '/api/v1/incidents/:id'],
  ['patch', '/api/v1/incidents/:id'],
  ['delete', '/api/v1/incidents/:id'],
  ['post', '/api/v1/incidents/:id/submit'],
  ['get', '/api/v1/form-builder/form-formats/:id'],
  ['put', '/api/v1/form-builder/form-formats/:id'],
  ['delete', '/api/v1/form-builder/form-formats/:id'],
  ['post', '/api/v1/form-builder/form-formats/:id/versions'],
  ['get', '/api/v1/form-builder/form-formats/:id/versions'],
  ['post', '/api/v1/form-builder/form-formats/:id/archive'],
  ['post', '/api/v1/form-builder/form-versions/:id/publish'],
  ['put', '/api/v1/medication/requirements/:id'],
  ['patch', '/api/v1/medication/distributions/:id'],
  ['patch', '/api/v1/medication/receptions/:id'],
  ['delete', '/api/v1/medication/receptions/:id'],
  ['get', '/api/v1/medication/authorizations/:id'],
  ['get', '/api/v1/medication/receptions?activity_id=:id'],
  ['get', '/api/v1/participants/:id'],
  ['delete', '/api/v1/participants/:id/erasure'],
  ['delete', '/api/v1/participants/:id/users/00000000-0000-4000-8000-000000000002'],
  ['get', '/api/v1/participants?group_id=:id'],
  ['get', '/api/v1/participants?page=:id'],
  ['get', '/api/v1/participants?limit=:id'],
  ['get', '/api/v1/forms/:id'],
  ['post', '/api/v1/forms/:id/submit'],
  ['get', '/api/v1/forms/:id/submissions'],
  ['put', '/api/v1/forms/:id/submissions/1/approve'],
  ['put', '/api/v1/forms/1/submissions/:id/approve']
];

beforeAll(() => {
  process.env.JWT_SECRET_KEY = TEST_SECRET;
  process.env.ORGANIZATION_ID = ORG_ID.toString();
  app = require('../api');
});

beforeEach(() => {
  const { __mClient, __mPool } = require('pg');
  businessQueries = [];
  databaseRefusal = null;
  mockQueryImplementation(__mClient, __mPool, (query, params) => {
    if (databaseRefusal && query.includes('po.inscription_date')) {
      return Promise.reject(Object.assign(new Error('refused'), { code: databaseRefusal }));
    }
    if (query.includes('permission_key')) {
      return { rows: PERMISSIONS.map((key) => ({ permission_key: key })) };
    }
    if ((params || []).some((value) => MALFORMED_IDS.includes(String(value)))) {
      businessQueries.push(query);
    }
    return undefined;
  });
});

afterAll((done) => {
  closeServerResources(app, done);
});

describe('malformed ids in the URL', () => {
  describe.each(ROUTES)('%s %s', (method, path) => {
    it.each(MALFORMED_IDS)('refuses %s as an id with a 400, without querying it', async (badId) => {
      const res = await request(app)[method](path.replace(':id', badId))
        .set('Authorization', `Bearer ${staffToken()}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(Array.isArray(res.body.errors)).toBe(true);
      expect(businessQueries).toEqual([]);
    });
  });

  it('a well-formed id still reaches the route', async () => {
    const res = await request(app)
      .get('/api/v1/yearly-planner/plans/42')
      .set('Authorization', `Bearer ${staffToken()}`);

    expect(res.status).not.toBe(400);
  });

  it('a malformed id in the source meeting of a schedule copy is refused too', async () => {
    const res = await request(app)
      .post('/api/v1/yearly-planner/meetings/1/schedule/copy-from/12abc')
      .set('Authorization', `Bearer ${staffToken()}`)
      .send({});

    expect(res.status).toBe(400);
  });
});

describe('input the database refuses', () => {
  it.each([
    ['22P02', 'a value it cannot read as its type'],
    ['22003', 'a value out of its range']
  ])('answers 400, not 500, when PostgreSQL refuses %s (%s)', async (code) => {
    databaseRefusal = code;

    const res = await request(app)
      .get('/api/v1/participants/42')
      .set('Authorization', `Bearer ${staffToken()}`);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, message: 'invalid_request' });
  });

  it('any other database failure is still a 500', async () => {
    databaseRefusal = '57014';

    const res = await request(app)
      .get('/api/v1/participants/42')
      .set('Authorization', `Bearer ${staffToken()}`);

    expect(res.status).toBe(500);
  });
});
