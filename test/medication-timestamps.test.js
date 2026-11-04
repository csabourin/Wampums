/** Medication times must identify an instant, independently of the server's time zone. */
const express = require('express');
const request = require('supertest');

jest.mock('../middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: '00000000-0000-0000-0000-000000000001' };
    next();
  },
  requirePermission: () => (_req, _res, next) => next(),
  blockDemoRoles: (_req, _res, next) => next(),
  getOrganizationId: () => Promise.resolve(1),
  withScoutYear: () => (_req, _res, next) => next()
}));

const client = { query: jest.fn(), release: jest.fn() };
const pool = { query: jest.fn(), connect: jest.fn() };
const medicationRoute = require('../routes/medication');
const app = express();
app.use(express.json());
app.use('/api', medicationRoute(pool, { error: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
  pool.connect.mockResolvedValue(client);
  pool.query.mockResolvedValue({ rows: [{ id: 3, status: 'scheduled' }] });
  client.query.mockImplementation((sql) => Promise.resolve({
    rows: sql.includes('SELECT id, status FROM medication_distributions') ? [] : [{ id: 9 }]
  }));
});

const invalidTimes = [
  undefined, null, '', 0, false, [], {},
  '2026-01-15', '2026-01-15T08:00', '2026-01-15T08:00:00',
  'January 15, 2026 08:00 GMT', '2026-02-29T08:00:00Z',
  '2026-02-30T08:00:00-05:00', '2026-04-31T08:00:00Z',
  '2026-01-15T24:00:00Z', '2026-01-15T08:60:00Z',
  '2026-01-15T08:00:60Z', '2026-01-15T08:00:00+24:00',
  '2026-01-15T08:00:00-05:60', '2026-01-15T08:00:00Z trailing'
];
const validTimes = [
  ['2026-01-15T08:00:00Z', '2026-01-15T08:00:00.000Z'],
  ['2026-01-15T08:00-05:00', '2026-01-15T13:00:00.000Z'],
  ['2026-07-15T08:00:00-04:00', '2026-07-15T12:00:00.000Z'],
  ['2026-01-15T08:00:00.123+05:30', '2026-01-15T02:30:00.123Z'],
  ['2024-02-29T23:30:00-05:00', '2024-03-01T04:30:00.000Z'],
  // The repeated autumn hour identifies two distinct doses through its offset.
  ['2026-11-01T01:30:00-04:00', '2026-11-01T05:30:00.000Z'],
  ['2026-11-01T01:30:00-05:00', '2026-11-01T06:30:00.000Z']
];

function schedule(scheduledFor) {
  return request(app).post('/api/v1/medication/distributions').send({
    medication_requirement_id: 3, participant_ids: [7], scheduled_for: scheduledFor
  });
}

function recordAdministration(administeredAt) {
  return request(app).patch('/api/v1/medication/distributions/9').send({
    status: 'given', administered_at: administeredAt
  });
}

describe('Scheduling a medication dose', () => {
  it.each(invalidTimes.map((value) => [value]))('rejects ambiguous or invalid time %p before accessing medication records', async (value) => {
    const res = await schedule(value);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/explicit UTC offset/);
    expect(pool.query).not.toHaveBeenCalled();
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it.each(validTimes)('stores %s as the explicit instant %s', async (value, expected) => {
    const res = await schedule(value);
    expect(res.status).toBe(201);
    const [, params] = client.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO medication_distributions'));
    expect(params[4]).toBe(expected);
    const [, duplicateCheck] = client.query.mock.calls.find(([sql]) => sql.includes('SELECT id, status FROM medication_distributions'));
    expect(duplicateCheck[3]).toBe(expected);
  });
});

describe('Recording when a medication dose was administered', () => {
  it.each(invalidTimes.filter((value) => value !== undefined && value !== null).map((value) => [value]))(
    'rejects ambiguous or invalid time %p without updating the dose', async (value) => {
      const res = await recordAdministration(value);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/explicit UTC offset/);
      expect(pool.query).not.toHaveBeenCalled();
    }
  );

  it.each(validTimes)('stores %s as the explicit instant %s', async (value, expected) => {
    const res = await recordAdministration(value);
    expect(res.status).toBe(200);
    const [, params] = pool.query.mock.calls.find(([sql]) => sql.includes('UPDATE medication_distributions'));
    expect(params[1]).toBe(expected);
  });

  it.each([undefined, null])('keeps an omitted or null administration time optional (%p)', async (value) => {
    const res = await recordAdministration(value);
    expect(res.status).toBe(200);
    const [, params] = pool.query.mock.calls.find(([sql]) => sql.includes('UPDATE medication_distributions'));
    expect(params[1]).toBeNull();
  });
});
