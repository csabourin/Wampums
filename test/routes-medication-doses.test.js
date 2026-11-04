/**
 * Giving doses is the team's (#1339), a dose is scheduled only for the youth its
 * medication names, enrolled in the unit (#1340), and a given dose never changes
 * again (#1341). The pool is mocked; the same rules run on a real database in
 * medication-doses.integration.
 */
process.env.JWT_SECRET_KEY = 'fictional-medication-dose-tests';

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { authorizationContextRow } = require('./mock-helpers');

const USER_ID = '00000000-0000-4000-8000-000000000001';
const UNIT_ID = 7;
const FAMILY = [{ role_name: 'u7_family_plus', display_name: 'Family plus', data_scope: 'linked' }];
const TEAM = [{ role_name: 'animation', display_name: 'Leader', data_scope: 'organization' }];
let roles; let requirementRows; let updateRows; let existsRows;
const client = { query: jest.fn(() => Promise.resolve({ rows: [{ id: 1 }] })), release: jest.fn() };
const pool = {
  connect: jest.fn(() => Promise.resolve(client)),
  query: jest.fn((sql) => {
    if (sql.includes('AS authorization_permissions')) { return authorizationContextRow({ permissions: ['medication.manage', 'medication.view'], roles }); }
    if (sql.includes('SELECT organization_id FROM user_organizations')) { return Promise.resolve({ rows: [{ organization_id: UNIT_ID }] }); }
    if (sql.includes('FROM medication_requirements r')) { return Promise.resolve({ rows: requirementRows }); }
    if (sql.includes('UPDATE medication_distributions')) { return Promise.resolve({ rows: updateRows }); }
    if (sql.includes('SELECT 1 FROM medication_distributions')) { return Promise.resolve({ rows: existsRows }); }
    return Promise.resolve({ rows: [] });
  }),
};
const app = express();
app.locals.pool = pool;
app.use(express.json());
app.use('/api', require('../routes/medication')(pool, { info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
const token = jwt.sign({ user_id: USER_ID, organizationId: UNIT_ID }, process.env.JWT_SECRET_KEY);
const send = (method, path, body) => request(app)[method](`/api/v1/medication${path}`).set('Authorization', `Bearer ${token}`).send(body);
const schedule = (overrides = {}) => send('post', '/distributions', {
  medication_requirement_id: 11, participant_ids: [5], scheduled_for: '2026-11-15T13:00:00Z', ...overrides,
});
const writes = () => client.query.mock.calls.filter(([sql]) => /INSERT|UPDATE/.test(sql));

beforeEach(() => {
  jest.clearAllMocks();
  roles = TEAM;
  requirementRows = [{ id: 11, default_dose_amount: null, default_dose_unit: null }];
  updateRows = [{ id: 21, status: 'given' }];
  existsRows = [{ '?column?': 1 }];
});

describe('a family role holding medication.manage', () => {
  test.each([
    ['get', '/distributions', undefined],
    ['post', '/distributions', { medication_requirement_id: 11, participant_ids: [5], scheduled_for: '2026-11-15T13:00:00Z' }],
    ['patch', '/distributions/21', { status: 'given' }],
    ['post', '/receptions', { participant_id: 5, medication_requirement_id: 11, status: 'received' }],
    ['patch', '/receptions/4', { status: 'received' }],
    ['delete', '/receptions/4', undefined],
  ])('is refused %s %s, which only the unit’s team does', async (method, path, body) => {
    roles = FAMILY;
    const response = await send(method, path, body);
    expect(response.status).toBe(403);
    expect(response.body.required).toEqual(['medication.manage']);
    expect(pool.query.mock.calls.some(([sql]) => /medication_distributions|medication_receptions/.test(sql))).toBe(false);
  });

  test('the team still lists the unit’s doses', async () => {
    expect((await send('get', '/distributions')).status).toBe(200);
  });
});

describe('scheduling a dose', () => {
  test('names the medication’s own youth, enrolled in the unit, before anything is written', async () => {
    expect((await schedule()).status).toBe(201);
    const [sql, params] = pool.query.mock.calls.find(([text]) => text.includes('FROM medication_requirements r'));
    expect(sql).toContain('r.participant_id = $3');
    expect(sql).toContain('participant_enrollments');
    expect(params).toEqual([11, UNIT_ID, 5]);
  });

  test('another youth than the medication’s, or one not enrolled in the unit, is refused with nothing written', async () => {
    requirementRows = [];
    const response = await schedule({ participant_ids: [6] });
    expect(response.status).toBe(404);
    expect(pool.connect).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });

  test.each([['999abc'], ['5.5'], [''], [null]])('a malformed youth id (%p) is a bad request, never read as a number', async (id) => {
    const response = await schedule({ participant_ids: [id] });
    expect(response.status).toBe(400);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  test('a malformed medication id is a bad request', async () => {
    expect((await schedule({ medication_requirement_id: '11abc' })).status).toBe(400);
  });
});

describe('changing a dose', () => {
  test('confirming is one write that never touches a dose already given', async () => {
    expect((await send('patch', '/distributions/21', { status: 'given' })).status).toBe(200);
    const updates = pool.query.mock.calls.filter(([sql]) => sql.includes('UPDATE medication_distributions'));
    expect(updates).toHaveLength(1);
    expect(updates[0][0]).toContain("status <> 'given'");
    expect(pool.query.mock.calls.some(([sql]) => /SELECT id, status FROM medication_distributions/.test(sql))).toBe(false);
  });

  test.each([['given'], ['scheduled'], ['missed'], [undefined]])('a dose already given answers 409 to %p, and stays given', async (status) => {
    updateRows = [];
    const response = await send('patch', '/distributions/21', status ? { status } : {});
    expect(response.status).toBe(409);
  });

  test('a dose of another unit, or none, is not found', async () => {
    updateRows = [];
    existsRows = [];
    expect((await send('patch', '/distributions/21', { status: 'given' })).status).toBe(404);
  });
});
