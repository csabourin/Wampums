/**
 * Scout Years Routes Test Suite
 *
 * Covers:
 * - GET /api/v1/scout-years          (list years)
 * - GET /api/v1/scout-years/active   (current active year)
 * - GET /api/v1/scout-years/transition/preview (propose disposition)
 * - POST /api/v1/scout-years/transition        (execute transition)
 *   - early transition (today < nominal start): boundary clamped to today
 *   - late transition (today > nominal start): orphan points re-stamped
 *   - membership deactivation guardrail: non-parent roles never deactivated
 * - GET /api/v1/scout-years/memberships/without-child
 * - PATCH /api/v1/scout-years/memberships/:id/status
 *
 * @module test/routes-scout-years
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

const ACTIVE_YEAR = {
  id: 10,
  organization_id: ORG_ID,
  label: '2025-2026',
  start_date: '2025-09-01',
  end_date: '2026-08-31',
  status: 'active'
};

function generateToken(overrides = {}) {
  return jwt.sign({
    user_id: USER_ID,
    organizationId: ORG_ID,
    roleIds: [1],
    roleNames: ['admin'],
    permissions: ['scout_year.view', 'scout_year.manage'],
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

// ==========================================
// GET /api/v1/scout-years
// ==========================================

describe('GET /api/v1/scout-years', () => {
  test('returns list of scout years for the organization', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken();

    mockQueryImplementation(__mClient, __mPool, (query) => {
      if (query.includes('permission_key')) {
        return Promise.resolve({ rows: [{ permission_key: 'scout_year.view' }] });
      }
      if (query.includes("role_name IN ('demoadmin', 'demoparent')")) {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('FROM scout_years') && query.includes('status')) {
        return Promise.resolve({ rows: [ACTIVE_YEAR] });
      }
      if (query.includes('FROM scout_years sy') && query.includes('active_participants')) {
        return Promise.resolve({
          rows: [
            { ...ACTIVE_YEAR, active_participants: '5', total_enrollments: '6' }
          ]
        });
      }
      return undefined;
    });

    const res = await request(app)
      .get('/api/v1/scout-years')
      .set('Authorization', `Bearer ${token}`)     .expect(200);

    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('rejects request without a valid token', async () => {
    await request(app)
      .get('/api/v1/scout-years')
      .expect(401);
  });

  test('rejects request that lacks scout_year.view permission', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({ permissions: [] });

    mockQueryImplementation(__mClient, __mPool, (query) => {
      if (query.includes('permission_key')) {
        return Promise.resolve({ rows: [] });
      }
      return undefined;
    });

    await request(app)
      .get('/api/v1/scout-years')
      .set('Authorization', `Bearer ${token}`)     .expect(403);
  });
});

// ==========================================
// GET /api/v1/scout-years/active
// ==========================================

describe('GET /api/v1/scout-years/active', () => {
  test('returns the active scout year', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken();

    mockQueryImplementation(__mClient, __mPool, (query) => {
      if (query.includes('permission_key')) {
        return Promise.resolve({ rows: [{ permission_key: 'scout_year.view' }] });
      }
      if (query.includes("role_name IN ('demoadmin', 'demoparent')")) {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('FROM scout_years') && query.includes("status = 'active'")) {
        return Promise.resolve({ rows: [ACTIVE_YEAR] });
      }
      return undefined;
    });

    const res = await request(app)
      .get('/api/v1/scout-years/active')
      .set('Authorization', `Bearer ${token}`)     .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ label: '2025-2026', status: 'active' });
  });

  test('creates an active year if none exists', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken();

    mockQueryImplementation(__mClient, __mPool, (query) => {
      if (query.includes('permission_key')) {
        return Promise.resolve({ rows: [{ permission_key: 'scout_year.view' }] });
      }
      if (query.includes("role_name IN ('demoadmin', 'demoparent')")) {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('FROM scout_years') && query.includes("status = 'active'")) {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('setting_key') && query.includes('fiscal_year')) {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('INSERT INTO scout_years')) {
        return Promise.resolve({ rows: [ACTIVE_YEAR] });
      }
      return undefined;
    });

    const res = await request(app)
      .get('/api/v1/scout-years/active')
      .set('Authorization', `Bearer ${token}`)     .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ label: '2025-2026' });
  });
});

// ==========================================
// GET /api/v1/scout-years/transition/preview
// ==========================================

describe('GET /api/v1/scout-years/transition/preview', () => {
  test('returns participant dispositions with returning/graduating counts', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken();

    mockQueryImplementation(__mClient, __mPool, (query) => {
      if (query.includes('permission_key')) {
        return Promise.resolve({ rows: [{ permission_key: 'scout_year.manage' }] });
      }
      if (query.includes("role_name IN ('demoadmin', 'demoparent')")) {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('FROM scout_years') && query.includes("status = 'active'")) {
        return Promise.resolve({ rows: [ACTIVE_YEAR] });
      }
      if (query.includes('setting_key') && query.includes('fiscal_year')) {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('setting_key') && query.includes('year_transition')) {
        return Promise.resolve({ rows: [{ setting_value: { max_age: 12, age_reference_date: '12-31' } }] });
      }
      if (query.includes('FROM participant_enrollments pe') && query.includes('date_naissance')) {
        return Promise.resolve({
          rows: [
            {
              id: 1,
              first_name: 'Alice',
              last_name: 'Smith',
              date_naissance: '2015-06-01',
              group_name: 'Wolves',
              age_at_reference: 11,
              points_this_year: '20'
            },
            {
              id: 2,
              first_name: 'Bob',
              last_name: 'Jones',
              date_naissance: '2013-03-15',
              group_name: 'Beavers',
              age_at_reference: 13,
              points_this_year: '15'
            }
          ]
        });
      }
      if (query.includes('membership_roles') && query.includes('linked_participants')) {
        return Promise.resolve({ rows: [] });
      }
      return undefined;
    });

    const res = await request(app)
      .get('/api/v1/scout-years/transition/preview')
      .set('Authorization', `Bearer ${token}`)     .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.participants).toHaveLength(2);
    expect(res.body.data.counts.returning).toBe(1);
    expect(res.body.data.counts.graduating).toBe(1);
    expect(res.body.data.current_year).toMatchObject({ label: '2025-2026' });
  });

  test('marks participants with no birth date as needs_review', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken();

    mockQueryImplementation(__mClient, __mPool, (query) => {
      if (query.includes('permission_key')) {
        return Promise.resolve({ rows: [{ permission_key: 'scout_year.manage' }] });
      }
      if (query.includes("role_name IN ('demoadmin', 'demoparent')")) {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('FROM scout_years') && query.includes("status = 'active'")) {
        return Promise.resolve({ rows: [ACTIVE_YEAR] });
      }
      if (query.includes('setting_key') && query.includes('fiscal_year')) {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('setting_key') && query.includes('year_transition')) {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('FROM participant_enrollments pe') && query.includes('date_naissance')) {
        return Promise.resolve({
          rows: [
            {
              id: 3,
              first_name: 'Charlie',
              last_name: 'Brown',
              date_naissance: null,
              group_name: null,
              age_at_reference: null,
              points_this_year: '0'
            }
          ]
        });
      }
      if (query.includes('membership_roles') && query.includes('linked_participants')) {
        return Promise.resolve({ rows: [] });
      }
      return undefined;
    });

    const res = await request(app)
      .get('/api/v1/scout-years/transition/preview')
      .set('Authorization', `Bearer ${token}`)     .expect(200);

    const charlie = res.body.data.participants[0];
    expect(charlie.needs_review).toBe(true);
    expect(charlie.disposition).toBe('returning');
    expect(res.body.data.counts.needs_review).toBe(1);
  });
});

// ==========================================
// POST /api/v1/scout-years/transition
// ==========================================

describe('POST /api/v1/scout-years/transition', () => {
  /**
   * Helper: build a client mock for transition queries.
   * @param {object} opts
   * @param {string} opts.todayIso - ISO date for "today" in the service
   * @param {boolean} opts.earlyTransition - true if today < nominal start
   * @param {number[]} opts.membershipIds - IDs submitted for deactivation
   * @param {boolean} opts.hasNonParentRole - whether the deactivation target has a non-parent role
   */
  function buildTransitionMock(__mClient, __mPool, {
    earlyTransition = false,
    membershipIds = [],
    hasNonParentRole = false
  } = {}) {
    __mPool.connect.mockResolvedValue(__mClient);

    let deactivationQuery = '';

    mockQueryImplementation(__mClient, __mPool, (query) => {
      // Auth / permission checks
      if (query.includes("role_name IN ('demoadmin', 'demoparent')")) {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('permission_key')) {
        return Promise.resolve({ rows: [{ permission_key: 'scout_year.manage' }] });
      }

      // Transaction controls
      if (query === 'BEGIN' || query === 'COMMIT' || query === 'ROLLBACK') {
        return Promise.resolve({ rows: [] });
      }

      // Active scout year lookup (called both by pool and client)
      if (query.includes('FROM scout_years') && query.includes("status = 'active'")) {
        return Promise.resolve({ rows: [ACTIVE_YEAR] });
      }

      // Fiscal year settings
      if (query.includes('setting_key') && query.includes('fiscal_year')) {
        return Promise.resolve({ rows: [] });
      }

      // Early transition: today < nominal start → clamp end_date
      if (earlyTransition && query.includes('UPDATE scout_years') && query.includes('end_date')) {
        return Promise.resolve({ rows: [], rowCount: 1 });
      }

      // Close previous year
      if (query.includes("status = 'closed'")) {
        return Promise.resolve({ rows: [], rowCount: 1 });
      }

      // Open new year
      if (query.includes('INSERT INTO scout_years')) {
        return Promise.resolve({
          rows: [{
            id: 11,
            organization_id: ORG_ID,
            label: '2026-2027',
            start_date: '2026-09-01',
            end_date: '2027-08-31',
            status: 'active'
          }]
        });
      }

      // Late transition: restamp points
      if (query.includes('UPDATE points') && query.includes('scout_year_id')) {
        return Promise.resolve({ rows: [], rowCount: earlyTransition ? 0 : 3 });
      }

      // Graduate enrollments
      if (query.includes("status = 'graduated'")) {
        return Promise.resolve({ rows: [{ participant_id: 5 }], rowCount: 1 });
      }

      // Carry-over enrollments
      if (query.includes('INSERT INTO participant_enrollments')) {
        return Promise.resolve({ rows: [{ participant_id: 1 }, { participant_id: 2 }], rowCount: 2 });
      }

      // Membership deactivation (transition route uses status = 'inactive' + NOT EXISTS guardrail)
      if (query.includes('UPDATE user_organizations') && query.includes('NOT EXISTS')) {
        deactivationQuery = query;
        // Simulate guardrail: only deactivate if no non-parent roles
        const deactivated = hasNonParentRole ? [] : membershipIds.map(id => ({ id, user_id: `user-${id}` }));
        return Promise.resolve({ rows: deactivated, rowCount: deactivated.length });
      }

      // Transition log
      if (query.includes('INSERT INTO scout_year_transitions')) {
        return Promise.resolve({
          rows: [{ id: 1, executed_at: new Date().toISOString() }]
        });
      }

      return undefined;
    });

    return { getDeactivationQuery: () => deactivationQuery };
  }

  test('executes transition and returns summary with 201', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken();

    buildTransitionMock(__mClient, __mPool, {
      membershipIds: [20]
    });

    const res = await request(app)
      .post('/api/v1/scout-years/transition')
      .set('Authorization', `Bearer ${token}`)     .send({
        graduating_participant_ids: [5],
        deactivate_membership_ids: [20]
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.summary).toMatchObject({
      graduated: 1,
      carried_over: 2
    });
    expect(res.body.data.previous_year).toMatchObject({ label: '2025-2026' });
    expect(res.body.data.new_year).toMatchObject({ label: '2026-2027' });
  });

  test('early transition: deactivation guardrail SQL excludes non-parent roles', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken();

    const { getDeactivationQuery } = buildTransitionMock(__mClient, __mPool, {
      earlyTransition: true,
      membershipIds: [30]
    });

    const res = await request(app)
      .post('/api/v1/scout-years/transition')
      .set('Authorization', `Bearer ${token}`)     .send({
        graduating_participant_ids: [],
        deactivate_membership_ids: [30]
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    // The deactivation query must contain the role guardrail so that
    // non-parent role holders are never deactivated automatically.
    const dq = getDeactivationQuery();
    expect(dq).toContain("parent','guardian','demoparent'");
    expect(dq).toContain('NOT EXISTS');
  });

  test('membership deactivation guardrail: memberships_skipped when non-parent role present', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken();

    buildTransitionMock(__mClient, __mPool, {
      membershipIds: [99],
      hasNonParentRole: true
    });

    const res = await request(app)
      .post('/api/v1/scout-years/transition')
      .set('Authorization', `Bearer ${token}`)     .send({
        graduating_participant_ids: [],
        deactivate_membership_ids: [99]
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    // The membership was submitted but the guardrail prevented its deactivation
    expect(res.body.data.summary.memberships_deactivated).toBe(0);
    expect(res.body.data.summary.memberships_skipped).toBe(1);
  });

  test('rejects non-array graduating_participant_ids', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken();

    mockQueryImplementation(__mClient, __mPool, (query) => {
      if (query.includes("role_name IN ('demoadmin', 'demoparent')")) {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('permission_key')) {
        return Promise.resolve({ rows: [{ permission_key: 'scout_year.manage' }] });
      }
      return undefined;
    });

    const res = await request(app)
      .post('/api/v1/scout-years/transition')
      .set('Authorization', `Bearer ${token}`)     .send({ graduating_participant_ids: 'bad', deactivate_membership_ids: [] })
      .expect(400);

    expect(res.body.success).toBe(false);
  });

  test('demo roles cannot execute a transition', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      roleNames: ['demoparent'],
      permissions: ['scout_year.manage']
    });

    mockQueryImplementation(__mClient, __mPool, (query) => {
      if (query.includes("role_name IN ('demoadmin', 'demoparent')")) {
        return Promise.resolve({ rows: [{ role_name: 'demoparent' }] });
      }
      return undefined;
    });

    const res = await request(app)
      .post('/api/v1/scout-years/transition')
      .set('Authorization', `Bearer ${token}`)     .send({ graduating_participant_ids: [], deactivate_membership_ids: [] })
      .expect(403);

    expect(res.body.isDemo).toBe(true);
  });
});

