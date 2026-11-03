/**
 * Camp site routes (#1317): who may read, add and choose sites, and how
 * refusals read. The service is mocked; the rules themselves are covered on a
 * real database in camp-sites.integration.
 */
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { authorizationContextRow } = require('./mock-helpers');

jest.mock('../services/campSites', () => {
  const actual = jest.requireActual('../services/campSites');
  return {
    ...actual,
    listSites: jest.fn(), createSite: jest.fn(), updateSite: jest.fn(), setSiteArchived: jest.fn(),
    readCampSite: jest.fn(), saveCampSite: jest.fn(),
  };
});
const service = require('../services/campSites');

process.env.JWT_SECRET_KEY = 'fictional-camp-sites-tests';
const USER_ID = '00000000-0000-4000-8000-000000000001';
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
app.use('/api/v1/camp-sites', require('../routes/camp-sites')(pool));
const token = () => jwt.sign({ user_id: USER_ID, organizationId: UNIT_ID }, process.env.JWT_SECRET_KEY);
const call = (method, path, body) => {
  const req = request(app)[method](`/api/v1/camp-sites${path}`).set('Authorization', `Bearer ${token()}`);
  return body ? req.send(body) : req;
};

beforeEach(() => {
  jest.clearAllMocks();
  permissions = ['meetings.view', 'meetings.manage', 'camp_sites.manage'];
  roles = [{ role_name: 'animation', display_name: 'Leader', data_scope: 'organization' }];
  service.listSites.mockResolvedValue([]);
  service.createSite.mockResolvedValue({ id: 4 });
  service.updateSite.mockResolvedValue({ id: 4 });
  service.setSiteArchived.mockResolvedValue({ id: 4, archived: true });
  service.readCampSite.mockResolvedValue({ camp: { id: 12 } });
  service.saveCampSite.mockResolvedValue({ camp: { id: 12 } });
});

test('without a token, nothing is listed, read or changed', async () => {
  for (const [method, path] of [['get', '/'], ['post', '/'], ['get', '/camps/12'], ['put', '/camps/12']]) {
    // eslint-disable-next-line no-await-in-loop -- each refusal is checked in turn
    expect((await request(app)[method](`/api/v1/camp-sites${path}`)).status).toBe(401);
  }
});

test('a leader lists the authenticated unit’s sites, whatever unit the request names', async () => {
  expect((await call('get', '/?organization_id=99&include_archived=true')).status).toBe(200);
  expect(service.listSites).toHaveBeenCalledWith(pool, UNIT_ID, { includeArchived: true });
});

test('adding, editing and archiving a site take camp_sites.manage, and the refusal says so', async () => {
  permissions = ['meetings.view', 'meetings.manage'];
  for (const [method, path, body] of [['post', '/', { name: 'Fictional' }], ['put', '/4', { name: 'Fictional' }], ['patch', '/4/archive', { archived: true }]]) {
    // eslint-disable-next-line no-await-in-loop -- each refusal is checked in turn
    const response = await call(method, path, body);
    expect(response.status).toBe(403);
    expect(response.body.required).toEqual(['camp_sites.manage']);
    expect(response.body.missing).toEqual(['camp_sites.manage']);
  }
  expect(service.createSite).not.toHaveBeenCalled();
});

test('choosing a camp’s site takes meetings.manage; reading it, meetings.view', async () => {
  permissions = ['meetings.view'];
  const refused = await call('put', '/camps/12', { camp_site_id: 4, expected_version: 0 });
  expect(refused.status).toBe(403);
  expect(refused.body.missing).toEqual(['meetings.manage']);

  expect((await call('get', '/camps/12')).status).toBe(200);
  // Who may lead on site is offered only to whoever may choose them.
  expect(service.readCampSite).toHaveBeenCalledWith(pool, UNIT_ID, 12, { withMembers: false });

  permissions = [];
  const unread = await call('get', '/camps/12');
  expect(unread.status).toBe(403);
  expect(unread.body.missing).toEqual(['meetings.view']);
});

test('a manager reading a camp’s site is offered the members who may lead on site', async () => {
  await call('get', '/camps/12');
  expect(service.readCampSite).toHaveBeenCalledWith(pool, UNIT_ID, 12, { withMembers: true });
});

test('a demo account changes nothing', async () => {
  roles = [{ role_name: 'demoadmin', display_name: 'Demo', data_scope: 'organization' }];
  for (const [method, path, body] of [['post', '/', { name: 'Fictional' }], ['put', '/camps/12', { expected_version: 0 }]]) {
    // eslint-disable-next-line no-await-in-loop -- each refusal is checked in turn
    const response = await call(method, path, body);
    expect(response.status).toBe(403);
    expect(response.body.isDemo).toBe(true);
  }
  expect(service.createSite).not.toHaveBeenCalled();
  expect(service.saveCampSite).not.toHaveBeenCalled();
});

test('a malformed id or archive flag is a 400, not a write', async () => {
  expect((await call('put', '/4abc', { name: 'Fictional' })).status).toBe(400);
  expect((await call('put', '/camps/2147483648', { expected_version: 0 })).status).toBe(400);
  expect((await call('patch', '/4/archive', { archived: 'yes' })).status).toBe(400);
  expect(service.updateSite).not.toHaveBeenCalled();
  expect(service.setSiteArchived).not.toHaveBeenCalled();
});

test('a refusal reads as its translation key, naming the field it concerns', async () => {
  service.createSite.mockRejectedValue(new service.CampSiteError('camp_site_name_conflict', 409, 'name'));
  const response = await call('post', '/', { name: 'Fictional' });
  expect(response.status).toBe(409);
  expect(response.body.message).toBe('camp_site_name_conflict');
  expect(response.body.errors).toEqual([{ path: 'name', location: 'body', msg: 'camp_site_name_conflict' }]);
});

test('a site is checked field by field before anything is written', () => {
  expect(() => service.readSite({ name: 'Fictional', directions_url: 'javascript:alert(1)' })).toThrow('camp_site_invalid_url');
  expect(() => service.readSite({ name: '   ' })).toThrow('camp_site_name_required');
  expect(service.readSite({ name: ' Fictional ', hospital_distance_km: 12.345 })).toMatchObject({ name: 'Fictional', hospital_distance_km: 12.3 });
});
