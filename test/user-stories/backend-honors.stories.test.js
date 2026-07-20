/**
 * User stories: honors API (routes/honors.js).
 *
 * Implements: US-HON-004, US-HON-005, US-HON-006, US-HON-007, US-HON-015
 * Catalog: test/user-stories/CATALOG.md
 *
 * NOTE: US-HON-005 is EXPECTED TO FAIL against current code — the batch honor
 * INSERT hardcodes $5 as the created_by placeholder while parameters are laid
 * out per-honor (routes/honors.js:213-221). See RUN-REPORT.md.
 */

'use strict';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { closeServerResources } = require('../test-helpers');
const { maxPlaceholder } = require('./helpers/story-helpers');

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
const HONOR_POINTS = 5;

function generateToken(overrides = {}) {
  return jwt.sign({
    user_id: LEADER_ID,
    organizationId: ORG_ID,
    roleIds: [1],
    roleNames: ['leader'],
    permissions: ['honors.view', 'honors.create'],
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

/**
 * Handler for the POST /v1/honors transaction.
 * @param {Object} options
 * @param {Array} options.existing - Existing (participant_id, date) honor rows
 * @param {Array} options.insertedRows - Rows returned by the honors INSERT
 */
function awardHandler({ existing = [], insertedRows = [] } = {}) {
  return (query) => {
    if (query.includes('demoadmin')) {
      return { rows: [] };
    }
    if (query.includes('organization_settings') && query.includes('point_system_rules')) {
      return { rows: [{ setting_value: { honors: { award: HONOR_POINTS } } }] };
    }
    if (query.includes('FROM honors') && query.includes('ANY($2::int[])')) {
      return { rows: existing };
    }
    if (query.includes('FROM participant_groups') && query.includes('ANY($2::int[])')) {
      return { rows: [{ participant_id: 1, group_id: 5 }, { participant_id: 2, group_id: 5 }] };
    }
    if (query.includes('INSERT INTO honors')) {
      return { rows: insertedRows };
    }
    if (query.includes('INSERT INTO points')) {
      return { rows: [] };
    }
    return undefined;
  };
}

describe('US-HON-004 — Awarding one honor also awards its points (server)', () => {
  it('inserts the honor plus a rule-driven points row linked by honor_id', async () => {
    const recorded = installHandler(awardHandler({
      insertedRows: [{ id: 42, participant_id: 1, date: '2026-07-15' }]
    }));

    const res = await request(app)
      .post('/api/v1/honors')
      .set('Authorization', `Bearer ${generateToken()}`)
      .send([{ participantId: 1, date: '2026-07-15', reason: 'Helped set up camp' }])
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.results[0]).toMatchObject({
      participantId: 1,
      success: true,
      action: 'awarded',
      points: HONOR_POINTS,
      honorId: 42
    });

    const pointInserts = queriesMatching(recorded, 'INSERT INTO points');
    expect(pointInserts).toHaveLength(1);
    expect(pointInserts[0].params).toEqual([1, 5, HONOR_POINTS, '2026-07-15', ORG_ID, 42]);
  });

  it('reports already_awarded without inserting a duplicate', async () => {
    const recorded = installHandler(awardHandler({
      existing: [{ participant_id: 1, date: '2026-07-15' }]
    }));

    const res = await request(app)
      .post('/api/v1/honors')
      .set('Authorization', `Bearer ${generateToken()}`)
      .send([{ participantId: 1, date: '2026-07-15', reason: 'Again' }])
      .expect(200);

    expect(res.body.data.results[0]).toMatchObject({ participantId: 1, action: 'already_awarded' });
    expect(queriesMatching(recorded, 'INSERT INTO honors')).toHaveLength(0);
    expect(queriesMatching(recorded, 'INSERT INTO points')).toHaveLength(0);
  });

  it('rejects entries missing participant or date without failing the batch', async () => {
    installHandler(awardHandler({}));

    const res = await request(app)
      .post('/api/v1/honors')
      .set('Authorization', `Bearer ${generateToken()}`)
      .send([{ reason: 'No kid named' }])
      .expect(200);

    expect(res.body.data.results[0].success).toBe(false);
  });
});

describe('US-HON-005 — Awarding several honors at once must work (server)', () => {
  it('binds a consistent parameter list with created_by = the awarding user for every row', async () => {
    const recorded = installHandler(awardHandler({
      insertedRows: [
        { id: 42, participant_id: 1, date: '2026-07-15' },
        { id: 43, participant_id: 2, date: '2026-07-15' }
      ]
    }));

    await request(app)
      .post('/api/v1/honors')
      .set('Authorization', `Bearer ${generateToken()}`)
      .send([
        { participantId: 1, date: '2026-07-15', reason: 'Led the hike' },
        { participantId: 2, date: '2026-07-15', reason: 'Cooked dinner' }
      ])
      .expect(200);

    const honorInserts = queriesMatching(recorded, 'INSERT INTO honors');
    expect(honorInserts).toHaveLength(1);
    const { query, params } = honorInserts[0];

    // On real PostgreSQL, a bind-count mismatch aborts the whole batch:
    // the highest $N placeholder must equal the number of parameters sent.
    expect(maxPlaceholder(query)).toBe(params.length);

    // And the created_by placeholder must reference the awarding user, not a
    // participant id from another row's parameter block.
    const createdByPlaceholder = `$${params.indexOf(LEADER_ID) + 1}`;
    expect(params).toContain(LEADER_ID);
    const rowClauses = query.slice(query.indexOf('VALUES')).split('),');
    rowClauses.forEach((clause) => {
      expect(clause).toContain(createdByPlaceholder);
    });
  });
});

describe('US-HON-006 — Fixing an honor\'s date moves its points too (server)', () => {
  function patchHandler({ found = true } = {}) {
    return (query) => {
      if (query.includes('demoadmin')) {
        return { rows: [] };
      }
      if (query.includes('FROM honors h') && query.includes('po.organization_id = $2')) {
        return { rows: found ? [{ id: 42, date: '2026-07-10', participant_id: 1 }] : [] };
      }
      if (query.includes('UPDATE honors')) {
        return { rows: [{ id: 42, date: '2026-07-15', reason: 'moved' }] };
      }
      if (query.includes('UPDATE points')) {
        return { rows: [] };
      }
      return undefined;
    };
  }

  it('rejects an empty patch, a malformed date, and an oversized reason', async () => {
    installHandler(patchHandler({}));

    const empty = await request(app)
      .patch('/api/v1/honors/42')
      .set('Authorization', `Bearer ${generateToken()}`)
      .send({})
      .expect(400);
    expect(empty.body.success).toBe(false);

    await request(app)
      .patch('/api/v1/honors/42')
      .set('Authorization', `Bearer ${generateToken()}`)
      .send({ date: '15-07-2026' })
      .expect(400);

    await request(app)
      .patch('/api/v1/honors/42')
      .set('Authorization', `Bearer ${generateToken()}`)
      .send({ reason: 'x'.repeat(1001) })
      .expect(400);
  });

  it('returns 404 for an honor outside the caller\'s organization', async () => {
    installHandler(patchHandler({ found: false }));

    const res = await request(app)
      .patch('/api/v1/honors/42')
      .set('Authorization', `Bearer ${generateToken()}`)
      .send({ date: '2026-07-15' })
      .expect(404);
    expect(res.body.success).toBe(false);
  });

  it('updates the honor and syncs its points row date', async () => {
    const recorded = installHandler(patchHandler({}));

    const res = await request(app)
      .patch('/api/v1/honors/42')
      .set('Authorization', `Bearer ${generateToken()}`)
      .send({ date: '2026-07-15' })
      .expect(200);

    expect(res.body.success).toBe(true);
    const pointsSync = queriesMatching(recorded, 'UPDATE points');
    expect(pointsSync).toHaveLength(1);
    expect(pointsSync[0].params).toEqual(['2026-07-15', 42, ORG_ID]);
  });
});

describe('US-HON-007 — Deleting an honor removes its points (server)', () => {
  function deleteHandler({ found = true } = {}) {
    return (query) => {
      if (query.includes('demoadmin')) {
        return { rows: [] };
      }
      if (query.includes('FROM honors h') && query.includes('first_name')) {
        return {
          rows: found
            ? [{ id: 42, participant_id: 1, date: '2026-07-15', reason: 'r', first_name: 'Alex', last_name: 'River' }]
            : []
        };
      }
      if (query.includes('DELETE FROM points')) {
        return { rows: [{ id: 7, value: HONOR_POINTS }] };
      }
      if (query.includes('DELETE FROM honors')) {
        return { rows: [] };
      }
      return undefined;
    };
  }

  it('returns 404 for an unknown or foreign honor', async () => {
    installHandler(deleteHandler({ found: false }));

    await request(app)
      .delete('/api/v1/honors/42')
      .set('Authorization', `Bearer ${generateToken()}`)
      .expect(404);
  });

  it('deletes the linked points in the same transaction and reports the count', async () => {
    const recorded = installHandler(deleteHandler({}));

    const res = await request(app)
      .delete('/api/v1/honors/42')
      .set('Authorization', `Bearer ${generateToken()}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ deleted: true, honorId: 42, pointsRemoved: 1 });

    const pointDeletes = queriesMatching(recorded, 'DELETE FROM points');
    expect(pointDeletes).toHaveLength(1);
    expect(pointDeletes[0].params).toEqual([42, ORG_ID]);
    expect(queriesMatching(recorded, 'DELETE FROM honors')).toHaveLength(1);
  });
});

describe('US-HON-015 — Honors API envelope and org isolation (server)', () => {
  it('GET /v1/honors returns participants, honors and availableDates in one envelope', async () => {
    const recorded = installHandler((query) => {
      if (query.includes('p.id as participant_id')) {
        return { rows: [{ participant_id: 1, first_name: 'Alex', last_name: 'River', group_id: 5, group_name: 'Wolves' }] };
      }
      if (query.includes('DISTINCT date::text')) {
        return { rows: [{ date: '2026-07-15' }] };
      }
      if (query.includes('h.created_by')) {
        return { rows: [{ id: 42, participant_id: 1, date: '2026-07-15', reason: 'r', created_at: '2026-07-15T01:00:00Z' }] };
      }
      return undefined;
    });

    const res = await request(app)
      .get('/api/v1/honors?date=2026-07-15')
      .set('Authorization', `Bearer ${generateToken()}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.participants).toHaveLength(1);
    expect(res.body.data.honors).toHaveLength(1);
    expect(res.body.data.availableDates).toEqual(['2026-07-15']);

    recorded
      .filter((entry) => entry.query.includes('FROM honors') || entry.query.includes('FROM participants'))
      .forEach((entry) => {
        expect(entry.params[0]).toBe(ORG_ID);
      });
  });

  it('GET /v1/honors/history applies filters only when supplied', async () => {
    let historyQuery = null;
    let historyParams = null;
    installHandler((query, params) => {
      if (query.includes('g.name as group_name') && query.includes('FROM honors h')) {
        historyQuery = query;
        historyParams = params;
        return { rows: [] };
      }
      if (query.includes('honor_count')) {
        return { rows: [] };
      }
      return undefined;
    });

    await request(app)
      .get('/api/v1/honors/history?start_date=2026-07-01&participant_id=1')
      .set('Authorization', `Bearer ${generateToken()}`)
      .expect(200);

    expect(historyQuery).toContain('h.date >= $2');
    expect(historyQuery).toContain('h.participant_id = $3');
    expect(historyQuery).not.toContain('h.date <= ');
    expect(historyParams).toEqual([ORG_ID, '2026-07-01', '1']);
  });
});
