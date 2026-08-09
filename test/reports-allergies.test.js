/**
 * Allergy and medication report suite
 *
 * These two reports are read on site to decide what to do with a child, so the
 * property under test is inclusion: a health form that says anything about an
 * allergy must put the child on the allergy report, whatever shape the answer
 * was stored in and whichever form version it was filled with.
 *
 * The regression this suite pins down: the reports filtered on
 * `has_allergies = 'yes'` in SQL, so a submission storing `true`, `"on"` or
 * `"oui"` — or carrying the allergy in `allergie` with no `has_allergies` field
 * at all, which is every submission predating that radio — was dropped from the
 * report while the child's fiche santé displayed the allergy perfectly.
 *
 * @module test/reports-allergies
 */

process.env.JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || 'reports-allergies-test-secret';

const express = require('express');
const request = require('supertest');

const scoutYearContext = {
  id: 7,
  label: '2025-2026',
  start_date: '2025-09-01',
  end_date: '2026-08-31',
  status: 'active'
};

jest.mock('../middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: '00000000-0000-0000-0000-000000000001' };
    next();
  },
  requirePermission: () => (_req, _res, next) => next(),
  authorize: () => (_req, _res, next) => next(),
  blockDemoRoles: (_req, _res, next) => next(),
  getOrganizationId: async () => 1,
  withScoutYear: () => (req, _res, next) => {
    req.scoutYear = scoutYearContext;
    req.rosterStatuses = ['active'];
    next();
  }
}));

const reportsRoute = require('../routes/reports');
const { formWindowFor, OPEN_ENDED_DATE } = reportsRoute;

/** Rows the stubbed roster query returns; one per test case. */
let rosterRows = [];
/** Parameters the last query ran with, for the year-window assertions. */
let lastParams = null;

const pool = {
  query: jest.fn(async (_sql, params) => {
    lastParams = params;
    return { rows: rosterRows };
  })
};

const logger = { info: () => {}, warn: () => {}, error: () => {} };

/**
 * Build a roster row around a health form submission.
 *
 * @param {string} firstName - Participant first name
 * @param {Object|null} healthData - `fiche_sante` submission_data
 * @returns {Object} Row shaped like the report query returns
 */
function participantWith(firstName, healthData) {
  return {
    id: firstName.length,
    first_name: firstName,
    last_name: 'Tremblay',
    group_name: 'Castors',
    has_allergies: healthData ? healthData.has_allergies : null,
    epipen: healthData ? healthData.epipen : null,
    has_medication: healthData ? healthData.has_medication : null,
    has_limitations: healthData ? healthData.has_limitations : null,
    limitations: healthData ? healthData.limitation : null,
    health_data: healthData
  };
}

