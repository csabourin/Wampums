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

const ORG_ID = 1;

beforeAll(() => {
  process.env.JWT_SECRET_KEY = 'testsecret';
  process.env.DB_USER = 'test';
  process.env.DB_HOST = 'localhost';
  process.env.DB_NAME = 'testdb';
  process.env.DB_PASSWORD = 'test';
  process.env.DB_PORT = '5432';
  process.env.ORGANIZATION_ID = String(ORG_ID);

  app = require('../api');
});

beforeEach(() => {
  const { __mClient, __mPool } = require('pg');
  __mClient.query.mockReset();
  __mClient.release.mockReset();
  __mPool.connect.mockClear();
  __mPool.query.mockReset();
  __mPool.query.mockImplementation((text, params) => {
    if (typeof text === 'string' && text.includes('organization_domains')) {
      return Promise.resolve({ rows: [{ organization_id: ORG_ID }] });
    }
    return Promise.resolve({ rows: [] });
  });
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
      organizationId: ORG_ID,
      isDemoRole: false
    },
    process.env.JWT_SECRET_KEY,
    { expiresIn: '1h' }
  );

  it('returns a calendar payload with floating local activity time values', async () => {
    const { __mPool } = require('pg');

    __mPool.query
      .mockResolvedValueOnce({
        rows: [{ permission_key: 'activities.view' }]
      })
      .mockResolvedValueOnce({
        rows: [{ role_name: 'parent', display_name: 'Parent' }]
      })
      .mockResolvedValueOnce({
        rows: [{ name: 'Club Éclaireurs' }]
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
    expect(response.headers['content-disposition']).toContain('attachment; filename="club-eclaireurs-activities-');
    expect(response.headers['content-disposition']).toContain('.ics"; filename*=UTF-8\'\'club-eclaireurs-activities-');
    expect(response.text).toContain('BEGIN:VCALENDAR');
    expect(response.text).toContain('BEGIN:VEVENT');
    expect(response.text).toContain('SUMMARY:Winter Camp');
    expect(response.text).toContain('DTSTART:20260214T093000');
    expect(response.text).toContain('DTEND:20260214T164500');
    expect(response.text).not.toContain('DTSTART:20260214T093000Z');
    expect(response.text).toContain('END:VCALENDAR');

    expect(__mPool.query).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining('FROM activities'),
      [ORG_ID]
    );
  });

  it('folds long UTF-8 lines according to RFC 5545', async () => {
    const { __mPool } = require('pg');

    __mPool.query
      .mockResolvedValueOnce({
        rows: [{ permission_key: 'activities.view' }]
      })
      .mockResolvedValueOnce({
        rows: [{ role_name: 'parent', display_name: 'Parent' }]
      })
      .mockResolvedValueOnce({
        rows: [{ name: 'Org' }]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 202,
            name: 'Long Summary Event',
            description: '😀'.repeat(30),
            activity_date: '2026-03-10',
            activity_start_date: '2026-03-10',
            activity_start_time: '10:00:00',
            activity_end_date: '2026-03-10',
            activity_end_time: '11:00:00',
            meeting_location_going: 'Main Hall',
            meeting_time_going: '09:45:00',
            departure_time_going: '10:00:00',
            departure_time_return: '11:00:00',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-02T00:00:00.000Z'
          }
        ]
      });

    const response = await request(app)
      .get('/api/v1/activities/calendar.ics')
      .set('Authorization', `Bearer ${getValidToken()}`);

    expect(response.status).toBe(200);
    expect(response.text).toMatch(/DESCRIPTION:.*\r\n .+/);
  });
});
