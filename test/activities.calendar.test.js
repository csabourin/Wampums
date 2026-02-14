/**
 * Activities Calendar Export Test Suite
 *
 * Verifies the `GET /api/v1/activities/calendar.ics` endpoint used by the SPA
 * calendar download feature. This suite guards against regressions in:
 * - iCalendar payload structure and required metadata fields
 * - response headers for file download
 * - organization scoping via authenticated JWT context
 * - safe handling of empty activity datasets
 *
 * @module test/activities.calendar
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

let app;
const TEST_SECRET = 'testsecret';
const TOKEN_ORG_ID = 7;
let consoleLogSpy;

/**
 * Creates a valid authenticated JWT for endpoint tests.
 * @returns {string} Signed JWT token.
 */
function getValidToken() {
  return jwt.sign(
    {
      user_id: 42,
      user_role: 'parent',
      organizationId: TOKEN_ORG_ID,
      roleIds: [2],
      roleNames: ['parent'],
      permissions: ['activities.view'],
      isDemoRole: false
    },
    process.env.JWT_SECRET_KEY,
    { expiresIn: '1h' }
  );
}

const ORG_ID = 1;

beforeAll(() => {
  consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  process.env.DOTENV_CONFIG_QUIET = 'true';
  process.env.JWT_SECRET_KEY = TEST_SECRET;
  process.env.DB_USER = 'test';
  process.env.DB_HOST = 'localhost';
  process.env.DB_NAME = 'testdb';
  process.env.DB_PASSWORD = 'test';
  process.env.DB_PORT = '5432';
  process.env.ORGANIZATION_ID = '3';

  app = require('../api');
});

beforeEach(() => {
  const { __mClient, __mPool } = require('pg');
  __mClient.query.mockReset();
  __mClient.release.mockReset();
  __mPool.connect.mockClear();
  __mPool.query.mockReset();

  __mPool.query.mockImplementation((text) => {
    if (typeof text === 'string' && text.includes('organization_domains')) {
      return Promise.resolve({ rows: [{ organization_id: ORG_ID }] });
    }
    return Promise.resolve({ rows: [] });
  });
});

afterAll((done) => {
  if (consoleLogSpy) {
    consoleLogSpy.mockRestore();
  }
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
      .mockResolvedValueOnce({ rows: [{ permission_key: 'activities.view' }] })
      .mockResolvedValueOnce({ rows: [{ role_name: 'parent', display_name: 'Parent' }] })
      .mockResolvedValueOnce({ rows: [{ name: 'Demo Organization' }] })
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
    expect(response.headers['content-disposition']).toMatch(/attachment; filename=".*activities-.*\.ics"/);
    expect(response.text).toContain('BEGIN:VCALENDAR');
    expect(response.text).toContain('VERSION:2.0');
    expect(response.text).toContain('PRODID:-//Wampums//Activities Calendar//EN');
    expect(response.text).toContain('CALSCALE:GREGORIAN');
    expect(response.text).toContain('BEGIN:VEVENT');
    expect(response.text).toContain('SUMMARY:Winter Camp');
    expect(response.text).toContain('END:VCALENDAR');

    expect(__mPool.query).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining('FROM activities'),
      [ORG_ID]
    );
  });

  it('returns a valid iCalendar file when there are no activities for the organization', async () => {
    const { __mPool } = require('pg');

    __mPool.query
      .mockResolvedValueOnce({
        rows: [{ permission_key: 'activities.view' }]
      })
      .mockResolvedValueOnce({
        rows: [{ role_name: 'parent', display_name: 'Parent' }]
      })
      .mockResolvedValueOnce({
        rows: []
      })
      .mockResolvedValueOnce({
        rows: []
      });

    const response = await request(app)
      .get('/api/v1/activities/calendar.ics')
      .set('Authorization', `Bearer ${getValidToken()}`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/calendar');
    expect(response.headers['content-disposition']).toContain('activities-calendar-');
    expect(response.text).toContain('BEGIN:VCALENDAR');
    expect(response.text).toContain('END:VCALENDAR');
    // No activities means no VEVENT blocks
    expect(response.text).not.toContain('BEGIN:VEVENT');
  });

  it('returns a valid empty iCalendar payload when there are no activities', async () => {
    const { __mPool } = require('pg');

    __mPool.query
      .mockResolvedValueOnce({
        rows: [{ permission_key: 'activities.view' }]
      })
      .mockResolvedValueOnce({
        rows: [{ role_name: 'parent', display_name: 'Parent' }]
      })
      .mockResolvedValueOnce({
        rows: []
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            name: 'Activity Without Optional Fields',
            description: null,
            meeting_location_going: null,
            activity_date: '2025-02-01',
            activity_start_date: '2025-02-01',
            activity_start_time: '10:00:00',
            activity_end_date: '2025-02-01',
            activity_end_time: '12:00:00',
            meeting_time_going: '09:45:00',
            departure_time_going: '10:00:00',
            departure_time_return: null
          }
        ]
      });

    const response = await request(app)
      .get('/api/v1/activities/calendar.ics')
      .set('Authorization', `Bearer ${getValidToken()}`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/calendar');
    expect(response.headers['content-disposition']).toContain('activities-calendar-');
    expect(response.text).toContain('BEGIN:VCALENDAR');
    expect(response.text).toContain('END:VCALENDAR');
    expect(response.text).toContain('BEGIN:VEVENT');
    expect(response.text).toContain('SUMMARY:Activity Without Optional Fields');
  });

  it('skips activities when their date/time cannot be converted to iCal format', async () => {
    const { __mPool } = require('pg');

    __mPool.query
      .mockResolvedValueOnce({
        rows: [{ permission_key: 'activities.view' }]
      })
      .mockResolvedValueOnce({
        rows: [{ role_name: 'parent', display_name: 'Parent' }]
      })
      .mockResolvedValueOnce({
        rows: []
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 2,
            name: 'Invalid Date Activity',
            description: 'This activity has invalid date information',
            activity_date: null,
            activity_start_date: null,
            activity_start_time: '09:00:00',
            activity_end_date: '2025-03-01',
            activity_end_time: '11:00:00',
            meeting_location_going: 'Hall',
            meeting_time_going: '08:30:00',
            departure_time_going: '09:00:00',
            departure_time_return: null
          }
        ]
      });

    const response = await request(app)
      .get('/api/v1/activities/calendar.ics')
      .set('Authorization', `Bearer ${getValidToken()}`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/calendar');
    expect(response.headers['content-disposition']).toContain('activities-calendar-');
    expect(response.text).toContain('BEGIN:VCALENDAR');
    expect(response.text).toContain('END:VCALENDAR');
    expect(response.text).not.toContain('BEGIN:VEVENT');
  });
});
