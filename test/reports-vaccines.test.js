/**
 * Vaccination report suite
 *
 * The regression this suite pins down: the report returned the raw
 * `vaccins_a_jour` text and the SPA only recognised `"on"` and `"true"`, so a
 * fiche santé answering `"oui"`, `"1"` or `true` showed "non" while the health
 * report showed the child as vaccinated.
 *
 * @module test/reports-vaccines
 */

process.env.JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || 'reports-vaccines-test-secret';

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
  withScoutYear: () => (req, _res, next) => {
    req.scoutYear = {
      id: 7,
      label: '2025-2026',
      start_date: '2025-09-01',
      end_date: '2026-08-31',
      status: 'active'
    };
    req.rosterStatuses = ['active'];
    next();
  }
}));

const reportsRoute = require('../routes/reports');

/** Rows the stubbed roster query returns. */
let rosterRows = [];

const pool = {
  query: jest.fn(() => Promise.resolve({ rows: rosterRows }))
};

const logger = { info: () => {}, warn: () => {}, error: () => {} };

describe('Vaccination report', () => {
  let app;

  beforeEach(() => {
    rosterRows = [];
    app = express();
    app.use(express.json());
    app.use('/api/v1/reports', reportsRoute(pool, logger));
  });

  /**
   * Run the report for one participant whose form holds the given answer.
   *
   * @param {*} answer - Stored `vaccins_a_jour` value
   * @returns {Promise<Object>} The participant's report row
   */
  async function reportFor(answer) {
    rosterRows = [{
      id: 1,
      first_name: 'Alix',
      last_name: 'Tremblay',
      group_name: 'Roux',
      vaccines_answer: answer
    }];
    const res = await request(app).get('/api/v1/reports/vaccines');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    return res.body.data[0];
  }

  it.each([['oui'], ['Oui'], ['1'], [true], ['on'], ['true'], ['yes']])(
    'reports vaccines up to date for an answer of %p',
    async (answer) => {
      const row = await reportFor(answer);
      expect(row.vaccines_up_to_date).toBe(true);
      expect(row).not.toHaveProperty('vaccines_answer');
    }
  );

  it.each([['non'], ['0'], [false], [''], [null]])(
    'reports vaccines not up to date for an answer of %p',
    async (answer) => {
      const row = await reportFor(answer);
      expect(row.vaccines_up_to_date).toBe(false);
    }
  );
});
