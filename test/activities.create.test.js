/**
 * Test for activity creation endpoint
 * Validates that the activity creation handles empty optional fields correctly
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');

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

describe('POST /api/v1/activities', () => {
  const validToken = jwt.sign(
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
    
    // Mock getOrganizationId query
    __mPool.query.mockResolvedValueOnce({
      rows: [{ organization_id: 1 }]
    });

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
      .set('Authorization', `Bearer ${validToken}`)
      .send({
        name: 'Test Activity',
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
    
    // Mock getOrganizationId query
    __mPool.query.mockResolvedValueOnce({
      rows: [{ organization_id: 1 }]
    });

    const response = await request(app)
      .post('/api/v1/activities')
      .set('Authorization', `Bearer ${validToken}`)
      .send({
        name: 'Test Activity',
        // Missing required fields
        meeting_location_going: 'School'
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain('Missing required fields');
  });

  it('should handle empty strings in optional fields', async () => {
    const { __mPool } = require('pg');
    
    // Mock getOrganizationId query
    __mPool.query.mockResolvedValueOnce({
      rows: [{ organization_id: 1 }]
    });

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
      .set('Authorization', `Bearer ${validToken}`)
      .send({
        name: 'Test Activity',
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
  });

  it('should provide specific error message for missing fields', async () => {
    const { __mPool } = require('pg');
    
    // Mock getOrganizationId query
    __mPool.query.mockResolvedValueOnce({
      rows: [{ organization_id: 1 }]
    });

    const response = await request(app)
      .post('/api/v1/activities')
      .set('Authorization', `Bearer ${validToken}`)
      .send({
        name: 'Test Activity',
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
