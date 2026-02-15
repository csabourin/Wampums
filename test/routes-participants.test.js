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
    const { __mPool } = require('pg');
    const token = generateToken({
      roleNames: ['leader'],
      permissions: ['participants.view']
    });

    let queryUsedOrganizationScope = false;

    __mPool.query.mockImplementation((query, params) => {
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
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .get('/api/v1/participants')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.participants).toBeDefined();
    expect(res.body.data.participants.length).toBe(2);
    expect(queryUsedOrganizationScope).toBe(true);
  });

  test('parent (linked scope) sees only their children', async () => {
    const { __mPool } = require('pg');
    const parentUserId = 100;
    const token = generateToken({
      user_id: parentUserId,
      roleNames: ['parent'],
      permissions: ['participants.view']
    });

    let queryDidJoinUserParticipants = false;

    __mPool.query.mockImplementation((query, params) => {
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
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .get('/api/v1/participants')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(queryDidJoinUserParticipants).toBe(true);
  });

  test('filters by group_id parameter', async () => {
    const { __mPool } = require('pg');
    const token = generateToken({
      roleNames: ['leader'],
      permissions: ['participants.view']
    });

    let capturedGroupId = null;

    __mPool.query.mockImplementation((query, params) => {
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
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .get('/api/v1/participants?group_id=5')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  test('requires participants.view permission', async () => {
    const { __mPool } = require('pg');
    const token = generateToken({
      permissions: [] // No permissions
    });

    __mPool.query.mockImplementation((query, params) => {
      if (query.includes('data_scope')) {
        return Promise.resolve({
          rows: [{ data_scope: 'organization' }]
        });
      }
      if (query.includes('permission_key')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
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
    const { __mPool } = require('pg');
    const token = generateToken({
      permissions: ['participants.manage']
    });

    let participantInserted = false;

    __mPool.query.mockImplementation((query, params) => {
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
      if (query.includes('INSERT INTO participant_organizations')) {
        return Promise.resolve({ rows: [{}] });
      }
      if (query.includes('permission_key')) {
        return Promise.resolve({
          rows: [{ permission_key: 'participants.manage' }]
        });
      }
      if (query.includes('role_name')) {
        return Promise.resolve({
          rows: [{ role_name: 'admin' }]
        });
      }
      return Promise.resolve({ rows: [] });
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
    const { __mPool } = require('pg');
    const token = generateToken({
      permissions: ['participants.manage']
    });

    __mPool.query.mockImplementation((query, params) => {
      if (query.includes('permission_key')) {
        return Promise.resolve({
          rows: [{ permission_key: 'participants.manage' }]
        });
      }
      return Promise.resolve({ rows: [] });
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
    const { __mPool } = require('pg');
    const token = generateToken({
      permissions: ['participants.manage']
    });

    __mPool.query.mockImplementation((query, params) => {
      if (query.includes('permission_key')) {
        return Promise.resolve({
          rows: [{ permission_key: 'participants.manage' }]
        });
      }
      return Promise.resolve({ rows: [] });
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

  test('requires participants.manage permission', async () => {
    const { __mPool } = require('pg');
    const token = generateToken({
      permissions: ['participants.view'] // Can view, not manage
    });

    __mPool.query.mockImplementation((query, params) => {
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
      return Promise.resolve({ rows: [] });
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
    const { __mPool } = require('pg');
    const token = generateToken({
      roleNames: ['demoparent'],
      permissions: ['participants.manage']
    });

    __mPool.query.mockImplementation((query, params) => {
      if (query.includes('demoadmin') || query.includes('demoparent')) {
        return Promise.resolve({
          rows: [{ role_name: 'demoparent' }]
        });
      }
      return Promise.resolve({ rows: [] });
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
// ============================================

describe('POST /api/v1/participants/:id/link-parent', () => {
  test('links parent user to participant', async () => {
    const { __mPool } = require('pg');
    const token = generateToken({
      permissions: ['participants.manage']
    });

    let linkInserted = false;

    __mPool.query.mockImplementation((query, params) => {
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
      if (query.includes('role_name')) {
        return Promise.resolve({
          rows: [{ role_name: 'admin' }]
        });
      }
      return Promise.resolve({ rows: [] });
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
    const { __mPool } = require('pg');
    const token = generateToken({
      permissions: ['participants.manage']
    });

    __mPool.query.mockImplementation((query, params) => {
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
      if (query.includes('role_name')) {
        return Promise.resolve({
          rows: [{ role_name: 'admin' }]
        });
      }
      return Promise.resolve({ rows: [] });
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
    const { __mPool } = require('pg');
    const token = generateToken({
      permissions: ['participants.manage']
    });

    __mPool.query.mockImplementation((query, params) => {
      if (query.includes('permission_key')) {
        return Promise.resolve({
          rows: [{ permission_key: 'participants.manage' }]
        });
      }
      return Promise.resolve({ rows: [] });
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
// ============================================

describe('POST /api/v1/participants/:id/add-group', () => {
  test('adds participant to group', async () => {
    const { __mPool } = require('pg');
    const token = generateToken({
      permissions: ['participants.manage']
    });

    let groupMembershipInserted = false;

    __mPool.query.mockImplementation((query, params) => {
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
      if (query.includes('role_name')) {
        return Promise.resolve({
          rows: [{ role_name: 'admin' }]
        });
      }
      return Promise.resolve({ rows: [] });
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
    const { __mPool } = require('pg');
    const token = generateToken({
      permissions: ['participants.manage']
    });

    __mPool.query.mockImplementation((query, params) => {
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
      return Promise.resolve({ rows: [] });
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

describe('Multi-organization participant isolation', () => {
  test('prevents participant from being linked to non-existent user in same org', async () => {
    const { __mPool } = require('pg');
    const token = generateToken({
      permissions: ['participants.manage'],
      organizationId: ORG_ID
    });

    __mPool.query.mockImplementation((query, params) => {
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
      return Promise.resolve({ rows: [] });
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
    const { __mPool } = require('pg');
    const token = generateToken({
      permissions: ['participants.view'],
      organizationId: ORG_ID
    });

    let queriedOrgId = null;

    __mPool.query.mockImplementation((query, params) => {
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
      return Promise.resolve({ rows: [] });
    });

    await request(app)
      .get('/api/v1/participants')
      .set('Authorization', `Bearer ${token}`);

    // First param should be organization_id
    expect(queriedOrgId).toBe(ORG_ID);
  });
});
