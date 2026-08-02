/**
 * Meeting Preparation Route Test Suite
 *
 * Covers POST /api/v1/meetings/preparation, which writes the same
 * year_plan_meetings row the yearly planner reads. These tests exist mainly to
 * lock in that a preparation save cannot damage planner-owned data:
 *
 * - a series placed across several meetings must survive the save
 * - the later days of a multi-day camp must not be touched
 * - planner-entered location must not be blanked by an empty form field
 *
 * @module test/routes-meetings-preparation
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
const MEETING_ID = 55;
const DATE = '2025-10-15';

function generateToken(overrides = {}) {
  return jwt.sign({
    user_id: USER_ID,
    organizationId: ORG_ID,
    roleIds: [1],
    roleNames: ['unitadmin'],
    permissions: ['meetings.view', 'meetings.manage'],
    ...overrides
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
  __mClient.query.mockClear();
  __mClient.release.mockClear();
  __mPool.connect.mockClear();
  __mPool.query.mockClear();
});

afterAll((done) => {
  closeServerResources(app, done);
});

/**
 * Stub the queries every save runs, and record the transaction traffic.
 * @returns {void}
 */
function stubSave() {
  const { __mClient, __mPool } = require('pg');

  mockQueryImplementation(__mClient, __mPool, (query) => {
    if (query.includes('permission_key')) {
      return Promise.resolve({ rows: [{ permission_key: 'meetings.manage' }, { permission_key: 'meetings.view' }] });
    }
    if (query.includes("role_name IN ('demoadmin', 'demoparent')")) {
      return Promise.resolve({ rows: [] });
    }
    if (query.includes('organization_settings')) {
      return Promise.resolve({
        rows: [{
          setting_key: 'organization_info',
          setting_value: { meeting_day: 'Wednesday', meeting_time: '18:00', endroit: 'Local' }
        }]
      });
    }
    if (query.includes('INSERT INTO year_plan_meetings')) {
      return Promise.resolve({ rows: [{ id: MEETING_ID, organization_id: ORG_ID, meeting_date: DATE }] });
    }
    if (query.includes('UPDATE year_plan_meeting_activities')) {
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
}

/** @returns {Array} [sql, params] pairs issued on the transaction client */
function clientCalls() {
  const { __mClient } = require('pg');
  return __mClient.query.mock.calls.map(call => [
    (typeof call[0] === 'string' ? call[0] : call[0]?.text) || '',
    call[1] || []
  ]);
}

describe('POST /api/v1/meetings/preparation', () => {
  test('reconciles the timeline by id instead of deleting it wholesale', async () => {
    stubSave();

    await request(app)
      .post('/api/v1/meetings/preparation')
      .set('Authorization', `Bearer ${generateToken()}`)
      .send({
        date: DATE,
        activities: [
          { id: 901, activity: 'Preparation du camp 2/4', time: '19:00' },
          { id: 902, activity: 'Jeu du drapeau', time: '19:20' }
        ]
      })
      .expect(200);

    const deletes = clientCalls().filter(([sql]) => sql.includes('DELETE FROM year_plan_meeting_activities'));
    expect(deletes).toHaveLength(1);

    const [sql, params] = deletes[0];
    // The submitted rows are excluded from the delete, so their ids - and the
    // series columns hanging off them - survive.
    expect(sql).toContain('NOT (id = ANY');
    expect(params).toContainEqual([901, 902]);
  });

  test('never touches the later days of a multi-day camp', async () => {
    stubSave();

    await request(app)
      .post('/api/v1/meetings/preparation')
      .set('Authorization', `Bearer ${generateToken()}`)
      .send({ date: DATE, activities: [{ id: 901, activity: 'Reveil' }] })
      .expect(200);

    const [sql] = clientCalls().find(([q]) => q.includes('DELETE FROM year_plan_meeting_activities'));
    // A preparation edits one evening; day_offset > 0 belongs to the camp schedule.
    expect(sql).toContain('day_offset = 0');
  });

  test('updates a known row rather than recreating it', async () => {
    stubSave();

    await request(app)
      .post('/api/v1/meetings/preparation')
      .set('Authorization', `Bearer ${generateToken()}`)
      .send({ date: DATE, activities: [{ id: 901, activity: 'Jeu', time: '19:00' }] })
      .expect(200);

    const calls = clientCalls();
    expect(calls.some(([sql]) => sql.includes('UPDATE year_plan_meeting_activities'))).toBe(true);
    expect(calls.some(([sql]) => sql.includes('INSERT INTO year_plan_meeting_activities'))).toBe(false);
  });

  test('an update never writes the series columns', async () => {
    stubSave();

    await request(app)
      .post('/api/v1/meetings/preparation')
      .set('Authorization', `Bearer ${generateToken()}`)
      .send({ date: DATE, activities: [{ id: 901, activity: 'Jeu' }] })
      .expect(200);

    const [sql] = clientCalls().find(([q]) => q.includes('UPDATE year_plan_meeting_activities'));
    // A night's preparation does not own the series a plan placed across a term.
    expect(sql).not.toContain('series_id');
    expect(sql).not.toContain('series_occurrence');
  });

  test('a new row carries any series it was given', async () => {
    stubSave();

    await request(app)
      .post('/api/v1/meetings/preparation')
      .set('Authorization', `Bearer ${generateToken()}`)
      .send({
        date: DATE,
        activities: [{ activity: 'Preparation du camp 3/4', series_id: 'ser-xyz', series_occurrence: 3 }]
      })
      .expect(200);

    const insert = clientCalls().find(([sql]) => sql.includes('INSERT INTO year_plan_meeting_activities'));
    expect(insert[0]).toContain('series_id');
    expect(insert[1]).toContain('ser-xyz');
    expect(insert[1]).toContain(3);
  });

  test('an empty location does not blank what the planner set', async () => {
    stubSave();

    await request(app)
      .post('/api/v1/meetings/preparation')
      .set('Authorization', `Bearer ${generateToken()}`)
      .send({ date: DATE, endroit: '', activities: [] })
      .expect(200);

    const [sql] = clientCalls().find(([q]) => q.includes('INSERT INTO year_plan_meetings'));
    expect(sql).toContain('THEN year_plan_meetings.location');
  });

  test('fields owned by this form stay clearable', async () => {
    stubSave();

    await request(app)
      .post('/api/v1/meetings/preparation')
      .set('Authorization', `Bearer ${generateToken()}`)
      .send({ date: DATE, activities: [] })
      .expect(200);

    const [sql] = clientCalls().find(([q]) => q.includes('INSERT INTO year_plan_meetings'));
    // Guarding these would stop a user removing a youth of honor or a note.
    expect(sql).toContain('youth_of_honor = EXCLUDED.youth_of_honor');
    expect(sql).toContain('notes = EXCLUDED.notes');
  });

  test('rejects a save from a user without meetings.manage', async () => {
    const { __mClient, __mPool } = require('pg');
    mockQueryImplementation(__mClient, __mPool, (query) => {
      if (query.includes('permission_key')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    await request(app)
      .post('/api/v1/meetings/preparation')
      .set('Authorization', `Bearer ${generateToken({ permissions: [] })}`)
      .send({ date: DATE, activities: [] })
      .expect(403);
  });
});
