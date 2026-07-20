/**
 * User stories: attendance API (routes/attendance.js).
 *
 * Implements: US-ATT-003, US-ATT-013, US-ATT-014, US-ATT-015, US-ATT-016,
 *             US-PERM-001, US-PERM-002, US-PERM-003
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

function generateToken(overrides = {}) {
  return jwt.sign({
    user_id: LEADER_ID,
    organizationId: ORG_ID,
    roleIds: [1],
    roleNames: ['leader'],
    permissions: ['attendance.view', 'attendance.manage'],
    ...overrides
  }, TEST_SECRET);
}

/**
 * Install a story-specific query handler on top of the factory defaults.
 * Records every (query, params) pair for side-effect assertions.
 */
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

const SIMPLE_RULES = {
  attendance: {
    present: 1,
    absent: 0,
    late: 0,
    excused: 0
  }
};

const OBJECT_RULES = {
  attendance: {
    present: { label: 'present', points: 2 },
    absent: { label: 'absent', points: 0 },
    late: { label: 'late', points: 0 },
    excused: { label: 'excused', points: 0 }
  }
};

/**
 * Handler covering the POST /v1/attendance transaction.
 * @param {string|null} previousStatus - What the server has recorded
 * @param {Object} rules - point_system_rules setting value
 */
function attendancePostHandler(previousStatus, rules) {
  return (query, params) => {
    if (query.includes('demoadmin')) {
      return { rows: [] };
    }
    if (query.includes('FOR UPDATE')) {
      return { rows: previousStatus ? [{ status: previousStatus }] : [] };
    }
    if (query.includes('INSERT INTO attendance')) {
      return {
        rows: [{
          id: 77,
          participant_id: params[0],
          date: params[1],
          status: params[2],
          organization_id: params[3]
        }]
      };
    }
    if (query.includes('organization_settings') && query.includes('point_system_rules')) {
      return { rows: [{ setting_value: rules }] };
    }
    if (query.includes('INSERT INTO points')) {
      return { rows: [] };
    }
    return undefined;
  };
}

describe('US-ATT-003 — First-time marking earns the right points (server)', () => {
  it('inserts a +1 points row when marking present with no recorded baseline', async () => {
    const recorded = installHandler(attendancePostHandler(null, SIMPLE_RULES));

    const res = await request(app)
      .post('/api/v1/attendance')
      .set('Authorization', `Bearer ${generateToken()}`)
      .send({ participant_id: 12, date: '2026-07-15', status: 'present' })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.previous_status).toBeNull();
    expect(res.body.data.status).toBe('present');

    const pointInserts = queriesMatching(recorded, 'INSERT INTO points');
    expect(pointInserts).toHaveLength(1);
    expect(pointInserts[0].params).toEqual([12, 1, ORG_ID]);
  });

  it('falls back to the shared default rules when no point_system_rules setting exists', async () => {
    const recorded = installHandler((query, params) => {
      if (query.includes('demoadmin')) {
        return { rows: [] };
      }
      if (query.includes('FOR UPDATE')) {
        return { rows: [{ status: 'absent' }] };
      }
      if (query.includes('INSERT INTO attendance')) {
        return {
          rows: [{
            id: 78,
            participant_id: params[0],
            date: params[1],
            status: params[2],
            organization_id: params[3]
          }]
        };
      }
      if (query.includes('organization_settings') && query.includes('point_system_rules')) {
        return { rows: [] };
      }
      if (query.includes('INSERT INTO points')) {
        return { rows: [] };
      }
      return undefined;
    });

    await request(app)
      .post('/api/v1/attendance')
      .set('Authorization', `Bearer ${generateToken()}`)
      .send({ participant_id: 12, date: '2026-07-15', status: 'present' })
      .expect(201);

    const pointInserts = queriesMatching(recorded, 'INSERT INTO points');
    expect(pointInserts).toHaveLength(1);
    expect(pointInserts[0].params).toEqual([12, 1, ORG_ID]);
  });

  it('inserts nothing when the status did not change', async () => {
    const recorded = installHandler(attendancePostHandler('present', SIMPLE_RULES));

    const res = await request(app)
      .post('/api/v1/attendance')
      .set('Authorization', `Bearer ${generateToken()}`)
      .send({ participant_id: 12, date: '2026-07-15', status: 'present' })
      .expect(201);

    expect(res.body.data.previous_status).toBe('present');
    expect(queriesMatching(recorded, 'INSERT INTO points')).toHaveLength(0);
  });

  it('supports the {present: {points: N}} object rule shape', async () => {
    const recorded = installHandler(attendancePostHandler('absent', OBJECT_RULES));

    await request(app)
      .post('/api/v1/attendance')
      .set('Authorization', `Bearer ${generateToken()}`)
      .send({ participant_id: 12, date: '2026-07-15', status: 'present' })
      .expect(201);

    const pointInserts = queriesMatching(recorded, 'INSERT INTO points');
    expect(pointInserts).toHaveLength(1);
    expect(pointInserts[0].params).toEqual([12, 2, ORG_ID]);
  });

  it('inserts a negative adjustment when a present kid becomes absent', async () => {
    const recorded = installHandler(attendancePostHandler('present', SIMPLE_RULES));

    await request(app)
      .post('/api/v1/attendance')
      .set('Authorization', `Bearer ${generateToken()}`)
      .send({ participant_id: 12, date: '2026-07-15', status: 'absent' })
      .expect(201);

    const pointInserts = queriesMatching(recorded, 'INSERT INTO points');
    expect(pointInserts).toHaveLength(1);
    expect(pointInserts[0].params).toEqual([12, -1, ORG_ID]);
  });
});

