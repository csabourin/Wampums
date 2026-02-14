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

let app;

beforeAll(() => {
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

afterAll((done) => {
  closeServerResources(app, done);
});

describe('GET /api/v1/activities/calendar.ics', () => {
  const getValidToken = () => jwt.sign(
    {
      user_id: '123e4567-e89b-12d3-a456-426614174000',
      roleIds: [1],
      roleNames: ['parent'],
      permissions: ['activities.view'],
      organizationId: 7,
      isDemoRole: false
    },
    process.env.JWT_SECRET_KEY,
    { expiresIn: '1h' }
  );

  it('returns an iCalendar export payload for organization activities', async () => {
    const { __mPool } = require('pg');

    __mPool.query
      .mockResolvedValueOnce({
        rows: [{ permission_key: 'activities.view' }]
      })
      .mockResolvedValueOnce({
        rows: [{ role_name: 'parent', display_name: 'Parent' }]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 101,
            name: 'Winter Camp',
            description: 'Overnight cabin event',
            activity_date: '2026-02-14',
            activity_start_date: '2026-02-14',
            activity_start_time: '09:30:00',
            activity_end_date: '2026-02-14',
            activity_end_time: '16:45:00',
            meeting_location_going: 'Main Hall',
            meeting_time_going: '09:00:00',
            departure_time_going: '09:30:00',
            departure_time_return: '16:45:00',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-02T00:00:00.000Z'
          }
        ]
      });

    const response = await request(app)
      .get('/api/v1/activities/calendar.ics')
      .set('Authorization', `Bearer ${getValidToken()}`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/calendar');
    expect(response.headers['content-disposition']).toContain('activities-calendar.ics');
    expect(response.text).toContain('BEGIN:VCALENDAR');
    expect(response.text).toContain('BEGIN:VEVENT');
    expect(response.text).toContain('SUMMARY:Winter Camp');
    expect(response.text).toContain('END:VCALENDAR');

    expect(__mPool.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('FROM activities'),
      [7]
    );
  });
});
