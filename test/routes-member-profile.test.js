/** Personal forms are self-only and use current active membership, including for volunteers. */
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { authorizationContextRow } = require('./mock-helpers');
const { readInput, MemberProfileError } = require('../services/memberProfile');

jest.mock('../services/memberProfile', () => ({
  ...jest.requireActual('../services/memberProfile'),
  readOwnProfile: jest.fn(), readOwnHealth: jest.fn(), saveOwnForm: jest.fn(),
}));
const service = require('../services/memberProfile');
process.env.JWT_SECRET_KEY = 'fictional-profile-tests';
const USER = '00000000-0000-4000-8000-000000000001';
let active; let demo;
const pool = { query: jest.fn((sql) => {
  if (sql.includes('AS authorization_permissions')) {
    return authorizationContextRow({ permissions: [], roles: [{ role_name: demo ? 'demoadmin' : 'volunteer', data_scope: 'organization' }], status: active ? 'active' : 'inactive' });
  }
  if (sql.includes('SELECT organization_id FROM user_organizations')) { return { rows: active ? [{ organization_id: 7 }] : [] }; }
  return { rows: [] };
}) };
const app = express(); app.locals.pool = pool; app.use(express.json());
app.use('/api/v1/member-profile', require('../routes/member-profile')(pool));
const call = (method, path = '/me') => request(app)[method](`/api/v1/member-profile${path}`)
  .set('Authorization', `Bearer ${jwt.sign({ user_id: USER, organizationId: 7 }, process.env.JWT_SECRET_KEY)}`);
beforeEach(() => {
  active = true; demo = false; jest.clearAllMocks();
  service.readOwnProfile.mockResolvedValue({ phone: null, share_camp_contacts: false });
  service.readOwnHealth.mockResolvedValue(null);
  service.saveOwnForm.mockResolvedValue({ phone: '555-0100' });
});

test('no token reads or writes a personal form', async () => {
  expect((await request(app).get('/api/v1/member-profile/me')).status).toBe(401);
  expect((await request(app).put('/api/v1/member-profile/me/health').send({})).status).toBe(401);
});
test('a volunteer reads their own profile and health form without unit health permissions, and responses cannot be cached', async () => {
  const response = await call('get');
  expect(response.status).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(service.readOwnProfile).toHaveBeenCalledWith(pool, 7, USER);
  expect((await call('get', '/me/health')).status).toBe(200);
  expect(service.readOwnHealth).toHaveBeenCalledWith(pool, 7, USER);
});
test('a submitted target id never changes who writes the form', async () => {
  const body = { user_id: 'someone-else', phone: '555-0100', share_camp_contacts: true };
  expect((await call('put').send(body)).status).toBe(200);
  expect(service.saveOwnForm).toHaveBeenCalledWith(pool, 7, USER, body);
  expect((await call('put', '/someone-else').send(body)).status).toBe(404);
});
test('demo accounts cannot change contacts, consent or health information', async () => {
  demo = true;
  expect((await call('put').send({})).status).toBe(403);
  expect((await call('put', '/me/health').send({})).status).toBe(403);
  expect(service.saveOwnForm).not.toHaveBeenCalled();
});
test('a former member cannot read or write a personal form through this unit', async () => {
  active = false;
  expect((await call('get')).status).toBe(403);
  expect((await call('put').send({})).status).toBe(403);
});

test('validation refusals identify the field', async () => {
  service.saveOwnForm.mockRejectedValue(new MemberProfileError('member_profile_field_invalid', 400, 'phone'));
  const response = await call('put').send({ phone: 'abc' });
  expect(response.status).toBe(400);
  expect(response.body.errors[0].path).toBe('phone');
});
test.each([
  { phone: 'not a phone', share_camp_contacts: false },
  { share_camp_contacts: 'true' },
  { emergency_contact_name: 'x'.repeat(201), share_camp_contacts: false },
  { date_of_birth: '2025-02-30', share_camp_contacts: false },
  { date_of_birth: '2999-01-01', share_camp_contacts: false },
])('invalid personal fields are rejected', (body) => {
  expect(() => readInput(body)).toThrow(MemberProfileError);
});
test('optional contact values can be cleared and sharing requires an explicit boolean', () => {
  expect(readInput({ phone: ' 555-0100 ', share_camp_contacts: false })).toMatchObject({ phone: '555-0100', emergency_contact_name: null, share_camp_contacts: false });
});
test('health fields have bounded lengths and ignore any target id', () => {
  expect(readInput({ health_conditions: '  None  ', user_id: 'someone-else' }, true))
    .toEqual({ health_conditions: 'None', medications: null, support_needs: null });
  expect(() => readInput({ medications: 'x'.repeat(2001) }, true)).toThrow(MemberProfileError);
});
