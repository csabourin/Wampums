/**
 * Test for activity creation endpoint
 * Validates that the activity creation handles empty optional fields correctly
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
    on: jest.fn(),
    end: jest.fn()
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

beforeAll(() => {
  // Set required env variables
  process.env.JWT_SECRET_KEY = 'testsecret';
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
  __mPool.query.mockResolvedValue({ rows: [] });
});

afterEach(() => {
  Pool.mockClear();
});

afterAll((done) => {
  closeServerResources(app, done);
});

describe('POST /api/v1/activities', () => {
  // Generate token inside a function to ensure JWT_SECRET_KEY is set
  const getValidToken = () => jwt.sign(
    {
      user_id: '123e4567-e89b-12d3-a456-426614174000',
      roleIds: [1],
      roleNames: ['admin'],
      permissions: ['activities.create'],
      organizationId: 1,
      isDemoRole: false
    },
    process.env.JWT_SECRET_KEY,
    { expiresIn: '1h' }
  );

  it('should create activity with all required fields', async () => {
    const { __mPool } = require('pg');
    
    // Mock blockDemoRoles query (no demo roles)
    __mPool.query.mockResolvedValueOnce({ rows: [] });

    // Mock requirePermission permissions query
    __mPool.query.mockResolvedValueOnce({ rows: [{ permission_key: 'activities.create' }] });

    // Mock requirePermission roles query
    __mPool.query.mockResolvedValueOnce({ rows: [{ role_name: 'admin', display_name: 'Admin' }] });

    // Mock INSERT query
    __mPool.query.mockResolvedValueOnce({
      rows: [{
        id: 1,
        name: 'Test Activity',
        activity_date: '2026-02-14',
        activity_start_date: '2026-02-14',
        activity_start_time: '09:00',
        activity_end_date: '2026-02-14',
        activity_end_time: '12:00',
        meeting_location_going: 'School',
        meeting_time_going: '08:45',
        departure_time_going: '09:00',
        created_at: new Date(),
        updated_at: new Date()
      }]
    });

    const response = await request(app)
      .post('/api/v1/activities')
      .set('Authorization', `Bearer ${getValidToken()}`)
      .send({
        activity_name: 'Test Activity', // Using new field name
        activity_start_date: '2026-02-14',
        activity_start_time: '09:00',
        activity_end_date: '2026-02-14',
        activity_end_time: '12:00',
        meeting_location_going: 'School',
        meeting_time_going: '08:45',
        departure_time_going: '09:00',
        meeting_location_return: null,
        meeting_time_return: null,
        departure_time_return: null
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toBeDefined();
    expect(response.body.data.name).toBe('Test Activity');
  });

  it('should create activity with legacy "name" field (backward compatibility)', async () => {
    const { __mPool } = require('pg');
    
    // Mock blockDemoRoles query (no demo roles)
    __mPool.query.mockResolvedValueOnce({ rows: [] });

    // Mock requirePermission permissions query
    __mPool.query.mockResolvedValueOnce({ rows: [{ permission_key: 'activities.create' }] });

    // Mock requirePermission roles query
    __mPool.query.mockResolvedValueOnce({ rows: [{ role_name: 'admin', display_name: 'Admin' }] });

    // Mock INSERT query
    __mPool.query.mockResolvedValueOnce({
      rows: [{
        id: 1,
        name: 'Test Activity',
        activity_date: '2026-02-14',
        activity_start_date: '2026-02-14',
        activity_start_time: '09:00',
        activity_end_date: '2026-02-14',
        activity_end_time: '12:00',
        meeting_location_going: 'School',
        meeting_time_going: '08:45',
        departure_time_going: '09:00',
        created_at: new Date(),
        updated_at: new Date()
      }]
    });

    const response = await request(app)
      .post('/api/v1/activities')
      .set('Authorization', `Bearer ${getValidToken()}`)
      .send({
        name: 'Test Activity', // Using legacy field name
        activity_start_date: '2026-02-14',
        activity_start_time: '09:00',
        activity_end_date: '2026-02-14',
        activity_end_time: '12:00',
        meeting_location_going: 'School',
        meeting_time_going: '08:45',
        departure_time_going: '09:00',
        meeting_location_return: null,
        meeting_time_return: null,
        departure_time_return: null
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toBeDefined();
    expect(response.body.data.name).toBe('Test Activity');
  });

  it('should reject activity with missing required fields', async () => {
    const { __mPool } = require('pg');
    
    // Mock blockDemoRoles query (no demo roles)
    __mPool.query.mockResolvedValueOnce({ rows: [] });

    // Mock requirePermission permissions query
    __mPool.query.mockResolvedValueOnce({ rows: [{ permission_key: 'activities.create' }] });

    // Mock requirePermission roles query
    __mPool.query.mockResolvedValueOnce({ rows: [{ role_name: 'admin', display_name: 'Admin' }] });

    const response = await request(app)
      .post('/api/v1/activities')
      .set('Authorization', `Bearer ${getValidToken()}`)
      .send({
        name: 'Test Activity',
        // Missing required fields
        meeting_location_going: 'School'
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain('Missing required fields');
  });

  it('should handle empty strings in optional fields and pass them to database', async () => {
    const { __mPool } = require('pg');
    
    // Mock blockDemoRoles query (no demo roles)
    __mPool.query.mockResolvedValueOnce({ rows: [] });

    // Mock requirePermission permissions query
    __mPool.query.mockResolvedValueOnce({ rows: [{ permission_key: 'activities.create' }] });

    // Mock requirePermission roles query
    __mPool.query.mockResolvedValueOnce({ rows: [{ role_name: 'admin', display_name: 'Admin' }] });

    // Mock INSERT query
    __mPool.query.mockResolvedValueOnce({
      rows: [{
        id: 1,
        name: 'Test Activity',
        activity_date: '2026-02-14',
        activity_start_date: '2026-02-14',
        activity_start_time: '09:00',
        activity_end_date: '2026-02-14',
        activity_end_time: '12:00',
        meeting_location_going: 'School',
        meeting_time_going: '08:45',
        departure_time_going: '09:00',
        meeting_location_return: '',
        meeting_time_return: '',
        departure_time_return: '',
        created_at: new Date(),
        updated_at: new Date()
      }]
    });

    const response = await request(app)
      .post('/api/v1/activities')
      .set('Authorization', `Bearer ${getValidToken()}`)
      .send({
        activity_name: 'Test Activity',
        activity_start_date: '2026-02-14',
        activity_start_time: '09:00',
        activity_end_date: '2026-02-14',
        activity_end_time: '12:00',
        meeting_location_going: 'School',
        meeting_time_going: '08:45',
        departure_time_going: '09:00',
        meeting_location_return: '',
        meeting_time_return: '',
        departure_time_return: ''
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    
    // Verify the INSERT query was called with empty strings converted appropriately
    // Query order: blockDemoRoles, requirePermission permissions, requirePermission roles, INSERT
    expect(__mPool.query).toHaveBeenCalledTimes(4);
    const insertCall = __mPool.query.mock.calls[3];
    expect(insertCall[1]).toEqual(expect.arrayContaining([
      expect.any(Number), // organizationId
      expect.any(String), // userId
      'Test Activity',    // name
      undefined,          // description (not provided)
      '2026-02-14',       // activity_date
      '2026-02-14',       // activity_start_date
      '09:00',            // activity_start_time
      '2026-02-14',       // activity_end_date
      '12:00',            // activity_end_time
      'School',           // meeting_location_going
      '08:45',            // meeting_time_going
      '09:00',            // departure_time_going
      '',                 // meeting_location_return (empty string as sent)
      '',                 // meeting_time_return (empty string as sent)
      ''                  // departure_time_return (empty string as sent)
    ]));
  });

  it('should provide specific error message for missing fields', async () => {
    const { __mPool } = require('pg');
    
    // Mock blockDemoRoles query (no demo roles)
    __mPool.query.mockResolvedValueOnce({ rows: [] });

    // Mock requirePermission permissions query
    __mPool.query.mockResolvedValueOnce({ rows: [{ permission_key: 'activities.create' }] });

    // Mock requirePermission roles query
    __mPool.query.mockResolvedValueOnce({ rows: [{ role_name: 'admin', display_name: 'Admin' }] });

    const response = await request(app)
      .post('/api/v1/activities')
      .set('Authorization', `Bearer ${getValidToken()}`)
      .send({
        activity_name: 'Test Activity',
        activity_start_date: '2026-02-14',
        // Missing: activity_start_time, activity_end_date, activity_end_time, 
        // meeting_location_going, meeting_time_going, departure_time_going
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain('Missing required fields');
    // Should now provide specific field names rather than generic message
    expect(response.body.message).toMatch(/activity_start_time|meeting_time_going/);
  });
});
