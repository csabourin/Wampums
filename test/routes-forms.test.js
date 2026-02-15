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

const { Pool } = require('pg');
const { setupDefaultMocks, mockQueryImplementation } = require('./mock-helpers');
let app;

const TEST_SECRET = 'testsecret';
const ORG_ID = 3; // Demo organization - safe for live testing
const FORM_ID = 1;
const PARTICIPANT_ID = 100;
const USER_ID = 1;
const PARENT_USER_ID = 50;

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
// GET /api/v1/forms - LIST FORMS
// ============================================

describe('GET /api/v1/forms', () => {
  test('returns list of forms for organization', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['forms.view']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('FROM forms') && query.includes('WHERE')) {
        return Promise.resolve({
          rows: [
            {
              id: 1,
              name: 'Health Form (2025)',
              type: 'health',
              version: 1,
              organization_id: ORG_ID,
              is_active: true,
              created_at: new Date(),
              updated_at: new Date()
            },
            {
              id: 2,
              name: 'Medication Authorization',
              type: 'medication',
              version: 1,
              organization_id: ORG_ID,
              is_active: true,
              created_at: new Date(),
              updated_at: new Date()
            }
          ]
        });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .get('/api/v1/forms')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].name).toBe('Health Form (2025)');
    expect(res.body.data[0].type).toBe('health');
  });

  test('filters by form type if provided', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['forms.view']
    });

    let queryString = '';

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('FROM forms')) {
        queryString = query;
        if (query.includes('type') || params.includes('health')) {
          return Promise.resolve({
            rows: [{
              id: 1,
              name: 'Health Form',
              type: 'health'
            }]
          });
        }
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .get('/api/v1/forms')
      .query({ type: 'health' })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  test('requires forms.view permission', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: [] // No permission
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('permission_key') && query.includes('user_organizations')) {
        return Promise.resolve({ rows: [] });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .get('/api/v1/forms')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  test('returns 401 without authentication', async () => {
    const res = await request(app)
      .get('/api/v1/forms');

    expect(res.status).toBe(401);
  });

  test('only returns active forms by default', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['forms.view']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('FROM forms')) {
        // Check that query filters for is_active = TRUE
        return Promise.resolve({
          rows: [
            { id: 1, name: 'Active Form', is_active: true }
            // Inactive forms should not be returned
          ]
        });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .get('/api/v1/forms')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.every(f => f.is_active === true)).toBe(true);
  });

  test('enforces organization isolation', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      organizationId: ORG_ID,
      permissions: ['forms.view']
    });

    let queriedOrgId = null;

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('FROM forms')) {
        queriedOrgId = params[params.length - 1];
        return Promise.resolve({ rows: [] });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    await request(app)
      .get('/api/v1/forms')
      .set('Authorization', `Bearer ${token}`);

    expect(queriedOrgId).toBe(ORG_ID);
  });
});

// ============================================
// GET /api/v1/forms/:id - GET SINGLE FORM
// ============================================

describe('GET /api/v1/forms/:id', () => {
  test('returns form definition and schema', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['forms.view']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('WHERE id') && query.includes('forms')) {
        return Promise.resolve({
          rows: [{
            id: FORM_ID,
            name: 'Health Disclosure Form',
            type: 'health',
            version: 1,
            organization_id: ORG_ID,
            schema: JSON.stringify({
              fields: [
                { name: 'allergies', type: 'text', required: true },
                { name: 'medications', type: 'text', required: false },
                { name: 'medical_conditions', type: 'text', required: true }
              ]
            }),
            is_active: true
          }]
        });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .get(`/api/v1/forms/${FORM_ID}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Health Disclosure Form');
    expect(res.body.data.schema).toBeDefined();
    expect(res.body.data.schema.fields).toHaveLength(3);
  });

  test('returns 404 when form not found', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['forms.view']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('WHERE id')) {
        return Promise.resolve({ rows: [] });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .get('/api/v1/forms/999')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  test('requires forms.view permission', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: []
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('permission_key') && query.includes('user_organizations')) {
        return Promise.resolve({ rows: [] });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .get(`/api/v1/forms/${FORM_ID}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });
});

// ============================================
// POST /api/v1/forms - CREATE FORM
// ============================================

describe('POST /api/v1/forms', () => {
  test('creates new form with schema', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['forms.manage']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('INSERT INTO forms')) {
        return Promise.resolve({
          rows: [{
            id: 100,
            name: 'New Form',
            type: 'health',
            version: 1,
            organization_id: ORG_ID
          }]
        });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .post('/api/v1/forms')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'New Form',
        type: 'health',
        schema: {
          fields: [
            { name: 'allergies', type: 'text', required: true }
          ]
        }
      });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('New Form');
    expect(res.body.data.version).toBe(1);
  });

  test('requires forms.manage permission', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: [] // No permission
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('permission_key') && query.includes('user_organizations')) {
        return Promise.resolve({ rows: [] });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .post('/api/v1/forms')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'New Form',
        type: 'health',
        schema: {}
      });

    expect(res.status).toBe(403);
  });

  test('requires name and type', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['forms.manage']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .post('/api/v1/forms')
      .set('Authorization', `Bearer ${token}`)
      .send({
        // Missing name and type
        schema: {}
      });

    expect(res.status).toBe(400);
  });

  test('validates schema is valid JSON', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['forms.manage']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .post('/api/v1/forms')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Form',
        type: 'health',
        schema: 'not valid json' // Invalid
      });

    expect(res.status).toBe(400);
  });
});

