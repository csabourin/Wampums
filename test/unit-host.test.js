const express = require('express');
const request = require('supertest');
const { redirectUnassignedUnitHost } = require('../middleware/unit-host');
const { error } = require('../middleware/response');

function createHostApp(pool) {
  const app = express();
  app.set('trust proxy', 1);
  app.locals.pool = pool;
  app.use(redirectUnassignedUnitHost);
  app.use((_req, res) => res.send('unit content'));
  app.use((_err, _req, res, _next) => error(res, 'internal_server_error', 500));
  return app;
}

describe('unassigned unit hostnames', () => {
  let pool;
  let app;

  beforeEach(() => {
    pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    app = createHostApp(pool);
  });

  test.each(['/', '/login', '/assets/app.js', '/api/v1/organizations/status', '/invite?token=private']) (
    'an unused hostname sends %s to the public home without carrying its URL', async (url) => {
      const res = await request(app).get(url).set('Host', 'unused.wampums.app');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('https://wampums.app/');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(res.headers['ratelimit-limit']).toBeDefined();
      expect(res.text).not.toContain('unit content');
    },
  );

  test('posting to an unused hostname redirects without replaying the form', async () => {
    const res = await request(app).post('/login').set('Host', 'unused.wampums.app').send({ password: 'fictional' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://wampums.app/');
  });

  test('a unit address starts serving its unit as soon as it is assigned', async () => {
    const first = await request(app).get('/login').set('Host', 'new-unit.wampums.app');
    expect(first.status).toBe(302);
    pool.query.mockResolvedValue({ rows: [{ organization_id: 12 }] });
    const assigned = await request(app).get('/login').set('Host', 'new-unit.wampums.app');
    expect(assigned.status).toBe(200);
    expect(assigned.text).toBe('unit content');
    pool.query.mockResolvedValue({ rows: [] });
    expect((await request(app).get('/').set('Host', 'new-unit.wampums.app')).status).toBe(302);
  });

  test('a public unit header cannot bypass the hostname assignment check', async () => {
    const res = await request(app).get('/').set('Host', 'unused.wampums.app').set('x-organization-id', '12');
    expect(res.status).toBe(302);
    expect(pool.query).toHaveBeenCalledWith(
      'SELECT 1 FROM organization_domains WHERE lower(domain) = $1 LIMIT 1', ['unused.wampums.app'],
    );
  });

  test('mixed-case hostnames and a trailing DNS dot still find their assignment', async () => {
    pool.query.mockResolvedValue({ rows: [{}] });
    const res = await request(app).get('/').set('Host', 'NEW-UNIT.WAMPUMS.APP.');
    expect(res.status).toBe(200);
    expect(pool.query.mock.calls[0][1]).toEqual(['new-unit.wampums.app']);
  });

  test.each(['wampums.app', 'www.wampums.app', 'localhost:5000', '127.0.0.1', 'meute6a.app', 'unit.example.test', 'wampums.app.evil.test', 'notwampums.app'])(
    '%s keeps its existing routing without a unit-host lookup', async (host) => {
      const res = await request(app).get('/').set('Host', host);
      expect(res.status).toBe(200);
      expect(pool.query).not.toHaveBeenCalled();
    },
  );

  test('a database outage returns an error rather than sending an assigned unit away', async () => {
    pool.query.mockRejectedValue(new Error('fictional database outage'));
    const res = await request(app).get('/').set('Host', 'known.wampums.app');
    expect(res.status).toBe(500);
    expect(res.headers.location).toBeUndefined();
    expect(res.text).not.toContain('fictional database outage');
  });
});