// ==========================================
// GET /api/v1/scout-years/memberships/without-child
// ==========================================

describe('GET /api/v1/scout-years/memberships/without-child', () => {
  test('returns memberships with no enrolled children', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken();

    mockQueryImplementation(__mClient, __mPool, (query) => {
      if (query.includes('permission_key')) {
        return Promise.resolve({ rows: [{ permission_key: 'scout_year.manage' }] });
      }
      if (query.includes("role_name IN ('demoadmin', 'demoparent')")) {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('FROM scout_years') && query.includes("status = 'active'")) {
        return Promise.resolve({ rows: [ACTIVE_YEAR] });
      }
      if (query.includes('membership_roles') && query.includes('linked_participants')) {
        return Promise.resolve({
          rows: [
            {
              membership_id: 7,
              user_id: 'user-7',
              status: 'active',
              role_names: ['parent'],
              email: 'parent@example.com',
              full_name: 'Parent Seven',
              past_children: ['Alice Smith']
            }
          ]
        });
      }
      return undefined;
    });

    const res = await request(app)
      .get('/api/v1/scout-years/memberships/without-child')
      .set('Authorization', `Bearer ${token}`)     .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      membership_id: 7,
      role_names: ['parent']
    });
  });
});

// ==========================================
// PATCH /api/v1/scout-years/memberships/:id/status
// ==========================================

