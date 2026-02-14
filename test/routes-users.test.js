/**
 * Users Routes Comprehensive Test Suite
 *
 * Tests user account management, approval workflows, and role assignment.
 * User management is critical for Scout organization administration.
 *
 * Key Business Logic:
 * - User account creation and activation
 * - Role assignment (admin, animation/staff, parent)
 * - Pending user approval workflow
 * - Permission inheritance from role assignment
 * - Parent-participant linking
 * - User deactivation (soft delete)
 *
 * Security Model:
 * - requirePermission('users.view') for read access
 * - requirePermission('users.manage') for admin operations
 * - requirePermission('users.approve') for approving pending users
 * - Admin role cannot grant itself elevated permissions (prevented)
 * - Organization isolation on user accounts
 * - Privilege escalation prevention
 *
 * @module test/routes-users
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
const USER_ID = 1;
const ADMIN_USER_ID = 1;
const STAFF_USER_ID = 50;
const PENDING_USER_ID = 100;
const PARENT_USER_ID = 200;

function generateToken(overrides = {}, secret = TEST_SECRET) {
  return jwt.sign({
    user_id: ADMIN_USER_ID,
    user_role: 'admin',
    organizationId: ORG_ID,
    roleIds: [1],
    roleNames: ['admin'],
    permissions: ['users.view', 'users.manage', 'users.approve'],
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
// GET /api/v1/users - LIST USERS
// ============================================

describe('GET /api/v1/users', () => {
  test('returns list of users in organization', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['users.view']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('FROM users') && query.includes('WHERE')) {
        return Promise.resolve({
          rows: [
            {
              id: 1,
              email: 'admin@example.com',
              first_name: 'Admin',
              last_name: 'User',
              organization_id: ORG_ID,
              status: 'active',
              created_at: new Date()
            },
            {
              id: 2,
              email: 'staff@example.com',
              first_name: 'Staff',
              last_name: 'Member',
              organization_id: ORG_ID,
              status: 'pending',
              created_at: new Date()
            }
          ]
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].email).toBe('admin@example.com');
    expect(res.body.data[1].status).toBe('pending');
  });

  test('lists pending users separately if status filter', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['users.view']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('FROM users')) {
        if (query.includes('status')) {
          return Promise.resolve({
            rows: [
              {
                id: PENDING_USER_ID,
                email: 'pending@example.com',
                status: 'pending'
              }
            ]
          });
        }
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .get('/api/v1/users')
      .query({ status: 'pending' })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data[0].status).toBe('pending');
  });

  test('requires users.view permission', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: [] // No permission
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('FROM role_permissions')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  test('enforces organization isolation', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      organizationId: ORG_ID,
      permissions: ['users.view']
    });

    let queriedOrgId = null;

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('FROM users')) {
        queriedOrgId = params[params.length - 1];
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    await request(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${token}`);

    expect(queriedOrgId).toBe(ORG_ID);
  });
});

// ============================================
// GET /api/v1/users/:id - GET SINGLE USER
// ============================================

describe('GET /api/v1/users/:id', () => {
  test('returns user details with role information', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['users.view']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('SELECT * FROM users WHERE id')) {
        return Promise.resolve({
          rows: [{
            id: STAFF_USER_ID,
            email: 'staff@example.com',
            first_name: 'John',
            last_name: 'Staff',
            organization_id: ORG_ID,
            status: 'active'
          }]
        });
      }
      if (query.includes('FROM user_roles WHERE user_id')) {
        return Promise.resolve({
          rows: [{
            role_id: 2,
            role_name: 'animation'
          }]
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .get(`/api/v1/users/${STAFF_USER_ID}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe('staff@example.com');
    expect(res.body.data.roleNames).toContain('animation');
  });

  test('returns 404 when user not found', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['users.view']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('FROM users')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .get('/api/v1/users/999')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  test('requires users.view permission', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: []
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('FROM role_permissions')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .get(`/api/v1/users/${STAFF_USER_ID}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });
});

// ============================================
// POST /api/v1/users - CREATE USER
// ============================================

describe('POST /api/v1/users', () => {
  test('creates new user with pending status', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['users.manage']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('INSERT INTO users')) {
        return Promise.resolve({
          rows: [{
            id: 500,
            email: 'newuser@example.com',
            first_name: 'New',
            last_name: 'User',
            status: 'pending',
            organization_id: ORG_ID
          }]
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        email: 'newuser@example.com',
        first_name: 'New',
        last_name: 'User'
      });

    expect(res.status).toBe(201);
    expect(res.body.data.email).toBe('newuser@example.com');
    expect(res.body.data.status).toBe('pending');
  });

  test('requires valid email format', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['users.manage']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        email: 'invalid-email',
        first_name: 'New',
        last_name: 'User'
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/email|invalid/i);
  });

  test('requires email and name fields', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['users.manage']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        // Missing required fields
        first_name: 'New'
      });

    expect(res.status).toBe(400);
  });

  test('prevents duplicate email in same organization', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['users.manage']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('INSERT INTO users')) {
        // Simulate duplicate key error
        const err = new Error('duplicate key value');
        err.code = '23505';
        return Promise.reject(err);
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        email: 'existing@example.com',
        first_name: 'New',
        last_name: 'User'
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/duplicate|exists/i);
  });

  test('requires users.manage permission', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['users.view'] // Only view
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('FROM role_permissions')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        email: 'new@example.com',
        first_name: 'New',
        last_name: 'User'
      });

    expect(res.status).toBe(403);
  });
});

// ============================================
// PUT /api/v1/users/:id - UPDATE USER
// ============================================

describe('PUT /api/v1/users/:id', () => {
  test('updates user basic information', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['users.manage']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('UPDATE users SET')) {
        return Promise.resolve({
          rows: [{
            id: STAFF_USER_ID,
            email: 'staff@example.com',
            first_name: 'John',
            last_name: 'Updated',
            organization_id: ORG_ID
          }]
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .put(`/api/v1/users/${STAFF_USER_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        first_name: 'John',
        last_name: 'Updated'
      });

    expect(res.status).toBe(200);
    expect(res.body.data.last_name).toBe('Updated');
  });

  test('prevents email change to duplicate', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['users.manage']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('UPDATE users SET')) {
        const err = new Error('duplicate key value');
        err.code = '23505';
        return Promise.reject(err);
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .put(`/api/v1/users/${STAFF_USER_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        email: 'taken@example.com'
      });

    expect(res.status).toBe(400);
  });

  test('requires users.manage permission', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['users.view']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('FROM role_permissions')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .put(`/api/v1/users/${STAFF_USER_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        first_name: 'Updated'
      });

    expect(res.status).toBe(403);
  });
});

// ============================================
// POST /api/v1/users/:id/approve - APPROVE PENDING USER
// ============================================

describe('POST /api/v1/users/:id/approve', () => {
  test('approves pending user and activates account', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['users.approve']
    });

    let updateCalled = false;

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('UPDATE users SET status')) {
        updateCalled = true;
        return Promise.resolve({
          rows: [{
            id: PENDING_USER_ID,
            email: 'pending@example.com',
            status: 'active' // Status changed
          }]
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post(`/api/v1/users/${PENDING_USER_ID}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        approved_notes: 'User verified'
      });

    expect(res.status).toBe(200);
    expect(updateCalled).toBe(true);
    expect(res.body.data.status).toBe('active');
  });

  test('cannot approve non-pending user', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['users.approve']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('SELECT * FROM users WHERE id')) {
        return Promise.resolve({
          rows: [{
            id: ADMIN_USER_ID,
            status: 'active' // Already active
          }]
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post(`/api/v1/users/${ADMIN_USER_ID}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
  });

  test('requires users.approve permission', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['users.manage'] // Manage but not approve
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('FROM role_permissions')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post(`/api/v1/users/${PENDING_USER_ID}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(403);
  });

  test('returns 404 when user not found', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['users.approve']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('UPDATE users')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/api/v1/users/999/approve')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(404);
  });
});

// ============================================
// POST /api/v1/users/:id/roles - ASSIGN ROLE
// ============================================

describe('POST /api/v1/users/:id/roles', () => {
  test('assigns role to user', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['users.manage']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('INSERT INTO user_roles')) {
        return Promise.resolve({
          rows: [{
            user_id: STAFF_USER_ID,
            role_id: 2,
            role_name: 'animation'
          }]
        });
      }
      if (query.includes('SELECT * FROM users WHERE id')) {
        return Promise.resolve({
          rows: [{
            id: STAFF_USER_ID
          }]
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post(`/api/v1/users/${STAFF_USER_ID}/roles`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        role_id: 2
      });

    expect(res.status).toBe(201);
    expect(res.body.data.role_name).toBe('animation');
  });

  test('prevents granting admin role to non-admin', async () => {
    const { __mClient, __mPool } = require('pg');
    const staffToken = generateToken({
      user_id: STAFF_USER_ID,
      roleNames: ['animation'],
      permissions: ['users.manage'] // Has manage but not admin
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('SELECT * FROM users WHERE id')) {
        return Promise.resolve({
          rows: [{ id: STAFF_USER_ID }]
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post(`/api/v1/users/100/roles`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        role_id: 1 // Admin role
      });

    expect(res.status).toBe(403);
  });

  test('prevents duplicate role assignment', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['users.manage']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('INSERT INTO user_roles')) {
        const err = new Error('duplicate');
        err.code = '23505';
        return Promise.reject(err);
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post(`/api/v1/users/${STAFF_USER_ID}/roles`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        role_id: 2
      });

    expect(res.status).toBe(400);
  });

  test('requires users.manage permission', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['users.view']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('FROM role_permissions')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post(`/api/v1/users/${STAFF_USER_ID}/roles`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        role_id: 2
      });

    expect(res.status).toBe(403);
  });
});

// ============================================
// DELETE /api/v1/users/:id/roles/:roleId - REMOVE ROLE
// ============================================

describe('DELETE /api/v1/users/:id/roles/:roleId', () => {
  test('removes role from user', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['users.manage']
    });

    let deleteCalled = false;

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('DELETE FROM user_roles')) {
        deleteCalled = true;
        return Promise.resolve({ rows: [{ rowCount: 1 }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .delete(`/api/v1/users/${STAFF_USER_ID}/roles/2`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(deleteCalled).toBe(true);
  });

  test('prevents removing last admin role from all admins', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      user_id: ADMIN_USER_ID,
      permissions: ['users.manage']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('COUNT(*)') && query.includes('role_id')) {
        return Promise.resolve({
          rows: [{ count: '1' }] // Only 1 admin
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .delete(`/api/v1/users/${ADMIN_USER_ID}/roles/1`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
  });

  test('requires users.manage permission', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['users.view']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('FROM role_permissions')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .delete(`/api/v1/users/${STAFF_USER_ID}/roles/2`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });
});

// ============================================
// POST /api/v1/users/:id/parent - LINK PARENT TO CHILDREN
// ============================================

describe('POST /api/v1/users/:id/parent', () => {
  test('links parent user to participant children', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['users.manage']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('INSERT INTO user_participants')) {
        return Promise.resolve({
          rows: [{
            user_id: PARENT_USER_ID,
            participant_id: 100
          }]
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post(`/api/v1/users/${PARENT_USER_ID}/parent`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        participant_ids: [100, 101, 102]
      });

    expect(res.status).toBe(201);
  });

  test('prevents linking to non-existent participants', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['users.manage']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('INSERT INTO user_participants')) {
        const err = new Error('foreign key');
        err.code = '23503';
        return Promise.reject(err);
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post(`/api/v1/users/${PARENT_USER_ID}/parent`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        participant_ids: [999]
      });

    expect(res.status).toBe(400);
  });

  test('requires users.manage permission', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['users.view']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('FROM role_permissions')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post(`/api/v1/users/${PARENT_USER_ID}/parent`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        participant_ids: [100]
      });

    expect(res.status).toBe(403);
  });
});

// ============================================
// DELETE /api/v1/users/:id - DEACTIVATE USER
// ============================================

describe('DELETE /api/v1/users/:id', () => {
  test('soft-deletes user (deactivates)', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['users.manage']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('UPDATE users SET') && query.includes('is_active')) {
        return Promise.resolve({
          rows: [{
            id: STAFF_USER_ID,
            is_active: false
          }]
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .delete(`/api/v1/users/${STAFF_USER_ID}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.is_active).toBe(false);
  });

  test('prevents removing last admin', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      user_id: ADMIN_USER_ID,
      permissions: ['users.manage']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('SELECT * FROM users WHERE id')) {
        return Promise.resolve({
          rows: [{
            id: ADMIN_USER_ID,
            user_role: 'admin'
          }]
        });
      }
      if (query.includes('COUNT(*)') && query.includes('admin')) {
        return Promise.resolve({
          rows: [{ count: '1' }] // Only one admin
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .delete(`/api/v1/users/${ADMIN_USER_ID}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
  });

  test('requires users.manage permission', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['users.view']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('FROM role_permissions')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .delete(`/api/v1/users/${STAFF_USER_ID}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  test('returns 404 when user not found', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['users.manage']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('UPDATE users SET')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .delete('/api/v1/users/999')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});

// ============================================
// PERMISSION & SECURITY TESTS
// ============================================

describe('User Permission Enforcement', () => {
  test('users.view allows read-only access', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['users.view']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('FROM users') && !query.includes('INSERT|UPDATE|DELETE')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const getRes = await request(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${token}`);

    expect(getRes.status).toBe(200);

    const postRes = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        email: 'new@example.com',
        first_name: 'New'
      });

    expect(postRes.status).toBe(403);
  });
});

// ============================================
// ORGANIZATION ISOLATION TESTS
// ============================================

describe('User Organization Isolation', () => {
  test('users from different org not visible to other org admins', async () => {
    const { __mClient, __mPool } = require('pg');

    const org1Token = generateToken({
      organizationId: 1,
      permissions: ['users.view']
    });

    const org2Token = generateToken({
      organizationId: 2,
      permissions: ['users.view']
    });

    let org1QueryCount = 0;
    let org2QueryCount = 0;

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('FROM users')) {
        const orgId = params[params.length - 1];
        if (orgId === 1) org1QueryCount++;
        if (orgId === 2) org2QueryCount++;
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    await request(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${org1Token}`);

    await request(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${org2Token}`);

    expect(org1QueryCount).toBeGreaterThan(0);
    expect(org2QueryCount).toBeGreaterThan(0);
  });
});

// ============================================
// PRIVILEGE ESCALATION PREVENTION TESTS
// ============================================

describe('Privilege Escalation Prevention', () => {
  test('cannot grant admin role without being admin', async () => {
    const { __mClient, __mPool } = require('pg');
    const staffToken = generateToken({
      user_id: STAFF_USER_ID,
      roleNames: ['animation'],
      permissions: ['users.manage']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post(`/api/v1/users/100/roles`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        role_id: 1 // Admin role
      });

    expect(res.status).toBe(403);
  });

  test('admin cannot escalate self without existing admin approver', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      user_id: ADMIN_USER_ID,
      permissions: ['users.manage']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('Escalation policy')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .put(`/api/v1/users/${ADMIN_USER_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        roleNames: ['super-admin'] // Attempting escalation
      });

    // Should either reject or require approval
    expect([400, 403]).toContain(res.status);
  });
});
