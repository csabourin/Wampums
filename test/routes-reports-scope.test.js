/**
 * Unit reports are the team's (#1338): every report listing the whole unit
 * (health, allergies, medication, contacts…) refuses a role that sees only its
 * own children, even one a unit gave `reports.view`. The progress report,
 * which filters itself to the account's linked children, stays open to it.
 */
process.env.JWT_SECRET_KEY = 'fictional-report-scope-tests';

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { authorizationContextRow } = require('./mock-helpers');

jest.mock('../middleware/auth', () => {
  const actual = jest.requireActual('../middleware/auth');
  return {
    ...actual,
    withScoutYear: () => (req, _res, next) => {
      req.scoutYear = { id: 7, label: '2026-2027', start_date: '2026-09-01', end_date: '2027-08-31', status: 'active' };
      req.rosterStatuses = ['active'];
      next();
    },
  };
});

const USER_ID = '00000000-0000-4000-8000-000000000001';
const UNIT_ID = 7;
const UNIT_REPORTS = [
  'mailing-list', 'health', 'attendance', 'missing-documents', 'health-contacts', 'allergies', 'medication',
  'vaccines', 'leave-alone', 'media-authorization', 'honors', 'points', 'time-since-registration', 'parent-contact-list',
];
let roles;
const pool = { query: jest.fn((sql) => {
  if (sql.includes('AS authorization_permissions')) { return authorizationContextRow({ permissions: ['reports.view'], roles }); }
  if (sql.includes('SELECT organization_id FROM user_organizations')) { return { rows: [{ organization_id: UNIT_ID }] }; }
  return { rows: [] };
}) };
const app = express();
app.locals.pool = pool;
app.use(express.json());
app.use('/api/v1/reports', require('../routes/reports')(pool, { info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
const token = jwt.sign({ user_id: USER_ID, organizationId: UNIT_ID }, process.env.JWT_SECRET_KEY);
const get = (report) => request(app).get(`/api/v1/reports/${report}`).set('Authorization', `Bearer ${token}`);
const reportQueries = () => pool.query.mock.calls.filter(([sql]) =>
  !sql.includes('AS authorization_permissions') && !sql.includes('SELECT organization_id FROM user_organizations'));

beforeEach(() => {
  pool.query.mockClear();
  roles = [{ role_name: 'animation', display_name: 'Leader', data_scope: 'organization' }];
});

test.each(UNIT_REPORTS)('a family role holding reports.view cannot read the unit’s %s report', async (report) => {
  roles = [{ role_name: 'u7_family_plus', display_name: 'Family plus', data_scope: 'linked' }];
  const response = await get(report);
  expect(response.status).toBe(403);
  expect(response.body.required).toEqual(['reports.view']);
  expect(Array.isArray(response.body.missing)).toBe(true);
  expect(reportQueries()).toEqual([]);
});

test.each(UNIT_REPORTS)('the unit’s team still reads the %s report', async (report) => {
  const response = await get(report);
  expect(response.status).not.toBe(403);
  expect(response.status).toBeLessThan(500);
});

test('a family role still reads the progress report, which lists only its own children', async () => {
  roles = [{ role_name: 'u7_family_plus', display_name: 'Family plus', data_scope: 'linked' }];
  const response = await get('participant-progress');
  expect(response.status).toBe(200);
  expect(response.body.data.isStaff).toBe(false);
  const participants = reportQueries().find(([sql]) => sql.includes('FROM participants p'));
  expect(participants[0]).toContain('JOIN user_participants up');
  expect(participants[1]).toContain(USER_ID);
});
