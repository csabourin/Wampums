const { adaptAuthorizationMock } = require('./mock-helpers');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const TEST_SECRET = 'communication-archive-secret';
const USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const ORGANIZATION_ID = 7;
const quiet = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

function token() {
  return jwt.sign({ user_id: USER_ID, user_role: 'district', organizationId: ORGANIZATION_ID }, TEST_SECRET);
}

/**
 * What the pool answers. The announcement router keeps module-level state tied
 * to the first pool it is built with, so the app is built once and each test
 * describes its scenario here.
 */
const DEFAULTS = {
  permissions: ['communications.send'],
  demo: false,
  announcement: { id: 4, status: 'sent' },
  newsItem: { id: 9 },
};
let scenario;
let queryLog;

const pool = {
  query: jest.fn((query, params = []) => Promise.resolve(answer(query, params))),
};

function answer(query, params) {
  queryLog.push({ query, params });
  const { permissions, demo, announcement, newsItem } = scenario;
  if (query.includes('SELECT organization_id FROM user_organizations')) {
    return { rows: [{ organization_id: ORGANIZATION_ID }] };
  }
  if (query.includes("role_name IN ('demoadmin', 'demoparent')")) {
    return { rows: demo ? [{ role_name: 'demoadmin' }] : [] };
  }
  if (query.includes('SELECT DISTINCT p.permission_key')) {
    return { rows: permissions.map((key) => ({ permission_key: key })) };
  }
  if (query.includes('SELECT DISTINCT r.role_name')) {
    return { rows: [{ role_name: 'district', display_name: 'District' }] };
  }
  if (query.includes('UPDATE announcements') && query.includes('archived_at')) {
    const [archived] = params;
    const pending = ['scheduled', 'sending'].includes(announcement?.status);
    return announcement && !(archived && pending)
      ? { rows: [{ id: announcement.id, status: announcement.status, archived_at: archived ? 'now' : null }] }
      : { rows: [] };
  }
  if (query.includes('SELECT id FROM announcements')) {
    return { rows: announcement ? [{ id: announcement.id }] : [] };
  }
  if (query.includes('UPDATE news')) {
    return newsItem ? { rows: [{ id: newsItem.id, archived_at: params[0] ? 'now' : null }] } : { rows: [] };
  }
  if (query.includes('FROM news')) {
    return { rows: [{ id: 9, title: 'Camp', content: 'Text', created_at: '2026-10-01T00:00:00Z' }] };
  }
  return { rows: [] };
}
adaptAuthorizationMock(pool);

const app = express();
app.locals.pool = pool;
app.use(express.json());
app.use('/api/v1/news', require('../routes/news')(pool));
app.use('/api', require('../routes/announcements')(pool, quiet, {}, {}));

/** @param {Object} [overrides] - Scenario values that differ from the defaults */
function given(overrides = {}) {
  scenario = { ...DEFAULTS, ...overrides };
}

const authorized = (req) => req.set('Authorization', `Bearer ${token()}`);

beforeAll(() => {
  process.env.JWT_SECRET_KEY = TEST_SECRET;
});

beforeEach(() => {
  queryLog = [];
  given();
});

