/**
 * Adults' allergy declarations (#1319): a member reads, records and withdraws their own, and no
 * route writes one for someone else. The service's queries run against a mocked pool; its rules on a
 * real database are in camp-allergies.integration.
 */
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { authorizationContextRow } = require('./mock-helpers');
const { readDeclaration, AllergyDeclarationError } = require('../services/memberAllergies');

process.env.JWT_SECRET_KEY = 'fictional-allergy-tests';
const USER_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_ID = '00000000-0000-4000-8000-000000000002';
const UNIT_ID = 7;
let permissions; let roles; let member; const writes = [];
const pool = { query: jest.fn((sql, params) => {
  if (sql.includes('AS authorization_permissions')) { return authorizationContextRow({ permissions, roles }); }
  if (sql.includes('SELECT organization_id FROM user_organizations')) { return { rows: [{ organization_id: UNIT_ID }] }; }
  if (sql.includes('SELECT 1 FROM user_organizations')) { return { rows: member ? [{ 1: 1 }] : [] }; }
  if (sql.includes('INSERT INTO member_allergy_declarations')) {
    writes.push(params);
    return { rows: [{ allergies: params[1], carries_epipen: params[2], person_to_notify: params[3], declared_at: '2026-11-05T12:00:00Z' }] };
  }
  if (sql.includes('DELETE FROM member_allergy_declarations')) { writes.push(params); return { rowCount: 1, rows: [] }; }
  return { rows: [] };
}) };
const app = express();
app.locals.pool = pool;
app.use(express.json());
app.use('/api/v1/member-allergies', require('../routes/member-allergies')(pool));
const token = () => jwt.sign({ user_id: USER_ID, organizationId: UNIT_ID }, process.env.JWT_SECRET_KEY);
const call = (method, path, body) => {
  const req = request(app)[method](`/api/v1/member-allergies${path}`).set('Authorization', `Bearer ${token()}`);
  return body ? req.send(body) : req;
};

beforeEach(() => {
  writes.length = 0;
  member = true;
  permissions = ['volunteers.view'];
  roles = [{ role_name: 'volunteer', display_name: 'Volunteer', data_scope: 'organization' }];
});

test('without a token, no declaration is read, written or withdrawn', async () => {
  for (const method of ['get', 'put', 'delete']) {
    // eslint-disable-next-line no-await-in-loop -- each refusal is checked in turn
    expect((await request(app)[method]('/api/v1/member-allergies/me')).status).toBe(401);
  }
});

test('a member records their own declaration; a user id in the body is ignored', async () => {
  const response = await call('put', '/me', { allergies: ' Arachides ', carries_epipen: true, person_to_notify: 'Ada Lovelace, 555-0100', user_id: OTHER_ID });
  expect(response.status).toBe(200);
  expect(response.body.message).toBe('allergy_declaration_saved');
  expect(writes[0]).toEqual([USER_ID, 'Arachides', true, 'Ada Lovelace, 555-0100']);
  expect(response.body.data).toMatchObject({ allergies: 'Arachides', carries_epipen: true });
});

test('there is no route to write someone else’s declaration', async () => {
  expect((await call('put', `/${OTHER_ID}`, { allergies: 'Pollen' })).status).toBe(404);
  expect(writes).toEqual([]);
});

test('a member withdraws their own declaration', async () => {
  const response = await call('delete', '/me');
  expect(response.status).toBe(200);
  expect(response.body.message).toBe('allergy_declaration_removed');
  expect(writes[0]).toEqual([USER_ID]);
});

test('a demo account cannot declare or withdraw', async () => {
  roles = [{ role_name: 'demoadmin', display_name: 'Demo', data_scope: 'organization' }];
  const response = await call('put', '/me', { allergies: 'Pollen' });
  expect(response.status).toBe(403);
  expect(response.body.isDemo).toBe(true);
  expect((await call('delete', '/me')).body.isDemo).toBe(true);
  expect(writes).toEqual([]);
});

test('an empty declaration is refused next to its field', async () => {
  const response = await call('put', '/me', { allergies: '   ' });
  expect(response.status).toBe(400);
  expect(response.body.message).toBe('allergy_declaration_allergies_invalid');
  expect(response.body.errors).toEqual([expect.objectContaining({ path: 'allergies' })]);
  expect(writes).toEqual([]);
});

test('someone who is no longer an active member cannot declare', async () => {
  member = false;
  expect((await call('put', '/me', { allergies: 'Pollen' })).status).toBe(404);
  expect(writes).toEqual([]);
});

describe('what a declaration may say', () => {
  test('the allergies are trimmed, the auto-injector defaults to no, an empty person to notify to none', () => {
    expect(readDeclaration({ allergies: ' Latex ', person_to_notify: '  ' })).toEqual({ allergies: 'Latex', carries_epipen: false, person_to_notify: null });
  });

  test.each([
    ['no allergies', { carries_epipen: true }, 'allergies'],
    ['allergies too long', { allergies: 'x'.repeat(1001) }, 'allergies'],
    ['an auto-injector that is not yes or no', { allergies: 'Latex', carries_epipen: 'yes' }, 'carries_epipen'],
    ['a person to notify too long', { allergies: 'Latex', person_to_notify: 'x'.repeat(201) }, 'person_to_notify'],
  ])('%s is refused, naming its field', (_label, input, field) => {
    let refusal;
    try { readDeclaration(input); } catch (err) { refusal = err; }
    expect(refusal).toBeInstanceOf(AllergyDeclarationError);
    expect(refusal.field).toBe(field);
  });
});
