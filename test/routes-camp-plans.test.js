/**
 * Camp plan routes (#1318): who may read and write a camp's written sections,
 * its bad-weather games and the unit's templates, and how refusals read. The
 * service is mocked; the rules themselves are covered on a real database in
 * camp-plan.integration.
 */
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { authorizationContextRow } = require('./mock-helpers');

jest.mock('../services/campPlan', () => {
  const actual = jest.requireActual('../services/campPlan');
  return {
    ...actual,
    listTemplates: jest.fn(), listCampPlans: jest.fn(), saveTemplate: jest.fn(), readCampPlan: jest.fn(), saveCampSection: jest.fn(), saveRainGames: jest.fn(),
  };
});
const service = require('../services/campPlan');

jest.mock('../services/campPermit', () => ({ readCampPermit: jest.fn() }));
const permitService = require('../services/campPermit');

process.env.JWT_SECRET_KEY = 'fictional-camp-plan-tests';
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
app.use('/api/v1/camp-plans', require('../routes/camp-plans')(pool));
const token = () => jwt.sign({ user_id: USER_ID, organizationId: UNIT_ID }, process.env.JWT_SECRET_KEY);
const call = (method, path, body) => {
  const req = request(app)[method](`/api/v1/camp-plans${path}`).set('Authorization', `Bearer ${token()}`);
  return body ? req.send(body) : req;
};

beforeEach(() => {
  jest.clearAllMocks();
  permissions = ['meetings.view', 'meetings.manage', 'camp_plan_templates.manage'];
  roles = [{ role_name: 'animation', display_name: 'Leader', data_scope: 'organization' }];
  service.listTemplates.mockResolvedValue([]);
  service.listCampPlans.mockResolvedValue({ coming: [], past: [] });
  service.saveTemplate.mockResolvedValue({ key: 'camp_rules' });
  service.readCampPlan.mockResolvedValue({ camp: { id: 12 }, sections: [] });
  service.saveCampSection.mockResolvedValue({ section: { key: 'theme' } });
  service.saveRainGames.mockResolvedValue({ rain_games: [] });
  permitService.readCampPermit.mockResolvedValue({ camp: { id: 12 }, header: {}, groups: [], lines: [] });
});

describe('the camp permit checklist', () => {
  test('a unit-wide leader reads the authenticated unit’s checklist, with the rights the engine grants', async () => {
    permissions = ['meetings.view', 'participants.view'];
    const response = await call('get', '/camps/12/permit?organization_id=99&participants=1');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(permitService.readCampPermit).toHaveBeenCalledWith(pool, UNIT_ID, 12,
      { participants: true, carpools: false, reviews: false });
  });

  test('without a token, the checklist is not read', async () => {
    expect((await request(app).get('/api/v1/camp-plans/camps/12/permit')).status).toBe(401);
    expect(permitService.readCampPermit).not.toHaveBeenCalled();
  });

  test('reading it takes meetings.view, and the refusal says so', async () => {
    permissions = [];
    const response = await call('get', '/camps/12/permit');
    expect(response.status).toBe(403);
    expect(response.body.required).toEqual(['meetings.view']);
    expect(response.body.missing).toEqual(['meetings.view']);
    expect(permitService.readCampPermit).not.toHaveBeenCalled();
  });

  test('a parent who holds meetings.view through a family role cannot read it', async () => {
    permissions = ['meetings.view', 'participants.view'];
    roles = [{ role_name: 'parent', display_name: 'Parent', data_scope: 'linked' }];
    expect((await call('get', '/camps/12/permit')).status).toBe(403);
    expect(permitService.readCampPermit).not.toHaveBeenCalled();
  });

  test('another unit’s camp is not found, and a malformed id is a 400', async () => {
    permitService.readCampPermit.mockRejectedValue(new service.CampPlanError('camp_permit_camp_not_found', 404));
    const missing = await call('get', '/camps/12/permit');
    expect(missing.status).toBe(404);
    expect(missing.body.message).toBe('camp_permit_camp_not_found');
    expect((await call('get', '/camps/12abc/permit')).status).toBe(400);
    expect((await call('get', '/camps/2147483648/permit')).status).toBe(400);
  });
});

