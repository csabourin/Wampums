/**
 * Yearly Planner Routes Test Suite
 *
 * Covers the Phase 1 calendar endpoints and locks in the defects they fixed:
 * - POST   /api/v1/yearly-planner/plans/:planId/meetings
 * - DELETE /api/v1/yearly-planner/meetings/:id
 * - DELETE /api/v1/yearly-planner/meetings/:id/activity-event
 * - PATCH  /api/v1/yearly-planner/meetings/:id  (partial-update regressions)
 *
 * @module test/routes-yearly-planner
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

const { setupDefaultMocks, mockQueryImplementation } = require('./mock-helpers');
let app;

const TEST_SECRET = 'testsecret';
const ORG_ID = 1;
const USER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const PLAN_ID = 7;
const MEETING_ID = 42;

const ALL_PERMISSIONS = ['meetings.view', 'meetings.manage', 'activities.create'];

function generateToken(overrides = {}) {
  return jwt.sign({
    user_id: USER_ID,
    organizationId: ORG_ID,
    roleIds: [1],
    roleNames: ['unitadmin'],
    permissions: ALL_PERMISSIONS,
    ...overrides
  }, TEST_SECRET);
}

/**
 * Build a meeting row as the routes select it.
 * @param {Object} overrides - Column overrides
 * @returns {Object} Meeting row
 */
function meetingRow(overrides = {}) {
  return {
    id: MEETING_ID,
    organization_id: ORG_ID,
    year_plan_id: PLAN_ID,
    period_id: null,
    meeting_date: '2025-10-17',
    start_time: '18:00:00',
    end_time: '20:00:00',
    duration_minutes: 120,
    location: 'Local',
    theme: null,
    notes: null,
    is_cancelled: false,
    meeting_kind: 'regular',
    activity_id: null,
    metadata: {},
    ...overrides
  };
}

/**
 * Standard permission/demo-role stubs every authenticated route hits first.
 * @param {string} query - SQL text
 * @param {string[]} permissions - Permission keys the user holds
 * @returns {Promise|undefined} Stubbed result, or undefined to fall through
 */
