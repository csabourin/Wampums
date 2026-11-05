/**
 * Adult certification routes (#1319): a member declares their own, a manager of volunteers reads
 * anyone's in the unit before verifying it. The service's queries are mocked; its rules on a real
 * database are in member-certifications.integration.
 */
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { authorizationContextRow } = require('./mock-helpers');

jest.mock('../services/memberCertifications', () => {
  const actual = jest.requireActual('../services/memberCertifications');
  return { ...actual, certificationsOf: jest.fn(), saveOwnDeclarations: jest.fn() };
});
const service = require('../services/memberCertifications');

process.env.JWT_SECRET_KEY = 'fictional-certification-tests';
const USER_ID = '00000000-0000-4000-8000-000000000001';
const MEMBER_ID = '00000000-0000-4000-8000-000000000002';
const UNIT_ID = 7;
let permissions; let roles;
const pool = { query: jest.fn((sql, params) => {
  if (sql.includes('AS authorization_permissions')) { return authorizationContextRow({ permissions, roles }); }
  if (sql.includes('SELECT organization_id FROM user_organizations')) { return { rows: [{ organization_id: UNIT_ID }] }; }
  if (sql.includes('p.permission_key = $3')) { return { rows: permissions.includes(params?.[2]) ? [{ held: 1 }] : [] }; }
  return { rows: [] };
}) };
const app = express();
app.locals.pool = pool;
app.use(express.json());
app.use('/api/v1/member-certifications', require('../routes/member-certifications')(pool));
const token = () => jwt.sign({ user_id: USER_ID, organizationId: UNIT_ID }, process.env.JWT_SECRET_KEY);
const call = (method, path, body) => {
  const req = request(app)[method](`/api/v1/member-certifications${path}`).set('Authorization', `Bearer ${token()}`);
  return body ? req.send(body) : req;
};

beforeEach(() => {
  jest.clearAllMocks();
  permissions = ['volunteers.view'];
  roles = [{ role_name: 'volunteer', display_name: 'Volunteer', data_scope: 'organization' }];
  service.certificationsOf.mockResolvedValue([]);
  service.saveOwnDeclarations.mockResolvedValue([]);
});

test('without a token, no certification is read or declared', async () => {
  for (const [method, path] of [['get', '/me'], ['put', '/me'], ['get', `/${MEMBER_ID}`]]) {
    // eslint-disable-next-line no-await-in-loop -- each refusal is checked in turn
    const response = await request(app)[method](`/api/v1/member-certifications${path}`);
    expect(response.status).toBe(401);
  }
});

test('a member reads and declares their own certifications, never someone else’s', async () => {
  expect((await call('get', '/me')).status).toBe(200);
  expect(service.certificationsOf).toHaveBeenCalledWith(pool, UNIT_ID, USER_ID);
  const body = { declared: { first_aid_certificate: { obtained_on: '2025-03-01' } }, user_id: MEMBER_ID, organization_id: 99 };
  const saved = await call('put', '/me', body);
  expect(saved.status).toBe(200);
  expect(saved.body.message).toBe('certifications_saved');
  expect(service.saveOwnDeclarations).toHaveBeenCalledWith(pool, UNIT_ID, USER_ID, expect.objectContaining({ declared: body.declared }));
});

test('a demo account cannot declare certifications', async () => {
  roles = [{ role_name: 'demoadmin', display_name: 'Demo', data_scope: 'organization' }];
  const response = await call('put', '/me', { declared: {} });
  expect(response.status).toBe(403);
  expect(response.body.isDemo).toBe(true);
  expect(service.saveOwnDeclarations).not.toHaveBeenCalled();
});

test('reading another member’s certifications takes volunteers.manage', async () => {
  const refused = await call('get', `/${MEMBER_ID}`);
  expect(refused.status).toBe(403);
  expect(refused.body.required).toEqual(['volunteers.manage']);
  expect(refused.body.missing).toEqual(['volunteers.manage']);
  permissions = ['volunteers.view', 'volunteers.manage'];
  expect((await call('get', `/${MEMBER_ID}`)).status).toBe(200);
  expect(service.certificationsOf).toHaveBeenCalledWith(pool, UNIT_ID, MEMBER_ID);
});

test('a malformed member id is a bad request', async () => {
  permissions = ['volunteers.manage'];
  expect((await call('get', '/not-a-uuid')).status).toBe(400);
  expect(service.certificationsOf).not.toHaveBeenCalled();
});

test('a refused declaration answers its key and names its field', async () => {
  service.saveOwnDeclarations.mockRejectedValue(new service.CertificationError(
    'certification_obtained_on_invalid', 400, 'declared.first_aid_certificate.obtained_on'));
  const response = await call('put', '/me', { declared: { first_aid_certificate: { obtained_on: '2999-01-01' } } });
  expect(response.status).toBe(400);
  expect(response.body.message).toBe('certification_obtained_on_invalid');
  expect(response.body.errors).toEqual([expect.objectContaining({ path: 'declared.first_aid_certificate.obtained_on' })]);
  service.certificationsOf.mockRejectedValue(new service.CertificationError('certification_member_not_found', 404));
  expect((await call('get', '/me')).status).toBe(404);
});

describe('what a declaration may say', () => {
  const NOW = new Date('2026-11-05T12:00:00Z');
  const read = (declared) => service.readDeclarations({ declared }, NOW);

  test('a certification held is declared with the day obtained, and an optional expiry', () => {
    expect(read({ wilderness_first_aid: { obtained_on: '2025-06-01', valid_until: '2028-06-01' }, winter_camping: { obtained_on: '2024-01-15' } }))
      .toEqual({
        wilderness_first_aid: { obtained_on: '2025-06-01', valid_until: '2028-06-01' },
        winter_camping: { obtained_on: '2024-01-15', valid_until: null },
      });
    expect(read({})).toEqual({});
  });

  test.each([
    ['an unknown certification', { lifeguard: { obtained_on: '2025-01-01' } }, 'certification_unknown', 'declared'],
    ['no day obtained', { winter_camping: {} }, 'certification_obtained_on_invalid', 'declared.winter_camping.obtained_on'],
    ['a day obtained in the future', { winter_camping: { obtained_on: '2026-11-06' } }, 'certification_obtained_on_invalid', 'declared.winter_camping.obtained_on'],
    ['an impossible date', { winter_camping: { obtained_on: '2025-02-30' } }, 'certification_obtained_on_invalid', 'declared.winter_camping.obtained_on'],
    ['an expiry before the day obtained', { first_aid_certificate: { obtained_on: '2025-01-01', valid_until: '2024-12-31' } }, 'certification_valid_until_invalid', 'declared.first_aid_certificate.valid_until'],
  ])('%s is refused, naming its field', (_label, declared, key, field) => {
    let refusal;
    try { read(declared); } catch (err) { refusal = err; }
    expect(refusal).toBeInstanceOf(service.CertificationError);
    expect(refusal.message).toBe(key);
    expect(refusal.field).toBe(field);
  });

  test('a body without a set of declarations is refused', () => {
    expect(() => service.readDeclarations({}, NOW)).toThrow('certification_invalid');
    expect(() => service.readDeclarations({ declared: [] }, NOW)).toThrow('certification_invalid');
  });
});