test('without a token, nothing is read or written', async () => {
  for (const [method, path] of [['get', '/templates'], ['put', '/templates/camp_rules'], ['get', '/camps/12'],
    ['put', '/camps/12/sections/theme'], ['put', '/camps/12/rain-games']]) {
    // eslint-disable-next-line no-await-in-loop -- each refusal is checked in turn
    expect((await request(app)[method](`/api/v1/camp-plans${path}`)).status).toBe(401);
  }
});

test('a leader reads the authenticated unit’s camp plan, whatever unit the request names', async () => {
  permissions = ['meetings.view'];
  expect((await call('get', '/camps/12?organization_id=99')).status).toBe(200);
  expect(service.readCampPlan).toHaveBeenCalledWith(pool, UNIT_ID, 12);
  expect((await call('get', '/templates')).status).toBe(200);
  expect(service.listTemplates).toHaveBeenCalledWith(pool, UNIT_ID);
});

test('the templates are read by whoever may write them, even without meetings.view', async () => {
  permissions = ['camp_plan_templates.manage'];
  expect((await call('get', '/templates')).status).toBe(200);
  permissions = [];
  const refused = await call('get', '/templates');
  expect(refused.status).toBe(403);
  expect(refused.body.required).toEqual(['meetings.view', 'camp_plan_templates.manage']);
});

test('the unit’s camp plans are listed for the authenticated unit with meetings.view', async () => {
  permissions = ['meetings.view'];
  expect((await call('get', '/camps?organization_id=99')).status).toBe(200);
  expect(service.listCampPlans).toHaveBeenCalledWith(pool, UNIT_ID);
  permissions = [];
  const refused = await call('get', '/camps');
  expect(refused.status).toBe(403);
  expect(refused.body.missing).toEqual(['meetings.view']);
});

test('reading takes meetings.view, and the refusal says so', async () => {
  permissions = [];
  const response = await call('get', '/camps/12');
  expect(response.status).toBe(403);
  expect(response.body.missing).toEqual(['meetings.view']);
});

test('writing a camp’s sections or games takes meetings.manage', async () => {
  permissions = ['meetings.view', 'camp_plan_templates.manage'];
  for (const [path, body] of [['/camps/12/sections/theme', { body_html: '<p>x</p>', expected_version: 0 }], ['/camps/12/rain-games', { activity_library_ids: [] }]]) {
    // eslint-disable-next-line no-await-in-loop -- each refusal is checked in turn
    const response = await call('put', path, body);
    expect(response.status).toBe(403);
    expect(response.body.required).toEqual(['meetings.manage']);
    expect(response.body.missing).toEqual(['meetings.manage']);
  }
  expect(service.saveCampSection).not.toHaveBeenCalled();
});

test('writing the unit’s templates takes camp_plan_templates.manage', async () => {
  permissions = ['meetings.view', 'meetings.manage'];
  const response = await call('put', '/templates/camp_rules', { body_html: '<p>x</p>', expected_version: 0 });
  expect(response.status).toBe(403);
  expect(response.body.missing).toEqual(['camp_plan_templates.manage']);
  expect(service.saveTemplate).not.toHaveBeenCalled();
});

test('a leader saves a section for the authenticated unit, as the signed-in person', async () => {
  const response = await call('put', '/camps/12/sections/theme', { body_html: '<p>Pirates</p>', expected_version: 0 });
  expect(response.status).toBe(200);
  expect(service.saveCampSection).toHaveBeenCalledWith(pool, UNIT_ID, USER_ID, 12, 'theme', { body_html: '<p>Pirates</p>', expected_version: 0 });
});

