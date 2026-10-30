const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { authorizationContextRow } = require('./mock-helpers');
jest.mock('../services/campReadiness', () => ({ campReadiness: jest.fn(), campReadinessForActivity: jest.fn(), upcomingCamps: jest.fn() }));
const { campReadiness, campReadinessForActivity, upcomingCamps } = require('../services/campReadiness');
process.env.JWT_SECRET_KEY = 'fictional-readiness-tests';
let permissions; let scope;
const pool = { query: jest.fn((sql) => {
  if (sql.includes('AS authorization_permissions')) {
    return authorizationContextRow({ permissions, roles: [{ role_name: 'custom_team', display_name: 'Team', data_scope: scope }] });
  }
  if (sql.includes('SELECT organization_id FROM user_organizations')) { return { rows: [{ organization_id: 7 }] }; }
  return { rows: [] };
}) };
const app = express(); app.locals.pool = pool;
app.use('/api/v1/camp-readiness', require('../routes/camp-readiness')(pool));
const call = (path = '/3') => request(app).get(`/api/v1/camp-readiness${path}`).set('Authorization', `Bearer ${jwt.sign({ user_id: '00000000-0000-4000-8000-000000000001', organizationId: 7 }, process.env.JWT_SECRET_KEY)}`);
beforeEach(() => { jest.clearAllMocks(); permissions = ['meetings.view']; scope = 'organization'; campReadiness.mockResolvedValue({ camp: { id: 3 }, sections: {} }); });
test('the team overview requires authentication', async () => { expect((await request(app).get('/api/v1/camp-readiness/3')).status).toBe(401); });
test.each([['linked', ['meetings.view']], ['organization', []]])('scope %s with permissions %j cannot read the team overview', async (dataScope, keys) => {
  scope = dataScope; permissions = keys;
  const result = await call(); expect(result.status).toBe(403); expect(result.body.required).toBeDefined(); expect(campReadiness).not.toHaveBeenCalled();
});
test.each(['0', '12abc', '2147483648'])('invalid camp id %s is refused', async (id) => { expect((await call(`/${id}`)).status).toBe(400); expect(campReadiness).not.toHaveBeenCalled(); });
test('section decisions use refreshed permissions and the authenticated unit, ignoring query claims', async () => {
  expect((await call('/3?organization_id=99&permissions=true')).status).toBe(200);
  expect(campReadiness).toHaveBeenCalledWith(pool, 7, 3, { inventory: false, lots: false, tasks: false, permissions: false });
});
test('consent and task links require every permission their destination screen needs', async () => {
  permissions.push('participants.view', 'activities.view', 'groups.view', 'tasks.manage', 'tasks.view', 'inventory.view', 'camp_lots.view');
  expect((await call()).status).toBe(200);
  expect(campReadiness).toHaveBeenCalledWith(pool, 7, 3, { inventory: true, lots: true, tasks: true, permissions: true });
});
test('a camp belonging to another unit is missing', async () => { campReadiness.mockResolvedValue(null); expect((await call()).status).toBe(404); });

describe('camps coming up, for the dashboard', () => {
  test('the team sees the next camps of its own unit only', async () => {
    upcomingCamps.mockResolvedValue([{ id: 3, theme: 'Fictional camp', date_from: '2026-11-14', date_to: '2026-11-16' }]);
    const result = await call('/upcoming?organization_id=99');
    expect(result.status).toBe(200);
    expect(result.body.data).toEqual([{ id: 3, theme: 'Fictional camp', date_from: '2026-11-14', date_to: '2026-11-16' }]);
    expect(upcomingCamps).toHaveBeenCalledWith(pool, 7, 14, 3);
  });
  test('a family account or someone without meetings.view is refused, saying what is missing', async () => {
    scope = 'linked';
    const result = await call('/upcoming');
    expect(result.status).toBe(403); expect(result.body.required).toBeDefined(); expect(upcomingCamps).not.toHaveBeenCalled();
  });
  test('without a token the list is refused', async () => {
    expect((await request(app).get('/api/v1/camp-readiness/upcoming')).status).toBe(401);
  });
});

describe('a camp created as an activity', () => {
  beforeEach(() => { campReadinessForActivity.mockResolvedValue({ camp: { id: null, activity_id: 8 }, sections: {} }); });
  test('the team opens its overview by the activity, in its own unit, with the section rights it holds', async () => {
    permissions.push('tasks.manage', 'tasks.view');
    expect((await call('/activities/8?organization_id=99')).status).toBe(200);
    expect(campReadinessForActivity).toHaveBeenCalledWith(pool, 7, 8, { inventory: false, lots: false, tasks: true, permissions: false });
  });
  test('without a token, without meetings.view, or with a malformed id it is refused', async () => {
    expect((await request(app).get('/api/v1/camp-readiness/activities/8')).status).toBe(401);
    expect((await call('/activities/12abc')).status).toBe(400);
    permissions = [];
    const refused = await call('/activities/8');
    expect(refused.status).toBe(403); expect(refused.body.missing).toBeDefined();
    expect(campReadinessForActivity).not.toHaveBeenCalled();
  });
  test('another unit\'s activity, or one that is not a camp, is missing', async () => {
    campReadinessForActivity.mockResolvedValue(null);
    expect((await call('/activities/8')).status).toBe(404);
  });
});