describe('US-ATT-013 — Every camp day is selectable as soon as the activity exists (server)', () => {
  it('unions attendance, meeting and activity-range dates with the 31-day guard', async () => {
    let datesQuery = null;
    let datesParams = null;
    installHandler((query, params) => {
      if (query.includes('generate_series')) {
        datesQuery = query;
        datesParams = params;
        return { rows: [{ date: '2026-07-16' }, { date: '2026-07-15' }, { date: '2026-07-14' }] };
      }
      return undefined;
    });

    const res = await request(app)
      .get('/api/v1/attendance/dates')
      .set('Authorization', `Bearer ${generateToken()}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual(['2026-07-16', '2026-07-15', '2026-07-14']);
    expect(datesQuery).toContain('generate_series');
    expect(datesQuery).toContain('is_active');
    expect(datesQuery).toContain('reunion_preparations');
    expect(datesParams).toEqual([ORG_ID, 31]);
  });
});

describe('US-ATT-014 — The attendance API keeps orgs sealed off (server)', () => {
  it('binds organization_id from the token on the attendance list query', async () => {
    let listQuery = null;
    let listParams = null;
    installHandler((query, params) => {
      if (query.includes('FROM attendance a')) {
        listQuery = query;
        listParams = params;
        return { rows: [] };
      }
      return undefined;
    });

    const res = await request(app)
      .get('/api/v1/attendance?date=2026-07-15')
      // A hostile client header must not override the token's organization
      .set('x-organization-id', '999')
      .set('Authorization', `Bearer ${generateToken()}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(listQuery).toContain('a.organization_id = $1');
    expect(listParams[0]).toBe(ORG_ID);
    expect(listParams).not.toContain(999);
    expect(listParams).not.toContain('999');
  });
});

describe('US-ATT-015 — Server-side carry-forward copies only what it should', () => {
  function carryForwardHandler(sourceRows) {
    return (query) => {
      if (query.includes('demoadmin')) {
        return { rows: [] };
      }
      if (query.includes('NOT EXISTS')) {
        return { rows: sourceRows };
      }
      if (query.includes('INSERT INTO attendance')) {
        return { rows: [] };
      }
      return undefined;
    };
  }

  it('copies present/late rows that have no target-date record', async () => {
    const recorded = installHandler(carryForwardHandler([
      { participant_id: 1, status: 'present' },
      { participant_id: 2, status: 'late' }
    ]));

    const res = await request(app)
      .post('/api/v1/attendance/carry-forward')
      .set('Authorization', `Bearer ${generateToken()}`)
      .send({ fromDate: '2026-07-14', toDate: '2026-07-15' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.copiedCount).toBe(2);
    expect(res.body.data.participants).toEqual([1, 2]);

    const sourceSelect = queriesMatching(recorded, 'NOT EXISTS')[0];
    expect(sourceSelect.query).toContain("status IN ('present', 'late')");

    const inserts = queriesMatching(recorded, 'INSERT INTO attendance');
    expect(inserts).toHaveLength(1);
    expect(inserts[0].params).toEqual([
      1, '2026-07-15', 'present', ORG_ID,
      2, '2026-07-15', 'late', ORG_ID
    ]);
  });

  it('reports zero copies without inserting when nothing qualifies', async () => {
    const recorded = installHandler(carryForwardHandler([]));

    const res = await request(app)
      .post('/api/v1/attendance/carry-forward')
      .set('Authorization', `Bearer ${generateToken()}`)
      .send({ fromDate: '2026-07-14', toDate: '2026-07-15' })
      .expect(200);

    expect(res.body.data.copiedCount).toBe(0);
    expect(queriesMatching(recorded, 'INSERT INTO attendance')).toHaveLength(0);
  });

  it('rejects missing dates and identical dates with 400', async () => {
    installHandler((query) => (query.includes('demoadmin') ? { rows: [] } : undefined));

    const missing = await request(app)
      .post('/api/v1/attendance/carry-forward')
      .set('Authorization', `Bearer ${generateToken()}`)
      .send({ fromDate: '2026-07-14' })
      .expect(400);
    expect(missing.body.success).toBe(false);

    const same = await request(app)
      .post('/api/v1/attendance/carry-forward')
      .set('Authorization', `Bearer ${generateToken()}`)
      .send({ fromDate: '2026-07-14', toDate: '2026-07-14' })
      .expect(400);
    expect(same.body.success).toBe(false);
  });
});

describe('US-ATT-016 — Clearing a day removes only that org\'s records (server)', () => {
  it('requires a date', async () => {
    installHandler((query) => (query.includes('demoadmin') ? { rows: [] } : undefined));

    const res = await request(app)
      .delete('/api/v1/attendance')
      .set('Authorization', `Bearer ${generateToken()}`)
      .expect(400);
    expect(res.body.success).toBe(false);
  });

  it('deletes rows scoped to (organization, date) and reports the count', async () => {
    const recorded = installHandler((query) => {
      if (query.includes('demoadmin')) {
        return { rows: [] };
      }
      if (query.includes('DELETE FROM attendance')) {
        return { rows: [], rowCount: 3 };
      }
      return undefined;
    });

    const res = await request(app)
      .delete('/api/v1/attendance?date=2026-07-15')
      .set('Authorization', `Bearer ${generateToken()}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.deleted).toBe(3);

    const deletes = queriesMatching(recorded, 'DELETE FROM attendance');
    expect(deletes).toHaveLength(1);
    expect(deletes[0].params).toEqual([ORG_ID, '2026-07-15']);
  });
});

describe('US-PERM-001 — Visitors are turned away', () => {
  it('returns 401 with the standard error envelope when no token is sent', async () => {
    const res = await request(app)
      .get('/api/v1/attendance')
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/authentication required/i);
  });
});

describe('US-PERM-002 — Missing permission is explained', () => {
  it('returns 403 with required and missing arrays for a view-only parent', async () => {
    installHandler((query) => {
      if (query.includes('demoadmin')) {
        return { rows: [] };
      }
      if (query.includes('permission_key')) {
        return { rows: [{ permission_key: 'attendance.view' }] };
      }
      return undefined;
    });

    const res = await request(app)
      .post('/api/v1/attendance')
      .set('Authorization', `Bearer ${generateToken({ permissions: ['attendance.view'] })}`)
      .send({ participant_id: 12, date: '2026-07-15', status: 'present' })
      .expect(403);

    expect(res.body.success).toBe(false);
    expect(res.body.required).toEqual(['attendance.manage']);
    expect(res.body.missing).toEqual(['attendance.manage']);
  });
});

describe('US-PERM-003 — Demo accounts are read-only', () => {
  it('returns 403 with isDemo: true when a demo role attempts a write', async () => {
    installHandler((query) => {
      if (query.includes('demoadmin')) {
        return { rows: [{ role_name: 'demoadmin' }] };
      }
      return undefined;
    });

    const res = await request(app)
      .post('/api/v1/attendance')
      .set('Authorization', `Bearer ${generateToken()}`)
      .send({ participant_id: 12, date: '2026-07-15', status: 'present' })
      .expect(403);

    expect(res.body.success).toBe(false);
    expect(res.body.isDemo).toBe(true);
  });
});
