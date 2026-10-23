/*
 * The demo request form on wampums.app: only a name and an email are required,
 * and the two menus accept only the answers the form offers.
 */
const request = require('supertest');
const { closeServerResources } = require('./test-helpers');

jest.mock('pg', () => {
  const mClient = { query: jest.fn(), release: jest.fn() };
  const mPool = {
    connect: jest.fn(() => Promise.resolve(mClient)),
    query: jest.fn(),
    on: jest.fn(),
  };
  return { Pool: jest.fn(() => mPool), __esModule: true, __mClient: mClient, __mPool: mPool };
});

jest.mock('../utils/index', () => ({
  ...jest.requireActual('../utils/index'),
  sendEmail: jest.fn(() => Promise.resolve(true)),
}));

const { setupDefaultMocks } = require('./mock-helpers');
const { sendEmail } = require('../utils/index');

let app;
const ENDPOINT = '/api/v1/public/contact-demo';

beforeAll(() => {
  process.env.JWT_SECRET_KEY = 'testsecret';
  process.env.DB_USER = 'test';
  process.env.DB_HOST = 'localhost';
  process.env.DB_NAME = 'testdb';
  process.env.DB_PASSWORD = 'test';
  process.env.DB_PORT = '5432';
  app = require('../api');
});

beforeEach(() => {
  const { __mClient, __mPool } = require('pg');
  setupDefaultMocks(__mClient, __mPool);
  sendEmail.mockClear();
});

afterAll((done) => {
  closeServerResources(app, done);
});

describe('demo requests from the public site', () => {
  test('a request with only a name and an email is sent', async () => {
    const res = await request(app).post(ENDPOINT).send({ name: 'Ada Lovelace', email: 'ada@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][2]).toMatch(/Message:\s*Not provided/);
  });

  test('the number of youth and the current tool reach the request email in words', async () => {
    const res = await request(app).post(ENDPOINT).send({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      unit_size: '15_30',
      current_tool: 'scoutstracker',
      message: '',
    });

    expect(res.status).toBe(200);
    const [, , text, html] = sendEmail.mock.calls[0];
    expect(text).toContain('Youth: 15 to 30');
    expect(text).toContain('Uses today: ScoutsTracker');
    expect(html).toContain('15 to 30');
  });

  test('an answer the menus do not offer is refused and names its field', async () => {
    const res = await request(app).post(ENDPOINT).send({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      unit_size: '<script>',
    });

    expect(res.status).toBe(400);
    expect(res.body.errors.map((item) => item.field)).toEqual(['unit_size']);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test('a request without an email is refused', async () => {
    const res = await request(app).post(ENDPOINT).send({ name: 'Ada Lovelace' });

    expect(res.status).toBe(400);
    expect(res.body.errors.map((item) => item.field)).toContain('email');
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
