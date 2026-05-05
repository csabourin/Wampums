/**
 * Points Routes Test Suite
 *
 * Verifies point ledgers stay separated:
 * - group totals are calculated from group-attributed records only
 * - participant totals are calculated from participant-attributed records only
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

function generateToken(overrides = {}) {
  return jwt.sign({
    user_id: 1,
    user_role: 'district',
    organizationId: ORG_ID,
    roleIds: [1],
    roleNames: ['admin'],
    permissions: ['points.view'],
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

describe('GET /api/v1/points', () => {
  test('separates group-only totals from current member participant totals', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken();
    let groupQuery = '';

    mockQueryImplementation(__mClient, __mPool, (query) => {
      if (query.includes('permission_key')) {
        return Promise.resolve({ rows: [{ permission_key: 'points.view' }] });
      }
      if (query.includes('role_name')) {
        return Promise.resolve({ rows: [{ role_name: 'admin', display_name: 'Admin' }] });
      }
      if (query.includes('FROM groups g') && query.includes('member_points')) {
        groupQuery = query;
        return Promise.resolve({
          rows: [{
            id: 10,
            name: 'Wolves',
            total_points: 4,
            individual_total_points: 12
          }]
        });
      }
      if (query.includes('FROM participants part')) {
        return Promise.resolve({
          rows: [{
            id: 20,
            first_name: 'Alex',
            last_name: 'River',
            group_id: 10,
            total_points: 12
          }]
        });
      }
      return undefined;
    });

    const res = await request(app)
      .get('/api/v1/points')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.groups[0]).toMatchObject({
      total_points: 4,
      individual_total_points: 12
    });
    expect(groupQuery).toContain('participant_id IS NULL');
    expect(groupQuery).toContain('participant_id IS NOT NULL');
  });
});

describe('GET /api/v1/points/leaderboard', () => {
  test('group leaderboard uses only group-attributed point records', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken();
    let leaderboardQuery = '';

    mockQueryImplementation(__mClient, __mPool, (query) => {
      if (query.includes('permission_key')) {
        return Promise.resolve({ rows: [{ permission_key: 'points.view' }] });
      }
      if (query.includes('role_name')) {
        return Promise.resolve({ rows: [{ role_name: 'admin', display_name: 'Admin' }] });
      }
      if (query.includes('FROM groups g') && query.includes('member_counts')) {
        leaderboardQuery = query;
        return Promise.resolve({
          rows: [{
            id: 10,
            name: 'Wolves',
            total_points: 4,
            member_count: 3
          }]
        });
      }
      return undefined;
    });

    const res = await request(app)
      .get('/api/v1/points/leaderboard?type=groups')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.data[0]).toMatchObject({
      total_points: 4,
      member_count: 3
    });
    expect(leaderboardQuery).toContain('participant_id IS NULL');
  });
});
