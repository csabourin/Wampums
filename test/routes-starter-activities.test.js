/**
 * Starter activity routes: who may browse and import, and what a refused or
 * malformed request does. The import's behaviour on real rows (one copy per
 * unit, legacy names, hidden copies, other units) is in
 * test/activity-library-starter.integration.test.js.
 *
 * @module test/routes-starter-activities
 */

const { adaptAuthorizationMock } = require('./mock-helpers');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const TEST_SECRET = 'starter-activities-secret';
// The routes read the secret when they load, so it is set before they are required.
process.env.JWT_SECRET_KEY = TEST_SECRET;
const USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const ORGANIZATION_ID = 7;
const OTHER_UNIT_ID = 99;
const quiet = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

const token = () => jwt.sign({ user_id: USER_ID, organizationId: ORGANIZATION_ID }, TEST_SECRET);

let scenario;
let queryLog;

/**
 * What the database answers.
 * @param {string} query - SQL
 * @param {Array} params - Parameters
 * @returns {Object} Result
 */
function answer(query, params) {
  queryLog.push({ query, params });
  if (query.includes('SELECT organization_id FROM user_organizations')) {
    return { rows: [{ organization_id: ORGANIZATION_ID }] };
  }
  if (query.includes("role_name IN ('demoadmin', 'demoparent')")) {
    return { rows: scenario.demo ? [{ role_name: 'demoadmin' }] : [] };
  }
  if (query.includes('SELECT DISTINCT p.permission_key')) {
    return { rows: scenario.permissions.map((key) => ({ permission_key: key })) };
  }
  if (query.includes('SELECT DISTINCT r.role_name')) {
    return { rows: [{ role_name: 'animation', display_name: 'Animation' }] };
  }
  if (query.includes('FROM organizations o')) {
    return { rows: [{ default_language: scenario.language, program_section: 'cubs', interface_languages: null }] };
  }
  if (query.includes('INSERT INTO activity_library')) {
    return { rows: [{ id: 501 }] };
  }
  return { rows: [] };
}

const client = {
  query: jest.fn((query, params = []) => Promise.resolve(answer(query, params))),
  release: jest.fn(),
};
const pool = {
  query: jest.fn((query, params = []) => Promise.resolve(answer(query, params))),
  connect: jest.fn(() => Promise.resolve(client)),
};
adaptAuthorizationMock(pool);

const app = express();
app.locals.pool = pool;
app.use(express.json());
app.use('/api/v1/yearly-planner', require('../routes/yearlyPlanner')(pool, quiet));

const authorized = (req) => req.set('Authorization', `Bearer ${token()}`);
const writes = () => queryLog.filter(({ query }) => /INSERT INTO activity_library|UPDATE activity_library/.test(query));

beforeEach(() => {
  queryLog = [];
  scenario = { permissions: ['meetings.view', 'meetings.manage'], demo: false, language: 'fr' };
});

describe('browsing the starter activities', () => {
  test('requires signing in', async () => {
    const response = await request(app).get('/api/v1/yearly-planner/starter-activities');

    expect(response.status).toBe(401);
    expect(response.body.message).toMatch(/authentication required/i);
  });

  test('is refused to a member who cannot manage meetings, naming the missing permission', async () => {
    scenario.permissions = ['meetings.view'];

    const response = await authorized(request(app).get('/api/v1/yearly-planner/starter-activities'));

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ required: ['meetings.manage'], missing: ['meetings.manage'] });
  });

  test('lists the catalogue in the unit\'s language, without the withdrawn game', async () => {
    scenario.language = 'en';

    const response = await authorized(request(app).get('/api/v1/yearly-planner/starter-activities'));

    expect(response.status).toBe(200);
    const { data } = response.body;
    expect(data).toMatchObject({ language: 'en', branch: 'cubs' });
    expect(data.activities.find((activity) => activity.key === 'block_closing').name)
      .toBe('Closing: messages, prayer and departure');
    expect(data.activities.map((activity) => activity.key)).not.toContain('game_den_ball');
    expect(data.default_keys).not.toContain('technique_knives');
  });
});

describe('adding starter activities to the unit', () => {
  const post = (body) => authorized(request(app).post('/api/v1/yearly-planner/starter-activities/import')).send(body);

  test('requires signing in', async () => {
    const response = await request(app)
      .post('/api/v1/yearly-planner/starter-activities/import')
      .send({ keys: ['game_sardines'] });

    expect(response.status).toBe(401);
    expect(writes()).toEqual([]);
  });

  test('is refused to a demo account, which says so', async () => {
    scenario.demo = true;

    const response = await post({ keys: ['game_sardines'] });

    expect(response.status).toBe(403);
    expect(response.body.isDemo).toBe(true);
    expect(writes()).toEqual([]);
  });

  test('is refused without meetings.manage', async () => {
    scenario.permissions = ['meetings.view'];

    const response = await post({ keys: ['game_sardines'] });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ required: ['meetings.manage'], missing: ['meetings.manage'] });
    expect(writes()).toEqual([]);
  });

  test.each([
    ['no keys', {}],
    ['an empty list', { keys: [] }],
    ['a single string', { keys: 'game_sardines' }],
    ['a malformed key', { keys: ['<img src=x onerror=alert(1)>'] }],
    ['an unknown key', { keys: ['game_sardines', 'game_imaginary'] }],
    ['the withdrawn game', { keys: ['game_den_ball'] }],
  ])('answers 400 for %s, writing nothing', async (_label, body) => {
    const response = await post(body);

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ success: false, message: 'invalid_starter_selection' });
    expect(response.body.errors.length).toBeGreaterThan(0);
    expect(writes()).toEqual([]);
  });

  test('copies into the signed-in unit, whatever unit the request names', async () => {
    const response = await post({ keys: ['game_sardines'], organization_id: OTHER_UNIT_ID })
      .set('x-organization-id', String(OTHER_UNIT_ID));

    expect(response.status).toBe(200);
    expect(response.body.data.created).toEqual([expect.objectContaining({ key: 'game_sardines', library_id: 501 })]);
    const [insert] = queryLog.filter(({ query }) => query.includes('INSERT INTO activity_library'));
    expect(insert.params[0]).toBe(ORGANIZATION_ID);
    const lock = queryLog.find(({ query }) => query.includes('pg_advisory_xact_lock'));
    expect(lock.params[0]).toBe(ORGANIZATION_ID);
    expect(client.release).toHaveBeenCalled();
  });
});

describe('editing a unit\'s library activity', () => {
  test('a new hand-made activity never carries a starter key', async () => {
    await authorized(request(app).post('/api/v1/yearly-planner/activity-library'))
      .send({ name: 'Jeu maison', metadata: { starter_key: 'game_sardines', note: 'à nous' } });

    const [insert] = writes();
    expect(JSON.parse(insert.params[9])).toEqual({ note: 'à nous' });
  });

  test('an edit keeps the copy\'s own starter key, whatever metadata it sends', async () => {
    await authorized(request(app).patch('/api/v1/yearly-planner/activity-library/12'))
      .send({ metadata: { starter_key: 'game_dodgeball' } });

    const [update] = writes();
    expect(update.query).toMatch(/\$9::jsonb - 'starter_key'/);
    expect(update.query).toMatch(/jsonb_build_object\('starter_key', metadata -> 'starter_key'\)/);
  });
});
