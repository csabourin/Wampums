/**
 * Fundraisers as a family sees them — integration suite
 *
 * A parent holds no fundraiser permission; `GET /api/v1/fundraisers/family`
 * answers from the children linked to the account. Against a real database,
 * this holds it to: only their own children, only this unit, only campaigns
 * that are under way or still owed on, and the unit's total only against an
 * objective.
 *
 * Skipped unless SCOUT_YEAR_TEST_DATABASE_URL (or TEST_DATABASE_URL) points at
 * a disposable database holding the project schema and permission catalog.
 *
 * @module test/family-fundraisers.integration
 */

const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');

require('./jest-conditional-helpers');

const DATABASE_URL = process.env.SCOUT_YEAR_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL;

process.env.JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || 'family-fundraisers-secret';

const mockContext = { userId: null, organizationId: null };

jest.mock('../middleware/auth', () => {
  const actual = jest.requireActual('../middleware/auth');
  return {
    ...actual,
    authenticate: (req, _res, next) => {
      req.user = { id: mockContext.userId, organizationId: mockContext.organizationId, permissions: [] };
      next();
    },
  };
});

const { ACCESS_SOURCE, grantParticipantAccess } = require('../services/participantAccess');
const { resetCampaignModelSchemaCache } = require('../services/fundraiserCampaigns');