describe('Allergy report', () => {
  let app;

  beforeEach(() => {
    rosterRows = [];
    lastParams = null;
    pool.query.mockClear();
    scoutYearContext.status = 'active';

    app = express();
    app.use(express.json());
    app.use('/api/v1/reports', reportsRoute(pool, logger));
  });

  /**
   * Run the allergy report over a roster.
   *
   * @param {Array<Object>} rows - Roster rows
   * @returns {Promise<Array<Object>>} Report rows
   */
  async function runReport(rows) {
    rosterRows = rows;
    const res = await request(app).get('/api/v1/reports/allergies');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    return res.body.data;
  }

  describe('recognises an allergy however it was recorded', () => {
    const affirmatives = [
      ['the current radio', { has_allergies: 'yes', allergie: 'Arachides' }],
      ['a checkbox stored as a boolean', { has_allergies: true, allergie: 'Arachides' }],
      ['a checkbox stored as "on"', { has_allergies: 'on', allergie: 'Arachides' }],
      ['a checkbox stored as "1"', { has_allergies: '1', allergie: 'Arachides' }],
      ['a French radio', { has_allergies: 'oui', allergie: 'Arachides' }],
      ['a capitalised answer', { has_allergies: 'Yes', allergie: 'Arachides' }]
    ];

    it.each(affirmatives)('includes a participant answering with %s', async (_label, healthData) => {
      const data = await runReport([participantWith('Alix', healthData)]);

      expect(data).toHaveLength(1);
      expect(data[0].first_name).toBe('Alix');
      expect(data[0].allergies).toBe('Arachides');
    });

    it('includes a form filled before the has_allergies question existed', async () => {
      const data = await runReport([
        participantWith('Noah', { allergie: 'Noix, kiwi', epipen: 'on' })
      ]);

      expect(data).toHaveLength(1);
      expect(data[0].allergies).toBe('Noix, kiwi');
      expect(data[0].epipen).toBe(true);
    });

    it('includes a child carrying an EpiPen even with nothing else filled in', async () => {
      const data = await runReport([participantWith('Sam', { epipen: true })]);

      expect(data).toHaveLength(1);
      expect(data[0].epipen).toBe(true);
    });

    it('includes an allergy recorded under a customised field name', async () => {
      const data = await runReport([
        participantWith('Lou', { allergies: 'Pollen', has_allergies: 'no' })
      ]);

      expect(data).toHaveLength(1);
      expect(data[0].allergies).toBe('Pollen');
    });

    it('includes a child whose only allergy detail is a reaction plan', async () => {
      const data = await runReport([
        participantWith('Ines', { allergie_reaction: 'Urticaire, gonflement des lèvres' })
      ]);

      expect(data).toHaveLength(1);
      expect(data[0].allergy_reaction).toBe('Urticaire, gonflement des lèvres');
    });
  });

  describe('leaves out records that declare nothing', () => {
    const nothing = [
      ['an explicit no', { has_allergies: 'no', allergie: '' }],
      ['a French no', { has_allergies: 'non' }],
      ['a "no" typed into the free-text box', { allergie: 'Aucune' }],
      ['an accented "no"', { allergie: 'aucune allergie' }],
      ['an English "no"', { allergie: 'None' }],
      ['a dash', { allergie: '-' }],
      ['an empty form', {}],
      ['no health form at all', null]
    ];

    it.each(nothing)('excludes a participant with %s', async (_label, healthData) => {
      const data = await runReport([participantWith('Kim', healthData)]);

      expect(data).toEqual([]);
    });
  });

  it('reports every child that declares an allergy, and only those', async () => {
    const data = await runReport([
      participantWith('Alix', { has_allergies: 'yes', allergie: 'Arachides' }),
      participantWith('Bo', { has_allergies: 'non' }),
      participantWith('Cam', { allergie: 'Lactose' }),
      participantWith('Dee', null),
      participantWith('Eli', { has_allergies: true, allergie: 'Gluten', epipen: '1' })
    ]);

    expect(data.map((row) => row.first_name)).toEqual(['Alix', 'Cam', 'Eli']);
  });

  it('does not narrow the roster on has_allergies in SQL', async () => {
    // Inclusion is decided on the record as a whole, in JavaScript. A WHERE
    // clause matching one field against one spelling is what dropped children
    // in the first place, so its absence is part of the contract.
    await runReport([]);

    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query.mock.calls[0][0]).not.toMatch(/has_allergies'\s*=/);
  });

  it('carries the emergency medication of a child with an EpiPen', async () => {
    const data = await runReport([
      participantWith('Alix', {
        has_allergies: 'yes',
        allergie: 'Arachides',
        epipen: 'on',
        medicament: 'EpiPen Jr'
      })
    ]);

    expect(data[0].emergency_medication).toBe('EpiPen Jr');
    expect(data[0].has_medication).toBe(true);
  });
});

describe('Medication report', () => {
  let app;

  beforeEach(() => {
    rosterRows = [];
    pool.query.mockClear();
    scoutYearContext.status = 'active';

    app = express();
    app.use(express.json());
    app.use('/api/v1/reports', reportsRoute(pool, logger));
  });

  it('includes a medication recorded without an affirmative has_medication', async () => {
    rosterRows = [
      participantWith('Alix', { medicament: 'Ventolin' }),
      participantWith('Bo', { has_medication: 'no', medicament: 'aucun' }),
      participantWith('Cam', { has_medication: true, medicament: 'Ritalin 10mg' })
    ];

    const res = await request(app).get('/api/v1/reports/medication');

    expect(res.status).toBe(200);
    expect(res.body.data.map((row) => row.first_name)).toEqual(['Alix', 'Cam']);
    expect(res.body.data[0].medication).toBe('Ventolin');
    expect(pool.query.mock.calls[0][0]).not.toMatch(/has_medication'\s*=/);
  });
});

describe('Form window for a scout year', () => {
  it('does not clip the year in progress', () => {
    // An organisation runs its transition when it gets round to it, so the open
    // year outlives its nominal end date. Clipping there hid every health form
    // filled in during the overrun.
    expect(formWindowFor({ start_date: '2025-09-01', end_date: '2026-06-30', status: 'active' }))
      .toEqual([OPEN_ENDED_DATE, OPEN_ENDED_DATE]);
  });

  it('keeps a closed year bounded by its own dates', () => {
    expect(formWindowFor({ start_date: '2024-09-01', end_date: '2025-08-31', status: 'closed' }))
      .toEqual(['2024-09-01', '2025-08-31']);
  });

  it('passes the open-ended bounds to the report query on the active year', async () => {
    rosterRows = [];
    const app = express();
    app.use('/api/v1/reports', reportsRoute(pool, logger));

    await request(app).get('/api/v1/reports/allergies');

    expect(lastParams.slice(-2)).toEqual([OPEN_ENDED_DATE, OPEN_ENDED_DATE]);
  });
});
