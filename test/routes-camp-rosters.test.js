/**
 * Camp list routes (#1319): who may read a camp's youth and team, who may name
 * the team, and how refusals read. The service is mocked; its rules are covered
 * on a real database in camp-roster.integration.
 */
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { authorizationContextRow } = require('./mock-helpers');

jest.mock('../services/campRoster', () => {
  const actual = jest.requireActual('../services/campRoster');
  return {
    ...actual,
    readCampRoster: jest.fn(), listTeamCandidates: jest.fn(), saveTeamMember: jest.fn(), removeTeamMember: jest.fn(),
    saveCampActivities: jest.fn(),
  };
});
const service = require('../services/campRoster');

process.env.JWT_SECRET_KEY = 'fictional-camp-roster-tests';
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
app.use('/api/v1/camp-rosters', require('../routes/camp-rosters')(pool));
const token = () => jwt.sign({ user_id: USER_ID, organizationId: UNIT_ID }, process.env.JWT_SECRET_KEY);
const call = (method, path, body) => {
  const req = request(app)[method](`/api/v1/camp-rosters${path}`).set('Authorization', `Bearer ${token()}`);
  return body ? req.send(body) : req;
};

beforeEach(() => {
  jest.clearAllMocks();
  permissions = ['meetings.view', 'participants.view', 'meetings.manage'];
  roles = [{ role_name: 'animation', display_name: 'Leader', data_scope: 'organization' }];
  service.readCampRoster.mockResolvedValue({ camp: { id: 12 }, youth: [], team: [], gaps: [] });
  service.listTeamCandidates.mockResolvedValue([]);
  service.saveTeamMember.mockResolvedValue([]);
  service.removeTeamMember.mockResolvedValue([]);
  service.saveCampActivities.mockResolvedValue({ swimming_planned: true });
});

test('without a token, nothing is read or written', async () => {
  for (const [method, path] of [['get', '/12'], ['patch', '/12'], ['get', '/12/team-candidates'], ['put', `/12/team/${MEMBER_ID}`], ['delete', `/12/team/${MEMBER_ID}`]]) {
    // eslint-disable-next-line no-await-in-loop -- each refusal is checked in turn
    const response = await request(app)[method](`/api/v1/camp-rosters${path}`);
    expect(response.status).toBe(401);
  }
});

test('a leader reads the authenticated unit’s camp lists, with the rights the engine grants', async () => {
  permissions = ['meetings.view', 'participants.view'];
  expect((await call('get', '/12?organization_id=99')).status).toBe(200);
  expect(service.readCampRoster).toHaveBeenCalledWith(pool, UNIT_ID, 12,
    { canManage: false, canSeeVolunteers: false, canSeeCertifications: false });
  permissions = ['meetings.view', 'participants.view', 'meetings.manage', 'volunteers.manage'];
  await call('get', '/12');
  expect(service.readCampRoster).toHaveBeenLastCalledWith(pool, UNIT_ID, 12,
    { canManage: true, canSeeVolunteers: true, canSeeCertifications: true });
});

test('team members’ certifications go to whoever manages the camp or its volunteers, and no one else', async () => {
  permissions = ['meetings.view', 'participants.view', 'volunteers.manage'];
  await call('get', '/12');
  expect(service.readCampRoster).toHaveBeenLastCalledWith(pool, UNIT_ID, 12,
    { canManage: false, canSeeVolunteers: true, canSeeCertifications: true });
  permissions = ['meetings.view', 'participants.view', 'meetings.manage'];
  await call('get', '/12');
  expect(service.readCampRoster).toHaveBeenLastCalledWith(pool, UNIT_ID, 12,
    { canManage: true, canSeeVolunteers: false, canSeeCertifications: true });
});

