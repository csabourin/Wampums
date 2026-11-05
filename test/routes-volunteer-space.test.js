/**
 * Volunteer space routes: who may open it, and how refusals read. The service is mocked; which
 * camps open to whom is covered on a real database in volunteer-space.integration.
 */
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { authorizationContextRow } = require('./mock-helpers');

jest.mock('../services/volunteerSpace', () => {
  const actual = jest.requireActual('../services/volunteerSpace');
  return { VolunteerSpaceError: actual.VolunteerSpaceError, readOverview: jest.fn(), readCamp: jest.fn() };
});
const service = require('../services/volunteerSpace');

process.env.JWT_SECRET_KEY = 'fictional-volunteer-space-tests';
const USER_ID = '00000000-0000-4000-8000-000000000001';
let permissions;
const pool = { query: jest.fn((sql) => {
  if (sql.includes('AS authorization_permissions')) {
    return authorizationContextRow({ permissions, roles: [{ role_name: 'volunteer', display_name: 'Volunteer', data_scope: 'organization' }] });
  }
  if (sql.includes('SELECT organization_id FROM user_organizations')) { return { rows: [{ organization_id: 7 }] }; }
  return { rows: [] };
}) };
const app = express();
app.locals.pool = pool;
app.use(express.json());
app.use('/api/v1/volunteer-space', require('../routes/volunteer-space')(pool));
const token = () => jwt.sign({ user_id: USER_ID, organizationId: 7 }, process.env.JWT_SECRET_KEY);
const call = (path) => request(app).get(`/api/v1/volunteer-space${path}`).set('Authorization', `Bearer ${token()}`);

beforeEach(() => {
  jest.clearAllMocks();
  permissions = ['volunteer_space.view'];
  service.readOverview.mockResolvedValue({ camps: [], shifts: [], tasks: [], open_tasks: 0 });
  service.readCamp.mockResolvedValue({ camp: { activity_id: 3 } });
});

test('without a token, the space is refused', async () => {
  expect((await request(app).get('/api/v1/volunteer-space')).status).toBe(401);
});

test('a volunteer opens their own space, in the unit of their session, whatever the request says', async () => {
  const response = await call('/?organization_id=99&user_id=00000000-0000-4000-8000-000000000099');
  expect(response.status).toBe(200);
  expect(service.readOverview).toHaveBeenCalledWith(pool, 7, USER_ID);
});

test('someone without volunteer_space.view is refused, saying what is missing', async () => {
  permissions = ['volunteers.view'];
  const response = await call('/');
  expect(response.status).toBe(403);
  expect(response.body.required).toEqual(['volunteer_space.view']);
  expect(response.body.missing).toEqual(['volunteer_space.view']);
});

test('a volunteer opens one of their camps by its activity', async () => {
  const response = await call('/camps/3');
  expect(response.status).toBe(200);
  expect(service.readCamp).toHaveBeenCalledWith(pool, 7, USER_ID, 3);
});

test('a camp they take no part in reads as not found', async () => {
  service.readCamp.mockRejectedValue(new service.VolunteerSpaceError('volunteer_space_camp_not_found', 404));
  const response = await call('/camps/4');
  expect(response.status).toBe(404);
  expect(response.body.message).toBe('volunteer_space_camp_not_found');
});

test.each(['abc', '0', '12abc', '2147483648'])('a malformed camp id (%s) is refused before any read', async (id) => {
  const response = await call(`/camps/${id}`);
  expect(response.status).toBe(400);
  expect(service.readCamp).not.toHaveBeenCalled();
});