describe('archiving a sent message', () => {
  test('is refused without a token', async () => {
    const response = await request(app).patch('/api/v1/announcements/4/archive').send({ archived: true });

    expect(response.status).toBe(401);
    expect(response.body.message).toMatch(/authentication required/i);
  });

  test('is refused to someone who cannot send communications, saying what is missing', async () => {
    given({ permissions: ['org.view'] });
    const response = await authorized(request(app).patch('/api/v1/announcements/4/archive')).send({ archived: true });

    expect(response.status).toBe(403);
    expect(response.body.required).toEqual(['communications.send']);
    expect(response.body.missing).toEqual(['communications.send']);
  });

  test('is refused to a demo account', async () => {
    given({ demo: true });
    const response = await authorized(request(app).patch('/api/v1/announcements/4/archive')).send({ archived: true });

    expect(response.status).toBe(403);
    expect(response.body.isDemo).toBe(true);
  });

  test.each(['12abc', '0', '2147483648'])('rejects the malformed id %s', async (id) => {
    const response = await authorized(request(app).patch(`/api/v1/announcements/${id}/archive`)).send({ archived: true });

    expect(response.status).toBe(400);
  });

  test('rejects a body that does not say whether to archive or restore', async () => {
    const response = await authorized(request(app).patch('/api/v1/announcements/4/archive')).send({ archived: 'maybe' });

    expect(response.status).toBe(400);
  });

  test('archives a sent message of the unit and restores it', async () => {
    const archive = await authorized(request(app).patch('/api/v1/announcements/4/archive')).send({ archived: true });
    const restore = await authorized(request(app).patch('/api/v1/announcements/4/archive')).send({ archived: false });

    expect(archive.status).toBe(200);
    expect(archive.body.data.archived_at).toBeTruthy();
    expect(restore.status).toBe(200);
    expect(restore.body.data.archived_at).toBeNull();
    const update = queryLog.find(({ query }) => query.includes('UPDATE announcements'));
    expect(update.params.slice(0, 3)).toEqual([true, 4, ORGANIZATION_ID]);
  });

  test('answers 404 for a message of another unit, whatever the client claims', async () => {
    given({ announcement: null });
    const response = await authorized(request(app).patch('/api/v1/announcements/4/archive'))
      .set('x-organization-id', '99')
      .send({ archived: true, organization_id: 99 });
    expect(response.status).toBe(404);
  });

  test('refuses to archive a message still waiting to go out', async () => {
    given({ announcement: { id: 4, status: 'scheduled' } });
    const response = await authorized(request(app).patch('/api/v1/announcements/4/archive')).send({ archived: true });

    expect(response.status).toBe(409);
  });
});

describe('listing the message history', () => {
  test('lists the active messages by default and the archived ones on request', async () => {
    await authorized(request(app).get('/api/v1/announcements'));
    await authorized(request(app).get('/api/v1/announcements?archived=true'));

    const lists = queryLog.filter(({ query }) => query.includes('FROM announcements') && query.includes('LIMIT 50'));
    expect(lists.map(({ params }) => params)).toEqual([[ORGANIZATION_ID, false], [ORGANIZATION_ID, true]]);
  });

  test('rejects an archived filter that is not true or false', async () => {
    const response = await authorized(request(app).get('/api/v1/announcements?archived=soon'));

    expect(response.status).toBe(400);
  });
});

describe('news', () => {
  test('are listed to any member of the unit', async () => {
    given({ permissions: [] });
    const response = await authorized(request(app).get('/api/v1/news'));

    expect(response.status).toBe(200);
    expect(response.body.data[0].title).toBe('Camp');
    const list = queryLog.find(({ query }) => query.includes('FROM news'));
    expect(list.query).toContain('archived_at IS NULL');
    expect(list.params[0]).toBe(ORGANIZATION_ID);
  });

  test('their archive is for those who send communications only', async () => {
    given({ permissions: [] });
    const response = await authorized(request(app).get('/api/v1/news/archived'));

    expect(response.status).toBe(403);
    expect(response.body.required).toEqual(['communications.send']);
  });

  test('archived news are listed to those who send communications', async () => {
    const response = await authorized(request(app).get('/api/v1/news/archived'));

    expect(response.status).toBe(200);
    expect(queryLog.find(({ query }) => query.includes('archived_at IS NOT NULL'))).toBeTruthy();
  });

  test('can be archived and restored by those who send communications', async () => {
    const archive = await authorized(request(app).patch('/api/v1/news/9/archive')).send({ archived: true });
    const restore = await authorized(request(app).patch('/api/v1/news/9/archive')).send({ archived: false });

    expect([archive.status, restore.status]).toEqual([200, 200]);
    const update = queryLog.find(({ query }) => query.includes('UPDATE news'));
    expect(update.params).toEqual([true, 9, ORGANIZATION_ID]);
  });

  test.each([
    ['a demo account', { demo: true }, 403],
    ['someone who cannot send communications', { permissions: [] }, 403],
    ['another unit\'s news item', { newsItem: null }, 404],
  ])('cannot be archived for %s', async (_who, scenarioOverrides, status) => {
    given(scenarioOverrides);
    const response = await authorized(request(app).patch('/api/v1/news/9/archive')).send({ archived: true });

    expect(response.status).toBe(status);
    expect(response.body.isDemo).toBe(scenarioOverrides.demo ? true : undefined);
  });

  test('cannot be archived with a malformed id', async () => {
    const response = await authorized(request(app).patch('/api/v1/news/9x/archive')).send({ archived: true });

    expect(response.status).toBe(400);
  });

  test('without a token are refused', async () => {
    const response = await request(app).get('/api/v1/news');

    expect(response.status).toBe(401);
  });
});
