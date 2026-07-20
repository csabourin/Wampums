/**
 * User stories: activities API (routes/activities.js) and the
 * activities → attendance-dates interaction seam.
 *
 * Implements: US-ACT-005, US-ACT-006
 * Catalog: test/user-stories/CATALOG.md
 */

'use strict';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { closeServerResources } = require('../test-helpers');

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

const { setupDefaultMocks, mockQueryImplementation } = require('../mock-helpers');

let app;

const TEST_SECRET = 'testsecret';
const ORG_ID = 1;
const LEADER_ID = '550e8400-e29b-41d4-a716-446655440000';

const VALID_ACTIVITY = {
  activity_name: 'Summer Camp',
  description: 'Three days in the woods',
  activity_start_date: '2026-07-14',
  activity_end_date: '2026-07-16',
  meeting_location_going: 'Scout Hall',
  meeting_time_going: '08:00',
  departure_time_going: '08:30'
};

function generateToken(overrides = {}) {
  return jwt.sign({
    user_id: LEADER_ID,
    organizationId: ORG_ID,
    roleIds: [1],
    roleNames: ['leader'],
    permissions: ['activities.view', 'activities.create', 'activities.edit', 'activities.delete', 'attendance.view'],
    ...overrides
  }, TEST_SECRET);
}

function installHandler(storyHandler) {
  const { __mClient, __mPool } = require('pg');
  const recorded = [];
  mockQueryImplementation(__mClient, __mPool, (query, params) => {
    recorded.push({ query, params });
    return storyHandler(query, params);
  });
  return recorded;
}

function queriesMatching(recorded, needle) {
  return recorded.filter((entry) => entry.query.includes(needle));
}

beforeAll(() => {
  process.env.JWT_SECRET_KEY = TEST_SECRET;
  process.env.ORGANIZATION_ID = ORG_ID.toString();
  process.env.DB_USER = 'test';
  process.env.DB_HOST = 'localhost';
  process.env.DB_NAME = 'testdb';
  process.env.DB_PASSWORD = 'test';
  process.env.DB_PORT = '5432';
  app = require('../../api');
});

beforeEach(() => {
  const { __mClient, __mPool } = require('pg');
  setupDefaultMocks(__mClient, __mPool);
  __mClient.query.mockClear();
  __mPool.query.mockClear();
});

afterAll((done) => {
  closeServerResources(app, done);
});

describe('US-ACT-005 — Activities API: validation, permissions, isolation (server)', () => {
  it('lists every missing required field in the 400 message', async () => {
    installHandler((query) => (query.includes('demoadmin') ? { rows: [] } : undefined));

    const res = await request(app)
      .post('/api/v1/activities')
      .set('Authorization', `Bearer ${generateToken()}`)
      .send({ description: 'no name, no dates' })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('name');
    expect(res.body.message).toContain('meeting_location_going');
    expect(res.body.message).toContain('meeting_time_going');
    expect(res.body.message).toContain('departure_time_going');
  });

  it('rejects a departure time at or before the meeting time', async () => {
    installHandler((query) => (query.includes('demoadmin') ? { rows: [] } : undefined));

    const res = await request(app)
      .post('/api/v1/activities')
      .set('Authorization', `Bearer ${generateToken()}`)
      .send({ ...VALID_ACTIVITY, departure_time_going: '08:00' })
      .expect(400);

    expect(res.body.success).toBe(false);
  });

  it('creates a valid activity bound to the caller\'s org and user id', async () => {
    const recorded = installHandler((query, params) => {
      if (query.includes('demoadmin')) {
        return { rows: [] };
      }
      if (query.includes('INSERT INTO activities')) {
        return { rows: [{ id: 9, name: params[0], activity_start_date: params[3], activity_end_date: params[5] }] };
      }
      return undefined;
    });

    const res = await request(app)
      .post('/api/v1/activities')
      .set('Authorization', `Bearer ${generateToken()}`)
      .send(VALID_ACTIVITY)
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Summer Camp');

    const inserts = queriesMatching(recorded, 'INSERT INTO activities');
    expect(inserts).toHaveLength(1);
    expect(inserts[0].params[0]).toBe('Summer Camp');
    expect(inserts[0].params).toContain(LEADER_ID);
    expect(inserts[0].params).toContain(ORG_ID);
  });

  it('returns 404 when deleting an activity outside the caller\'s org', async () => {
    installHandler((query) => {
      if (query.includes('demoadmin')) {
        return { rows: [] };
      }
      if (query.includes('FROM activities') && query.includes('is_active = TRUE')) {
        return { rows: [] };
      }
      return undefined;
    });

    const res = await request(app)
      .delete('/api/v1/activities/999')
      .set('Authorization', `Bearer ${generateToken()}`)
      .expect(404);
    expect(res.body.success).toBe(false);
  });

  it('blocks demo accounts from creating activities', async () => {
    installHandler((query) => {
      if (query.includes('demoadmin')) {
        return { rows: [{ role_name: 'demoadmin' }] };
      }
      return undefined;
    });

    const res = await request(app)
      .post('/api/v1/activities')
      .set('Authorization', `Bearer ${generateToken()}`)
      .send(VALID_ACTIVITY)
      .expect(403);
    expect(res.body.isDemo).toBe(true);
  });
});

describe('US-ACT-006 — Planning a camp makes its days selectable everywhere', () => {
  it('after creating a 3-day camp, the attendance dates include each of its days', async () => {
    // Simulated persistent state: activities "created" in this story are
    // reflected by the dates query, the way generate_series does on real PG.
    const createdRanges = [];

    installHandler((query, params) => {
      if (query.includes('demoadmin')) {
        return { rows: [] };
      }
      if (query.includes('INSERT INTO activities')) {
        createdRanges.push({ start: params[3], end: params[5] });
        return { rows: [{ id: 9 }] };
      }
      if (query.includes('generate_series')) {
        // Expand created ranges exactly as the SQL union would
        const dates = new Set();
        createdRanges.forEach((range) => {
          const cursor = new Date(`${range.start}T00:00:00`);
          const end = new Date(`${range.end}T00:00:00`);
          while (cursor <= end) {
            dates.add(cursor.toLocaleDateString('en-CA'));
            cursor.setDate(cursor.getDate() + 1);
          }
        });
        return { rows: [...dates].sort().reverse().map((date) => ({ date })) };
      }
      return undefined;
    });

    await request(app)
      .post('/api/v1/activities')
      .set('Authorization', `Bearer ${generateToken()}`)
      .send(VALID_ACTIVITY)
      .expect(201);

    const dates = await request(app)
      .get('/api/v1/attendance/dates')
      .set('Authorization', `Bearer ${generateToken()}`)
      .expect(200);

    expect(dates.body.data).toEqual(expect.arrayContaining(['2026-07-14', '2026-07-15', '2026-07-16']));
  });
});
