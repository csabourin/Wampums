/**
 * A route the database fails on answers a generic 500, never the database's
 * words, a file path or a stack (CLAUDE.md §9; #1463).
 *
 * test/server-error-leaks.test.js reads the route files for one pattern; this
 * suite calls the routes. Every query naming the record asked for fails with a
 * message no response may repeat. The read and delete routes of
 * routes-malformed-ids.test.js are reused: they reach the database with an id
 * alone.
 */
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { closeServerResources } = require('./test-helpers');

jest.mock('pg', () => {
  const mClient = { query: jest.fn(), release: jest.fn() };
  const mPool = {
    connect: jest.fn(() => Promise.resolve(mClient)),
    query: jest.fn(),
    on: jest.fn()
  };
  return { Pool: jest.fn(() => mPool), __esModule: true, __mClient: mClient, __mPool: mPool };
});

const { mockQueryImplementation } = require('./mock-helpers');

const TEST_SECRET = 'testsecret';
const ORG_ID = 1;
const PERMISSIONS = [
  'finance.manage', 'finance.view', 'inventory.manage', 'inventory.view',
  'permission_slips.manage', 'permission_slips.view', 'permission_slips.sign',
  'inventory.reserve', 'activities.edit', 'honors.create', 'honors.manage', 'meetings.manage',
  'meetings.view', 'meetings.delete', 'activities.manage',
  'incidents.view', 'incidents.manage', 'forms.view', 'forms.manage', 'forms.submit',
  'medication.view', 'medication.manage', 'participants.view', 'participants.edit', 'participants.erase',
  'activities.view', 'activities.delete', 'carpools.view', 'badges.view', 'badges.manage', 'budget.manage',
  'fundraisers.view', 'fundraisers.edit', 'fundraisers.delete', 'groups.view', 'groups.edit', 'groups.delete',
  'participants.delete', 'participants.transfer', 'participants.create_own', 'participants.walk_in',
  'users.invite', 'scout_year.manage', 'communications.send', 'activities.edit', 'roles.manage', 'roles.view',
  'org.edit', 'camp_sites.manage'
];


/** What no response may contain. */
const SECRET = 'SECRET_DB_DETAIL relation "fictional_table" at /srv/app/routes/fictional.js:12:34';
const LEAKS = [/SECRET_DB_DETAIL/, /fictional_table/, /\/srv\/app/, /at .+\(.+:\d+:\d+\)/, /node_modules/];
const RECORD_ID = 42;

let app;

function staffToken() {
  return jwt.sign({
    user_id: '00000000-0000-4000-8000-000000000001',
    organizationId: ORG_ID,
    roleIds: [1],
    roleNames: ['district'],
    permissions: PERMISSIONS
  }, TEST_SECRET);
}

