/**
 * User stories: points API (routes/points.js).
 *
 * Implements: US-PTS-013, US-PTS-014, US-PTS-015, US-PTS-016, US-PTS-017,
 *             US-PERM-004
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
const GROUP_ID = 5;

function generateToken(overrides = {}) {
  return jwt.sign({
    user_id: '550e8400-e29b-41d4-a716-446655440000',
    organizationId: ORG_ID,
    roleIds: [1],
    roleNames: ['leader'],
    permissions: ['points.view', 'points.manage', 'reports.view'],
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

describe('US-PTS-013 — Group award, server side: attendance decides who gets points', () => {
  /**
   * Group of 3 (ids 1, 2, 3). Attendance taken: 1 present, 3 late, 2 absent.
   */
  function groupAwardHandler({ attendanceTaken }) {
    return (query, params) => {
      if (query.includes('demoadmin')) {
        return { rows: [] };
      }
      if (query.includes('FROM participants p') && query.includes('participant_groups pg')) {
        return { rows: [{ id: 1 }, { id: 2 }, { id: 3 }] };
      }
      if (query.includes('COUNT(*) as count FROM attendance')) {
        return { rows: [{ count: attendanceTaken ? '3' : '0' }] };
      }
      if (query.includes("status IN ('present', 'late')")) {
        return { rows: [{ participant_id: 1, status: 'present' }, { participant_id: 3, status: 'late' }] };
      }
      if (query.includes('INSERT INTO points') && query.includes('VALUES (NULL')) {
        return { rows: [] };
      }
      if (query.includes('INSERT INTO points')) {
        return { rows: [] };
      }
      if (query.includes('GROUP BY participant_id') && Array.isArray(params?.[1])) {
        return {
          rows: params[1].map((id) => ({ id, total: id === 2 ? '10' : '13' }))
        };
      }
      if (query.includes('participant_id IS NULL')) {
        return { rows: [{ total: '23' }] };
      }
      return undefined;
    };
  }

  it('credits present/late members and the group, reporting skipped members with unchanged totals', async () => {
    const recorded = installHandler(groupAwardHandler({ attendanceTaken: true }));

    const res = await request(app)
      .post('/api/v1/points')
      .set('Authorization', `Bearer ${generateToken()}`)
      .send([{ type: 'group', id: GROUP_ID, points: 3, date: '2026-07-15', timestamp: new Date().toISOString() }])
      .expect(200);

    expect(res.body.success).toBe(true);
    const update = res.body.data.updates[0];
    expect(update.type).toBe('group');
    expect(update.id).toBe(GROUP_ID);
    expect(update.totalPoints).toBe(23);
    expect(update.memberIds).toEqual([1, 3]);
    expect(update.skippedCount).toBe(1);
    expect(update.skippedParticipants).toEqual([2]);
    expect(update.memberTotals).toEqual(expect.arrayContaining([
      { id: 1, totalPoints: 13 },
      { id: 3, totalPoints: 13 },
      { id: 2, totalPoints: 10 }
    ]));

    // Group-level record is participant_id NULL; member insert excludes kid 2
    const groupInsert = queriesMatching(recorded, 'VALUES (NULL');
    expect(groupInsert).toHaveLength(1);
    expect(groupInsert[0].params).toEqual([GROUP_ID, ORG_ID, 3]);

    const memberInserts = queriesMatching(recorded, 'INSERT INTO points')
      .filter((entry) => !entry.query.includes('VALUES (NULL'));
    expect(memberInserts).toHaveLength(1);
    expect(memberInserts[0].params).toEqual([1, GROUP_ID, ORG_ID, 3, 3, GROUP_ID, ORG_ID, 3]);
  });

  it('credits every member when no attendance was taken for the date', async () => {
    installHandler(groupAwardHandler({ attendanceTaken: false }));

    const res = await request(app)
      .post('/api/v1/points')
      .set('Authorization', `Bearer ${generateToken()}`)
      .send([{ type: 'group', id: GROUP_ID, points: 3, date: '2026-07-15' }])
      .expect(200);

    const update = res.body.data.updates[0];
    expect(update.memberIds).toEqual([1, 2, 3]);
    expect(update.skippedCount).toBe(0);
    expect(update.skippedParticipants).toEqual([]);
  });

  it('rejects a non-array body with 400', async () => {
    installHandler((query) => (query.includes('demoadmin') ? { rows: [] } : undefined));

    const res = await request(app)
      .post('/api/v1/points')
      .set('Authorization', `Bearer ${generateToken()}`)
      .send({ type: 'group', id: GROUP_ID, points: 3 })
      .expect(400);

    expect(res.body.success).toBe(false);
  });
});

