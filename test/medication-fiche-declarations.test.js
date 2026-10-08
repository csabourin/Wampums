/**
 * Medication declared on the health form, for the reception page
 *
 * The regression this suite pins down: the reception page listed only
 * medications planned through medication planning, so a child whose fiche santé
 * declares a medication that nobody had planned yet never appeared — while the
 * medication report, which reads the fiche santé, listed them.
 *
 * @module test/medication-fiche-declarations
 */

process.env.JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || 'medication-fiche-test-secret';

const express = require('express');
const request = require('supertest');

const USER_ID = '00000000-0000-0000-0000-000000000001';
let dataScope = 'organization';

jest.mock('../middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: '00000000-0000-0000-0000-000000000001' };
    next();
  },
  requirePermission: () => (_req, _res, next) => next(),
  blockDemoRoles: (_req, _res, next) => next(),
  getOrganizationId: () => Promise.resolve(1),
  getUserDataScope: () => Promise.resolve(dataScope),
  withScoutYear: () => (req, _res, next) => {
    req.scoutYear = { id: 7, status: 'active' };
    req.rosterStatuses = ['active'];
    next();
  }
}));

jest.mock('../middleware/medicationAuthorizationPolicy', () => ({
  medicationParticipantInUnit: () => (_req, _res, next) => next(),
  familyMedicationAccess: () => (_req, _res, next) => next()
}));

/** Rows the stubbed roster query returns. */
let rosterRows = [];
/** Parameters the last query ran with. */
let lastParams = null;

const pool = {
  query: jest.fn((_sql, params) => {
    lastParams = params;
    return Promise.resolve({ rows: rosterRows });
  })
};

const medicationRoute = require('../routes/medication');

describe('GET /v1/medication/fiche-declarations', () => {
  let app;

  beforeEach(() => {
    rosterRows = [];
    lastParams = null;
    dataScope = 'organization';
    app = express();
    app.use(express.json());
    app.use('/api', medicationRoute(pool, { info: () => {}, warn: () => {}, error: () => {} }));
  });

  it('lists every child whose health form declares a medication', async () => {
    rosterRows = [
      { participant_id: 1, health_data: { has_medication: 'oui', medicament: 'Ventolin' } },
      { participant_id: 2, health_data: { medicament: 'Ritalin 10 mg' } },
      { participant_id: 3, health_data: { has_medication: 'non', medicament: 'Aucun' } },
      { participant_id: 4, health_data: {} }
    ];

    const res = await request(app).get('/api/v1/medication/fiche-declarations');

    expect(res.status).toBe(200);
    expect(res.body.data.declarations).toEqual([
      { participant_id: 1, medication: 'Ventolin' },
      { participant_id: 2, medication: 'Ritalin 10 mg' }
    ]);
  });

  it('confines a linked-scope user to their own children', async () => {
    dataScope = 'linked';

    await request(app).get('/api/v1/medication/fiche-declarations');

    expect(lastParams).toEqual([1, 7, ['active'], true, USER_ID]);
  });
});
