/**
 * Form submissions of a child — integration suite
 *
 * A unit gives each role rights on each form type (form_permissions): a parent
 * may typically view, submit and edit the health form. Those rights are about
 * the form type; they are never a right over every child's copy. A family reads,
 * saves and deletes the forms of its own children only, and reads back what it
 * saved. Setting a review status is a reviewer's act.
 *
 * Skipped unless SCOUT_YEAR_TEST_DATABASE_URL (or TEST_DATABASE_URL) points at
 * a disposable database holding the project schema and permission catalog.
 *
 * @module test/form-submissions-access.integration
 */

const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');

require('./jest-conditional-helpers');

const DATABASE_URL = process.env.SCOUT_YEAR_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL;

process.env.JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || 'form-submissions-integration-secret';

const { signJWTToken } = require('../utils/jwt-config');
const { ACCESS_SOURCE, grantParticipantAccess } = require('../services/participantAccess');

const HEALTH_FORM = 'fiche_sante';
const quietLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

describe.skipIf(!DATABASE_URL)('Form submissions of a child', () => {
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
   * A role with the given scope and permissions.
   *
   * @param {string} name - Role name prefix
   * @param {string} dataScope - 'organization' or 'linked'
   * @param {string[]} permissionKeys - Permissions granted
   * @returns {Promise<number>} Role ID
   */
  async function role(name, dataScope, permissionKeys = []) {
    const roleId = await one(
      'INSERT INTO roles (role_name, display_name, data_scope) VALUES ($1, $1, $2) RETURNING id',
      [`${name}_${suffix}`, dataScope]
    );
    await pool.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT $1, id FROM permissions WHERE permission_key = ANY($2::text[])`,
      [roleId, permissionKeys]
    );
    return roleId;
  }

  /**
   * Give a role rights on the unit's health form.
   *
   * @param {number} roleId - Role
   * @param {Object} rights - { view, submit, edit, approve }
   * @returns {Promise<void>}
   */
  async function formRights(roleId, { view = false, submit = false, edit = false, approve = false }) {
    await pool.query(
      `INSERT INTO form_permissions (form_format_id, role_id, can_view, can_submit, can_edit, can_approve)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [ids.healthFormat, roleId, view, submit, edit, approve]
    );
  }

  /**
   * An account with an active membership in a unit.
   *
   * @param {string} fullName - Display name
   * @param {number} roleId - Role
   * @param {number} [unitId] - Unit, the test unit by default
   * @returns {Promise<string>} User ID
   */
  async function member(fullName, roleId, unitId = ids.unit) {
    const userId = await one(
      `INSERT INTO users (email, password, full_name)
       VALUES (lower(split_part($1, ' ', 1)) || '-' || gen_random_uuid() || '@example.test', 'x', $1)
       RETURNING id`,
      [fullName]
    );
    await pool.query(
      `INSERT INTO user_organizations (user_id, organization_id, role_ids, status)
       VALUES ($1, $2, $3, 'active')`,
      [userId, unitId, JSON.stringify([roleId])]
    );
    return userId;
  }

  /**
   * A unit with its program section and an active scout year.
   *
   * @param {string} name - Unit name
   * @returns {Promise<{unit: number, year: number}>} Unit and year IDs
   */
  async function unit(name) {
    // The program section and its unit reference each other; the key is
    // checked at commit.
    const client = await pool.connect();
    let unitId;
    try {
      await client.query('BEGIN');
      unitId = (await client.query('INSERT INTO organizations (name) VALUES ($1) RETURNING id', [name])).rows[0].id;
      await client.query(
        `INSERT INTO organization_program_sections (organization_id, section_key, display_name)
         VALUES ($1, 'general', 'General')`,
        [unitId]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    const yearId = await one(
      `INSERT INTO scout_years (organization_id, label, start_date, end_date, status)
       VALUES ($1, '2026-2027', '2026-09-01', '2027-08-31', 'active') RETURNING id`,
      [unitId]
    );
    return { unit: unitId, year: yearId };
  }

  /**
   * A child enrolled in a unit.
   *
   * @param {string} firstName - Name
   * @param {{unit: number, year: number}} where - Unit and year
   * @returns {Promise<number>} Participant ID
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
   * Headers for a request made by a user signed into the test unit.
   *
   * @param {string} userId - Acting user
   * @returns {Object} Headers
   */
  function signedIn(userId) {
    return { Authorization: `Bearer ${signJWTToken({ user_id: userId, organizationId: ids.unit })}` };
  }

  /**
   * The child's saved health form, as stored.
   *
   * @param {number} participantId - Child
   * @returns {Promise<Object|undefined>} submission_data, or undefined
   */
  function storedHealthForm(participantId) {
    return one(
      'SELECT submission_data FROM form_submissions WHERE participant_id = $1 AND organization_id = $2 AND form_type = $3',
      [participantId, ids.unit, HEALTH_FORM]
    );
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });

    const home = await unit('Forms unit');
    ids.unit = home.unit;
    const elsewhere = await unit('Forms other unit');

    ids.healthFormat = await one(
      `INSERT INTO organization_form_formats (organization_id, form_type, form_structure, status)
       VALUES ($1, $2, '{"fields": []}'::jsonb, 'published') RETURNING id`,
      [ids.unit, HEALTH_FORM]
    );

    // What the default form policy gives parents: view, submit and edit.
    const family = await role('family_f', 'linked', ['participants.view']);
    await formRights(family, { view: true, submit: true, edit: true });
    // A family role the unit gave no right on the health form.
    const familyNoForm = await role('family_nf', 'linked', ['participants.view']);
    const reviewer = await role('reviewer_f', 'organization', ['participants.view']);
    await formRights(reviewer, { view: true, submit: true, edit: true, approve: true });

    ids.alice = await member('Alice Tremblay', family);
    ids.bob = await member('Bob Roy', family);
    ids.dana = await member('Dana Nofrm', familyNoForm);
    ids.reviewer = await member('Akela Reviewer', reviewer);

    ids.lea = await child('Léa', home);
    ids.noe = await child('Noé', home);
    ids.outsider = await child('Zoé', elsewhere);
    await grantParticipantAccess(pool, { participantId: ids.lea, userId: ids.alice, sourceType: ACCESS_SOURCE.DIRECT });
    await grantParticipantAccess(pool, { participantId: ids.lea, userId: ids.dana, sourceType: ACCESS_SOURCE.DIRECT });
    await grantParticipantAccess(pool, { participantId: ids.noe, userId: ids.bob, sourceType: ACCESS_SOURCE.DIRECT });

    // Bob already filled in Noé's health form.
    ids.noeSubmission = await one(
      `INSERT INTO form_submissions (organization_id, participant_id, form_type, submission_data, user_id)
       VALUES ($1, $2, $3, '{"allergies": "arachides"}'::jsonb, $4) RETURNING id`,
      [ids.unit, ids.noe, HEALTH_FORM, ids.bob]
    );

    app = express();
    app.use(express.json());
    app.locals.pool = pool;
    app.use('/api/v1/forms', require('../routes/forms')(pool, quietLogger));
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  test('a parent reads back the health form they saved for their own child', async () => {
    const saved = await request(app)
      .post('/api/v1/forms/submissions')
      .set(signedIn(ids.alice))
      .send({ participant_id: ids.lea, form_type: HEALTH_FORM, submission_data: { allergies: 'pollen' } });
    expect(saved.status).toBe(200);

    const reopened = await request(app)
      .get('/api/v1/forms/submissions')
      .set(signedIn(ids.alice))
      .query({ participant_id: ids.lea, form_type: HEALTH_FORM });

    expect(reopened.status).toBe(200);
    expect(reopened.body.form_data).toMatchObject({ allergies: 'pollen', participant_id: ids.lea });
  });

  test('a parent cannot overwrite another family\'s child\'s form', async () => {
    const response = await request(app)
      .post('/api/v1/forms/submissions')
      .set(signedIn(ids.alice))
      .send({ participant_id: ids.noe, form_type: HEALTH_FORM, submission_data: { allergies: 'aucune' } });

    expect(response.status).toBe(403);
    expect(await storedHealthForm(ids.noe)).toEqual({ allergies: 'arachides' });
  });

  test('a parent cannot delete another family\'s child\'s form', async () => {
    const response = await request(app)
      .delete('/api/v1/forms/submissions')
      .set(signedIn(ids.alice))
      .query({ participant_id: ids.noe, form_type: HEALTH_FORM });

    expect(response.status).toBe(403);
    expect(await storedHealthForm(ids.noe)).toEqual({ allergies: 'arachides' });
  });

  test('a parent cannot read another family\'s child\'s form, alone or in a list', async () => {
    const single = await request(app)
      .get('/api/v1/forms/submissions')
      .set(signedIn(ids.alice))
      .query({ participant_id: ids.noe, form_type: HEALTH_FORM });
    expect(single.status).toBe(403);

    const byChild = await request(app)
      .get('/api/v1/forms/submissions/list')
      .set(signedIn(ids.alice))
      .query({ participant_id: ids.noe, form_type: HEALTH_FORM });
    expect(byChild.status).toBe(403);

    const list = await request(app)
      .get('/api/v1/forms/submissions/list')
      .set(signedIn(ids.alice))
      .query({ form_type: HEALTH_FORM });
    expect(list.status).toBe(200);
    const listed = list.body.data.map((row) => row.participant_id);
    expect(listed).not.toContain(ids.noe);
    expect(listed).toContain(ids.lea);

    const history = await request(app)
      .get(`/api/v1/forms/form-submission-history/${ids.noeSubmission}`)
      .set(signedIn(ids.alice));
    expect(history.status).toBe(403);
  });

  test('a parent cannot set a review status, even on their own child\'s form', async () => {
    const leaSubmission = await one(
      'SELECT id FROM form_submissions WHERE participant_id = $1 AND form_type = $2',
      [ids.lea, HEALTH_FORM]
    );

    const response = await request(app)
      .put('/api/v1/forms/form-submission-status')
      .set(signedIn(ids.alice))
      .send({ submission_id: leaSubmission, status: 'approved' });

    expect(response.status).toBe(403);
    expect(response.body.required).toEqual(['forms.manage']);
    expect(await one('SELECT status FROM form_submissions WHERE id = $1', [leaSubmission])).not.toBe('approved');
  });

  test('an account without a right on the form type is refused, naming what would do', async () => {
    const response = await request(app)
      .get('/api/v1/forms/submissions')
      .set(signedIn(ids.dana))
      .query({ participant_id: ids.lea, form_type: HEALTH_FORM });

    expect(response.status).toBe(403);
    expect(response.body.required).toEqual(['forms.view', 'forms.submit', 'forms.manage']);
    expect(response.body.missing).toEqual(['forms.view', 'forms.submit', 'forms.manage']);
  });

  test('a reviewer who sees the whole unit reads, lists and approves any child\'s form', async () => {
    const single = await request(app)
      .get('/api/v1/forms/submissions')
      .set(signedIn(ids.reviewer))
      .query({ participant_id: ids.noe, form_type: HEALTH_FORM });
    expect(single.status).toBe(200);
    expect(single.body.form_data).toMatchObject({ allergies: 'arachides' });

    const list = await request(app)
      .get('/api/v1/forms/submissions/list')
      .set(signedIn(ids.reviewer))
      .query({ form_type: HEALTH_FORM });
    expect(list.body.data.map((row) => row.participant_id)).toEqual(expect.arrayContaining([ids.lea, ids.noe]));

    const approved = await request(app)
      .put('/api/v1/forms/form-submission-status')
      .set(signedIn(ids.reviewer))
      .send({ submission_id: ids.noeSubmission, status: 'approved' });
    expect(approved.status).toBe(200);
    expect(await one('SELECT status FROM form_submissions WHERE id = $1', [ids.noeSubmission])).toBe('approved');
  });

  test('no one saves a form for a child who is not enrolled in the unit', async () => {
    const response = await request(app)
      .post('/api/v1/forms/submissions')
      .set(signedIn(ids.reviewer))
      .send({ participant_id: ids.outsider, form_type: HEALTH_FORM, submission_data: { allergies: 'x' } });

    expect(response.status).toBe(403);
    expect(await one(
      'SELECT count(*)::int FROM form_submissions WHERE participant_id = $1',
      [ids.outsider]
    )).toBe(0);
  });

  test.each([
    ['GET', 'abc'],
    ['GET', '99999999999999999999'],
    ['POST', [1]],
    ['DELETE', '0'],
  ])('a malformed participant id on %s (%p) is a 400, not a database error', async (method, participantId) => {
    let call;
    if (method === 'GET') {
      call = request(app).get('/api/v1/forms/submissions').query({ participant_id: participantId, form_type: HEALTH_FORM });
    } else if (method === 'DELETE') {
      call = request(app).delete('/api/v1/forms/submissions').query({ participant_id: participantId, form_type: HEALTH_FORM });
    } else {
      call = request(app).post('/api/v1/forms/submissions')
        .send({ participant_id: participantId, form_type: HEALTH_FORM, submission_data: {} });
    }

    const response = await call.set(signedIn(ids.reviewer));

    expect(response.status).toBe(400);
  });
});
