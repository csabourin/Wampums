/**
 * Forms Routes Comprehensive Test Suite
 *
 * Tests health forms (fiche_sante) and form submission workflows.
 * Forms are critical for participant safety/health tracking.
 *
 * Key Business Logic:
 * - Form versioning (multiple versions can coexist)
 * - Form submission with parent/staff roles
 * - Form status tracking (draft, submitted, approved)
 * - Parent signature/acceptance
 * - Risk form types (health, medication, allergy tracking)
 *
 * Security Model:
 * - requirePermission('forms.view') for read access
 * - requirePermission('forms.manage') for admin operations
 * - Parents can submit for their children
 * - Staff can view/audit form submissions
 * - Organization isolation on form data
 *
 * @module test/routes-forms
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { closeServerResources } = require('./test-helpers');

jest.mock('pg', () => {
  const mClient = {
    query: jest.fn(),
    release: jest.fn()
  };
  const mPool = {
    connect: jest.fn(() => Promise.resolve(mClient)),
    query: jest.fn(),
    on: jest.fn()
  };
  return {
    Pool: jest.fn(() => mPool),
    __esModule: true,
    __mClient: mClient,
    __mPool: mPool
  };
});

const { setupDefaultMocks, mockQueryImplementation } = require('./mock-helpers');
let app;

const TEST_SECRET = 'testsecret';
const ORG_ID = 3; // Demo organization - safe for live testing
const USER_ID = 1;

function generateToken(overrides = {}, secret = TEST_SECRET) {
  return jwt.sign({
    user_id: USER_ID,
    user_role: 'district',
    organizationId: ORG_ID,
    roleIds: [1],
    roleNames: ['admin'],
    permissions: ['forms.view', 'forms.manage'],
    ...overrides
  }, secret);
}

beforeAll(() => {
  process.env.JWT_SECRET_KEY = TEST_SECRET;
  process.env.ORGANIZATION_ID = ORG_ID.toString();
  process.env.DB_USER = 'test';
  process.env.DB_HOST = 'localhost';
  process.env.DB_NAME = 'testdb';
  process.env.DB_PASSWORD = 'test';
  process.env.DB_PORT = '5432';

  app = require('../api');
});

beforeEach(() => {
  const { __mClient, __mPool } = require('pg');
  setupDefaultMocks(__mClient, __mPool);
  __mClient.query.mockClear();
  __mClient.release.mockClear();
  __mPool.connect.mockClear();
  __mPool.query.mockClear();
});

afterAll((done) => {
  closeServerResources(app, done);
});


// ============================================
// GET /api/v1/forms/structure/:form_type
// ============================================

describe('GET /api/v1/forms/structure/:form_type', () => {
  test.each([
    ['a decoded JSONB object', { fields: [{ name: 'incident_date', type: 'date' }] }],
    ['a JSON string', JSON.stringify({ fields: [{ name: 'incident_date', type: 'date' }] })]
  ])('returns the form structure when PostgreSQL supplies %s', async (_label, storedStructure) => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken();

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('FROM organization_form_formats') && query.includes('form_type = $1')) {
        expect(params).toEqual(['incident_report', ORG_ID]);
        return Promise.resolve({ rows: [{ form_structure: storedStructure }] });
      }
      return undefined;
    });

    const res = await request(app)
      .get('/api/v1/forms/structure/incident_report')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      fields: [{ name: 'incident_date', type: 'date' }]
    });
  });
});


describe('form permissions follow forms.manage, not the role name', () => {
  test('a role with any name that holds forms.manage may read them', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({ roleNames: ['forms_coordinator'], user_role: 'forms_coordinator' });

    mockQueryImplementation(__mClient, __mPool, (query) => {
      if (query.includes('permission_key') && query.includes('user_organizations')) {
        return Promise.resolve({ rows: [{ permission_key: 'forms.manage' }] });
      }
      if (query.includes('role_name')) {
        return Promise.resolve({ rows: [{ role_name: 'forms_coordinator', id: 1 }] });
      }
      return undefined;
    });

    const res = await request(app)
      .get('/api/v1/forms/form-permissions')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  test('a role called unitadmin without forms.manage is refused, and told what is missing', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({ roleNames: ['unitadmin'], user_role: 'unitadmin', permissions: [] });

    mockQueryImplementation(__mClient, __mPool, (query) => {
      if (query.includes('permission_key') && query.includes('user_organizations')) {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('role_name')) {
        return Promise.resolve({ rows: [{ role_name: 'unitadmin', id: 1 }] });
      }
      return undefined;
    });

    const res = await request(app)
      .get('/api/v1/forms/form-permissions')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.missing).toContain('forms.manage');
  });
});