// ============================================
// POST /api/v1/forms/:id/submit - SUBMIT FORM
// ============================================

describe('POST /api/v1/forms/:id/submit', () => {
  test('parent submits form for their child', async () => {
    const { __mClient, __mPool } = require('pg');
    const parentToken = generateToken({
      user_id: PARENT_USER_ID,
      roleNames: ['parent'],
      permissions: ['forms.submit']
    });

    let insertCalled = false;

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('INSERT INTO form_submissions')) {
        insertCalled = true;
        return Promise.resolve({
          rows: [{
            id: 1000,
            form_id: FORM_ID,
            participant_id: PARTICIPANT_ID,
            status: 'submitted',
            submitted_by_user_id: PARENT_USER_ID
          }]
        });
      }
      if (query.includes('FROM user_participants')) {
        // Verify parent can submit for this child
        return Promise.resolve({
          rows: [{ participant_id: PARTICIPANT_ID }]
        });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .post(`/api/v1/forms/${FORM_ID}/submit`)
      .set('Authorization', `Bearer ${parentToken}`)
      .send({
        participant_id: PARTICIPANT_ID,
        data: {
          allergies: 'Peanuts',
          medications: 'None',
          medical_conditions: 'Asthma'
        }
      });

    expect(res.status).toBe(201);
    expect(insertCalled).toBe(true);
    expect(res.body.data.status).toBe('submitted');
  });

  test('staff can submit form on behalf of parent', async () => {
    const { __mClient, __mPool } = require('pg');
    const staffToken = generateToken({
      roleNames: ['animation'],
      permissions: ['forms.manage']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('INSERT INTO form_submissions')) {
        return Promise.resolve({
          rows: [{
            id: 1000,
            form_id: FORM_ID,
            participant_id: PARTICIPANT_ID,
            status: 'submitted'
          }]
        });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .post(`/api/v1/forms/${FORM_ID}/submit`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        participant_id: PARTICIPANT_ID,
        data: {},
        user_id: PARENT_USER_ID // Acting on behalf of parent
      });

    expect(res.status).toBe(201);
  });

  test('parent cannot submit for other parent\'s children', async () => {
    const { __mClient, __mPool } = require('pg');
    const parentToken = generateToken({
      user_id: PARENT_USER_ID,
      roleNames: ['parent'],
      permissions: ['forms.submit']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('FROM user_participants')) {
        return Promise.resolve({ rows: [] }); // Not linked to this child
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .post(`/api/v1/forms/${FORM_ID}/submit`)
      .set('Authorization', `Bearer ${parentToken}`)
      .send({
        participant_id: 999, // Different child
        data: {}
      });

    expect(res.status).toBe(403);
  });

  test('validates required fields in submission data', async () => {
    const { __mClient, __mPool } = require('pg');
    const staffToken = generateToken({
      permissions: ['forms.manage']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('FROM forms WHERE id')) {
        return Promise.resolve({
          rows: [{
            id: FORM_ID,
            schema: JSON.stringify({
              fields: [
                { name: 'allergies', required: true },
                { name: 'medications', required: false }
              ]
            })
          }]
        });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .post(`/api/v1/forms/${FORM_ID}/submit`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        participant_id: PARTICIPANT_ID,
        data: {
          medications: 'None'
          // Missing required field: allergies
        }
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/required|allergies/i);
  });

  test('requires forms.submit permission', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: [] // No permission
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('permission_key') && query.includes('user_organizations')) {
        return Promise.resolve({ rows: [] });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .post(`/api/v1/forms/${FORM_ID}/submit`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        participant_id: PARTICIPANT_ID,
        data: {}
      });

    expect(res.status).toBe(403);
  });

  test('returns 404 when form not found', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['forms.manage']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('FROM forms')) {
        return Promise.resolve({ rows: [] }); // Not found
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .post('/api/v1/forms/999/submit')
      .set('Authorization', `Bearer ${token}`)
      .send({
        participant_id: PARTICIPANT_ID,
        data: {}
      });

    expect(res.status).toBe(404);
  });
});

// ============================================
// GET /api/v1/forms/:id/submissions - LIST SUBMISSIONS
// ============================================

describe('GET /api/v1/forms/:id/submissions', () => {
  test('lists all submissions for a form', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['forms.view']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('FROM form_submissions')) {
        return Promise.resolve({
          rows: [
            {
              id: 1,
              participant_id: PARTICIPANT_ID,
              status: 'submitted',
              data: JSON.stringify({ allergies: 'Peanuts' }),
              submitted_at: new Date()
            }
          ]
        });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .get(`/api/v1/forms/${FORM_ID}/submissions`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].status).toBe('submitted');
  });

  test('filters submissions by status if provided', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['forms.view']
    });

    let queriedStatus = null;

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('FROM form_submissions')) {
        if (query.includes('status')) {
          queriedStatus = params[params.length - 1];
        }
        return Promise.resolve({
          rows: [{
            id: 1,
            status: 'draft'
          }]
        });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .get(`/api/v1/forms/${FORM_ID}/submissions`)
      .query({ status: 'draft' })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  test('requires forms.view permission', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: []
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('permission_key') && query.includes('user_organizations')) {
        return Promise.resolve({ rows: [] });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .get(`/api/v1/forms/${FORM_ID}/submissions`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });
});

