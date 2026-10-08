/**
 * Activities Routes Comprehensive Test Suite
 *
 * Comprehensive endpoint coverage for all activity CRUD operations.
 * Current tests only cover: GET / and GET /calendar.ics
 * This suite expands to include: GET /:id, POST /, PUT /:id, DELETE /:id
 *
 * Endpoint Coverage:
 * - GET /api/v1/activities - List all activities
 * - GET /api/v1/activities/:id - Get specific activity
 * - POST /api/v1/activities - Create activity
 * - PUT /api/v1/activities/:id - Update activity
 * - DELETE /api/v1/activities/:id - Soft-delete activity
 * - GET /api/v1/activities/calendar.ics - Download calendar
 *
 * Security Focus:
 * - requirePermission('activities.view') for reads
 * - requirePermission('activities.create') for POST
 * - requirePermission('activities.edit') for PUT
 * - requirePermission('activities.delete') for DELETE
 * - blockDemoRoles prevents demo users from creating/editing/deleting
 * - Organization isolation ensures cross-org data isn't accessible
 *
 * Business Logic Validation:
 * - Time validation: departure > meeting time
 * - Required fields enforcement
 * - Carpool cascade deletion on activity delete
 * - Permission slip cascade on activity delete
 *
 * @module test/routes-activities-comprehensive
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
const ORG_ID = 3; // Demo organization - safe for live testing
const ACTIVITY_ID = 100;
const USER_ID = 1;

function generateToken(overrides = {}, secret = TEST_SECRET) {
  return jwt.sign({
    user_id: USER_ID,
    user_role: 'district',
    organizationId: ORG_ID,
    roleIds: [1],
    roleNames: ['admin'],
    permissions: ['activities.view', 'activities.create', 'activities.edit', 'activities.delete'],
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
// GET /api/v1/activities/:id - GET SPECIFIC ACTIVITY
// ============================================

describe('GET /api/v1/activities/:id', () => {
  test('returns specific activity by ID', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['activities.view']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('WHERE a.id') && query.includes('AND a.organization_id')) {
        return Promise.resolve({
          rows: [{
            id: ACTIVITY_ID,
            name: 'Scout Camp',
            description: 'Summer camp activity',
            organization_id: ORG_ID,
            created_by: USER_ID,
            created_by_name: 'Admin User',
            created_by_email: 'admin@example.com',
            activity_date: '2026-06-15',
            activity_start_date: '2026-06-15',
            activity_start_time: '09:00',
            activity_end_date: '2026-06-15',
            activity_end_time: '17:00',
            meeting_location_going: 'Scout Hall',
            meeting_time_going: '08:30',
            departure_time_going: '09:00',
            meeting_location_return: 'Scout Hall',
            meeting_time_return: '16:30',
            departure_time_return: '17:00',
            is_active: true
          }]
        });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .get(`/api/v1/activities/${ACTIVITY_ID}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(ACTIVITY_ID);
    expect(res.body.data.name).toBe('Scout Camp');
    expect(res.body.data.created_by_name).toBe('Admin User');
  });

  test('returns 404 when activity not found', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['activities.view']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('WHERE a.id')) {
        return Promise.resolve({ rows: [] }); // Not found
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .get('/api/v1/activities/999')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  test('requires activities.view permission', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: [] // No permission
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      // Mock permission query to return no permissions
      if (query.includes('permission_key') && query.includes('user_organizations')) {
        return Promise.resolve({ rows: [] });
      }
      // Return undefined to fall back to default mocks for other queries
      return undefined;
    });

    const res = await request(app)
      .get(`/api/v1/activities/${ACTIVITY_ID}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  test('returns 404 for activity in different organization', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      organizationId: ORG_ID,
      permissions: ['activities.view']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('WHERE a.id')) {
        // Not found because belongs to different org
        return Promise.resolve({ rows: [] });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .get(`/api/v1/activities/${ACTIVITY_ID}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  test('returns 401 without authentication', async () => {
    const res = await request(app)
      .get(`/api/v1/activities/${ACTIVITY_ID}`);

    expect(res.status).toBe(401);
  });

  test('returns activity with all carpool and permission slip counts', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['activities.view']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('WHERE a.id')) {
        return Promise.resolve({
          rows: [{
            id: ACTIVITY_ID,
            name: 'Activity with carpools',
            organization_id: ORG_ID,
            created_by: USER_ID,
            carpool_offer_count: 3,
            assigned_participant_count: 8,
            pending_slip_count: 2,
            signed_slip_count: 5
          }]
        });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .get(`/api/v1/activities/${ACTIVITY_ID}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.carpool_offer_count).toBe(3);
    expect(res.body.data.assigned_participant_count).toBe(8);
    expect(res.body.data.pending_slip_count).toBe(2);
    expect(res.body.data.signed_slip_count).toBe(5);
  });

  test('includes created_by user info', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['activities.view']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('WHERE a.id')) {
        return Promise.resolve({
          rows: [{
            id: ACTIVITY_ID,
            name: 'Activity',
            organization_id: ORG_ID,
            created_by: 5,
            created_by_name: 'John Smith',
            created_by_email: 'john@example.com'
          }]
        });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .get(`/api/v1/activities/${ACTIVITY_ID}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.created_by_name).toBe('John Smith');
    expect(res.body.data.created_by_email).toBe('john@example.com');
  });
});

// ============================================
// POST /api/v1/activities - CREATE ACTIVITY
// ============================================

describe('POST /api/v1/activities', () => {
  test('creates activity with all required fields', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['activities.create']
    });

    let insertQuery = '';

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('INSERT INTO activities')) {
        insertQuery = query;
        return Promise.resolve({
          rows: [{
            id: 200,
            name: 'New Activity',
            organization_id: ORG_ID,
            created_by: USER_ID,
            is_active: true
          }]
        });
      }
      if (query.includes('FROM role_permissions')) {
        return Promise.resolve({
          rows: [{ permission_key: 'activities.create' }]
        });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .post('/api/v1/activities')
      .set('Authorization', `Bearer ${token}`)
      .send({
        activity_name: 'New Activity',
        description: 'Test activity',
        activity_start_date: '2026-06-15',
        activity_end_date: '2026-06-15',
        meeting_location_going: 'Scout Hall',
        meeting_time_going: '08:30',
        departure_time_going: '09:00'
      });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('New Activity');
    expect(insertQuery).toContain('INSERT INTO activities');
  });

  test('validates departure_time > meeting_time', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['activities.create']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .post('/api/v1/activities')
      .set('Authorization', `Bearer ${token}`)
      .send({
        activity_name: 'Activity',
        activity_start_date: '2026-06-15',
        activity_end_date: '2026-06-15',
        meeting_location_going: 'Scout Hall',
        meeting_time_going: '09:00',
        departure_time_going: '09:00' // Invalid: not > meeting time
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/departure.*after|must be after/i);
  });

  test('validates return departure_time > return meeting_time if provided', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['activities.create']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .post('/api/v1/activities')
      .set('Authorization', `Bearer ${token}`)
      .send({
        activity_name: 'Activity',
        activity_start_date: '2026-06-15',
        activity_end_date: '2026-06-15',
        meeting_location_going: 'Scout Hall',
        meeting_time_going: '08:30',
        departure_time_going: '09:00',
        meeting_time_return: '16:30',
        departure_time_return: '16:30' // Invalid
      });

    expect(res.status).toBe(400);
  });

  test('requires activities.create permission', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: [] // No permission
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      // Mock permission query to return no permissions
      if (query.includes('permission_key') && query.includes('user_organizations')) {
        return Promise.resolve({ rows: [] });
      }
      // Return undefined to fall back to default mocks for other queries
      return undefined;
    });

    const res = await request(app)
      .post('/api/v1/activities')
      .set('Authorization', `Bearer ${token}`)
      .send({
        activity_name: 'Activity',
        activity_start_date: '2026-06-15',
        activity_end_date: '2026-06-15',
        meeting_location_going: 'Scout Hall',
        meeting_time_going: '08:30',
        departure_time_going: '09:00'
      });

    expect(res.status).toBe(403);
  });

  test('blocks demo users from creating activities', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      roleNames: ['demoadmin'], // Demo role
      permissions: ['activities.create']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      // Mock demo role check to return demo role
      if (query.includes("role_name IN ('demoadmin', 'demoparent')")) {
        return Promise.resolve({
          rows: [{ role_name: 'demoadmin' }]
        });
      }
      // Return undefined to fall back to default mocks for other queries
      return undefined;
    });

    const res = await request(app)
      .post('/api/v1/activities')
      .set('Authorization', `Bearer ${token}`)
      .send({
        activity_name: 'Activity',
        activity_start_date: '2026-06-15',
        activity_end_date: '2026-06-15',
        meeting_location_going: 'Scout Hall',
        meeting_time_going: '08:30',
        departure_time_going: '09:00'
      });

    expect(res.status).toBe(403);
  });

  test('requires all required fields', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['activities.create']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .post('/api/v1/activities')
      .set('Authorization', `Bearer ${token}`)
      .send({
        // Missing: activity_name, activity_start_date, meeting_location_going, meeting_time_going, departure_time_going
        description: 'Missing required fields'
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/required|missing/i);
  });

  test('accepts both activity_name (new) and name (legacy) field names', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['activities.create']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('INSERT INTO activities')) {
        return Promise.resolve({
          rows: [{
            id: 200,
            name: 'Legacy Name Activity'
          }]
        });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .post('/api/v1/activities')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Legacy Name Activity', // Old field name
        activity_start_date: '2026-06-15',
        activity_end_date: '2026-06-15',
        meeting_location_going: 'Scout Hall',
        meeting_time_going: '08:30',
        departure_time_going: '09:00'
      });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Legacy Name Activity');
  });
});

// ============================================
// PUT /api/v1/activities/:id - UPDATE ACTIVITY
// ============================================

describe('PUT /api/v1/activities/:id', () => {
  const EXISTING_ACTIVITY = {
    name: 'Canoe outing',
    description: 'Paddling on the lake',
    authorization_text: 'I authorize my child to go canoeing.',
    is_active: true,
    activity_date: '2026-06-13',
    activity_start_date: '2026-06-13',
    activity_start_time: '09:00:00',
    activity_end_date: '2026-06-13',
    activity_end_time: '16:00:00',
    meeting_location_going: 'Scout hall',
    meeting_time_going: '08:30:00',
    departure_time_going: '08:45:00',
    meeting_location_return: 'Lake parking',
    meeting_time_return: '15:30:00',
    departure_time_return: '15:45:00'
  };

  /**
   * Mock the update transaction and record the statements it runs.
   * @param {Object|null} existing - Row the locked SELECT returns (null for none)
   * @param {number} pendingSlips - Rows the permission slip refresh touches
   * @returns {Object} Captured statements
   */
  function mockUpdateTransaction(existing = EXISTING_ACTIVITY, pendingSlips = 0) {
    const { __mClient, __mPool } = require('pg');
    const captured = { statements: [], activityUpdate: null, slipUpdate: null };

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (typeof query !== 'string') {
        return undefined;
      }
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(query)) {
        captured.statements.push(query);
        return { rows: [] };
      }
      if (query.includes('FROM activities') && query.includes('FOR UPDATE')) {
        return { rows: existing ? [{ ...existing }] : [] };
      }
      if (query.includes('UPDATE activities')) {
        captured.activityUpdate = params;
        return { rows: [{ id: ACTIVITY_ID, organization_id: ORG_ID, name: params[0], is_active: params[14] === 'f' ? false : params[14] }] };
      }
      if (query.includes('UPDATE permission_slips')) {
        captured.slipUpdate = params;
        return { rows: [], rowCount: pendingSlips };
      }
      return undefined;
    });

    return captured;
  }

  test('updates provided fields and clears emptied optional fields', async () => {
    const captured = mockUpdateTransaction(EXISTING_ACTIVITY, 3);
    const token = generateToken({ permissions: ['activities.edit'] });

    const res = await request(app)
      .put(`/api/v1/activities/${ACTIVITY_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        activity_name: 'Canoe and picnic',
        description: '',
        authorization_text: 'I authorize my child to go canoeing and picnic.',
        meeting_location_return: '',
        meeting_time_return: '',
        departure_time_return: ''
      });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Canoe and picnic');
    expect(res.body.data.pending_permission_slips_updated).toBe(3);

    const [name, description, authorizationText] = captured.activityUpdate;
    expect(name).toBe('Canoe and picnic');
    expect(description).toBeNull();
    expect(authorizationText).toBe('I authorize my child to go canoeing and picnic.');
    expect(captured.activityUpdate.slice(11, 14)).toEqual([null, null, null]);
    expect(captured.slipUpdate.slice(0, 3)).toEqual([
      'Canoe and picnic',
      null,
      'I authorize my child to go canoeing and picnic.'
    ]);
    expect(captured.statements).toEqual(['BEGIN', 'COMMIT']);
  });

  test('keeps fields that are not sent', async () => {
    const captured = mockUpdateTransaction();
    const token = generateToken({ permissions: ['activities.edit'] });

    const res = await request(app)
      .put(`/api/v1/activities/${ACTIVITY_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Just Name Changed' });

    expect(res.status).toBe(200);
    expect(captured.activityUpdate.slice(0, 3)).toEqual([
      'Just Name Changed',
      EXISTING_ACTIVITY.description,
      EXISTING_ACTIVITY.authorization_text
    ]);
    expect(captured.activityUpdate[10]).toBe(EXISTING_ACTIVITY.departure_time_going);
  });

  test('moves the legacy activity_date with the start date', async () => {
    const captured = mockUpdateTransaction();
    const token = generateToken({ permissions: ['activities.edit'] });

    const res = await request(app)
      .put(`/api/v1/activities/${ACTIVITY_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ activity_start_date: '2026-06-12', activity_end_date: '2026-06-14' });

    expect(res.status).toBe(200);
    expect(captured.activityUpdate[3]).toBe('2026-06-12');
    expect(captured.slipUpdate[3]).toBe('2026-06-12');
  });

  test('rejects clearing a required field', async () => {
    const captured = mockUpdateTransaction();
    const token = generateToken({ permissions: ['activities.edit'] });

    const res = await request(app)
      .put(`/api/v1/activities/${ACTIVITY_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ meeting_location_going: '  ' });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('meeting_location_going');
    expect(captured.activityUpdate).toBeNull();
    expect(captured.statements).toEqual(['BEGIN', 'ROLLBACK']);
  });

  test('validates the resulting schedule', async () => {
    const captured = mockUpdateTransaction();
    const token = generateToken({ permissions: ['activities.edit'] });

    const res = await request(app)
      .put(`/api/v1/activities/${ACTIVITY_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ departure_time_going: '08:00' });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Departure time must be after meeting time');
    expect(captured.activityUpdate).toBeNull();
  });

  test('rejects an end before the start', async () => {
    mockUpdateTransaction();
    const token = generateToken({ permissions: ['activities.edit'] });

    const res = await request(app)
      .put(`/api/v1/activities/${ACTIVITY_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ activity_end_date: '2026-06-12' });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Activity must end after it starts');
  });

  test('rejects malformed times', async () => {
    mockUpdateTransaction();
    const token = generateToken({ permissions: ['activities.edit'] });

    const res = await request(app)
      .put(`/api/v1/activities/${ACTIVITY_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ meeting_time_going: 'noon' });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('meeting_time_going');
  });

  test.each([
    ['meeting_time_going', '25:00'],
    ['departure_time_going', '08:99'],
    ['activity_end_date', '2026-02-30']
  ])('rejects out-of-range %s (%s) before the database sees it', async (field, value) => {
    const captured = mockUpdateTransaction();
    const token = generateToken({ permissions: ['activities.edit'] });

    const res = await request(app)
      .put(`/api/v1/activities/${ACTIVITY_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ [field]: value });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain(field);
    expect(captured.activityUpdate).toBeNull();
  });

  test('rejects a partially numeric id instead of updating another activity', async () => {
    const captured = mockUpdateTransaction();
    const token = generateToken({ permissions: ['activities.edit'] });

    const res = await request(app)
      .put('/api/v1/activities/1abc')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Wrong target' });

    expect(res.status).toBe(404);
    expect(captured.activityUpdate).toBeNull();
  });

  test('returns 404 when activity not found', async () => {
    const captured = mockUpdateTransaction(null);
    const token = generateToken({ permissions: ['activities.edit'] });

    const res = await request(app)
      .put('/api/v1/activities/999')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Updated Activity' });

    expect(res.status).toBe(404);
    expect(captured.activityUpdate).toBeNull();
  });

  test('requires activities.edit permission', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: [] // No permission
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      // Mock permission query to return no permissions
      if (query.includes('permission_key') && query.includes('user_organizations')) {
        return Promise.resolve({ rows: [] });
      }
      // Return undefined to fall back to default mocks for other queries
      return undefined;
    });

    const res = await request(app)
      .put(`/api/v1/activities/${ACTIVITY_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Updated Activity'
      });

    expect(res.status).toBe(403);
  });

  test('blocks demo users from editing activities', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      roleNames: ['demoadmin'],
      permissions: ['activities.edit']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      // Mock demo role check to return demo role
      if (query.includes("role_name IN ('demoadmin', 'demoparent')")) {
        return Promise.resolve({
          rows: [{ role_name: 'demoadmin' }]
        });
      }
      // Return undefined to fall back to default mocks for other queries
      return undefined;
    });

    const res = await request(app)
      .put(`/api/v1/activities/${ACTIVITY_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Updated Activity'
      });

    expect(res.status).toBe(403);
  });

  test('allows toggling is_active flag for soft delete', async () => {
    const captured = mockUpdateTransaction();
    const token = generateToken({ permissions: ['activities.edit'] });

    const res = await request(app)
      .put(`/api/v1/activities/${ACTIVITY_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ is_active: false });

    expect(res.status).toBe(200);
    expect(captured.activityUpdate[14]).toBe('f');
    expect(res.body.data.is_active).toBe(false);
  });
});

// ============================================
// DELETE /api/v1/activities/:id - DELETE ACTIVITY
// ============================================

describe('DELETE /api/v1/activities/:id', () => {
  test('soft-deletes activity (sets is_active=false)', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['activities.delete']
    });

    let deletedActivity = null;

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('SELECT id FROM activities')) {
        return Promise.resolve({
          rows: [{ id: ACTIVITY_ID }]
        });
      }
      if (query.includes('UPDATE carpool_offers')) {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('UPDATE activities') && query.includes('is_active = FALSE')) {
        deletedActivity = true;
        return Promise.resolve({
          rows: [{
            id: ACTIVITY_ID,
            is_active: false,
            organization_id: ORG_ID
          }]
        });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .delete(`/api/v1/activities/${ACTIVITY_ID}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(deletedActivity).toBe(true);
    expect(res.body.data.is_active).toBe(false);
  });

  test('cancels all active carpool offers when deleting activity', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['activities.delete']
    });

    let carpoolUpdateCalled = false;

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('SELECT id FROM activities')) {
        return Promise.resolve({
          rows: [{ id: ACTIVITY_ID }]
        });
      }
      if (query.includes('UPDATE carpool_offers SET is_active = FALSE')) {
        carpoolUpdateCalled = true;
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('UPDATE activities') && query.includes('is_active = FALSE')) {
        return Promise.resolve({
          rows: [{ id: ACTIVITY_ID, is_active: false }]
        });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .delete(`/api/v1/activities/${ACTIVITY_ID}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(carpoolUpdateCalled).toBe(true);
  });

  test('archives unanswered permission slips when deleting activity', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['activities.delete']
    });

    let slipQuery = null;

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('SELECT id FROM activities')) {
        return Promise.resolve({ rows: [{ id: ACTIVITY_ID }] });
      }
      if (query.includes('UPDATE permission_slips')) {
        slipQuery = query;
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('UPDATE activities') && query.includes('is_active = FALSE')) {
        return Promise.resolve({ rows: [{ id: ACTIVITY_ID, is_active: false }] });
      }
      return undefined;
    });

    const res = await request(app)
      .delete(`/api/v1/activities/${ACTIVITY_ID}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(slipQuery).toContain("status = 'archived'");
    expect(slipQuery).toContain("status = 'pending'");
  });

  test('returns 404 when activity not found', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['activities.delete']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('SELECT id FROM activities')) {
        return Promise.resolve({ rows: [] }); // Not found
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .delete('/api/v1/activities/999')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  test('requires activities.delete permission', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: [] // No permission
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      // Mock permission query to return no permissions
      if (query.includes('permission_key') && query.includes('user_organizations')) {
        return Promise.resolve({ rows: [] });
      }
      // Return undefined to fall back to default mocks for other queries
      return undefined;
    });

    const res = await request(app)
      .delete(`/api/v1/activities/${ACTIVITY_ID}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  test('blocks demo users from deleting activities', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      roleNames: ['demoadmin'],
      permissions: ['activities.delete']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      // Mock demo role check to return demo role
      if (query.includes("role_name IN ('demoadmin', 'demoparent')")) {
        return Promise.resolve({
          rows: [{ role_name: 'demoadmin' }]
        });
      }
      // Return undefined to fall back to default mocks for other queries
      return undefined;
    });

    const res = await request(app)
      .delete(`/api/v1/activities/${ACTIVITY_ID}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  test('returns 404 for activity in different organization', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      organizationId: ORG_ID,
      permissions: ['activities.delete']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('SELECT id FROM activities')) {
        // Not found in user's org
        return Promise.resolve({ rows: [] });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .delete(`/api/v1/activities/${ACTIVITY_ID}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  test('returns 401 without authentication', async () => {
    const res = await request(app)
      .delete(`/api/v1/activities/${ACTIVITY_ID}`);

    expect(res.status).toBe(401);
  });
});

// ============================================
// PERMISSION & SECURITY TESTS
// ============================================

describe('Activity Permission Enforcement', () => {
  test('activities.view allows read only', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['activities.view'] // View only
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      // Mock permission query to return only view permission
      if (query.includes('permission_key') && query.includes('user_organizations')) {
        return Promise.resolve({
          rows: [{ permission_key: 'activities.view' }]
        });
      }
      if (query.includes('WHERE a.id')) {
        return Promise.resolve({
          rows: [{ id: ACTIVITY_ID, name: 'Activity' }]
        });
      }
      // Return undefined to fall back to default mocks for other queries
      return undefined;
    });

    // Read should work
    const getRes = await request(app)
      .get(`/api/v1/activities/${ACTIVITY_ID}`)
      .set('Authorization', `Bearer ${token}`);

    expect(getRes.status).toBe(200);

    // Create should fail
    const postRes = await request(app)
      .post('/api/v1/activities')
      .set('Authorization', `Bearer ${token}`)
      .send({
        activity_name: 'Activity',
        activity_start_date: '2026-06-15',
        activity_end_date: '2026-06-15',
        meeting_location_going: 'Hall',
        meeting_time_going: '08:30',
        departure_time_going: '09:00'
      });

    expect(postRes.status).toBe(403);
  });

  test('different permission levels required for write operations', async () => {
    const { __mClient, __mPool } = require('pg');

    // Test POST with only create permission - should succeed
    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('permission_key') && query.includes('user_organizations')) {
        return Promise.resolve({
          rows: [{ permission_key: 'activities.create' }]
        });
      }
      return undefined;
    });

    const createToken = generateToken({
      permissions: ['activities.create']
    });

    const postRes = await request(app)
      .post('/api/v1/activities')
      .set('Authorization', `Bearer ${createToken}`)
      .send({
        activity_name: 'Activity',
        activity_start_date: '2026-06-15',
        activity_end_date: '2026-06-15',
        meeting_location_going: 'Hall',
        meeting_time_going: '08:30',
        departure_time_going: '09:00'
      });

    expect(postRes.status).toBe(201); // Should succeed with create permission

    // Test PUT without edit permission - should fail
    const putRes = await request(app)
      .put(`/api/v1/activities/${ACTIVITY_ID}`)
      .set('Authorization', `Bearer ${createToken}`) // Still using create token, not edit
      .send({ name: 'Updated' });

    expect(putRes.status).toBe(403); // Should fail without edit permission

    // Test DELETE without delete permission - should fail
    const delRes = await request(app)
      .delete(`/api/v1/activities/${ACTIVITY_ID}`)
      .set('Authorization', `Bearer ${createToken}`); // Still using create token, not delete

    expect(delRes.status).toBe(403); // Should fail without delete permission
  });
});

// ============================================
// ORGANIZATION ISOLATION TESTS
// ============================================

describe('Activity Organization Isolation', () => {
  test('activities from different orgs are not visible', async () => {
    const { __mClient, __mPool } = require('pg');

    const org1Token = generateToken({
      organizationId: 1,
      permissions: ['activities.view']
    });

    const org2Token = generateToken({
      organizationId: 2,
      permissions: ['activities.view']
    });

    let lastQueriedOrgId = null;

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('WHERE a.id') && query.includes('AND a.organization_id')) {
        lastQueriedOrgId = params[params.length - 1];
        return Promise.resolve({ rows: [] });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    await request(app)
      .get(`/api/v1/activities/${ACTIVITY_ID}`)
      .set('Authorization', `Bearer ${org1Token}`);

    expect(lastQueriedOrgId).toBe(1);

    await request(app)
      .get(`/api/v1/activities/${ACTIVITY_ID}`)
      .set('Authorization', `Bearer ${org2Token}`);

    expect(lastQueriedOrgId).toBe(2);
  });
});
