// Every line the auth middleware logs, to check a calendar token never appears.
const mockLogLines = [];
jest.mock('winston', () => {
  const actual = jest.requireActual('winston');
  return {
    ...actual,
    createLogger: (...args) => {
      const logger = actual.createLogger(...args);
      ['info', 'warn', 'error'].forEach((level) => {
        const original = logger[level].bind(logger);
        logger[level] = (...parts) => {
          mockLogLines.push(parts.map(String).join(' '));
          return original(...parts);
        };
      });
      return logger;
    },
  };
});

const { adaptAuthorizationMock } = require('./mock-helpers');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const TEST_SECRET = 'calendar-feeds-secret';
// The routes read the secret when they load, so it is set before they are required.
process.env.JWT_SECRET_KEY = TEST_SECRET;
const USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const ORGANIZATION_ID = 7;
const FEED_TOKEN = 'A'.repeat(43);
const quiet = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

function token() {
  return jwt.sign({ user_id: USER_ID, organizationId: ORGANIZATION_ID }, TEST_SECRET);
}

/** What the pool answers; each test describes its scenario here. */
const DEFAULTS = {
  permissions: ['activities.view'], demo: false, feedExists: true, failFeedLookup: false, failDomainLookup: false,
};
let scenario;

const pool = {
  query: jest.fn((query, params = []) => answer(query, params)),
  connect: jest.fn(() => Promise.resolve({
    query: jest.fn((query) => Promise.resolve(query.includes('RETURNING created_at')
      ? { rows: [{ created_at: '2026-10-16T00:00:00Z' }] } : { rows: [] })),
    release: jest.fn(),
  })),
};

function answer(query) {
  const { permissions, demo, feedExists, failFeedLookup, failDomainLookup } = scenario;
  if (query.includes('FROM organization_domains') && failDomainLookup) {
    return Promise.reject(new Error('organization_domains unavailable'));
  }
  if (query.includes('FROM calendar_feed_tokens') && query.includes('token_digest = $1')) {
    if (failFeedLookup) {
      return Promise.reject(new Error('connection to /var/run/postgresql lost'));
    }
    return Promise.resolve({ rows: feedExists ? [{ id: 3, organization_id: ORGANIZATION_ID, user_id: USER_ID }] : [] });
  }
  if (query.includes('SELECT organization_id FROM user_organizations')) {
    return Promise.resolve({ rows: [{ organization_id: ORGANIZATION_ID }] });
  }
  if (query.includes("role_name IN ('demoadmin', 'demoparent')")) {
    return Promise.resolve({ rows: demo ? [{ role_name: 'demoparent' }] : [] });
  }
  if (query.includes('SELECT DISTINCT p.permission_key')) {
    return Promise.resolve({ rows: permissions.map((key) => ({ permission_key: key })) });
  }
  if (query.includes('SELECT DISTINCT r.role_name')) {
    return Promise.resolve({ rows: [{ role_name: 'parent', display_name: 'Parent', data_scope: 'linked' }] });
  }
  if (query.includes('SELECT name FROM organizations')) {
    return Promise.resolve({ rows: [{ name: '6e Meute' }] });
  }
  if (query.includes('FROM activities')) {
    return Promise.resolve({
      rows: [{
        id: 12, name: 'Sortie canot', description: '', activity_date: '2026-11-14',
        activity_start_date: '2026-11-14', activity_start_time: '09:00:00',
        activity_end_date: '2026-11-14', activity_end_time: '16:00:00',
        meeting_location_going: 'Local', created_at: '2026-10-01T00:00:00Z',
      }],
    });
  }
  if (query.includes('SELECT created_at, last_used_at FROM calendar_feed_tokens')) {
    return Promise.resolve({ rows: [] });
  }
  return Promise.resolve({ rows: [], rowCount: 0 });
}
adaptAuthorizationMock(pool);

const app = express();
app.locals.pool = pool;
app.use(express.json());
app.use('/api/v1', require('../routes/calendarFeeds')(pool, quiet));

beforeEach(() => {
  scenario = { ...DEFAULTS };
});