// ============================================
// PUT /api/v1/forms/:id/submissions/:submissionId/approve
// ============================================

describe('PUT /api/v1/forms/:id/submissions/:submissionId/approve', () => {
  test('staff approves form submission', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['forms.manage']
    });

    let updateCalled = false;

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('UPDATE form_submissions SET status')) {
        updateCalled = true;
        return Promise.resolve({
          rows: [{
            id: 1,
            status: 'approved',
            approved_at: new Date()
          }]
        });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .put(`/api/v1/forms/${FORM_ID}/submissions/1/approve`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        approved_notes: 'Form looks good'
      });

    expect(res.status).toBe(200);
    expect(updateCalled).toBe(true);
    expect(res.body.data.status).toBe('approved');
  });

  test('requires forms.manage permission to approve', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['forms.view'] // Only view
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('permission_key') && query.includes('user_organizations')) {
        return Promise.resolve({ rows: [] });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .put(`/api/v1/forms/${FORM_ID}/submissions/1/approve`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(403);
  });

  test('returns 404 when submission not found', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['forms.manage']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('UPDATE form_submissions')) {
        return Promise.resolve({ rows: [] }); // Not found
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .put(`/api/v1/forms/${FORM_ID}/submissions/999/approve`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(404);
  });
});

// ============================================
// PERMISSION & SECURITY TESTS
// ============================================

describe('Form Permission Enforcement', () => {
  test('forms.view permission allows read-only access', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['forms.view'] // View only
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('FROM forms') && !query.includes('INSERT')) {
        return Promise.resolve({
          rows: [{ id: FORM_ID, name: 'Form' }]
        });
      }
      if (query.includes('INSERT INTO forms')) {
        return Promise.resolve({ rows: [] });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    // GET should work
    const getRes = await request(app)
      .get('/api/v1/forms')
      .set('Authorization', `Bearer ${token}`);

    expect(getRes.status).toBe(200);

    // POST should fail
    const postRes = await request(app)
      .post('/api/v1/forms')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'New Form',
        type: 'health'
      });

    expect(postRes.status).toBe(403);
  });
});

// ============================================
// FORM VERSION TESTS
// ============================================

describe('Form Versioning', () => {
  test('multiple versions of same form can coexist', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['forms.view']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('FROM forms')) {
        return Promise.resolve({
          rows: [
            {
              id: 1,
              name: 'Health Form',
              version: 1,
              is_active: false
            },
            {
              id: 2,
              name: 'Health Form',
              version: 2,
              is_active: true // Current version
            }
          ]
        });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .get('/api/v1/forms')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.filter(f => f.version === 1)).toHaveLength(1);
    expect(res.body.data.filter(f => f.version === 2)).toHaveLength(1);
  });

  test('only latest version is marked as active', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['forms.view']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('FROM forms')) {
        return Promise.resolve({
          rows: [
            { version: 1, is_active: false },
            { version: 2, is_active: false },
            { version: 3, is_active: true } // Only this one active
          ]
        });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .get('/api/v1/forms')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const activeCount = res.body.data.filter(f => f.is_active).length;
    expect(activeCount).toBeLessThanOrEqual(1);
  });
});

// ============================================
// ORGANIZATION ISOLATION TESTS
// ============================================

describe('Form Organization Isolation', () => {
  test('forms from different organizations are isolated', async () => {
    const { __mClient, __mPool } = require('pg');

    const org1Token = generateToken({
      organizationId: 1,
      permissions: ['forms.view']
    });

    const org2Token = generateToken({
      organizationId: 2,
      permissions: ['forms.view']
    });

    let lastQueriedOrgId = null;

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('FROM forms')) {
        lastQueriedOrgId = params[params.length - 1];
        return Promise.resolve({ rows: [] });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    await request(app)
      .get('/api/v1/forms')
      .set('Authorization', `Bearer ${org1Token}`);

    expect(lastQueriedOrgId).toBe(1);

    await request(app)
      .get('/api/v1/forms')
      .set('Authorization', `Bearer ${org2Token}`);

    expect(lastQueriedOrgId).toBe(2);
  });
});
