/**
 * Nicknames: the name a youth or a leader goes by in the unit.
 *
 * - PATCH /api/v1/participants/:id/nickname, by leaders holding participants.edit
 * - PATCH /api/v1/users/me/nickname, by the member themself
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

const token = (overrides = {}) => jwt.sign({
  user_id: USER_ID, organizationId: ORG_ID, roleIds: [1], roleNames: ['leader'],
  permissions: ['participants.edit'], ...overrides,
}, TEST_SECRET);

/**
 * @param {Object} [options]
 * @param {string[]} [options.permissions] - The member's current permissions
 * @param {boolean} [options.inUnit] - Whether the participant belongs to the unit
 * @param {boolean} [options.demo] - Whether the member holds a demo role
 * @returns {Array<{query: string, params: Array}>} Statements run
 */
function mockDatabase({ permissions = ['participants.edit'], inUnit = true, demo = false } = {}) {
  const { __mClient, __mPool } = require('pg');
  const statements = [];
  mockQueryImplementation(__mClient, __mPool, (query, params) => {
    statements.push({ query, params });
    if (demo && (query.includes('demoadmin') || query.includes('demoparent'))) {
      return { rows: [{ role_name: 'demoadmin' }] };
    }
    if (query.includes('p.permission_key')) {
      return { rows: permissions.map((key) => ({ permission_key: key })) };
    }
    if (query.includes('UPDATE participants') && query.includes('SET nickname')) {
      return { rows: inUnit ? [{ id: params[1], first_name: 'Maximilien', last_name: 'Roy', nickname: params[0] }] : [] };
    }
    if (query.includes('UPDATE users SET nickname')) {
      return { rows: [{ id: params[1], full_name: 'Christian S', nickname: params[0] }] };
    }
    return undefined;
  });
  return statements;
}

const nicknameUpdates = (statements) => statements.filter(({ query }) => query.includes('SET nickname'));

beforeAll(() => {
  process.env.JWT_SECRET_KEY = TEST_SECRET;
  process.env.ORGANIZATION_ID = ORG_ID.toString();
  app = require('../api');
});

beforeEach(() => {
  const { __mClient, __mPool } = require('pg');
  setupDefaultMocks(__mClient, __mPool);
});

afterAll((done) => {
  closeServerResources(app, done);
});

describe('a leader sets the nickname a youth goes by', () => {
  test('the nickname is saved, trimmed, on a youth of the unit', async () => {
    const statements = mockDatabase();

    const res = await request(app)
      .patch('/api/v1/participants/12/nickname')
      .set('Authorization', `Bearer ${token()}`)
      .send({ nickname: '  Max  ' });

    expect(res.status).toBe(200);
    expect(res.body.data.nickname).toBe('Max');
    const [update] = nicknameUpdates(statements);
    expect(update.params).toEqual(['Max', 12, ORG_ID]);
    expect(update.query).toContain('participant_organizations');
  });

  test('an empty nickname clears it', async () => {
    const statements = mockDatabase();

    const res = await request(app)
      .patch('/api/v1/participants/12/nickname')
      .set('Authorization', `Bearer ${token()}`)
      .send({ nickname: '' });

    expect(res.status).toBe(200);
    expect(nicknameUpdates(statements)[0].params[0]).toBeNull();
  });

  test('signing in is required', async () => {
    const res = await request(app).patch('/api/v1/participants/12/nickname').send({ nickname: 'Max' });
    expect(res.status).toBe(401);
  });

  test('a member without participants.edit is refused, saying what is missing', async () => {
    const statements = mockDatabase({ permissions: ['participants.view'] });

    const res = await request(app)
      .patch('/api/v1/participants/12/nickname')
      .set('Authorization', `Bearer ${token({ permissions: ['participants.view'] })}`)
      .send({ nickname: 'Max' });

    expect(res.status).toBe(403);
    expect(res.body.required).toEqual(['participants.edit']);
    expect(res.body.missing).toEqual(['participants.edit']);
    expect(nicknameUpdates(statements)).toHaveLength(0);
  });

  test('a demo account cannot change it', async () => {
    mockDatabase({ demo: true });

    const res = await request(app)
      .patch('/api/v1/participants/12/nickname')
      .set('Authorization', `Bearer ${token()}`)
      .send({ nickname: 'Max' });

    expect(res.status).toBe(403);
    expect(res.body.isDemo).toBe(true);
  });

  test('another unit\'s youth is not found', async () => {
    mockDatabase({ inUnit: false });

    const res = await request(app)
      .patch('/api/v1/participants/12/nickname')
      .set('Authorization', `Bearer ${token()}`)
      .send({ nickname: 'Max' });

    expect(res.status).toBe(404);
  });

  test.each([
    ['a malformed id', '12abc', { nickname: 'Max' }],
    ['an id beyond the integer range', '2147483648', { nickname: 'Max' }],
    ['markup in the nickname', '12', { nickname: '<img src=x onerror=alert(1)>' }],
    ['a nickname longer than 100 characters', '12', { nickname: 'x'.repeat(101) }],
    ['a nickname that is not text', '12', { nickname: { first: 'Max' } }],
  ])('%s is a bad request', async (_label, id, body) => {
    const statements = mockDatabase();

    const res = await request(app)
      .patch(`/api/v1/participants/${id}/nickname`)
      .set('Authorization', `Bearer ${token()}`)
      .send(body);

    expect(res.status).toBe(400);
    expect(Array.isArray(res.body.errors)).toBe(true);
    expect(nicknameUpdates(statements)).toHaveLength(0);
  });
});

describe('a leader sets their own nickname', () => {
  test('it is saved on their own account only', async () => {
    const statements = mockDatabase({ permissions: [] });

    const res = await request(app)
      .patch('/api/v1/users/me/nickname')
      .set('Authorization', `Bearer ${token({ permissions: [] })}`)
      .send({ nickname: 'Akela' });

    expect(res.status).toBe(200);
    expect(res.body.data.nickname).toBe('Akela');
    expect(nicknameUpdates(statements)[0].params).toEqual(['Akela', USER_ID]);
  });

  test('markup is refused', async () => {
    const statements = mockDatabase({ permissions: [] });

    const res = await request(app)
      .patch('/api/v1/users/me/nickname')
      .set('Authorization', `Bearer ${token({ permissions: [] })}`)
      .send({ nickname: '<b>Akela</b>' });

    expect(res.status).toBe(400);
    expect(nicknameUpdates(statements)).toHaveLength(0);
  });

  test('signing in is required', async () => {
    const res = await request(app).patch('/api/v1/users/me/nickname').send({ nickname: 'Akela' });
    expect(res.status).toBe(401);
  });
});