const ROUTES = [
  ['delete', '/api/v1/finance/payment-plans/:id'],
  ['put', '/api/v1/finance/payments/:id'],
  ['get', '/api/v1/finance/participants/:id/statement'],
  ['get', '/api/v1/finance/participant-fees/:id/payments'],
  ['delete', '/api/v1/resources/equipment/:id'],
  ['patch', '/api/v1/resources/equipment/reservations/:id'],
  ['patch', '/api/v1/resources/permission-slips/:id/archive'],
  ['patch', '/api/v1/honors/:id'],
  ['delete', '/api/v1/honors/:id'],
  ['get', '/api/v1/yearly-planner/plans/:id'],
  ['delete', '/api/v1/yearly-planner/meetings/:id'],
  ['post', '/api/v1/yearly-planner/meetings/:id/schedule/copy-from/1'],
  ['get', '/api/v1/yearly-planner/meetings/:id/duplication'],
  ['post', '/api/v1/yearly-planner/meetings/:id/duplicate'],
  ['put', '/api/v1/camp-sites/:id'],
  ['patch', '/api/v1/camp-sites/:id/archive'],
  ['get', '/api/v1/camp-sites/camps/:id'],
  ['put', '/api/v1/camp-sites/camps/:id'],
  ['get', '/api/v1/camp-plans/camps/:id'],
  ['put', '/api/v1/camp-plans/camps/:id/sections/theme'],
  ['put', '/api/v1/camp-plans/camps/:id/rain-games'],
  ['get', '/api/v1/incidents/prefill/participant/:id'],
  ['get', '/api/v1/incidents/prefill/activity/:id'],
  ['patch', '/api/v1/incidents/escalation-contacts/:id'],
  ['delete', '/api/v1/incidents/escalation-contacts/:id'],
  ['get', '/api/v1/incidents/:id'],
  ['patch', '/api/v1/incidents/:id'],
  ['delete', '/api/v1/incidents/:id'],
  ['post', '/api/v1/incidents/:id/submit'],
  ['get', '/api/v1/form-builder/form-formats/:id'],
  ['put', '/api/v1/form-builder/form-formats/:id'],
  ['delete', '/api/v1/form-builder/form-formats/:id'],
  ['post', '/api/v1/form-builder/form-formats/:id/versions'],
  ['get', '/api/v1/form-builder/form-formats/:id/versions'],
  ['post', '/api/v1/form-builder/form-formats/:id/archive'],
  ['post', '/api/v1/form-builder/form-versions/:id/publish'],
  ['put', '/api/v1/medication/requirements/:id'],
  ['patch', '/api/v1/medication/distributions/:id'],
  ['patch', '/api/v1/medication/receptions/:id'],
  ['delete', '/api/v1/medication/receptions/:id'],
  ['get', '/api/v1/medication/authorizations/:id'],
  ['get', '/api/v1/medication/receptions?activity_id=:id'],
  ['get', '/api/v1/participants/:id'],
  ['delete', '/api/v1/participants/:id/erasure'],
  ['delete', '/api/v1/participants/:id/users/00000000-0000-4000-8000-000000000002'],
  ['get', '/api/v1/participants?group_id=:id'],
  ['get', '/api/v1/participants?page=:id'],
  ['get', '/api/v1/participants?limit=:id'],
  ['get', '/api/v1/activities/:id'],
  ['get', '/api/v1/activities/:id/participants'],
  ['delete', '/api/v1/activities/:id'],
  ['put', '/api/v1/badges/badge-progress/:id'],
  ['get', '/api/v1/badges/stars?participant_id=:id'],
  ['get', '/api/v1/badges/stars?participant_id=1&badge_template_id=:id'],
  ['put', '/api/v1/budget/categories/:id'],
  ['delete', '/api/v1/budget/categories/:id'],
  ['put', '/api/v1/budget/items/:id'],
  ['delete', '/api/v1/budget/items/:id'],
  ['put', '/api/v1/budget/expenses/:id'],
  ['delete', '/api/v1/budget/expenses/:id'],
  ['put', '/api/v1/budget/plans/:id'],
  ['delete', '/api/v1/budget/plans/:id'],
  ['put', '/api/v1/calendars/:id'],
  ['put', '/api/v1/calendars/:id/payment'],
  ['get', '/api/v1/carpools/activity/:id'],
  ['get', '/api/v1/carpools/activity/:id/unassigned'],
  ['put', '/api/v1/carpools/offers/:id'],
  ['delete', '/api/v1/carpools/offers/:id'],
  ['delete', '/api/v1/carpools/assignments/:id'],
  ['put', '/api/v1/revenue/external/:id'],
  ['delete', '/api/v1/revenue/external/:id'],
  ['delete', '/api/v1/family-links/:id'],
  ['get', '/api/v1/fundraisers/:id'],
  ['put', '/api/v1/fundraisers/:id'],
  ['put', '/api/v1/fundraisers/:id/archive'],
  ['delete', '/api/v1/fundraisers/:id'],
  ['get', '/api/v1/groups/:id'],
  ['put', '/api/v1/groups/:id'],
  ['delete', '/api/v1/groups/:id'],
  ['get', '/api/v1/messages/:id'],
  ['post', '/api/v1/participant-duplicates/:id/resolve'],
  ['patch', '/api/v1/participants/:id/group-membership'],
  ['delete', '/api/v1/participants/groups/:id'],
  ['put', '/api/v1/participants/:id'],
  ['delete', '/api/v1/participants/:id'],
  ['post', '/api/v1/scout-years/transitions/:id/rollback'],
  ['patch', '/api/v1/scout-years/memberships/:id/status'],
  ['post', '/api/v1/walk-in-children/:id/invite'],
  ['post', '/api/v1/walk-in-children/:id/invite-another-parent'],
  ['get', '/api/v1/google-chat/messages?limit=:id'],
  ['get', '/api/v1/program-progress/stream?participant_id=:id'],
  ['get', '/api/v1/program-progress/stream?limit=:id'],
  ['get', '/api/v1/resources/equipment/reservations?activity_id=:id'],
  ['get', '/api/v1/resources/permission-slips?participant_id=:id'],
  ['get', '/api/v1/resources/permission-slips?activity_id=:id'],
  ['put', '/api/v1/activities/:id'],
  ['patch', '/api/v1/roles/:id'],
  ['get', '/api/v1/roles/:id/permissions'],
  ['delete', '/api/v1/roles/:id'],
  ['delete', '/api/v1/roles/1/permissions/:id']
];

beforeAll(() => {
  process.env.JWT_SECRET_KEY = TEST_SECRET;
  process.env.ORGANIZATION_ID = ORG_ID.toString();
  app = require('../api');
});

beforeEach(() => {
  const { __mClient, __mPool } = require('pg');
  mockQueryImplementation(__mClient, __mPool, (query, params) => {
    if (query.includes('permission_key')) {
      return { rows: PERMISSIONS.map((key) => ({ permission_key: key })) };
    }
    if ((params || []).some((value) => Number(value) === RECORD_ID)) {
      return Promise.reject(Object.assign(new Error(SECRET), { code: 'XX000', detail: SECRET, stack: `Error: ${SECRET}` }));
    }
    return undefined;
  });
});

afterAll((done) => {
  closeServerResources(app, done);
});

describe.each(ROUTES.filter(([method]) => method === 'get' || method === 'delete'))('%s %s', (method, path) => {
  it('a database failure says nothing of the database', async () => {
    const res = await request(app)[method](path.replace(/:[a-zA-Z]+/g, String(RECORD_ID)))
      .set('Authorization', `Bearer ${staffToken()}`);

    const body = JSON.stringify(res.body) + (res.text || '');
    LEAKS.forEach((pattern) => expect(body).not.toMatch(pattern));
  });
});

// Without this, a change that stopped the failure from being reached would leave every case above green.
describe('the suite reaches the database', () => {
  it('most routes answer 500 from the injected failure', async () => {
    const reads = ROUTES.filter(([method]) => method === 'get' || method === 'delete');
    const statuses = await Promise.all(reads.map(([method, path]) => request(app)[method](path.replace(/:[a-zA-Z]+/g, String(RECORD_ID)))
      .set('Authorization', `Bearer ${staffToken()}`).then((res) => res.status)));
    const counts = statuses.reduce((acc, status) => ({ ...acc, [status]: (acc[status] || 0) + 1 }), {});
    expect(counts[500]).toBeGreaterThan(reads.length / 2);
  });
});