test('saying a camp plans swimming takes meetings.manage and refuses demo accounts', async () => {
  const saved = await call('patch', '/12', { swimming_planned: true, organization_id: 99 });
  expect(saved.status).toBe(200);
  expect(saved.body.message).toBe('camp_roster_activities_saved');
  expect(service.saveCampActivities).toHaveBeenCalledWith(pool, UNIT_ID, 12, expect.objectContaining({ swimming_planned: true }));
  permissions = ['meetings.view', 'participants.view'];
  const refused = await call('patch', '/12', { swimming_planned: true });
  expect(refused.status).toBe(403);
  expect(refused.body.missing).toEqual(['meetings.manage']);
  permissions = ['meetings.view', 'participants.view', 'meetings.manage'];
  roles = [{ role_name: 'demoadmin', display_name: 'Demo', data_scope: 'organization' }];
  const demo = await call('patch', '/12', { swimming_planned: true });
  expect(demo.status).toBe(403);
  expect(demo.body.isDemo).toBe(true);
  expect(service.saveCampActivities).toHaveBeenCalledTimes(1);
});

test('swimming must be said with yes or no', () => {
  const { saveCampActivities } = jest.requireActual('../services/campRoster');
  expect(() => saveCampActivities(pool, UNIT_ID, 12, { swimming_planned: 'yes' })).toThrow('camp_roster_invalid');
  expect(() => saveCampActivities(pool, UNIT_ID, 12, {})).toThrow('camp_roster_invalid');
});

test('the lists name youth, so reading takes participants.view as well as meetings.view', async () => {
  permissions = ['meetings.view'];
  const response = await call('get', '/12');
  expect(response.status).toBe(403);
  expect(response.body.required).toEqual(['meetings.view', 'participants.view']);
  expect(response.body.missing).toEqual(['participants.view']);
  expect(service.readCampRoster).not.toHaveBeenCalled();
});

test('a parent whose role sees only their own children cannot read a camp’s lists', async () => {
  roles = [{ role_name: 'parent', display_name: 'Parent', data_scope: 'linked' }];
  const response = await call('get', '/12');
  expect(response.status).toBe(403);
  expect(service.readCampRoster).not.toHaveBeenCalled();
});

test('naming the team takes meetings.manage, and the member and camp come from the path', async () => {
  const body = { team_role: 'camp_aide', date_of_birth: '2009-05-01', organization_id: 99 };
  expect((await call('put', `/12/team/${MEMBER_ID}`, body)).status).toBe(200);
  expect(service.saveTeamMember).toHaveBeenCalledWith(pool, UNIT_ID, USER_ID, 12, MEMBER_ID, expect.objectContaining({ team_role: 'camp_aide' }));
  permissions = ['meetings.view', 'participants.view'];
  const refused = await call('put', `/12/team/${MEMBER_ID}`, body);
  expect(refused.status).toBe(403);
  expect(refused.body.missing).toEqual(['meetings.manage']);
  expect((await call('get', '/12/team-candidates')).status).toBe(403);
  expect((await call('delete', `/12/team/${MEMBER_ID}`)).status).toBe(403);
});

test('a demo account cannot change a camp’s team', async () => {
  roles = [{ role_name: 'demoadmin', display_name: 'Demo', data_scope: 'organization' }];
  const response = await call('put', `/12/team/${MEMBER_ID}`, { team_role: 'leader' });
  expect(response.status).toBe(403);
  expect(response.body.isDemo).toBe(true);
  expect(service.saveTeamMember).not.toHaveBeenCalled();
});

test('a malformed camp or member id is a bad request', async () => {
  expect((await call('get', '/12abc')).status).toBe(400);
  expect((await call('put', '/12/team/not-a-uuid', { team_role: 'leader' })).status).toBe(400);
  expect((await call('delete', `/0/team/${  MEMBER_ID}`)).status).toBe(400);
  expect(service.saveTeamMember).not.toHaveBeenCalled();
});

test('a refusal from the rules answers its key and names its field', async () => {
  service.saveTeamMember.mockRejectedValue(new service.CampRosterError('camp_roster_birth_date_invalid', 400, 'date_of_birth'));
  const response = await call('put', `/12/team/${MEMBER_ID}`, { team_role: 'camp_aide', date_of_birth: '2999-01-01' });
  expect(response.status).toBe(400);
  expect(response.body.message).toBe('camp_roster_birth_date_invalid');
  expect(response.body.errors).toEqual([expect.objectContaining({ path: 'date_of_birth' })]);
  service.readCampRoster.mockRejectedValue(new service.CampRosterError('camp_roster_camp_not_found', 404));
  expect((await call('get', '/99')).status).toBe(404);
});
