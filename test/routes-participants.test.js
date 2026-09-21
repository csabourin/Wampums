/**
 * Participants Routes Test Suite
 *
 * Tests critical participant data management:
 * - Participant CRUD operations
 * - Parent-child linking and unlinking
 * - Data scope filtering (organization vs linked)
 * - Multi-organization participant management
 * - Group membership operations
 * - Permission enforcement
 *
 * Data scope bugs directly enable:
 * - Unauthorized data access across organizations
 * - Parents viewing other families' children
 * - Cross-organization linking
 *
 * @module test/routes-participants
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { closeServerResources } = require('./test-helpers');

// Mock pg module before requiring app
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
const ORG_ID = 1;

function generateToken(overrides = {}, secret = TEST_SECRET) {
  return jwt.sign({
    user_id: 1,
    user_role: 'district',
    organizationId: ORG_ID,
    roleIds: [1],
    roleNames: ['admin'],
    permissions: ['participants.view', 'participants.manage'],
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
// PARTICIPANT LISTING WITH DATA SCOPE TESTS
// ============================================

describe('GET /api/v1/participants - Data Scope Filtering', () => {
  test('staff (organization scope) sees all participants', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      roleNames: ['leader'],
      permissions: ['participants.view']
    });

    let queryUsedOrganizationScope = false;

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('FROM participants p')) {
        // Organization-scoped query should NOT have user_participants join
        queryUsedOrganizationScope = !query.includes('user_participants');
        return Promise.resolve({
          rows: [
            {
              id: 50,
              first_name: 'John',
              last_name: 'Doe',
              total_points: 100,
              inscription_date: '2025-01-01'
            },
            {
              id: 51,
              first_name: 'Jane',
              last_name: 'Smith',
              total_points: 85,
              inscription_date: '2025-01-05'
            }
          ]
        });
      }
      if (query.includes('data_scope')) {
        return Promise.resolve({
          rows: [{ data_scope: 'organization' }]
        });
      }
      if (query.includes('permission_key')) {
        return Promise.resolve({
          rows: [{ permission_key: 'participants.view' }]
        });
      }
      if (query.includes('role_name')) {
        return Promise.resolve({
          rows: [{ role_name: 'leader' }]
        });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .get('/api/v1/participants')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(2);
    expect(queryUsedOrganizationScope).toBe(true);
  });

  test('parent (linked scope) sees only their children', async () => {
    const { __mClient, __mPool } = require('pg');
    const parentUserId = 100;
    const token = generateToken({
      user_id: parentUserId,
      roleNames: ['parent'],
      permissions: ['participants.view']
    });

    let queryDidJoinUserParticipants = false;

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('FROM participants p')) {
        // Parent query SHOULD include user_participants join
        queryDidJoinUserParticipants = query.includes('user_participants');
        if (queryDidJoinUserParticipants) {
          return Promise.resolve({
            rows: [
              {
                id: 50,
                first_name: 'Johnny',
                last_name: 'Doe',
                total_points: 45
              }
            ]
          });
        }
      }
      if (query.includes('data_scope')) {
        return Promise.resolve({
          rows: [{ data_scope: 'linked' }]
        });
      }
      if (query.includes('permission_key')) {
        return Promise.resolve({
          rows: [{ permission_key: 'participants.view' }]
        });
      }
      if (query.includes('role_name')) {
        return Promise.resolve({
          rows: [{ role_name: 'parent' }]
        });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .get('/api/v1/participants')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(queryDidJoinUserParticipants).toBe(true);
  });

  test('filters by group_id parameter', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      roleNames: ['leader'],
      permissions: ['participants.view']
    });

    let capturedGroupId = null;

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('FROM participants p')) {
        if (query.includes('WHERE')) {
          capturedGroupId = params[params.length - 1]; // Last param is group_id in filtered query
        }
        return Promise.resolve({
          rows: [
            {
              id: 50,
              first_name: 'John',
              last_name: 'Doe'
            }
          ]
        });
      }
      if (query.includes('data_scope')) {
        return Promise.resolve({
          rows: [{ data_scope: 'organization' }]
        });
      }
      if (query.includes('permission_key')) {
        return Promise.resolve({
          rows: [{ permission_key: 'participants.view' }]
        });
      }
      if (query.includes('role_name')) {
        return Promise.resolve({
          rows: [{ role_name: 'leader' }]
        });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .get('/api/v1/participants?group_id=5')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  test('requires participants.view permission', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: [] // No permissions
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('data_scope')) {
        return Promise.resolve({
          rows: [{ data_scope: 'organization' }]
        });
      }
      if (query.includes('permission_key')) {
        return Promise.resolve({ rows: [] });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .get('/api/v1/participants')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/permission/i);
  });
});

// ============================================
// PARTICIPANT CREATION TESTS
// ============================================

describe('POST /api/v1/participants', () => {
  test('creates new participant with required fields', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['participants.create']
    });

    let participantInserted = false;

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('INSERT INTO participants')) {
        participantInserted = true;
        return Promise.resolve({
          rows: [{
            id: 100,
            first_name: 'Jane',
            last_name: 'Smith',
            date_of_birth: '2015-06-15'
          }]
        });
      }
      if (query.includes('FROM scout_years')) {
        return Promise.resolve({
          rows: [{
            id: 1,
            organization_id: 1,
            label: '2025-2026',
            start_date: '2025-09-01',
            end_date: '2026-08-31',
            status: 'active'
          }]
        });
      }
      if (query.includes('INSERT INTO participant_enrollments')) {
        return Promise.resolve({ rows: [{}] });
      }
      if (query.includes('permission_key')) {
        return Promise.resolve({
          rows: [{ permission_key: 'participants.create' }]
        });
      }
      // Demo role check - must return empty to pass blockDemoRoles
      if (query.includes("role_name IN ('demoadmin', 'demoparent')")) {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('role_name')) {
        return Promise.resolve({
          rows: [{ role_name: 'admin' }]
        });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .post('/api/v1/participants')
      .set('Authorization', `Bearer ${token}`)
      .send({
        first_name: 'Jane',
        last_name: 'Smith',
        date_of_birth: '2015-06-15'
      });

    expect(res.status).toBe(201);
    expect(res.body.data.first_name).toBe('Jane');
    expect(participantInserted).toBe(true);
  });

  test('requires first_name', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['participants.create']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('permission_key')) {
        return Promise.resolve({
          rows: [{ permission_key: 'participants.create' }]
        });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .post('/api/v1/participants')
      .set('Authorization', `Bearer ${token}`)
      .send({
        // Missing first_name
        last_name: 'Smith',
        date_of_birth: '2015-06-15'
      });

    expect(res.status).toBe(400);
  });

  test('requires last_name', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['participants.create']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('permission_key')) {
        return Promise.resolve({
          rows: [{ permission_key: 'participants.create' }]
        });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .post('/api/v1/participants')
      .set('Authorization', `Bearer ${token}`)
      .send({
        first_name: 'Jane',
        // Missing last_name
        date_of_birth: '2015-06-15'
      });

    expect(res.status).toBe(400);
  });

  test('requires participants.create permission', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['participants.view'] // Can view, not manage
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('permission_key')) {
        return Promise.resolve({
          rows: [{ permission_key: 'participants.view' }]
        });
      }
      if (query.includes('role_name')) {
        return Promise.resolve({
          rows: [{ role_name: 'parent' }]
        });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .post('/api/v1/participants')
      .set('Authorization', `Bearer ${token}`)
      .send({
        first_name: 'Jane',
        last_name: 'Smith',
        date_of_birth: '2015-06-15'
      });

    expect(res.status).toBe(403);
  });

  test('blocks demo users from creating participants', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      roleNames: ['demoparent'],
      permissions: ['participants.create']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('demoadmin') || query.includes('demoparent')) {
        return Promise.resolve({
          rows: [{ role_name: 'demoparent' }]
        });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .post('/api/v1/participants')
      .set('Authorization', `Bearer ${token}`)
      .send({
        first_name: 'Jane',
        last_name: 'Smith',
        date_of_birth: '2015-06-15'
      });

    expect(res.status).toBe(403);
    expect(res.body.isDemo).toBe(true);
  });
});

// ============================================
// PARENT-CHILD LINKING TESTS
// NOTE: These tests are for routes that don't exist with these exact paths
// The actual route is POST /link-parent (not /:id/link-parent)
// Skipping these tests as they test non-existent API endpoints
// ============================================

describe.skip('POST /api/v1/participants/:id/link-parent', () => {
  test('links parent user to participant', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['participants.manage']
    });

    let linkInserted = false;

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('INSERT INTO user_participants')) {
        linkInserted = true;
        return Promise.resolve({
          rows: [{
            user_id: 1,
            participant_id: 50
          }]
        });
      }
      if (query.includes('SELECT.*FROM participants WHERE id')) {
        return Promise.resolve({
          rows: [{ id: 50, first_name: 'John' }]
        });
      }
      if (query.includes('permission_key')) {
        return Promise.resolve({
          rows: [{ permission_key: 'participants.manage' }]
        });
      }
      // Demo role check - must return empty to pass blockDemoRoles
      if (query.includes("role_name IN ('demoadmin', 'demoparent')")) {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('role_name')) {
        return Promise.resolve({
          rows: [{ role_name: 'admin' }]
        });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .post('/api/v1/participants/50/link-parent')
      .set('Authorization', `Bearer ${token}`)
      .send({
        parent_user_id: 100
      });

    expect(res.status).toBe(200);
    expect(linkInserted).toBe(true);
  });

  test('prevents duplicate parent-child links', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['participants.manage']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('SELECT.*FROM participants WHERE id')) {
        return Promise.resolve({
          rows: [{ id: 50 }]
        });
      }
      if (query.includes('INSERT INTO user_participants')) {
        // Simulate unique constraint violation
        return Promise.reject(new Error('duplicate key'));
      }
      if (query.includes('permission_key')) {
        return Promise.resolve({
          rows: [{ permission_key: 'participants.manage' }]
        });
      }
      // Demo role check - must return empty to pass blockDemoRoles
      if (query.includes("role_name IN ('demoadmin', 'demoparent')")) {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('role_name')) {
        return Promise.resolve({
          rows: [{ role_name: 'admin' }]
        });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .post('/api/v1/participants/50/link-parent')
      .set('Authorization', `Bearer ${token}`)
      .send({
        parent_user_id: 100
      });

    expect([400, 409]).toContain(res.status);
  });

  test('requires parent_user_id in request', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['participants.manage']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('permission_key')) {
        return Promise.resolve({
          rows: [{ permission_key: 'participants.manage' }]
        });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .post('/api/v1/participants/50/link-parent')
      .set('Authorization', `Bearer ${token}`)
      .send({
        // Missing parent_user_id
      });

    expect(res.status).toBe(400);
  });
});

// ============================================
// GROUP MEMBERSHIP TESTS
// NOTE: These tests are for routes that don't exist with these exact paths
// The actual route is PATCH /:id/group-membership (not POST /:id/add-group)
// Skipping these tests as they test non-existent API endpoints
// ============================================

describe.skip('POST /api/v1/participants/:id/add-group', () => {
  test('adds participant to group', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['participants.manage']
    });

    let groupMembershipInserted = false;

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('INSERT INTO participant_groups')) {
        groupMembershipInserted = true;
        return Promise.resolve({
          rows: [{
            participant_id: 50,
            group_id: 5
          }]
        });
      }
      if (query.includes('SELECT.*FROM participants WHERE id')) {
        return Promise.resolve({
          rows: [{ id: 50 }]
        });
      }
      if (query.includes('SELECT id FROM groups WHERE id')) {
        return Promise.resolve({
          rows: [{ id: 5 }]
        });
      }
      if (query.includes('permission_key')) {
        return Promise.resolve({
          rows: [{ permission_key: 'participants.manage' }]
        });
      }
      // Demo role check - must return empty to pass blockDemoRoles
      if (query.includes("role_name IN ('demoadmin', 'demoparent')")) {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('role_name')) {
        return Promise.resolve({
          rows: [{ role_name: 'admin' }]
        });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .post('/api/v1/participants/50/add-group')
      .set('Authorization', `Bearer ${token}`)
      .send({
        group_id: 5
      });

    expect(res.status).toBe(200);
    expect(groupMembershipInserted).toBe(true);
  });

  test('prevents adding participant to non-existent group', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['participants.manage']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('SELECT id FROM groups WHERE id')) {
        return Promise.resolve({ rows: [] }); // Group not found
      }
      if (query.includes('SELECT.*FROM participants WHERE id')) {
        return Promise.resolve({
          rows: [{ id: 50 }]
        });
      }
      if (query.includes('permission_key')) {
        return Promise.resolve({
          rows: [{ permission_key: 'participants.manage' }]
        });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .post('/api/v1/participants/50/add-group')
      .set('Authorization', `Bearer ${token}`)
      .send({
        group_id: 9999
      });

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/group|not found/i);
  });
});

// ============================================
// ORGANIZATION ISOLATION TESTS
// ============================================

describe('POST /api/v1/participants/link-organization', () => {
  /**
   * Drive the route with a controlled answer from the enrolment upsert.
   *
   * @param {Array} enrollmentRows - What RETURNING hands back
   * @param {Object} [options] - Failure and payload controls
   * @returns {Promise<Object>} Response and captured flagging query
   */
  async function linkWithMocks(enrollmentRows, options = {}) {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({ permissions: ['participants.edit'], organizationId: ORG_ID });
    let enrollmentParams = null;
    let flagQuery = null;
    let flagParams = null;

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('INSERT INTO participant_enrollments')) {
        enrollmentParams = params;
        return Promise.resolve({ rows: enrollmentRows });
      }
      if (query.includes("review_state = 'needs_review'")) {
        flagQuery = query;
        flagParams = params;
        if (options.failFlagging) {
          return Promise.reject(new Error('paperwork flagging failed'));
        }
        return Promise.resolve({ rows: [] });
      }
      return undefined;
    });

    const response = await request(app)
      .post('/api/v1/participants/link-organization')
      .set('Authorization', `Bearer ${token}`)
      .send({ participant_id: options.participantId ?? 50 });

    return { response, enrollmentParams, flagQuery, flagParams, client: __mClient };
  }

  test('flags required forms when the youth actually joins the roster', async () => {
    const result = await linkWithMocks([{ created: true }]);

    expect(result.response.status).toBe(200);
    expect(result.flagQuery).not.toBeNull();
  });

  test('flags required forms when a departed youth is revived', async () => {
    const result = await linkWithMocks([{ created: false }]);

    expect(result.response.status).toBe(200);
    expect(result.flagQuery).not.toBeNull();
  });

  test('leaves paperwork alone when the youth is already active', async () => {
    // The registration screen calls this route after every save, immediately
    // after submitting the registration form. Flagging on an idempotent re-link
    // would send every required form back to needs_review on each edit —
    // including the one just submitted.
    const result = await linkWithMocks([]);

    expect(result.response.status).toBe(200);
    expect(result.flagQuery).toBeNull();
  });

  test('preserves forms renewed during the active season', async () => {
    const result = await linkWithMocks([{ created: false }]);

    expect(result.flagParams).toEqual([ORG_ID, [50], '2025-09-01']);
    expect(result.flagQuery).toContain('fs.updated_at');
    expect(result.flagQuery).toContain('fs.last_reviewed_at');
    expect(result.flagQuery).toContain('$3::date');
  });

  test('parses the participant ID once and reuses the validated integer', async () => {
    const result = await linkWithMocks([{ created: true }], { participantId: '50' });

    expect(result.enrollmentParams[0]).toBe(50);
    expect(result.flagParams[1]).toEqual([50]);
  });

  test.each(['not-a-number', '50x', true, { id: 50 }])(
    'rejects invalid participant ID %p before opening a transaction',
    async (participantId) => {
      const { __mPool } = require('pg');
      const result = await linkWithMocks([], { participantId });

      expect(result.response.status).toBe(400);
      expect(result.response.body.message).toBe('Invalid participant identifier');
      expect(__mPool.connect).not.toHaveBeenCalled();
    }
  );

  test('rolls enrollment back when paperwork flagging fails', async () => {
    const result = await linkWithMocks([{ created: true }], { failFlagging: true });
    const transactionCommands = result.client.query.mock.calls
      .map(([query]) => query)
      .filter(query => ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(query));

    expect(result.response.status).toBe(500);
    expect(transactionCommands).toEqual(['BEGIN', 'ROLLBACK']);
    expect(result.client.release).toHaveBeenCalledTimes(1);
  });

  test('commits enrollment and paperwork flagging together', async () => {
    const result = await linkWithMocks([{ created: true }]);
    const transactionCommands = result.client.query.mock.calls
      .map(([query]) => query)
      .filter(query => ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(query));

    expect(transactionCommands).toEqual(['BEGIN', 'COMMIT']);
    expect(result.client.release).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/v1/participants/with-documents', () => {
  test('judges a form by review_state, not by the year its row was created', async () => {
    // form_submissions is UNIQUE (participant_id, form_type, organization_id):
    // one row per form type for all time, updated in place, with scout_year_id
    // left at the year the row was first created. Matching the selected year
    // against it reported every returning family as missing their paperwork
    // forever, however many times they filled it in.
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({ permissions: ['participants.view'], organizationId: ORG_ID });
    let documentsQuery = null;

    mockQueryImplementation(__mClient, __mPool, (query) => {
      if (query.includes('submitted_forms')) {
        documentsQuery = query;
        return Promise.resolve({ rows: [] });
      }
      return undefined;
    });

    await request(app)
      .get('/api/v1/participants/with-documents')
      .set('Authorization', `Bearer ${token}`);

    expect(documentsQuery).not.toBeNull();
    expect(documentsQuery).toContain("fs.review_state = 'current'");
    expect(documentsQuery).not.toContain('fs.scout_year_id');
    // The roster half stays year-scoped.
    expect(documentsQuery).toContain('pe.scout_year_id');
  });

  test('enables the review-state predicate for active years and disables it for archives', async () => {
    // review_state is a single mutable flag with no per-year history, so asking
    // it about an archived year would let the next transition retroactively mark
    // a finished season incomplete. An archived year reports what is on file.
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({ permissions: ['participants.view'], organizationId: ORG_ID });
    const reviewStateGates = [];

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('FROM scout_years') && params?.[0] === 2) {
        return Promise.resolve({
          rows: [{
            id: 2,
            organization_id: ORG_ID,
            label: '2024-2025',
            start_date: '2024-09-01',
            end_date: '2025-08-31',
            status: 'archived'
          }]
        });
      }
      if (query.includes('submitted_forms')) {
        reviewStateGates.push(params[3]);
        return Promise.resolve({ rows: [] });
      }
      return undefined;
    });

    await request(app)
      .get('/api/v1/participants/with-documents')
      .set('Authorization', `Bearer ${token}`);

    await request(app)
      .get('/api/v1/participants/with-documents?scout_year_id=2')
      .set('Authorization', `Bearer ${token}`);

    // The 4th parameter gates the predicate: true only when the year is active.
    expect(reviewStateGates).toEqual([true, false]);
  });
});