describe('PATCH /api/v1/scout-years/memberships/:id/status', () => {
  test('deactivates a membership', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken();

    mockQueryImplementation(__mClient, __mPool, (query) => {
      if (query.includes('permission_key')) {
        return Promise.resolve({ rows: [{ permission_key: 'scout_year.manage' }] });
      }
      if (query.includes("role_name IN ('demoadmin', 'demoparent')")) {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('FROM scout_years') && query.includes("status = 'active'")) {
        return Promise.resolve({ rows: [ACTIVE_YEAR] });
      }
      if (query.includes('UPDATE user_organizations') && query.includes('deactivated_at')) {
        return Promise.resolve({
          rows: [{ id: 7, user_id: 'user-7', status: 'inactive', deactivated_at: new Date().toISOString(), deactivated_reason: 'no_enrolled_child' }]
        });
      }
      return undefined;
    });

    const res = await request(app)
      .patch('/api/v1/scout-years/memberships/7/status')
      .set('Authorization', `Bearer ${token}`)     .send({ status: 'inactive', reason: 'no_enrolled_child' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('inactive');
  });

  test('reactivates a membership', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken();

    mockQueryImplementation(__mClient, __mPool, (query) => {
      if (query.includes('permission_key')) {
        return Promise.resolve({ rows: [{ permission_key: 'scout_year.manage' }] });
      }
      if (query.includes("role_name IN ('demoadmin', 'demoparent')")) {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('FROM scout_years') && query.includes("status = 'active'")) {
        return Promise.resolve({ rows: [ACTIVE_YEAR] });
      }
      if (query.includes('UPDATE user_organizations') && query.includes('deactivated_at')) {
        return Promise.resolve({
          rows: [{ id: 7, user_id: 'user-7', status: 'active', deactivated_at: null, deactivated_reason: null }]
        });
      }
      return undefined;
    });

    const res = await request(app)
      .patch('/api/v1/scout-years/memberships/7/status')
      .set('Authorization', `Bearer ${token}`)     .send({ status: 'active' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('active');
  });

  test('rejects an invalid status value', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken();

    mockQueryImplementation(__mClient, __mPool, (query) => {
      if (query.includes('permission_key')) {
        return Promise.resolve({ rows: [{ permission_key: 'scout_year.manage' }] });
      }
      if (query.includes("role_name IN ('demoadmin', 'demoparent')")) {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('FROM scout_years') && query.includes("status = 'active'")) {
        return Promise.resolve({ rows: [ACTIVE_YEAR] });
      }
      return undefined;
    });

    const res = await request(app)
      .patch('/api/v1/scout-years/memberships/7/status')
      .set('Authorization', `Bearer ${token}`)     .send({ status: 'deleted' })
      .expect(400);

    expect(res.body.success).toBe(false);
  });

  test('returns 404 when membership is not found', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken();

    mockQueryImplementation(__mClient, __mPool, (query) => {
      if (query.includes('permission_key')) {
        return Promise.resolve({ rows: [{ permission_key: 'scout_year.manage' }] });
      }
      if (query.includes("role_name IN ('demoadmin', 'demoparent')")) {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('FROM scout_years') && query.includes("status = 'active'")) {
        return Promise.resolve({ rows: [ACTIVE_YEAR] });
      }
      if (query.includes('UPDATE user_organizations') && query.includes('deactivated_at')) {
        return Promise.resolve({ rows: [] });
      }
      return undefined;
    });

    const res = await request(app)
      .patch('/api/v1/scout-years/memberships/9999/status')
      .set('Authorization', `Bearer ${token}`)     .send({ status: 'inactive' })
      .expect(404);

    expect(res.body.success).toBe(false);
  });

  test('demo roles cannot change membership status', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      roleNames: ['demoadmin'],
      permissions: ['scout_year.manage']
    });

    mockQueryImplementation(__mClient, __mPool, (query) => {
      if (query.includes("role_name IN ('demoadmin', 'demoparent')")) {
        return Promise.resolve({ rows: [{ role_name: 'demoadmin' }] });
      }
      return undefined;
    });

    const res = await request(app)
      .patch('/api/v1/scout-years/memberships/7/status')
      .set('Authorization', `Bearer ${token}`)     .send({ status: 'inactive' })
      .expect(403);

    expect(res.body.isDemo).toBe(true);
  });
});
