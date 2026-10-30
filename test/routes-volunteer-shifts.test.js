/**
 * Volunteer shift routes: who may do what, and how refusals read. The service is mocked;
 * places and the last-place race are covered on a real database in volunteer-shifts.integration.
 */
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { authorizationContextRow } = require('./mock-helpers');

jest.mock('../services/volunteerShifts', () => {
  const actual = jest.requireActual('../services/volunteerShifts');
  return {
    VolunteerError: actual.VolunteerError,
    listShifts: jest.fn(), listShiftActivities: jest.fn(), saveShift: jest.fn(), deleteShift: jest.fn(),
    signUp: jest.fn(), withdraw: jest.fn(), shiftsForActivity: jest.fn(),
  };
});
const service = require('../services/volunteerShifts');

process.env.JWT_SECRET_KEY = 'fictional-volunteer-tests';
const USER_ID = '00000000-0000-4000-8000-000000000001';
let permissions; let roles;
const pool = { query: jest.fn((sql) => {
  if (sql.includes('AS authorization_permissions')) { return authorizationContextRow({ permissions, roles }); }
  if (sql.includes('SELECT organization_id FROM user_organizations')) { return { rows: [{ organization_id: 7 }] }; }
  return { rows: [] };
}) };
const app = express();
app.locals.pool = pool;
app.use(express.json());
app.use('/api/v1/volunteer-shifts', require('../routes/volunteer-shifts')(pool));
const token = () => jwt.sign({ user_id: USER_ID, organizationId: 7 }, process.env.JWT_SECRET_KEY);
const call = (method, path, body) => {
  const req = request(app)[method](`/api/v1/volunteer-shifts${path}`).set('Authorization', `Bearer ${token()}`);
  return body ? req.send(body) : req;
};
const SHIFT = { activity_id: 3, title: 'Cuisine', shift_date: '2026-11-07', start_time: '17:00', end_time: '19:00', slots: 2 };

beforeEach(() => {
  jest.clearAllMocks();
  permissions = ['volunteers.view'];
  roles = [{ role_name: 'volunteer', display_name: 'Volunteer', data_scope: 'organization' }];
  service.listShifts.mockResolvedValue([]);
  service.saveShift.mockResolvedValue({ id: 5 });
  service.signUp.mockResolvedValue({ created: true });
  service.withdraw.mockResolvedValue(true);
  service.deleteShift.mockResolvedValue(true);
});

test('without a token, the shifts are refused', async () => {
  expect((await request(app).get('/api/v1/volunteer-shifts')).status).toBe(401);
});

test('a volunteer lists the unit\'s shifts without anyone else\'s name', async () => {
  expect((await call('get', '/?organization_id=99')).status).toBe(200);
  expect(service.listShifts).toHaveBeenCalledWith(pool, 7, USER_ID, { withNames: false });
});

test('a manager also sees who signed up', async () => {
  permissions.push('volunteers.manage');
  await call('get', '/');
  expect(service.listShifts).toHaveBeenCalledWith(pool, 7, USER_ID, { withNames: true });
});

test('someone without volunteers.view is refused, saying what is missing', async () => {
  permissions = [];
  const response = await call('get', '/');
  expect(response.status).toBe(403);
  expect(response.body.required).toEqual(['volunteers.view']);
  expect(response.body.missing).toEqual(['volunteers.view']);
});

test('a volunteer takes a place for themselves, never for a person named in the request', async () => {
  const response = await call('post', '/4/signups', { user_id: '00000000-0000-4000-8000-000000000099' });
  expect(response.status).toBe(201);
  expect(service.signUp).toHaveBeenCalledWith(pool, 7, 4, USER_ID);
});

test('a full shift answers 409 with a reason the screen explains', async () => {
  service.signUp.mockRejectedValue(new service.VolunteerError('volunteer_shift_full', 409));
  const response = await call('post', '/4/signups');
  expect(response.status).toBe(409);
  expect(response.body.message).toBe('volunteer_shift_full');
});

test('a volunteer cannot create, edit or delete shifts, nor remove someone else', async () => {
  for (const [method, path, body] of [['post', '/', SHIFT], ['put', '/4', SHIFT], ['delete', '/4'], ['delete', `/4/signups/${USER_ID}`]]) {
    // eslint-disable-next-line no-await-in-loop -- each refusal is checked in turn
    const response = await call(method, path, body);
    expect(response.status).toBe(403);
    expect(response.body.missing).toEqual(['volunteers.manage']);
  }
  expect(service.saveShift).not.toHaveBeenCalled();
});

test('a demo account changes nothing', async () => {
  permissions.push('volunteers.manage');
  roles = [{ role_name: 'demoadmin', display_name: 'Demo', data_scope: 'organization' }];
  const response = await call('post', '/4/signups');
  expect(response.status).toBe(403);
  expect(response.body.isDemo).toBe(true);
  expect(service.signUp).not.toHaveBeenCalled();
});

test('a manager creates a shift for the authenticated unit', async () => {
  permissions.push('volunteers.manage');
  const response = await call('post', '/', { ...SHIFT, organization_id: 99, notes: '  ' });
  expect(response.status).toBe(201);
  expect(service.saveShift).toHaveBeenCalledWith(pool, 7, USER_ID, expect.objectContaining({ activity_id: 3, slots: 2, title: 'Cuisine' }));
});

test.each([
  ['an end before the start', { end_time: '16:00' }, 'end_time'],
  ['no places', { slots: 0 }, 'slots'],
  ['too many places', { slots: 51 }, 'slots'],
  ['a malformed day', { shift_date: '2026-02-30' }, 'shift_date'],
  ['a malformed activity', { activity_id: '12abc' }, 'activity_id'],
  ['an empty role', { title: '  ' }, 'title'],
])('a shift with %s is refused with its field named', async (_label, change, field) => {
  permissions.push('volunteers.manage');
  const response = await call('post', '/', { ...SHIFT, ...change });
  expect(response.status).toBe(400);
  expect(response.body.errors.map((item) => item.path)).toContain(field);
  expect(service.saveShift).not.toHaveBeenCalled();
});

test.each(['0', '12abc', '2147483648'])('a malformed shift id %s is refused', async (id) => {
  expect((await call('post', `/${id}/signups`)).status).toBe(400);
});

test('another unit\'s shift, or a place already given up, is missing', async () => {
  service.withdraw.mockResolvedValue(false);
  expect((await call('delete', '/4/signups/me')).status).toBe(404);
  permissions.push('volunteers.manage');
  service.deleteShift.mockResolvedValue(false);
  expect((await call('delete', '/4')).status).toBe(404);
});