describe.skipIf(!DATABASE_URL)('Fundraisers as a family sees them', () => {
  let pool;
  let app;
  const ids = {};
  const suffix = Date.now();

  /**
   * Read a single value.
   *
   * @param {string} sql - Query returning one row and one column
   * @param {Array} params - Query parameters
   * @returns {Promise<*>} The value, or undefined
   */
  async function one(sql, params = []) {
    const result = await pool.query(sql, params);
    return result.rows[0] ? Object.values(result.rows[0])[0] : undefined;
  }

  /**
   * A unit with its program section and an active scout year.
   *
   * @param {string} name - Unit name
   * @returns {Promise<{unit: number, year: number}>} Ids
   */
  async function unitWithYear(name) {
    // The program section and its unit reference each other; the key is
    // checked at commit.
    const client = await pool.connect();
    let unit;
    try {
      await client.query('BEGIN');
      const created = await client.query('INSERT INTO organizations (name) VALUES ($1) RETURNING id', [name]);
      unit = created.rows[0].id;
      await client.query(
        `INSERT INTO organization_program_sections (organization_id, section_key, display_name)
         VALUES ($1, 'general', 'General')`,
        [unit]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const year = await one(
      `INSERT INTO scout_years (organization_id, label, start_date, end_date, status)
       VALUES ($1, '2026-2027', '2026-09-01', '2027-08-31', 'active') RETURNING id`,
      [unit]
    );
    return { unit, year };
  }

  /**
   * A child enrolled in a unit this year.
   *
   * @param {string} firstName - Name
   * @param {{unit: number, year: number}} where - Unit and year
   * @returns {Promise<number>} Participant id
   */
  async function child(firstName, where) {
    const childId = await one(
      "INSERT INTO participants (first_name, last_name, date_naissance) VALUES ($1, 'Test', '2016-01-01') RETURNING id",
      [firstName]
    );
    await pool.query(
      'INSERT INTO participant_enrollments (participant_id, organization_id, scout_year_id) VALUES ($1, $2, $3)',
      [childId, where.unit, where.year]
    );
    return childId;
  }

  /**
   * A campaign, dated relative to today so the suite never ages.
   *
   * @param {number} unit - Unit id
   * @param {string} name - Campaign name
   * @param {Object} [options] - Campaign options
   * @param {number} [options.startsIn=-10] - Days from today to the start
   * @param {number} [options.endsIn=30] - Days from today to the end
   * @param {number|null} [options.objective=null] - Unit objective
   * @param {boolean} [options.archived=false] - Archived
   * @returns {Promise<number>} Campaign id
   */
  async function campaign(unit, name, { startsIn = -10, endsIn = 30, objective = null, archived = false } = {}) {
    const id = await one(
      `INSERT INTO fundraisers
         (name, start_date, end_date, organization, archived, campaign_type, unit_price, unit_label, objective)
       VALUES ($1, CURRENT_DATE + $2::int, CURRENT_DATE + $3::int, $4, $5, 'fixed_price_sale', 10, 'calendriers', $6)
       RETURNING id`,
      [name, startsIn, endsIn, unit, archived, objective]
    );
    return Number(id);
  }

  /**
   * What one child received and handed in.
   *
   * @param {number} campaignId - Campaign id
   * @param {number} childId - Participant id
   * @param {number} quantity - Calendars received
   * @param {number} amountPaid - Money handed in
   * @returns {Promise<void>}
   */
  async function entry(campaignId, childId, quantity, amountPaid) {
    await pool.query(
      `INSERT INTO fundraiser_entries (fundraiser, participant_id, amount, quantity, amount_paid, paid)
       VALUES ($1, $2, $3::integer, $3::numeric, $4, $5)`,
      [campaignId, childId, quantity, amountPaid, amountPaid >= quantity * 10]
    );
  }

  /**
   * Call the endpoint as the parent.
   *
   * @returns {Promise<Object>} The `data` of a 200 answer
   */
  async function familyFundraisers() {
    const response = await request(app).get('/api/v1/fundraisers/family');
    expect(response.status).toBe(200);
    return response.body.data;
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    resetCampaignModelSchemaCache(pool);

    ids.home = await unitWithYear(`Family fundraisers unit ${suffix}`);
    ids.elsewhere = await unitWithYear(`Family fundraisers other unit ${suffix}`);

    // A role that only sees its own children and holds no permission at all.
    const familyRole = await one(
      `INSERT INTO roles (role_name, display_name, data_scope, is_system_role)
       VALUES ($1, 'Family', 'linked', false) RETURNING id`,
      [`family_fundraisers_${suffix}`]
    );
    ids.parent = await one(
      `INSERT INTO users (email, password, full_name)
       VALUES ('fundraiser-parent-' || gen_random_uuid() || '@example.test', 'x', 'Parent') RETURNING id`
    );
    await pool.query(
      `INSERT INTO user_organizations (user_id, organization_id, role_ids, status)
       VALUES ($1, $2, $3, 'active')`,
      [ids.parent, ids.home.unit, JSON.stringify([familyRole])]
    );

    ids.lea = await child('Léa', ids.home);
    ids.theo = await child('Théo', ids.home);
    ids.noe = await child('Noé', ids.home);
    // The parent's child too, but enrolled in another unit only.
    ids.zoe = await child('Zoé', ids.elsewhere);

    await Promise.all([ids.lea, ids.theo, ids.zoe].map((participantId) => grantParticipantAccess(pool, {
      participantId,
      userId: ids.parent,
      sourceType: ACCESS_SOURCE.DIRECT,
    })));

    // Under way: twelve calendars each at 10 $.
    ids.calendars = await campaign(ids.home.unit, 'Vente de calendriers', { objective: 600 });
    await entry(ids.calendars, ids.lea, 12, 40);
    await entry(ids.calendars, ids.theo, 12, 120);
    await entry(ids.calendars, ids.noe, 12, 60);
    await entry(ids.calendars, ids.zoe, 12, 0);

    ids.owed = await campaign(ids.home.unit, 'Terminée, solde dû', { startsIn: -60, endsIn: -5 });
    await entry(ids.owed, ids.lea, 5, 20);

    ids.settled = await campaign(ids.home.unit, 'Terminée, tout remis', { startsIn: -60, endsIn: -5 });
    await entry(ids.settled, ids.lea, 5, 50);

    ids.othersOwe = await campaign(ids.home.unit, 'Terminée, une autre famille doit', { startsIn: -60, endsIn: -5 });
    await entry(ids.othersOwe, ids.noe, 5, 0);

    ids.archived = await campaign(ids.home.unit, 'Archivée', { archived: true });
    await entry(ids.archived, ids.lea, 12, 0);

    ids.upcoming = await campaign(ids.home.unit, 'À venir', { startsIn: 20, endsIn: 40 });

    ids.foreign = await campaign(ids.elsewhere.unit, 'Autre unité');
    await entry(ids.foreign, ids.zoe, 12, 0);

    mockContext.userId = ids.parent;
    mockContext.organizationId = ids.home.unit;

    app = express();
    app.use(express.json());
    app.locals.pool = pool;
    app.use('/api/v1/fundraisers', require('../routes/fundraisers')(pool, console));
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  test('lists the campaigns under way, upcoming, or still owed on -- of this unit only', async () => {
    const data = await familyFundraisers();

    expect(data.campaigns.map((item) => item.id).sort((a, b) => a - b))
      .toEqual([ids.calendars, ids.owed, ids.upcoming].sort((a, b) => a - b));
  });

  test('shows the parent their own children and no one else', async () => {
    const data = await familyFundraisers();
    const calendars = data.campaigns.find((item) => item.id === ids.calendars);

    // Not Noé (another family), not Zoé (their child, but not enrolled here).
    expect(calendars.children.map((item) => item.participant_id).sort((a, b) => a - b))
      .toEqual([ids.lea, ids.theo].sort((a, b) => a - b));
    expect(data.children_count).toBe(2);
    expect(JSON.stringify(data)).not.toContain('Noé');
  });

  test('twelve calendars at 10 $: 120 $ expected, and the balance follows what was handed in', async () => {
    const data = await familyFundraisers();
    const calendars = data.campaigns.find((item) => item.id === ids.calendars);
    const byChild = Object.fromEntries(calendars.children.map((item) => [item.participant_id, item]));

    expect(calendars).toEqual(expect.objectContaining({
      campaign_type: 'fixed_price_sale',
      unit_price: 10,
      unit_label: 'calendriers',
    }));
    expect(calendars.start_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(byChild[ids.lea]).toEqual(expect.objectContaining({
      quantity: 12, amount_due: 120, amount_paid: 40, balance: 80, paid: false,
    }));
    expect(byChild[ids.theo]).toEqual(expect.objectContaining({
      quantity: 12, amount_due: 120, amount_paid: 120, balance: 0, paid: true,
    }));
  });

  test('the unit total covers every family, and is sent only against an objective', async () => {
    const data = await familyFundraisers();

    expect(data.campaigns.find((item) => item.id === ids.calendars).unit_progress)
      .toEqual({ objective: 600, collected: 220 });
    expect(data.campaigns.find((item) => item.id === ids.owed).unit_progress).toBeNull();
  });

  test('the unit-wide campaign list stays closed to the parent', async () => {
    const response = await request(app).get('/api/v1/fundraisers');

    expect(response.status).toBe(403);
    expect(response.body.missing).toEqual(['fundraisers.view']);
  });

  test('an account that left the unit is refused', async () => {
    await pool.query(
      "UPDATE user_organizations SET status = 'inactive' WHERE user_id = $1 AND organization_id = $2",
      [ids.parent, ids.home.unit]
    );
    try {
      const response = await request(app).get('/api/v1/fundraisers/family');
      expect(response.status).toBe(403);
    } finally {
      await pool.query(
        "UPDATE user_organizations SET status = 'active' WHERE user_id = $1 AND organization_id = $2",
        [ids.parent, ids.home.unit]
      );
    }
  });
});