describe('US-PTS-014 — Group and member ledgers never mix (server)', () => {
  it('computes group totals from group rows only and member sums separately', async () => {
    let groupsQuery = null;
    installHandler((query) => {
      if (query.includes('FROM groups g') && query.includes('member_points')) {
        groupsQuery = query;
        return { rows: [{ id: GROUP_ID, name: 'Wolves', total_points: 4, individual_total_points: 12 }] };
      }
      if (query.includes('FROM participants part')) {
        return { rows: [{ id: 20, first_name: 'Alex', last_name: 'River', group_id: GROUP_ID, total_points: 12 }] };
      }
      return undefined;
    });

    const res = await request(app)
      .get('/api/v1/points')
      .set('Authorization', `Bearer ${generateToken()}`)
      .expect(200);

    expect(res.body.groups[0]).toMatchObject({ total_points: 4, individual_total_points: 12 });
    expect(res.body.participants[0]).toMatchObject({ id: 20, total_points: 12 });
    expect(groupsQuery).toContain('participant_id IS NULL');
    expect(groupsQuery).toContain('participant_id IS NOT NULL');
  });
});

describe('US-PTS-015 — You can\'t score another org\'s kid (server)', () => {
  it('rolls the batch back when the participant is not in the caller\'s org', async () => {
    const recorded = installHandler((query) => {
      if (query.includes('demoadmin')) {
        return { rows: [] };
      }
      if (query.includes('participant_organizations po')) {
        return { rows: [] };
      }
      return undefined;
    });

    const res = await request(app)
      .post('/api/v1/points')
      .set('Authorization', `Bearer ${generateToken()}`)
      .send([{ type: 'individual', id: 999, points: 5 }])
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain('node_modules');
    expect(queriesMatching(recorded, 'ROLLBACK')).toHaveLength(1);
    expect(queriesMatching(recorded, 'INSERT INTO points')).toHaveLength(0);
  });
});

describe('US-PTS-016 — Leaderboards for groups and individuals (server)', () => {
  it('serves the group leaderboard from group-attributed rows only', async () => {
    let leaderboardQuery = null;
    installHandler((query) => {
      if (query.includes('member_counts')) {
        leaderboardQuery = query;
        return { rows: [{ id: GROUP_ID, name: 'Wolves', total_points: 4, member_count: 3 }] };
      }
      return undefined;
    });

    const res = await request(app)
      .get('/api/v1/points/leaderboard?type=groups')
      .set('Authorization', `Bearer ${generateToken()}`)
      .expect(200);

    expect(res.body.type).toBe('groups');
    expect(res.body.data[0]).toMatchObject({ total_points: 4, member_count: 3 });
    expect(leaderboardQuery).toContain('participant_id IS NULL');
  });

  it('defaults to the individual leaderboard with the limit applied', async () => {
    let individualParams = null;
    installHandler((query, params) => {
      if (query.includes('FROM participants p') && query.includes('ORDER BY total_points DESC')) {
        individualParams = params;
        return { rows: [{ id: 20, first_name: 'Alex', last_name: 'River', group_name: 'Wolves', total_points: 12 }] };
      }
      return undefined;
    });

    const res = await request(app)
      .get('/api/v1/points/leaderboard?limit=5')
      .set('Authorization', `Bearer ${generateToken()}`)
      .expect(200);

    expect(res.body.type).toBe('individuals');
    expect(res.body.data[0].total_points).toBe(12);
    expect(individualParams).toEqual([ORG_ID, 5]);
  });
});

describe('US-PTS-017 — Full points report (server)', () => {
  it('returns per-participant totals with honor counts, org-scoped', async () => {
    let reportParams = null;
    installHandler((query, params) => {
      if (query.includes('honor_counts')) {
        reportParams = params;
        return {
          rows: [{
            id: 20,
            first_name: 'Alex',
            last_name: 'River',
            group_name: 'Wolves',
            total_points: 12,
            honors_count: 2
          }]
        };
      }
      return undefined;
    });

    const res = await request(app)
      .get('/api/v1/points/report')
      .set('Authorization', `Bearer ${generateToken()}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data[0]).toMatchObject({ total_points: 12, honors_count: 2 });
    expect(reportParams).toEqual([ORG_ID]);
  });
});

describe('US-PERM-004 — Same auth rules on the points API', () => {
  it('401 for visitors', async () => {
    const res = await request(app)
      .post('/api/v1/points')
      .send([])
      .expect(401);
    expect(res.body.success).toBe(false);
  });

  it('403 with required/missing for a user without points.manage', async () => {
    installHandler((query) => {
      if (query.includes('demoadmin')) {
        return { rows: [] };
      }
      if (query.includes('permission_key')) {
        return { rows: [{ permission_key: 'points.view' }] };
      }
      return undefined;
    });

    const res = await request(app)
      .post('/api/v1/points')
      .set('Authorization', `Bearer ${generateToken({ permissions: ['points.view'] })}`)
      .send([])
      .expect(403);

    expect(res.body.required).toEqual(['points.manage']);
    expect(res.body.missing).toEqual(['points.manage']);
  });

  it('403 with isDemo for demo accounts', async () => {
    installHandler((query) => {
      if (query.includes('demoadmin')) {
        return { rows: [{ role_name: 'demoparent' }] };
      }
      return undefined;
    });

    const res = await request(app)
      .post('/api/v1/points')
      .set('Authorization', `Bearer ${generateToken()}`)
      .send([])
      .expect(403);

    expect(res.body.isDemo).toBe(true);
  });
});
