/**
 * Preparing a camp for offline use carries each youth's nickname, so the
 * attendance and points screens opened offline show the name the unit uses.
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { closeServerResources } = require('./test-helpers');

jest.mock('pg', () => {
  const mClient = { query: jest.fn(), release: jest.fn() };
  const mPool = { connect: jest.fn(() => Promise.resolve(mClient)), query: jest.fn(), on: jest.fn() };
  return { Pool: jest.fn(() => mPool), __esModule: true, __mClient: mClient, __mPool: mPool };
});

const { setupDefaultMocks, mockQueryImplementation } = require('./mock-helpers');

const TEST_SECRET = 'testsecret';
const ORG_ID = 1;
const USER_ID = '6f1c0f8e-1d7e-4a8e-9b1c-2f3a4b5c6d7e';
let app;

beforeAll(() => {
  process.env.JWT_SECRET_KEY = TEST_SECRET;
  process.env.ORGANIZATION_ID = ORG_ID.toString();
  app = require('../api');
});

afterAll((done) => {
  closeServerResources(app, done);
});

test('the prepared roster carries each youth\'s nickname', async () => {
  const { __mClient, __mPool } = require('pg');
  setupDefaultMocks(__mClient, __mPool);
  const statements = [];
  mockQueryImplementation(__mClient, __mPool, (query) => {
    statements.push(query);
    if (query.includes('p.permission_key')) {
      return { rows: [{ permission_key: 'activities.view' }] };
    }
    if (query.includes('SELECT DISTINCT r.data_scope')) {
      return { rows: [{ data_scope: 'organization' }] };
    }
    if (query.includes('p.nickname') && query.includes('FROM participants p')) {
      return { rows: [{ id: 10, first_name: 'Maximilien', last_name: 'Roy', nickname: 'Max', total_points: '0' }] };
    }
    return undefined;
  });
  const token = jwt.sign({ user_id: USER_ID, organizationId: ORG_ID, roleIds: [1], permissions: ['activities.view'] }, TEST_SECRET);

  const res = await request(app)
    .post('/api/v1/offline/prepare-activity')
    .set('Authorization', `Bearer ${token}`)
    .send({ start_date: '2026-11-07', end_date: '2026-11-08' });

  expect(res.status).toBe(200);
  expect(statements.some((sql) => sql.includes('p.nickname') && sql.includes('FROM participants p'))).toBe(true);
  expect(res.body.data.participants[0].nickname).toBe('Max');
});