test('a demo account changes nothing', async () => {
  roles = [{ role_name: 'demoadmin', display_name: 'Demo', data_scope: 'organization' }];
  for (const [path, body] of [['/templates/camp_rules', { expected_version: 0 }], ['/camps/12/sections/theme', { expected_version: 0 }],
    ['/camps/12/rain-games', { activity_library_ids: [] }]]) {
    // eslint-disable-next-line no-await-in-loop -- each refusal is checked in turn
    const response = await call('put', path, body);
    expect(response.status).toBe(403);
    expect(response.body.isDemo).toBe(true);
  }
  expect(service.saveTemplate).not.toHaveBeenCalled();
  expect(service.saveCampSection).not.toHaveBeenCalled();
  expect(service.saveRainGames).not.toHaveBeenCalled();
});

test('a malformed camp id or an unknown section is a 400, not a write', async () => {
  expect((await call('get', '/camps/12abc')).status).toBe(400);
  expect((await call('put', '/camps/2147483648/sections/theme', { expected_version: 0 })).status).toBe(400);
  expect((await call('put', '/camps/12/sections/password', { expected_version: 0 })).status).toBe(400);
  // A camp's own section has no unit template.
  expect((await call('put', '/templates/theme', { expected_version: 0 })).status).toBe(400);
  expect(service.saveCampSection).not.toHaveBeenCalled();
  expect(service.saveTemplate).not.toHaveBeenCalled();
});

test('a refusal reads as its translation key, naming the field it concerns', async () => {
  service.saveRainGames.mockRejectedValue(new service.CampPlanError('camp_plan_rain_game_unavailable', 400, 'activity_library_ids'));
  const response = await call('put', '/camps/12/rain-games', { activity_library_ids: [3] });
  expect(response.status).toBe(400);
  expect(response.body.message).toBe('camp_plan_rain_game_unavailable');
  expect(response.body.errors).toEqual([{ path: 'activity_library_ids', location: 'body', msg: 'camp_plan_rain_game_unavailable' }]);
});

test('a section and a list of games are checked before anything is written', () => {
  expect(() => service.readSectionInput({ body_html: 42, expected_version: 0 })).toThrow('camp_plan_text_too_long');
  expect(() => service.readSectionInput({ body_html: '<p>x</p>' })).toThrow('camp_plan_invalid');
  expect(service.readSectionInput({ body_html: '<p>Hi<script>x</script></p>', expected_version: 2 }))
    .toEqual({ html: '<p>Hi</p>', text: 'Hi', expectedVersion: 2 });
  expect(service.readSectionInput({ body_html: '<p>&nbsp;</p>', expected_version: 1 }).html).toBeNull();
  expect(() => service.readRainGameIds({ activity_library_ids: Array.from({ length: 21 }, (_, index) => index + 1) })).toThrow('camp_plan_rain_games_invalid');
  expect(() => service.readRainGameIds({ activity_library_ids: [2147483648] })).toThrow('camp_plan_rain_games_invalid');
  expect(service.readRainGameIds({ activity_library_ids: [3, 1] })).toEqual([3, 1]);
});

test('a section with nothing to show is to write, never complete', () => {
  const sections = service.resolveSections(
    [{ section_key: 'theme', body_html: '<p>x</p>', body_text: 'x', version: 1, needs_review: true }],
    [{ key: 'camp_rules', body_html: '<p>Rules</p>', body_text: 'Rules', version: 3 }]
  );
  const byKey = Object.fromEntries(sections.map((section) => [section.key, section]));
  expect(byKey.theme).toMatchObject({ source: 'camp', modified_for_camp: false, needs_review: true });
  expect(byKey.camp_rules).toMatchObject({ source: 'template', modified_for_camp: false, version: 0, template_version: 3 });
  expect(byKey.rules_of_life.source).toBe('empty');
  const gaps = service.planGaps(sections, 0);
  expect(gaps.to_write).toContain('rules_of_life');
  expect(gaps.to_write).toContain('rain_games');
  expect(gaps.to_write).not.toContain('camp_rules');
  expect(gaps.to_review).toEqual(['theme']);
});
