/**
 * Legacy health form endpoint — POST /api/v1/forms/health-forms
 *
 * The flat-body entry point predates `form_submissions` and used to write to a
 * `fiche_sante` table that no longer exists in the schema, behind an auth check
 * reading a JWT claim (`userId`) the tokens do not carry — so every call either
 * answered 401 or crashed, and any health data posted to it was lost.
 *
 * It now stores the same `fiche_sante` submission the current form endpoint
 * writes. What this suite pins down is that it does so without losing anything:
 * the fields it does not carry survive the save, and each free-text answer sets
 * the yes/no question the current form pairs it with, so an allergy saved here
 * is an allergy the reports and the fiche santé can both see.
 *
 * @module test/forms-health-form-legacy
 */

process.env.JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || 'health-form-legacy-test-secret';

const express = require('express');
const request = require('supertest');

const ORG_ID = 1;
const PARTICIPANT_ID = 42;
const USER_ID = '00000000-0000-0000-0000-000000000001';

const context = {
  dataScope: 'participant',
  enrollment: [{ scout_year_id: 3 }],
  membership: [{ role_ids: ['4'] }],
  roles: [{ role_name: 'parent' }],
  formPermission: [{ has_permission: true }],
  existingSubmission: []
};

jest.mock('../middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: '00000000-0000-0000-0000-000000000001', permissions: [] };
    next();
  },
  blockDemoRoles: (_req, _res, next) => next(),
  requireAnyPermission: () => (_req, _res, next) => next(),
  getOrganizationId: async () => 1,
  getUserDataScope: async () => context.dataScope
}));

const formsRoute = require('../routes/forms');

/** Every query the endpoint ran, so the stored document can be asserted. */
let queries = [];

/**
 * Answer a query the way the database would for the scenario in `context`.
 *
 * @param {string} sql - SQL text
 * @param {Array} params - Query parameters
 * @returns {Object} Query result
 */
function respond(sql, params) {
  queries.push({ sql, params });

  if (sql.includes('FROM participant_enrollments pe')) {
    return { rows: context.enrollment };
  }
  if (sql.includes('SELECT role_ids')) {
    return { rows: context.membership };
  }
  if (sql.includes('jsonb_array_elements_text')) {
    return { rows: context.roles };
  }
  if (sql.includes('has_permission')) {
    return { rows: context.formPermission };
  }
  if (sql.includes('SELECT submission_data FROM form_submissions')) {
    return { rows: context.existingSubmission };
  }
  if (sql.includes('JOIN form_format_versions')) {
    return { rows: [{ version_id: 9 }] };
  }
  if (sql.includes('SELECT id FROM form_submissions')) {
    return { rows: context.existingSubmission.length > 0 ? [{ id: 55 }] : [] };
  }
  if (sql.includes('UPDATE form_submissions')) {
    return { rows: [{ id: 55, submission_data: JSON.parse(params[0]) }] };
  }
  if (sql.includes('INSERT INTO form_submissions')) {
    return { rows: [{ id: 55, submission_data: JSON.parse(params[3]) }] };
  }
  return { rows: [] };
}

const client = {
  query: jest.fn(async (sql, params) => respond(sql, params)),
  release: jest.fn()
};

const pool = {
  query: jest.fn(async (sql, params) => respond(sql, params)),
  connect: jest.fn(async () => client)
};

const logger = { info: () => {}, warn: () => {}, error: () => {} };

/**
 * The document the endpoint wrote to `form_submissions`.
 *
 * @returns {Object} Stored submission_data
 */
function storedDocument() {
  const update = queries.find((entry) => entry.sql.includes('UPDATE form_submissions'));
  if (update) {
    return JSON.parse(update.params[0]);
  }

  const insert = queries.find((entry) => entry.sql.includes('INSERT INTO form_submissions'));
  expect(insert).toBeDefined();
  return JSON.parse(insert.params[3]);
}