describe('managing one\'s calendar link', () => {
  test.each([
    ['get', '/api/v1/calendar-feed'],
    ['post', '/api/v1/calendar-feed'],
    ['delete', '/api/v1/calendar-feed'],
  ])('%s %s is refused without a token', async (method, path) => {
    const response = await request(app)[method](path);
    expect(response.status).toBe(401);
    expect(response.body.message).toMatch(/authentication required/i);
  });

  test('a link is not made for someone who cannot see activities, saying what is missing', async () => {
    scenario.permissions = ['participants.view'];
    const response = await request(app).post('/api/v1/calendar-feed').set('Authorization', `Bearer ${token()}`);
    expect(response.status).toBe(403);
    expect(response.body.required).toEqual(['activities.view']);
    expect(response.body.missing).toEqual(['activities.view']);
  });

  test.each([['post'], ['delete']])('a demo account cannot %s a link', async (method) => {
    scenario.demo = true;
    const response = await request(app)[method]('/api/v1/calendar-feed').set('Authorization', `Bearer ${token()}`);
    expect(response.status).toBe(403);
    expect(response.body.isDemo).toBe(true);
  });

  test('when the unit\'s address cannot be read, the current link is left untouched', async () => {
    scenario.failDomainLookup = true;
    const previous = process.env.PUBLIC_BASE_URL;
    delete process.env.PUBLIC_BASE_URL;
    delete process.env.APP_URL;
    pool.connect.mockClear();
    try {
      const response = await request(app).post('/api/v1/calendar-feed').set('Authorization', `Bearer ${token()}`);
      expect(response.status).toBe(500);
      expect(pool.connect).not.toHaveBeenCalled();
    } finally {
      if (previous !== undefined) {
        process.env.PUBLIC_BASE_URL = previous;
      }
    }
  });

  test('a new link is returned once, under the unit\'s address, in both forms', async () => {
    const response = await request(app).post('/api/v1/calendar-feed').set('Authorization', `Bearer ${token()}`);
    expect(response.status).toBe(201);
    expect(response.body.data.url).toMatch(/^https:\/\/.+\/api\/v1\/calendar-feeds\/[A-Za-z0-9_-]{43}\.ics$/);
    expect(response.body.data.webcal_url).toMatch(/^webcal:\/\//);
  });
});

describe('the feed a calendar app fetches', () => {
  test('answers a known link with the unit\'s calendar, named after the unit', async () => {
    const response = await request(app).get(`/api/v1/calendar-feeds/${FEED_TOKEN}.ics`);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/^text\/calendar/);
    expect(response.headers['cache-control']).toBe('private, max-age=900');
    expect(response.text).toContain('X-WR-CALNAME:6e Meute');
    expect(response.text).toContain('SUMMARY:Sortie canot');
    expect(response.text).toContain('REFRESH-INTERVAL;VALUE=DURATION:PT6H');
  });

  test('a fetch carrying another unit\'s id is logged without the link\'s token', async () => {
    mockLogLines.length = 0;
    const response = await request(app)
      .get(`/api/v1/calendar-feeds/${FEED_TOKEN}.ics`)
      .set('x-organization-id', '99')
      .query({ organization_id: 98 });

    expect(response.status).toBe(200);
    expect(mockLogLines.some((line) => line.includes('Ignoring organization header override'))).toBe(true);
    expect(mockLogLines.some((line) => line.includes('/calendar-feeds/[token]'))).toBe(true);
    expect(mockLogLines.join('\n')).not.toContain(FEED_TOKEN);
  });

  test('answers an unknown or revoked link with 404', async () => {
    scenario.feedExists = false;
    const response = await request(app).get(`/api/v1/calendar-feeds/${FEED_TOKEN}.ics`);
    expect(response.status).toBe(404);
  });

  test('closes when the holder no longer sees activities', async () => {
    scenario.permissions = [];
    const response = await request(app).get(`/api/v1/calendar-feeds/${FEED_TOKEN}.ics`);
    expect(response.status).toBe(403);
    expect(response.body.missing).toEqual(['activities.view']);
  });

  test('a database failure is a 500 that says nothing about the server', async () => {
    scenario.failFeedLookup = true;
    const response = await request(app).get(`/api/v1/calendar-feeds/${FEED_TOKEN}.ics`);
    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toMatch(/postgresql|node_modules|at /);
  });
});