function authStubs(query, permissions = ALL_PERMISSIONS) {
  if (query.includes('permission_key')) {
    return Promise.resolve({ rows: permissions.map(p => ({ permission_key: p })) });
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
  return undefined;
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

/** @returns {string[]} Every SQL statement issued on the transaction client */
function clientQueries() {
  const { __mClient } = require('pg');
  return __mClient.query.mock.calls.map(call =>
    (typeof call[0] === 'string' ? call[0] : call[0]?.text) || ''
  );
}

// ==========================================
// POST /plans/:planId/meetings
// ==========================================

describe('POST /api/v1/yearly-planner/plans/:planId/meetings', () => {
  test('creates a regular one-off date without an outing', async () => {
    const { __mClient, __mPool } = require('pg');

    mockQueryImplementation(__mClient, __mPool, (query) => {
      const stub = authStubs(query);
      if (stub) { return stub; }
      if (query.includes('FROM year_plans')) {
        return Promise.resolve({ rows: [{ id: PLAN_ID }] });
      }
      if (query.includes('INSERT INTO year_plan_meetings')) {
        return Promise.resolve({ rows: [meetingRow({ inserted: true })] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post(`/api/v1/yearly-planner/plans/${PLAN_ID}/meetings`)
      .set('Authorization', `Bearer ${generateToken()}`)
      .send({ meeting_date: '2025-10-17', kind: 'regular' })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(clientQueries().some(q => q.includes('INSERT INTO activities'))).toBe(false);
  });

  test('a camp creates a multi-day activity and links it to the meeting', async () => {
    const { __mClient, __mPool } = require('pg');

    mockQueryImplementation(__mClient, __mPool, (query) => {
      const stub = authStubs(query);
      if (stub) { return stub; }
      if (query.includes('FROM year_plans')) {
        return Promise.resolve({ rows: [{ id: PLAN_ID }] });
      }
      if (query.includes('INSERT INTO year_plan_meetings')) {
        return Promise.resolve({ rows: [meetingRow({ theme: 'Camp automne', inserted: true })] });
      }
      if (query.includes('INSERT INTO activities')) {
        return Promise.resolve({ rows: [{ id: 500, name: 'Camp automne' }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post(`/api/v1/yearly-planner/plans/${PLAN_ID}/meetings`)
      .set('Authorization', `Bearer ${generateToken()}`)
      .send({
        meeting_date: '2025-10-17',
        end_date: '2025-10-19',
        kind: 'camp',
        theme: 'Camp automne'
      })
      .expect(201);

    expect(res.body.data.activity_id).toBe(500);

    const queries = clientQueries();
    expect(queries.some(q => q.includes('INSERT INTO activities'))).toBe(true);
    expect(queries.some(q => q.includes('SET activity_id'))).toBe(true);
    expect(queries).toContain('COMMIT');

    // The span must reach the activities row: that is what carpools and
    // permission slips hang off.
    const { __mClient: client } = require('pg');
    const activityCall = client.query.mock.calls.find(call =>
      String(call[0]).includes('INSERT INTO activities')
    );
    expect(activityCall[1]).toContain('2025-10-19');
  });

  test('never passes an empty string into the return time columns', async () => {
    // Regression: '' raised "invalid input syntax for type time" and made the
    // whole activity-event path fail.
    const { __mClient, __mPool } = require('pg');

    mockQueryImplementation(__mClient, __mPool, (query) => {
      const stub = authStubs(query);
      if (stub) { return stub; }
      if (query.includes('FROM year_plans')) {
        return Promise.resolve({ rows: [{ id: PLAN_ID }] });
      }
      if (query.includes('INSERT INTO year_plan_meetings')) {
        return Promise.resolve({ rows: [meetingRow({ theme: 'Sortie', inserted: true })] });
      }
      if (query.includes('INSERT INTO activities')) {
        return Promise.resolve({ rows: [{ id: 501 }] });
      }
      return Promise.resolve({ rows: [] });
    });

    await request(app)
      .post(`/api/v1/yearly-planner/plans/${PLAN_ID}/meetings`)
      .set('Authorization', `Bearer ${generateToken()}`)
      .send({ meeting_date: '2025-10-25', kind: 'weekend', theme: 'Sortie' })
      .expect(201);

    const activityCall = __mClient.query.mock.calls.find(call =>
      String(call[0]).includes('INSERT INTO activities')
    );
    expect(String(activityCall[0])).toMatch(/NULL,\s*NULL/);
  });

  test('adopts an existing date instead of rejecting it', async () => {
    const { __mClient, __mPool } = require('pg');

    mockQueryImplementation(__mClient, __mPool, (query) => {
      const stub = authStubs(query);
      if (stub) { return stub; }
      if (query.includes('FROM year_plans')) {
        return Promise.resolve({ rows: [{ id: PLAN_ID }] });
      }
      if (query.includes('INSERT INTO year_plan_meetings')) {
        // xmax != 0 -> the row already existed and was updated
        return Promise.resolve({ rows: [meetingRow({ inserted: false })] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post(`/api/v1/yearly-planner/plans/${PLAN_ID}/meetings`)
      .set('Authorization', `Bearer ${generateToken()}`)
      .send({ meeting_date: '2025-10-17' })
      .expect(200);

    expect(res.body.data.adopted).toBe(true);
  });

  test('creates the date but reports the skip when activities.create is missing', async () => {
    const { __mClient, __mPool } = require('pg');
    const permissions = ['meetings.view', 'meetings.manage'];

    mockQueryImplementation(__mClient, __mPool, (query) => {
      const stub = authStubs(query, permissions);
      if (stub) { return stub; }
      if (query.includes('FROM year_plans')) {
        return Promise.resolve({ rows: [{ id: PLAN_ID }] });
      }
      if (query.includes('INSERT INTO year_plan_meetings')) {
        return Promise.resolve({ rows: [meetingRow({ theme: 'Sortie', inserted: true })] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post(`/api/v1/yearly-planner/plans/${PLAN_ID}/meetings`)
      .set('Authorization', `Bearer ${generateToken({ permissions })}`)
      .send({ meeting_date: '2025-10-25', kind: 'weekend', theme: 'Sortie' })
      .expect(201);

    expect(res.body.data.activity_event_skipped).toBe('forbidden');
    expect(clientQueries().some(q => q.includes('INSERT INTO activities'))).toBe(false);
  });

  test('rejects an end_date before the meeting date', async () => {
    const { __mClient, __mPool } = require('pg');
    mockQueryImplementation(__mClient, __mPool, (query) => authStubs(query) || Promise.resolve({ rows: [] }));

    await request(app)
      .post(`/api/v1/yearly-planner/plans/${PLAN_ID}/meetings`)
      .set('Authorization', `Bearer ${generateToken()}`)
      .send({ meeting_date: '2025-10-17', end_date: '2025-10-10' })
      .expect(400);
  });

  test('rejects an unknown kind', async () => {
    const { __mClient, __mPool } = require('pg');
    mockQueryImplementation(__mClient, __mPool, (query) => authStubs(query) || Promise.resolve({ rows: [] }));

    await request(app)
      .post(`/api/v1/yearly-planner/plans/${PLAN_ID}/meetings`)
      .set('Authorization', `Bearer ${generateToken()}`)
      .send({ meeting_date: '2025-10-17', kind: 'bogus' })
      .expect(400);
  });

  test('404s for a plan in another organization', async () => {
    const { __mClient, __mPool } = require('pg');

    mockQueryImplementation(__mClient, __mPool, (query) => {
      const stub = authStubs(query);
      if (stub) { return stub; }
      if (query.includes('FROM year_plans')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    await request(app)
      .post(`/api/v1/yearly-planner/plans/${PLAN_ID}/meetings`)
      .set('Authorization', `Bearer ${generateToken()}`)
      .send({ meeting_date: '2025-10-17' })
      .expect(404);
  });

  test('requires authentication', async () => {
    await request(app)
      .post(`/api/v1/yearly-planner/plans/${PLAN_ID}/meetings`)
      .send({ meeting_date: '2025-10-17' })
      .expect(401);
  });
});

// ==========================================
// DELETE /meetings/:id
// ==========================================

describe('DELETE /api/v1/yearly-planner/meetings/:id', () => {
  test('deletes the date and detaches its dependants', async () => {
    const { __mClient, __mPool } = require('pg');

    mockQueryImplementation(__mClient, __mPool, (query) => {
      const stub = authStubs(query);
      if (stub) { return stub; }
      if (query.includes('FROM year_plan_meetings')) {
        return Promise.resolve({ rows: [meetingRow()] });
      }
      if (query.includes('FROM attendance')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    await request(app)
      .delete(`/api/v1/yearly-planner/meetings/${MEETING_ID}`)
      .set('Authorization', `Bearer ${generateToken()}`)
      .expect(200);

    const queries = clientQueries();
    expect(queries.some(q => q.includes('DELETE FROM year_plan_meeting_activities'))).toBe(true);
    expect(queries.some(q => q.includes('equipment_reservations SET meeting_id = NULL'))).toBe(true);
    expect(queries.some(q => q.includes('DELETE FROM year_plan_meetings'))).toBe(true);
    expect(queries).toContain('COMMIT');
  });

  test('unlinks but never deletes the linked outing', async () => {
    const { __mClient, __mPool } = require('pg');

    mockQueryImplementation(__mClient, __mPool, (query) => {
      const stub = authStubs(query);
      if (stub) { return stub; }
      if (query.includes('FROM year_plan_meetings')) {
        return Promise.resolve({ rows: [meetingRow({ activity_id: 500 })] });
      }
      if (query.includes('FROM attendance')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .delete(`/api/v1/yearly-planner/meetings/${MEETING_ID}`)
      .set('Authorization', `Bearer ${generateToken()}`)
      .expect(200);

    expect(res.body.data.unlinked_activity_id).toBe(500);
    // Signed permission slips may hang off that row.
    expect(clientQueries().some(q => q.includes('DELETE FROM activities'))).toBe(false);
  });

  test('refuses when attendance was recorded on that date', async () => {
    const { __mClient, __mPool } = require('pg');

    mockQueryImplementation(__mClient, __mPool, (query) => {
      const stub = authStubs(query);
      if (stub) { return stub; }
      if (query.includes('FROM year_plan_meetings')) {
        return Promise.resolve({ rows: [meetingRow()] });
      }
      if (query.includes('FROM attendance')) {
        return Promise.resolve({ rows: [{ '?column?': 1 }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .delete(`/api/v1/yearly-planner/meetings/${MEETING_ID}`)
      .set('Authorization', `Bearer ${generateToken()}`)
      .expect(409);

    expect(res.body.message).toBe('meeting_has_attendance');
    expect(clientQueries().some(q => q.includes('DELETE FROM year_plan_meetings'))).toBe(false);
  });

  test('404s for a meeting in another organization', async () => {
    const { __mClient, __mPool } = require('pg');

    mockQueryImplementation(__mClient, __mPool, (query) => {
      const stub = authStubs(query);
      if (stub) { return stub; }
      if (query.includes('FROM year_plan_meetings')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    await request(app)
      .delete(`/api/v1/yearly-planner/meetings/${MEETING_ID}`)
      .set('Authorization', `Bearer ${generateToken()}`)
      .expect(404);
  });
});

// ==========================================
// DELETE /meetings/:id/activity-event
// ==========================================

describe('DELETE /api/v1/yearly-planner/meetings/:id/activity-event', () => {
  test('unlinks the outing and leaves it intact', async () => {
    const { __mClient, __mPool } = require('pg');

    mockQueryImplementation(__mClient, __mPool, (query) => {
      const stub = authStubs(query);
      if (stub) { return stub; }
      if (query.includes('SELECT activity_id FROM year_plan_meetings')) {
        return Promise.resolve({ rows: [{ activity_id: 500 }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .delete(`/api/v1/yearly-planner/meetings/${MEETING_ID}/activity-event`)
      .set('Authorization', `Bearer ${generateToken()}`)
      .expect(200);

    expect(res.body.data.unlinked_activity_id).toBe(500);
  });

  test('404s when the meeting has no linked outing', async () => {
    const { __mClient, __mPool } = require('pg');

    mockQueryImplementation(__mClient, __mPool, (query) => {
      const stub = authStubs(query);
      if (stub) { return stub; }
      if (query.includes('SELECT activity_id FROM year_plan_meetings')) {
        return Promise.resolve({ rows: [{ activity_id: null }] });
      }
      return Promise.resolve({ rows: [] });
    });

    await request(app)
      .delete(`/api/v1/yearly-planner/meetings/${MEETING_ID}/activity-event`)
      .set('Authorization', `Bearer ${generateToken()}`)
      .expect(404);
  });
});

// ==========================================
// PATCH /meetings/:id — regression guards
// ==========================================

describe('PATCH /api/v1/yearly-planner/meetings/:id', () => {
  /**
   * Run a PATCH and return the UPDATE statement and its parameters.
   * @param {Object} body - Request body
   * @param {Object} [meetingOverrides] - Meeting row overrides
   * @returns {Promise<{res: Object, sql: string, params: Array}>} Captured call
   */
  async function patchMeeting(body, meetingOverrides = {}) {
    const { __mClient, __mPool } = require('pg');

    mockQueryImplementation(__mClient, __mPool, (query) => {
      const stub = authStubs(query);
      if (stub) { return stub; }
      if (query.includes('SELECT id, meeting_date FROM year_plan_meetings')) {
        return Promise.resolve({ rows: [meetingRow(meetingOverrides)] });
      }
      if (query.includes('UPDATE year_plan_meetings SET')) {
        return Promise.resolve({ rows: [meetingRow(meetingOverrides)] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .patch(`/api/v1/yearly-planner/meetings/${MEETING_ID}`)
      .set('Authorization', `Bearer ${generateToken()}`)
      .send(body);

    const call = __mPool.query.mock.calls
      .concat(__mClient.query.mock.calls)
      .find(c => String(c[0]).includes('UPDATE year_plan_meetings SET'));

    return { res, sql: call ? String(call[0]) : '', params: call ? call[1] : [] };
  }

  test('a theme-only update leaves period_id alone', async () => {
    // Regression: period_id was assigned unconditionally, so saving a theme
    // silently detached the meeting from its period.
    const { res, sql } = await patchMeeting({ theme: 'Explorateurs' });

    expect(res.status).toBe(200);
    expect(sql).toContain('theme =');
    expect(sql).not.toContain('period_id =');
  });

  test('an empty theme clears the field', async () => {
    // Regression: `theme || null` + COALESCE made theme unclearable.
    const { res, sql, params } = await patchMeeting({ theme: '' });

    expect(res.status).toBe(200);
    expect(sql).toContain('theme =');
    expect(params).toContain('');
  });

  test('period_id is written when explicitly provided', async () => {
    const { sql, params } = await patchMeeting({ period_id: 3 });

    expect(sql).toContain('period_id =');
    expect(params).toContain(3);
  });

  test('period_id can be explicitly cleared with null', async () => {
    const { sql, params } = await patchMeeting({ period_id: null });

    expect(sql).toContain('period_id =');
    expect(params).toContain(null);
  });

  test('an empty body changes nothing', async () => {
    const { res, sql } = await patchMeeting({});

    expect(res.status).toBe(200);
    expect(sql).toBe('');
  });

  test('a past meeting is editable', async () => {
    // Regression: a blanket 409 blocked retro-documenting a meeting, while
    // POST /v1/meetings/preparation rewrote the same row with no such lock.
    const { res } = await patchMeeting({ notes: 'Ce qui est arrive' }, { meeting_date: '2020-01-01' });

    expect(res.status).toBe(200);
  });

  test('cancelling a past meeting with granted honors is refused', async () => {
    const { __mClient, __mPool } = require('pg');

    mockQueryImplementation(__mClient, __mPool, (query) => {
      const stub = authStubs(query);
      if (stub) { return stub; }
      if (query.includes('SELECT id, meeting_date FROM year_plan_meetings')) {
        return Promise.resolve({ rows: [meetingRow({ meeting_date: '2020-01-01' })] });
      }
      if (query.includes('processed = TRUE')) {
        return Promise.resolve({ rows: [{ '?column?': 1 }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .patch(`/api/v1/yearly-planner/meetings/${MEETING_ID}`)
      .set('Authorization', `Bearer ${generateToken()}`)
      .send({ is_cancelled: true })
      .expect(409);

    expect(res.body.message).toBe('meeting_already_processed');
  });

  test('rejects an unknown meeting_kind', async () => {
    const { res } = await patchMeeting({ meeting_kind: 'bogus' });
    expect(res.status).toBe(400);
  });

  test('never lets a request name its own column', async () => {
    const { sql } = await patchMeeting({
      theme: 'ok',
      organization_id: 999,
      id: 1,
      'theme = 1, is_cancelled': true
    });

    // organization_id legitimately appears in the WHERE clause, so assert on
    // the SET clause only.
    const setClause = sql.slice(sql.indexOf('SET'), sql.indexOf('WHERE'));
    expect(setClause).toContain('theme =');
    expect(setClause).not.toContain('organization_id');
    expect(setClause).not.toMatch(/\bid\s*=/);
    expect(setClause).not.toContain('is_cancelled');
  });
});