describe('POST /api/v1/forms/health-forms', () => {
  let app;

  beforeEach(() => {
    queries = [];
    context.dataScope = 'participant';
    context.enrollment = [{ scout_year_id: 3 }];
    context.membership = [{ role_ids: ['4'] }];
    context.roles = [{ role_name: 'parent' }];
    context.formPermission = [{ has_permission: true }];
    context.existingSubmission = [];
    client.query.mockClear();
    pool.query.mockClear();
    pool.connect.mockClear();

    app = express();
    app.use(express.json());
    app.use('/api/v1/forms', formsRoute(pool, logger));
  });

  /**
   * Post a legacy health form body.
   *
   * @param {Object} body - Request body
   * @returns {Promise<Object>} Supertest response
   */
  function postHealthForm(body) {
    return request(app).post('/api/v1/forms/health-forms').send(body);
  }

  it('stores the health form as a fiche_sante submission', async () => {
    const res = await postHealthForm({
      participant_id: PARTICIPANT_ID,
      allergie: 'Arachides',
      epipen: true,
      nom_medecin: 'Dre Fortin'
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const write = queries.find((entry) => entry.sql.includes('INSERT INTO form_submissions'));
    expect(write.params).toEqual(expect.arrayContaining([PARTICIPANT_ID, ORG_ID, 'fiche_sante', USER_ID]));
    expect(storedDocument()).toMatchObject({
      allergie: 'Arachides',
      epipen: true,
      nom_medecin: 'Dre Fortin'
    });
  });

  it('answers the yes/no question that goes with each free-text field', async () => {
    // Without this the record carries an allergy and no `has_allergies`, which
    // reads as an unanswered question and greys the box out on the fiche santé.
    await postHealthForm({
      participant_id: PARTICIPANT_ID,
      allergie: 'Arachides',
      medicament: 'aucun',
      limitation: ''
    });

    expect(storedDocument()).toMatchObject({
      has_allergies: 'yes',
      has_medication: 'no',
      has_limitations: 'no'
    });
  });

  it('keeps the answers it was not given', async () => {
    context.existingSubmission = [{
      submission_data: {
        allergie: 'Arachides',
        has_allergies: 'yes',
        epipen: true,
        niveau_natation: 'debutant',
        custom_field: 'kept'
      }
    }];

    await postHealthForm({ participant_id: PARTICIPANT_ID, nom_medecin: 'Dre Fortin' });

    expect(storedDocument()).toEqual({
      allergie: 'Arachides',
      has_allergies: 'yes',
      epipen: true,
      niveau_natation: 'debutant',
      custom_field: 'kept',
      nom_medecin: 'Dre Fortin'
    });
  });

  it('normalises yes/no answers to booleans', async () => {
    await postHealthForm({
      participant_id: PARTICIPANT_ID,
      epipen: 'on',
      vaccins_a_jour: 'oui',
      doit_porter_vfi: 'no'
    });

    expect(storedDocument()).toMatchObject({
      epipen: true,
      vaccins_a_jour: true,
      doit_porter_vfi: false
    });
  });

  it('rejects a body without a participant', async () => {
    const res = await postHealthForm({ allergie: 'Arachides' });

    expect(res.status).toBe(400);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('refuses a participant the caller has no access to', async () => {
    context.enrollment = [];

    const res = await postHealthForm({ participant_id: PARTICIPANT_ID, allergie: 'Arachides' });

    expect(res.status).toBe(403);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('refuses a role without permission on the health form', async () => {
    context.formPermission = [{ has_permission: false }];

    const res = await postHealthForm({ participant_id: PARTICIPANT_ID, allergie: 'Arachides' });

    expect(res.status).toBe(403);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('never writes to the fiche_sante table the schema no longer has', async () => {
    await postHealthForm({ participant_id: PARTICIPANT_ID, allergie: 'Arachides' });

    queries.forEach((entry) => {
      expect(entry.sql).not.toMatch(/\bfiche_sante\b(?!')/);
    });
  });
});
