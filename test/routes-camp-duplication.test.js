/**
 * Reusing an earlier camp: who may copy what, and how refusals read. The
 * service is mocked; the copy itself is covered on a real database in
 * camp-duplication.integration.
 */
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { authorizationContextRow } = require('./mock-helpers');

jest.mock('../services/campDuplication', () => {
  const actual = jest.requireActual('../services/campDuplication');
  return { ...actual, listDuplicationSources: jest.fn(), duplicateCamp: jest.fn() };
});
const service = require('../services/campDuplication');

process.env.JWT_SECRET_KEY = 'fictional-camp-duplication-tests';
const USER_ID = '00000000-0000-4000-8000-000000000001';
const UNIT_ID = 7;
const EVERY_RIGHT = ['meetings.manage', 'personal_equipment.manage', 'camp_lots.view', 'camp_lots.manage', 'tasks.view', 'tasks.manage'];
let permissions; let roles;
const pool = { query: jest.fn((sql) => {
  if (sql.includes('AS authorization_permissions')) { return authorizationContextRow({ permissions, roles }); }
  if (sql.includes('SELECT organization_id FROM user_organizations')) { return { rows: [{ organization_id: UNIT_ID }] }; }
  return { rows: [] };
}) };
const app = express();
app.locals.pool = pool;
app.use(express.json());
app.use('/api/v1/yearly-planner', require('../routes/yearlyPlanner')(pool, { error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
const token = () => jwt.sign({ user_id: USER_ID, organizationId: UNIT_ID }, process.env.JWT_SECRET_KEY);
const copy = (body, meetingId = 12) => request(app)
  .post(`/api/v1/yearly-planner/meetings/${meetingId}/duplicate`)
  .set('Authorization', `Bearer ${token()}`)
  .send(body);

beforeEach(() => {
  jest.clearAllMocks();
  permissions = [...EVERY_RIGHT];
  roles = [{ role_name: 'animation', display_name: 'Leader', data_scope: 'organization' }];
  service.listDuplicationSources.mockResolvedValue({ target: { id: 12 }, sources: [] });
  service.duplicateCamp.mockResolvedValue({ copied: { tasks: 1 } });
});

test('without a token, nothing is listed or copied', async () => {
  expect((await request(app).get('/api/v1/yearly-planner/meetings/12/duplication')).status).toBe(401);
  expect((await request(app).post('/api/v1/yearly-planner/meetings/12/duplicate').send({ source_meeting_id: 3, parts: ['tasks'] })).status).toBe(401);
  expect(service.duplicateCamp).not.toHaveBeenCalled();
});

test('a leader copies the parts chosen into the authenticated unit, as themselves', async () => {
  const response = await copy({ source_meeting_id: 3, parts: ['tasks', 'schedule'], organization_id: 99 });

  expect(response.status).toBe(201);
  expect(service.duplicateCamp).toHaveBeenCalledWith(pool, { organizationId: UNIT_ID, actorId: USER_ID }, 12, 3, ['schedule', 'tasks']);
});

test('each part asks for the rights its own screen requires, and a refusal says what is missing', async () => {
  permissions = ['meetings.manage', 'tasks.view', 'tasks.manage'];

  const lots = await copy({ source_meeting_id: 3, parts: ['schedule', 'lots'] });
  expect(lots.status).toBe(403);
  expect(lots.body.required).toEqual(['meetings.manage', 'camp_lots.view', 'camp_lots.manage', 'tasks.manage']);
  expect(lots.body.missing).toEqual(['camp_lots.view', 'camp_lots.manage']);

  const list = await copy({ source_meeting_id: 3, parts: ['packing_list'] });
  expect(list.status).toBe(403);
  expect(list.body.missing).toEqual(['personal_equipment.manage']);

  expect(service.duplicateCamp).not.toHaveBeenCalled();
  expect((await copy({ source_meeting_id: 3, parts: ['tasks'] })).status).toBe(201);
});

test('a role scoped to its own children cannot write a packing list by copying one', async () => {
  roles = [{ role_name: 'family_helper', display_name: 'Family helper', data_scope: 'linked' }];

  const refused = await copy({ source_meeting_id: 3, parts: ['packing_list'] });
  expect(refused.status).toBe(403);
  expect(service.duplicateCamp).not.toHaveBeenCalled();

  // Parts whose own screens take no unit-wide role are still allowed.
  expect((await copy({ source_meeting_id: 3, parts: ['schedule'] })).status).toBe(201);
});

test('someone who may not plan meetings can neither list earlier camps nor copy one', async () => {
  permissions = ['meetings.view', 'tasks.manage', 'tasks.view'];

  const listed = await request(app).get('/api/v1/yearly-planner/meetings/12/duplication').set('Authorization', `Bearer ${token()}`);
  expect(listed.status).toBe(403);
  expect(listed.body.missing).toEqual(['meetings.manage']);
  expect((await copy({ source_meeting_id: 3, parts: ['tasks'] })).body.missing).toEqual(['meetings.manage']);
});

test('a demo account copies nothing', async () => {
  roles = [{ role_name: 'demoadmin', display_name: 'Demo', data_scope: 'organization' }];

  const response = await copy({ source_meeting_id: 3, parts: ['schedule'] });

  expect(response.status).toBe(403);
  expect(response.body.isDemo).toBe(true);
  expect(service.duplicateCamp).not.toHaveBeenCalled();
});

test('a malformed request is a 400, not a copy', async () => {
  for (const body of [
    { source_meeting_id: 3 },
    { source_meeting_id: 3, parts: [] },
    { source_meeting_id: 3, parts: ['attendance'] },
    { source_meeting_id: 3, parts: ['tasks', 'tasks'] },
    { source_meeting_id: '3abc', parts: ['tasks'] },
    { source_meeting_id: 2147483648, parts: ['tasks'] },
  ]) {
    // eslint-disable-next-line no-await-in-loop -- each refusal is checked in turn
    expect((await copy(body)).status).toBe(400);
  }
  expect((await copy({ source_meeting_id: 3, parts: ['tasks'] }, '12abc')).status).toBe(400);
  expect(service.duplicateCamp).not.toHaveBeenCalled();
});

test('a refusal from the copy reads as its translation key, with the parts it concerns', async () => {
  service.duplicateCamp.mockRejectedValue(new service.CampDuplicationError('camp_duplicate_target_not_empty', 409, [{ field: 'parts', part: 'lots' }]));

  const response = await copy({ source_meeting_id: 3, parts: ['lots'] });

  expect(response.status).toBe(409);
  expect(response.body.message).toBe('camp_duplicate_target_not_empty');
  expect(response.body.errors).toEqual([{ field: 'parts', part: 'lots' }]);
});

test('another unit’s camp is not found', async () => {
  service.listDuplicationSources.mockRejectedValue(new service.CampDuplicationError('camp_duplicate_not_found', 404));

  const response = await request(app).get('/api/v1/yearly-planner/meetings/12/duplication').set('Authorization', `Bearer ${token()}`);

  expect(response.status).toBe(404);
  expect(service.listDuplicationSources).toHaveBeenCalledWith(pool, UNIT_ID, 12);
});
