/**
 * Sign-in and password reset are rate limited in production (CLAUDE.md §6).
 *
 * Outside production the ceilings are far higher so tests and local runs are
 * not locked out; this suite loads the auth routes as production does, with a
 * pool that refuses nothing, and counts.
 */
const express = require('express');
const request = require('supertest');

process.env.JWT_SECRET_KEY ||= 'fictional-auth-rate-limits';

/** The auth routes as production builds them, on an app of their own. */
function productionApp() {
  const previous = process.env.NODE_ENV;
  let router;
  process.env.NODE_ENV = 'production';
  try {
    jest.isolateModules(() => {
      const pool = { query: jest.fn().mockResolvedValue({ rows: [] }), connect: jest.fn() };
      const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
      router = require('../routes/auth')(pool, logger);
    });
  } finally {
    process.env.NODE_ENV = previous;
  }
  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
}

describe('rate limits in production', () => {
  test('the seventh sign-in attempt within fifteen minutes is refused, with the limit in the headers', async () => {
    const app = productionApp();
    const attempt = () => request(app).post('/api/v1/auth/login').send({ email: 'not-an-address', password: 'x' });

    const statuses = [];
    for (let i = 0; i < 7; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- attempts are counted in order
      statuses.push((await attempt()).status);
    }
    const refused = await attempt();

    expect(statuses.slice(0, 6).every((status) => status !== 429)).toBe(true);
    expect(statuses[6]).toBe(429);
    expect(refused.body).toMatchObject({ success: false, message: 'too_many_login_attempts' });
    expect(refused.headers).toHaveProperty('ratelimit-limit', '6');
  });

  test('the sixth password reset request within an hour is refused', async () => {
    const app = productionApp();
    const statuses = [];
    for (let i = 0; i < 6; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- requests are counted in order
      statuses.push((await request(app).post('/api/v1/auth/request-reset').send({ email: 'not-an-address' })).status);
    }

    expect(statuses.slice(0, 5).every((status) => status !== 429)).toBe(true);
    expect(statuses[5]).toBe(429);
  });
});
