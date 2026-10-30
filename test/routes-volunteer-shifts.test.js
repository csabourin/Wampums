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
    VolunteerError: actual.VolunteerError, VOLUNTEER_TYPES: actual.VOLUNTEER_TYPES, REQUIREMENTS: actual.REQUIREMENTS,
    VALIDITY_YEARS: actual.VALIDITY_YEARS, teamChecks: jest.fn(),
    getRequirements: jest.fn(), recordRequirements: jest.fn(),
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
const SHIFT = { activity_id: 3, volunteer_type: 'cook', title: 'Cuisine', shift_date: '2026-11-07', start_time: '17:00', end_time: '19:00', slots: 2 };

beforeEach(() => {
  jest.clearAllMocks();
  permissions = ['volunteers.view'];
  roles = [{ role_name: 'volunteer', display_name: 'Volunteer', data_scope: 'organization' }];
  service.listShifts.mockResolvedValue([]);
  service.saveShift.mockResolvedValue({ id: 5 });
  service.signUp.mockResolvedValue({ created: true, status: 'confirmed', missing: [] });
  service.recordRequirements.mockResolvedValue({ confirmed: 1 });
  service.getRequirements.mockResolvedValue([]);
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
  expect(response.body.data).toEqual({ status: 'confirmed', missing: [] });
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
  ['"other" without saying what it is', { volunteer_type: 'other', title: '  ' }, 'title'],
  ['an unknown type', { volunteer_type: 'babysitter' }, 'volunteer_type'],
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

test('a place held for verification says so, and what is missing', async () => {
  service.signUp.mockResolvedValue({ created: true, status: 'pending', missing: ['background_check'] });
  const response = await call('post', '/4/signups');
  expect(response.status).toBe(201);
  expect(response.body.message).toBe('volunteer_pending');
  expect(response.body.data).toEqual({ status: 'pending', missing: ['background_check'] });
});

describe('what was verified for a person', () => {
  const OTHER = '00000000-0000-4000-8000-000000000002';

  test('a volunteer reads their own record, never someone else\'s', async () => {
    expect((await call('get', '/requirements/me')).status).toBe(200);
    expect(service.getRequirements).toHaveBeenCalledWith(pool, 7, USER_ID);
    const other = await call('get', `/requirements/${OTHER}`);
    expect(other.status).toBe(403);
    expect(other.body.missing).toEqual(['volunteers.manage']);
  });

  test('a manager records requirements for a member of the unit', async () => {
    permissions.push('volunteers.manage');
    const verified = { background_check: { checked_on: '2025-09-01' }, safety_training: { valid_until: null } };
    const response = await call('put', `/requirements/${OTHER}`, { verified });
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ confirmed: 1 });
    expect(service.recordRequirements).toHaveBeenCalledWith(pool, 7, USER_ID, OTHER, verified);
  });

  test.each([
    ['an unknown requirement', { criminal_record_copy: { valid_until: null } }],
    ['a malformed expiry', { safety_training: { valid_until: 'next year' } }],
    ['a background check without the date it was done', { background_check: { valid_until: '2029-01-01' } }],
    ['a background check dated in the future', { background_check: { checked_on: '2999-01-01' } }],
    ['an impossible date', { background_check: { checked_on: '2025-02-30' } }],
    ['no record at all', null],
  ])('%s is refused', async (_label, verified) => {
    permissions.push('volunteers.manage');
    expect((await call('put', `/requirements/${OTHER}`, { verified })).status).toBe(400);
    expect(service.recordRequirements).not.toHaveBeenCalled();
  });

  test('a malformed person id is refused, and a volunteer cannot record anything', async () => {
    permissions.push('volunteers.manage');
    expect((await call('get', '/requirements/12')).status).toBe(400);
    permissions = ['volunteers.view'];
    expect((await call('put', `/requirements/${OTHER}`, { verified: {} })).status).toBe(403);
  });
});

test('the team\'s background checks are listed for managers only', async () => {
  service.teamChecks.mockResolvedValue([]);
  const refused = await call('get', '/checks');
  expect(refused.status).toBe(403);
  expect(refused.body.missing).toEqual(['volunteers.manage']);
  permissions.push('volunteers.manage');
  expect((await call('get', '/checks')).status).toBe(200);
  expect(service.teamChecks).toHaveBeenCalledWith(pool, 7);
});
