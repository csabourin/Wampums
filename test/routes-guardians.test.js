/**
 * Guardian Routes Test Suite
 *
 * Tests the refactored guardians.js endpoints using standard middleware pattern.
 * Previously used manual JWT parsing - now uses authenticate + requirePermission middleware.
 *
 * Endpoint Coverage:
 * - GET /api/guardians - List guardians for a participant
 * - POST /api/guardians - Create/update guardian for participant
 * - DELETE /api/guardians - Remove guardian from participant
 *
 * Security Focus:
 * - requirePermission('guardians.view') for read access
 * - requirePermission('guardians.manage') for write operations
 * - Organization isolation (guardians belong to specific org participants)
 * - Parent can only access their linked children
 *
 * @module test/routes-guardians
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
let app;

const TEST_SECRET = 'testsecret';
const ORG_ID = 3; // Demo organization - safe for live testing
const PARTICIPANT_ID = 100;
const USER_ID = 1;
const GUARDIAN_ID = 50;

function generateToken(overrides = {}, secret = TEST_SECRET) {
  return jwt.sign({
    user_id: USER_ID,
    user_role: 'admin',
    organizationId: ORG_ID,
    roleIds: [1],
    roleNames: ['admin'],
    permissions: ['guardians.view', 'guardians.manage'],
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
  __mClient.query.mockReset();
  __mClient.release.mockReset();
  __mPool.connect.mockClear();
  __mPool.query.mockReset();
});

afterAll((done) => {
  closeServerResources(app, done);
});

// ============================================
// GET /api/guardians - LIST GUARDIANS
// ============================================

describe('GET /api/guardians', () => {
  test('returns list of guardians for a participant', async () => {
    const { __mPool } = require('pg');
    const token = generateToken({
      permissions: ['guardians.view']
    });

    __mPool.query.mockImplementation((query, params) => {
      if (query.includes('FROM participants p')) {
        // Verify participant exists in org
        return Promise.resolve({
          rows: [{ id: PARTICIPANT_ID }]
        });
      }
      if (query.includes('FROM participant_guardians pg')) {
        // Return guardians list
        return Promise.resolve({
          rows: [
            {
              guardian_id: GUARDIAN_ID,
              participant_id: PARTICIPANT_ID,
              lien: 'parent',
              relationship: 'parent',
              id: GUARDIAN_ID,
              nom: 'Dupont',
              prenom: 'Jean',
              courriel: 'jean@example.com',
              telephone_residence: '555-0001',
              telephone_travail: '555-0002',
              telephone_cellulaire: '555-1234',
              is_primary: true,
              is_emergency_contact: false
            }
          ]
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .get('/api/guardians')
      .query({ participant_id: PARTICIPANT_ID })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].nom).toBe('Dupont');
    expect(res.body.data[0].prenom).toBe('Jean');
  });

  test('returns empty list when participant has no guardians', async () => {
    const { __mPool } = require('pg');
    const token = generateToken({
      permissions: ['guardians.view']
    });

    __mPool.query.mockImplementation((query, params) => {
      if (query.includes('FROM participants p')) {
        return Promise.resolve({ rows: [{ id: PARTICIPANT_ID }] });
      }
      if (query.includes('FROM participant_guardians pg')) {
        return Promise.resolve({ rows: [] }); // No guardians
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .get('/api/guardians')
      .query({ participant_id: PARTICIPANT_ID })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  test('requires guardians.view permission', async () => {
    const { __mPool } = require('pg');
    const token = generateToken({
      permissions: [] // No permission
    });

    __mPool.query.mockImplementation((query, params) => {
      if (query.includes('FROM role_permissions')) {
        return Promise.resolve({ rows: [] }); // No permission found
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .get('/api/guardians')
      .query({ participant_id: PARTICIPANT_ID })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  test('returns 400 when participant_id is missing', async () => {
    const { __mPool } = require('pg');
    const token = generateToken();

    __mPool.query.mockImplementation((query, params) => {
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .get('/api/guardians')
      .set('Authorization', `Bearer ${token}`);
    // No query parameter

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/participant.*required/i);
  });

  test('returns 404 when participant not found in organization', async () => {
    const { __mPool } = require('pg');
    const token = generateToken({
      permissions: ['guardians.view']
    });

    __mPool.query.mockImplementation((query, params) => {
      if (query.includes('FROM participants p')) {
        return Promise.resolve({ rows: [] }); // Not found
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .get('/api/guardians')
      .query({ participant_id: 999 })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/not found/i);
  });

  test('returns 401 without authentication', async () => {
    const res = await request(app)
      .get('/api/guardians')
      .query({ participant_id: PARTICIPANT_ID });

    expect(res.status).toBe(401);
  });

  test('enforces organization isolation - participant from different org', async () => {
    const { __mPool } = require('pg');
    const otherOrgId = 99;
    const token = generateToken({
      organizationId: ORG_ID,
      permissions: ['guardians.view']
    });

    let queriedOrgId = null;

    __mPool.query.mockImplementation((query, params) => {
      if (query.includes('FROM participants p')) {
        // Capture the org_id being queried
        queriedOrgId = params[params.length - 1];
        // Return empty - participant not found in user's org
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .get('/api/guardians')
      .query({ participant_id: PARTICIPANT_ID })
      .set('Authorization', `Bearer ${token}`);

    // Should have checked with user's org_id
    expect(queriedOrgId).toBe(ORG_ID);
    expect(res.status).toBe(404);
  });

  test('returns all contact methods for guardian', async () => {
    const { __mPool } = require('pg');
    const token = generateToken({
      permissions: ['guardians.view']
    });

    __mPool.query.mockImplementation((query, params) => {
      if (query.includes('FROM participants p')) {
        return Promise.resolve({ rows: [{ id: PARTICIPANT_ID }] });
      }
      if (query.includes('FROM participant_guardians pg')) {
        return Promise.resolve({
          rows: [{
            guardian_id: GUARDIAN_ID,
            participant_id: PARTICIPANT_ID,
            lien: 'parent',
            relationship: 'parent',
            id: GUARDIAN_ID,
            nom: 'Dupont',
            prenom: 'Jean',
            courriel: 'jean@dupont.com',
            telephone_residence: '555-1000',
            telephone_travail: '555-2000',
            telephone_cellulaire: '555-3000',
            is_primary: true,
            is_emergency_contact: true
          }]
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .get('/api/guardians')
      .query({ participant_id: PARTICIPANT_ID })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const guardian = res.body.data[0];
    expect(guardian.courriel).toBe('jean@dupont.com');
    expect(guardian.telephone_residence).toBe('555-1000');
    expect(guardian.telephone_travail).toBe('555-2000');
    expect(guardian.telephone_cellulaire).toBe('555-3000');
    expect(guardian.is_primary).toBe(true);
    expect(guardian.is_emergency_contact).toBe(true);
  });
});

// ============================================
// POST /api/guardians - CREATE/UPDATE GUARDIAN
// ============================================

describe('POST /api/guardians', () => {
  test('creates new guardian and links to participant', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['guardians.manage']
    });

    let transactionStarted = false;
    let guardianInserted = false;
    let linkInserted = false;

    __mClient.query.mockImplementation((query, params) => {
      if (query === 'BEGIN') {
        transactionStarted = true;
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('FROM participants p')) {
        return Promise.resolve({ rows: [{ id: PARTICIPANT_ID }] });
      }
      if (query.includes('INSERT INTO parents_guardians')) {
        guardianInserted = true;
        return Promise.resolve({
          rows: [{ id: GUARDIAN_ID }]
        });
      }
      if (query.includes('INSERT INTO participant_guardians')) {
        linkInserted = true;
        return Promise.resolve({ rows: [] });
      }
      if (query === 'COMMIT') {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    __mPool.connect.mockResolvedValue(__mClient);

    const res = await request(app)
      .post('/api/guardians')
      .set('Authorization', `Bearer ${token}`)
      .send({
        participant_id: PARTICIPANT_ID,
        nom: 'Dupont',
        prenom: 'Marie',
        lien: 'parent',
        courriel: 'marie@example.com',
        telephone_cellulaire: '555-4567'
      });

    expect(res.status).toBe(200);
    expect(transactionStarted).toBe(true);
    expect(guardianInserted).toBe(true);
    expect(linkInserted).toBe(true);
    expect(res.body.data.guardian_id).toBe(GUARDIAN_ID);
  });

  test('updates existing guardian when guardian_id provided', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['guardians.manage']
    });

    let updateCalled = false;

    __mClient.query.mockImplementation((query, params) => {
      if (query === 'BEGIN') {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('FROM participants p')) {
        return Promise.resolve({ rows: [{ id: PARTICIPANT_ID }] });
      }
      if (query.includes('FROM participant_guardians pg') && query.includes('WHERE')) {
        return Promise.resolve({ rows: [{ guardian_id: GUARDIAN_ID }] });
      }
      if (query.includes('UPDATE parents_guardians')) {
        updateCalled = true;
        return Promise.resolve({ rows: [] });
      }
      if (query === 'COMMIT') {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    __mPool.connect.mockResolvedValue(__mClient);

    const res = await request(app)
      .post('/api/guardians')
      .set('Authorization', `Bearer ${token}`)
      .send({
        participant_id: PARTICIPANT_ID,
        guardian_id: GUARDIAN_ID,
        nom: 'Dupont',
        prenom: 'Marie',
        courriel: 'marie@newaddress.com'
      });

    expect(res.status).toBe(200);
    expect(updateCalled).toBe(true);
  });

  test('requires guardians.manage permission', async () => {
    const { __mPool } = require('pg');
    const token = generateToken({
      permissions: [] // No permission
    });

    __mPool.query.mockImplementation((query, params) => {
      if (query.includes('FROM role_permissions')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/api/guardians')
      .set('Authorization', `Bearer ${token}`)
      .send({
        participant_id: PARTICIPANT_ID,
        nom: 'Dupont',
        prenom: 'Jean'
      });

    expect(res.status).toBe(403);
  });

  test('requires participant_id', async () => {
    const { __mPool } = require('pg');
    const token = generateToken({
      permissions: ['guardians.manage']
    });

    __mPool.query.mockImplementation((query, params) => {
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/api/guardians')
      .set('Authorization', `Bearer ${token}`)
      .send({
        // Missing participant_id
        nom: 'Dupont',
        prenom: 'Jean'
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/required/i);
  });

  test('requires nom and prenom', async () => {
    const { __mPool } = require('pg');
    const token = generateToken({
      permissions: ['guardians.manage']
    });

    __mPool.query.mockImplementation((query, params) => {
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/api/guardians')
      .set('Authorization', `Bearer ${token}`)
      .send({
        participant_id: PARTICIPANT_ID,
        nom: 'Dupont'
        // Missing prenom
      });

    expect(res.status).toBe(400);
  });

  test('returns 404 when participant not found', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['guardians.manage']
    });

    __mClient.query.mockImplementation((query, params) => {
      if (query === 'BEGIN') {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('FROM participants p')) {
        return Promise.resolve({ rows: [] }); // Not found
      }
      if (query === 'ROLLBACK') {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    __mPool.connect.mockResolvedValue(__mClient);

    const res = await request(app)
      .post('/api/guardians')
      .set('Authorization', `Bearer ${token}`)
      .send({
        participant_id: 999,
        nom: 'Dupont',
        prenom: 'Jean'
      });

    expect(res.status).toBe(404);
  });

  test('returns 403 when guardian not found in organization', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['guardians.manage']
    });

    __mClient.query.mockImplementation((query, params) => {
      if (query === 'BEGIN') {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('FROM participants p') && query.includes('WHERE')) {
        return Promise.resolve({ rows: [{ id: PARTICIPANT_ID }] });
      }
      if (query.includes('FROM participant_guardians pg') && query.includes('WHERE')) {
        return Promise.resolve({ rows: [] }); // Guardian not found in org
      }
      if (query === 'ROLLBACK') {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    __mPool.connect.mockResolvedValue(__mClient);

    const res = await request(app)
      .post('/api/guardians')
      .set('Authorization', `Bearer ${token}`)
      .send({
        participant_id: PARTICIPANT_ID,
        guardian_id: 999, // Different org's guardian
        nom: 'Dupont',
        prenom: 'Jean'
      });

    expect(res.status).toBe(403);
  });

  test('rolls back transaction on error', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['guardians.manage']
    });

    let rollbackCalled = false;

    __mClient.query.mockImplementation((query, params) => {
      if (query === 'BEGIN') {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('FROM participants p')) {
        return Promise.resolve({ rows: [{ id: PARTICIPANT_ID }] });
      }
      if (query.includes('INSERT INTO parents_guardians')) {
        // Simulate database error
        return Promise.reject(new Error('Database error'));
      }
      if (query === 'ROLLBACK') {
        rollbackCalled = true;
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    __mPool.connect.mockResolvedValue(__mClient);

    const res = await request(app)
      .post('/api/guardians')
      .set('Authorization', `Bearer ${token}`)
      .send({
        participant_id: PARTICIPANT_ID,
        nom: 'Dupont',
        prenom: 'Jean'
      });

    expect(res.status).toBe(500);
    expect(rollbackCalled).toBe(true);
  });

  test('sets is_primary and is_emergency_contact flags', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['guardians.manage']
    });

    let insertedValues = null;

    __mClient.query.mockImplementation((query, params) => {
      if (query === 'BEGIN') {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('FROM participants p')) {
        return Promise.resolve({ rows: [{ id: PARTICIPANT_ID }] });
      }
      if (query.includes('INSERT INTO parents_guardians')) {
        insertedValues = params;
        return Promise.resolve({ rows: [{ id: GUARDIAN_ID }] });
      }
      if (query.includes('INSERT INTO participant_guardians')) {
        return Promise.resolve({ rows: [] });
      }
      if (query === 'COMMIT') {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    __mPool.connect.mockResolvedValue(__mClient);

    const res = await request(app)
      .post('/api/guardians')
      .set('Authorization', `Bearer ${token}`)
      .send({
        participant_id: PARTICIPANT_ID,
        nom: 'Dupont',
        prenom: 'Jean',
        is_primary: true,
        is_emergency_contact: true
      });

    expect(res.status).toBe(200);
    expect(insertedValues).toContain(true); // is_primary should be in params
  });
});

// ============================================
// DELETE /api/guardians - REMOVE GUARDIAN
// ============================================

describe('DELETE /api/guardians', () => {
  test('removes guardian link', async () => {
    const { __mPool } = require('pg');
    const token = generateToken({
      permissions: ['guardians.manage']
    });

    let deleteCalled = false;

    __mPool.query.mockImplementation((query, params) => {
      if (query.includes('FROM participant_guardians pg')) {
        return Promise.resolve({
          rows: [{ guardian_id: GUARDIAN_ID }]
        });
      }
      if (query.includes('DELETE FROM participant_guardians')) {
        deleteCalled = true;
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .delete('/api/guardians')
      .query({ participant_id: PARTICIPANT_ID, guardian_id: GUARDIAN_ID })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(deleteCalled).toBe(true);
  });

  test('requires guardians.manage permission', async () => {
    const { __mPool } = require('pg');
    const token = generateToken({
      permissions: [] // No permission
    });

    __mPool.query.mockImplementation((query, params) => {
      if (query.includes('FROM role_permissions')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .delete('/api/guardians')
      .query({ participant_id: PARTICIPANT_ID, guardian_id: GUARDIAN_ID })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  test('requires both participant_id and guardian_id', async () => {
    const { __mPool } = require('pg');
    const token = generateToken({
      permissions: ['guardians.manage']
    });

    __mPool.query.mockImplementation((query, params) => {
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .delete('/api/guardians')
      .query({ participant_id: PARTICIPANT_ID })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/required/i);
  });

  test('returns 404 when guardian link not found', async () => {
    const { __mPool } = require('pg');
    const token = generateToken({
      permissions: ['guardians.manage']
    });

    __mPool.query.mockImplementation((query, params) => {
      if (query.includes('FROM participant_guardians pg')) {
        return Promise.resolve({ rows: [] }); // Link not found
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .delete('/api/guardians')
      .query({ participant_id: PARTICIPANT_ID, guardian_id: 999 })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  test('enforces organization isolation on delete', async () => {
    const { __mPool } = require('pg');
    const token = generateToken({
      organizationId: ORG_ID,
      permissions: ['guardians.manage']
    });

    let queriedOrgId = null;

    __mPool.query.mockImplementation((query, params) => {
      if (query.includes('FROM participant_guardians pg')) {
        // Capture the organization_id being checked
        const queryStr = JSON.stringify(query);
        // Extract org_id from query if it's in WHERE clause
        queriedOrgId = params[params.length - 1];
        return Promise.resolve({ rows: [] }); // Not found in user's org
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .delete('/api/guardians')
      .query({ participant_id: PARTICIPANT_ID, guardian_id: GUARDIAN_ID })
      .set('Authorization', `Bearer ${token}`);

    expect(queriedOrgId).toBe(ORG_ID);
    expect(res.status).toBe(404);
  });

  test('returns 401 without authentication', async () => {
    const res = await request(app)
      .delete('/api/guardians')
      .query({ participant_id: PARTICIPANT_ID, guardian_id: GUARDIAN_ID });

    expect(res.status).toBe(401);
  });
});

// ============================================
// AUTHORIZATION & PERMISSION TESTS
// ============================================

describe('Guardian Permission Enforcement', () => {
  test('different users in same org can read guardians', async () => {
    const { __mPool } = require('pg');
    const token1 = generateToken({
      user_id: 1,
      permissions: ['guardians.view']
    });
    const token2 = generateToken({
      user_id: 2,
      permissions: ['guardians.view']
    });

    __mPool.query.mockImplementation((query, params) => {
      if (query.includes('FROM participants p')) {
        return Promise.resolve({ rows: [{ id: PARTICIPANT_ID }] });
      }
      if (query.includes('FROM participant_guardians pg')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res1 = await request(app)
      .get('/api/guardians')
      .query({ participant_id: PARTICIPANT_ID })
      .set('Authorization', `Bearer ${token1}`);

    const res2 = await request(app)
      .get('/api/guardians')
      .query({ participant_id: PARTICIPANT_ID })
      .set('Authorization', `Bearer ${token2}`);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
  });

  test('user without permission cannot read guardians even if authenticated', async () => {
    const { __mPool } = require('pg');
    const token = generateToken({
      permissions: ['participants.view'] // Different permission
    });

    __mPool.query.mockImplementation((query, params) => {
      if (query.includes('FROM role_permissions')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .get('/api/guardians')
      .query({ participant_id: PARTICIPANT_ID })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  test('cannot use manipulated token to access other org', async () => {
    const { __mPool } = require('pg');
    const maliciousToken = generateToken({
      organizationId: 999, // Try different org
      permissions: ['guardians.view']
    });

    let queriedOrgId = null;

    __mPool.query.mockImplementation((query, params) => {
      if (query.includes('FROM participants p')) {
        queriedOrgId = params[params.length - 1]; // Last param is org_id
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .get('/api/guardians')
      .query({ participant_id: PARTICIPANT_ID })
      .set('Authorization', `Bearer ${maliciousToken}`);

    // Critical: Should query with token's org (999), not URL
    expect(queriedOrgId).toBe(999);
  });
});

// ============================================
// MULTI-TENANT ISOLATION TESTS
// ============================================

describe('Guardian Multi-Tenant Isolation', () => {
  test('guardians from org1 not visible to org2 users', async () => {
    const { __mPool } = require('pg');
    const org1Token = generateToken({
      organizationId: 1,
      permissions: ['guardians.view']
    });
    const org2Token = generateToken({
      organizationId: 2,
      permissions: ['guardians.view']
    });

    let lastQueryOrgId = null;

    __mPool.query.mockImplementation((query, params) => {
      if (query.includes('FROM participants p')) {
        lastQueryOrgId = params[params.length - 1];
        return Promise.resolve({ rows: [] }); // Org2 doesn't have this participant
      }
      if (query.includes('FROM participant_guardians pg')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res1 = await request(app)
      .get('/api/guardians')
      .query({ participant_id: PARTICIPANT_ID })
      .set('Authorization', `Bearer ${org1Token}`);

    expect(lastQueryOrgId).toBe(1);

    const res2 = await request(app)
      .get('/api/guardians')
      .query({ participant_id: PARTICIPANT_ID })
      .set('Authorization', `Bearer ${org2Token}`);

    expect(lastQueryOrgId).toBe(2);
  });
});