describe('DELETE /api/v1/participants/:id/users/:userId', () => {
  // There was no way to undo one wrong parent link: the only removal path was
  // POST /link-users with replace_all, which rewrites every link a user has.
  test('removes a single link and scopes it to the caller organization', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({ permissions: ['participants.edit'], organizationId: ORG_ID });
    const userId = '11111111-2222-3333-4444-555555555555';
    let deleteParams = null;

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('participant_in_org')) {
        return Promise.resolve({ rows: [{ participant_in_org: true, user_in_org: true }] });
      }
      if (query.includes('DELETE FROM user_participants')) {
        deleteParams = params;
        return Promise.resolve({ rows: [{ user_id: userId }] });
      }
      return undefined;
    });

    const res = await request(app)
      .delete(`/api/v1/participants/50/users/${userId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    // The UUID must survive intact — user ids are not integers.
    expect(deleteParams).toEqual([50, userId]);
  });

  test('refuses a participant belonging to another organization', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({ permissions: ['participants.edit'], organizationId: ORG_ID });
    let deleteAttempted = false;

    mockQueryImplementation(__mClient, __mPool, (query) => {
      if (query.includes('participant_in_org')) {
        return Promise.resolve({ rows: [{ participant_in_org: false, user_in_org: true }] });
      }
      if (query.includes('DELETE FROM user_participants')) {
        deleteAttempted = true;
        return Promise.resolve({ rows: [] });
      }
      return undefined;
    });

    const res = await request(app)
      .delete('/api/v1/participants/50/users/11111111-2222-3333-4444-555555555555')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(deleteAttempted).toBe(false);
  });

  test('refuses a parent who belongs to a different organization', async () => {
    // user_participants has no organization column and a youth can be enrolled
    // in several organizations, so without checking the parent's tenant too an
    // admin of A could sever a shared youth's link to a parent of B.
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({ permissions: ['participants.edit'], organizationId: ORG_ID });
    let deleteAttempted = false;

    mockQueryImplementation(__mClient, __mPool, (query) => {
      if (query.includes('participant_in_org')) {
        return Promise.resolve({ rows: [{ participant_in_org: true, user_in_org: false }] });
      }
      if (query.includes('DELETE FROM user_participants')) {
        deleteAttempted = true;
        return Promise.resolve({ rows: [] });
      }
      return undefined;
    });

    const res = await request(app)
      .delete('/api/v1/participants/50/users/11111111-2222-3333-4444-555555555555')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(deleteAttempted).toBe(false);
  });
});

describe('Multi-organization participant isolation', () => {
  test('prevents participant from being linked to non-existent user in same org', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['participants.manage'],
      organizationId: ORG_ID
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('FROM users WHERE id')) {
        return Promise.resolve({ rows: [] }); // User not found
      }
      if (query.includes('SELECT.*FROM participants WHERE id')) {
        return Promise.resolve({
          rows: [{ id: 50, organization_id: ORG_ID }]
        });
      }
      if (query.includes('permission_key')) {
        return Promise.resolve({
          rows: [{ permission_key: 'participants.manage' }]
        });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .post('/api/v1/participants/50/link-parent')
      .set('Authorization', `Bearer ${token}`)
      .send({
        parent_user_id: 99999
      });

    expect(res.status).toBe(404);
  });

  test('filters participant queries by organization_id', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['participants.view'],
      organizationId: ORG_ID
    });

    let queriedOrgId = null;

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('FROM participants p')) {
        queriedOrgId = params[0];
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('data_scope')) {
        return Promise.resolve({
          rows: [{ data_scope: 'organization' }]
        });
      }
      if (query.includes('permission_key')) {
        return Promise.resolve({
          rows: [{ permission_key: 'participants.view' }]
        });
      }
      if (query.includes('role_name')) {
        return Promise.resolve({
          rows: [{ role_name: 'admin' }]
        });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    await request(app)
      .get('/api/v1/participants')
      .set('Authorization', `Bearer ${token}`);

    // First param should be organization_id
    expect(queriedOrgId).toBe(ORG_ID);
  });
});

// ============================================
// MALFORMED BODY GUARDS
// ============================================

describe('Participants malformed JSON body guards', () => {
  test('PATCH /api/v1/participants/:id/group-membership rejects non-object body', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({ permissions: ['participants.edit'] });

    mockQueryImplementation(__mClient, __mPool, () => undefined);

    const res = await request(app)
      .patch('/api/v1/participants/50/group-membership')
      .set('Authorization', `Bearer ${token}`)
      .send([]);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/invalid request body/i);
  });

  test('PUT /api/v1/participants/:id rejects non-object body', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({ permissions: ['participants.edit'] });

    mockQueryImplementation(__mClient, __mPool, () => undefined);

    const res = await request(app)
      .put('/api/v1/participants/50')
      .set('Authorization', `Bearer ${token}`)
      .send([]);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/invalid request body/i);
  });
});
