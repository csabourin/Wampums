/**
 * GET /api/v1/meetings/programme — the day's programme for the leaders'
 * "now / next" bar.
 *
 * Only someone who may read meeting preparations gets it, for the unit in
 * their token. A camp day returns that day's activities, in time order, with
 * who leads them and what to bring; activities typed into an older meeting
 * preparation keep their time and duration.
 *
 * @module test/routes-meetings-programme
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { closeServerResources } = require('./test-helpers');

jest.mock('pg', () => {
  const mClient = { query: jest.fn(), release: jest.fn() };
  const mPool = {
    connect: jest.fn(() => Promise.resolve(mClient)),
    query: jest.fn(),
    on: jest.fn()
  };
  return { Pool: jest.fn(() => mPool), __esModule: true, __mClient: mClient, __mPool: mPool };
});

const { setupDefaultMocks, mockQueryImplementation } = require('./mock-helpers');

let app;

const TEST_SECRET = 'testsecret';
const ORG_ID = 1;
const USER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const MEETING_ID = 77;

function token(permissions = ['meetings.view']) {
  return jwt.sign({
    user_id: USER_ID,
    organizationId: ORG_ID,
    roleIds: [1],
    roleNames: ['leader'],
    permissions
  }, TEST_SECRET);
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
  __mPool.query.mockClear();
});

afterAll((done) => {
  closeServerResources(app, done);
});

/**
 * Answer the permission lookup and the programme queries.
 *
 * @param {Object} options
 * @param {string[]} [options.permissions] - Keys the member holds
 * @param {?Object} [options.meeting] - The meeting covering the date, or null
 * @param {Array} [options.activities] - Its activity rows for that day
 * @param {?string} [options.dayTitle] - The camp day's own title
 * @param {Error} [options.failWith] - Make the programme lookup fail
 */
function stub({ permissions = ['meetings.view'], meeting = null, activities = [], dayTitle = null, failWith = null } = {}) {
  const { __mClient, __mPool } = require('pg');
  mockQueryImplementation(__mClient, __mPool, (query) => {
    if (query.includes('permission_key')) {
      return Promise.resolve({ rows: permissions.map((key) => ({ permission_key: key })) });
    }
    if (query.includes("role_name IN ('demoadmin', 'demoparent')")) {
      return Promise.resolve({ rows: [] });
    }
    if (query.includes('WITH spans')) {
      if (failWith) {
        return Promise.reject(failWith);
      }
      return Promise.resolve({ rows: meeting ? [meeting] : [] });
    }
    if (query.includes('FROM year_plan_meeting_activities')) {
      return Promise.resolve({ rows: activities });
    }
    if (query.includes('FROM year_plan_meeting_days')) {
      return Promise.resolve({ rows: dayTitle ? [{ title: dayTitle }] : [] });
    }
    return Promise.resolve({ rows: [] });
  });
}

/** @returns {Array} [sql, params] of every pool query */
function poolCalls() {
  const { __mPool } = require('pg');
  return __mPool.query.mock.calls.map((call) => [String(call[0]?.text || call[0] || ''), call[1] || []]);
}

describe('GET /api/v1/meetings/programme', () => {
  test('a signed-out request is refused', async () => {
    const res = await request(app).get('/api/v1/meetings/programme?date=2026-10-16');
    expect(res.status).toBe(401);
  });

  test('someone who may not read meeting preparations is refused, with what is missing', async () => {
    stub({ permissions: ['participants.view'] });
    const res = await request(app)
      .get('/api/v1/meetings/programme?date=2026-10-16')
      .set('Authorization', `Bearer ${token(['participants.view'])}`);

    expect(res.status).toBe(403);
    expect(res.body.required).toEqual(['meetings.view']);
    expect(res.body.missing).toEqual(['meetings.view']);
  });

  test.each(['', 'demain', '2026-13-45'])('a date that is not one (%p) is a 400', async (date) => {
    stub();
    const res = await request(app)
      .get(`/api/v1/meetings/programme?date=${encodeURIComponent(date)}`)
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(400);
  });

  test('a day with nothing planned answers null', async () => {
    stub();
    const res = await request(app)
      .get('/api/v1/meetings/programme?date=2026-10-16')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });

  test('a camp day lists its activities in time order, with leader and material, older timings kept', async () => {
    stub({
      meeting: { id: MEETING_ID, meeting_kind: 'camp', theme: 'Camp d’automne', activity_name: null, span_days: 3, meeting_date: '2026-10-15', day_offset: 1 },
      dayTitle: 'La piste du loup',
      activities: [
        { id: 3, name: 'Dîner', start_time: '12:00:00', duration_minutes: 60, responsable: 'Baloo et Rikki', material: null, legacy: null },
        { id: 1, name: 'Grand jeu en forêt', start_time: '09:30:00', duration_minutes: 150, responsable: 'Akela', material: 'Foulards', legacy: null },
        { id: 4, name: 'Temps libre', start_time: null, duration_minutes: null, responsable: null, material: null, legacy: null },
        { id: 2, name: 'Accueil', start_time: null, duration_minutes: null, responsable: 'Bagheera', material: '', legacy: { time: '9:00', duration: '00:15' } },
      ],
    });

    const res = await request(app)
      .get('/api/v1/meetings/programme?date=2026-10-16')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      meeting_id: MEETING_ID,
      kind: 'camp',
      date: '2026-10-16',
      title: 'La piste du loup',
      day_number: 2,
      day_count: 3,
      activities: [
        { id: 2, time: '09:00', duration_minutes: 15, name: 'Accueil', leader: 'Bagheera', material: '' },
        { id: 1, time: '09:30', duration_minutes: 150, name: 'Grand jeu en forêt', leader: 'Akela', material: 'Foulards' },
        { id: 3, time: '12:00', duration_minutes: 60, name: 'Dîner', leader: 'Baloo et Rikki', material: '' },
        { id: 4, time: null, duration_minutes: null, name: 'Temps libre', leader: '', material: '' },
      ],
    });
  });

  test('the programme is looked up in the unit of the token, for the date the phone sent', async () => {
    stub();
    await request(app)
      .get('/api/v1/meetings/programme?date=2026-10-16')
      .set('Authorization', `Bearer ${token()}`)
      .set('x-organization-id', '999')
      .expect(200);

    const [, params] = poolCalls().find(([sql]) => sql.includes('WITH spans'));
    expect(params).toEqual([ORG_ID, '2026-10-16']);
  });

  test('a database failure is a 500 that says nothing about the database', async () => {
    stub({ failWith: new Error('relation "year_plan_meetings" does not exist') });
    const res = await request(app)
      .get('/api/v1/meetings/programme?date=2026-10-16')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('year_plan_meetings');
  });
});
