/**
 * Correcting a medication plan on a disposable database (#1379): a family corrects its child's
 * plan in place, the correction is recorded, doses already given never change, later scheduled
 * doses follow a corrected dose, and anyone but the signer changing what is given asks for a
 * new signature. A leader may correct a plan filled in for a family; a parent only their own
 * child's. Every person here is invented.
 */
const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
require('./jest-conditional-helpers');
process.env.JWT_SECRET_KEY ||= 'fictional-medication-plan-integration';
const DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!DATABASE_URL)('Correcting a medication plan', () => {
  let pool; let app;
  let plans = 0;
  const ids = {}; const units = []; const users = []; const participants = []; const guardians = [];
  const one = async (sql, params = []) => Object.values((await pool.query(sql, params)).rows[0] || {})[0];

  async function unit() {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const id = (await db.query("INSERT INTO organizations (name) VALUES ('Fictional Plan Unit') RETURNING id")).rows[0].id;
      await db.query("INSERT INTO organization_program_sections (organization_id, section_key, display_name) VALUES ($1, 'general', 'General')", [id]);
      await db.query('COMMIT');
      units.push(id);
      return id;
    } finally {
      db.release();
    }
  }
  async function member(unitId, name, scope, keys) {
    const role = await one("INSERT INTO roles (role_name, display_name, data_scope, organization_id) VALUES ('plan_' || gen_random_uuid(), 'Fictional', $2, $1) RETURNING id", [unitId, scope]);
    await pool.query('INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE permission_key = ANY($2::text[])', [role, keys]);
    const user = await one("INSERT INTO users (email, password, full_name) VALUES ('plan-' || gen_random_uuid() || '@example.test', 'x', $1) RETURNING id", [name]);
    users.push(user);
    await pool.query('INSERT INTO user_organizations (organization_id, user_id, role_ids) VALUES ($1, $2, $3)', [unitId, user, JSON.stringify([role])]);
    return user;
  }
  async function child(unitId, year, first) {
    const id = await one("INSERT INTO participants (first_name, last_name) VALUES ($1, 'Fiction') RETURNING id", [first]);
    participants.push(id);
    await pool.query('INSERT INTO participant_enrollments (participant_id, organization_id, scout_year_id) VALUES ($1, $2, $3)', [id, unitId, year]);
    return id;
  }
  async function plan(unitId, participantId, createdBy) {
    const id = await one(
      `INSERT INTO medication_requirements (organization_id, participant_id, medication_name, dosage_instructions,
         frequency_preset_type, frequency_times, default_dose_amount, default_dose_unit, created_by)
       VALUES ($1, $2, $4, 'Avec un repas', 'time_of_day', '["08:00"]', 5, 'ml', $3) RETURNING id`,
      [unitId, participantId, createdBy, `Fictional syrup ${(plans += 1)}`]);
    await pool.query('INSERT INTO participant_medications (organization_id, medication_requirement_id, participant_id) VALUES ($1, $2, $3)', [unitId, id, participantId]);
    return id;
  }
  async function signedBy(userId, participantId, requirementId) {
    const authorization = await one(
      `INSERT INTO medication_admin_authorizations (organization_id, participant_id, guardian_id, status, created_by)
       VALUES ($1, $2, $3, 'signed', $4) RETURNING id`, [ids.unit, participantId, ids.guardian, userId]);
    await pool.query('INSERT INTO medication_admin_authorization_requirements (authorization_id, medication_requirement_id) VALUES ($1, $2)', [authorization, requirementId]);
    return authorization;
  }
  const dose = (requirementId, participantId, when, status, amount = 5) => one(
    `INSERT INTO medication_distributions (organization_id, medication_requirement_id, participant_id, scheduled_for, dose_amount, dose_unit, status)
     VALUES ($1, $2, $3, NOW() + $4::interval, $5, 'ml', $6) RETURNING id`,
    [ids.unit, requirementId, participantId, when, amount, status]);
  const version = async (requirementId) => (await pool.query('SELECT updated_at FROM medication_requirements WHERE id = $1', [requirementId])).rows[0].updated_at.toISOString();
  const call = (method, path, user, body, unitId = ids.unit) => request(app)[method](`/api/v1/medication${path}`)
    .set('Authorization', `Bearer ${jwt.sign({ user_id: user, organizationId: unitId }, process.env.JWT_SECRET_KEY)}`)
    .send(body);
  const correction = async (requirementId, participantId, changes) => ({
    medication_name: await one('SELECT medication_name FROM medication_requirements WHERE id = $1', [requirementId]), dosage_instructions: 'Avec un repas', frequency_preset_type: 'time_of_day',
    frequency_times: ['08:00'], default_dose_amount: 5, default_dose_unit: 'ml', participant_ids: [participantId],
    expected_updated_at: await version(requirementId), ...changes,
  });

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    ids.unit = await unit(); ids.otherUnit = await unit();
    const year = await one("INSERT INTO scout_years (organization_id, label, start_date, end_date, status) VALUES ($1, 'Current', CURRENT_DATE - 30, CURRENT_DATE + 300, 'active') RETURNING id", [ids.unit]);
    const otherYear = await one("INSERT INTO scout_years (organization_id, label, start_date, end_date, status) VALUES ($1, 'Current', CURRENT_DATE - 30, CURRENT_DATE + 300, 'active') RETURNING id", [ids.otherUnit]);
    ids.leader = await member(ids.unit, 'Ada Lovelace', 'organization', ['medication.manage', 'medication.view']);
    ids.mother = await member(ids.unit, 'Léa Tremblay', 'linked', ['medication.view']);
    ids.father = await member(ids.unit, 'Marc Tremblay', 'linked', ['medication.view']);
    ids.otherParent = await member(ids.unit, 'Grace Hopper', 'linked', ['medication.view']);
    ids.rosalind = await child(ids.unit, year, 'Rosalind');
    ids.hedy = await child(ids.unit, year, 'Hedy');
    ids.foreign = await child(ids.otherUnit, otherYear, 'Barbara');
    ids.guardian = await one("INSERT INTO parents_guardians (nom, prenom, courriel) VALUES ('Tremblay', 'Léa', 'lea.tremblay@example.test') RETURNING id");
    guardians.push(ids.guardian);
    await pool.query('INSERT INTO user_participants (user_id, participant_id) VALUES ($1, $3), ($2, $3), ($1, $4)', [ids.mother, ids.father, ids.rosalind, ids.hedy]);
    ids.foreignPlan = await plan(ids.otherUnit, ids.foreign, null);
    app = express(); app.locals.pool = pool; app.use(express.json());
    app.use('/api', require('../routes/medication')(pool, { info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
    app.use((err, _req, res, _next) => res.status(500).json({ success: false, message: 'internal_server_error' }));
  });

  afterAll(async () => {
    if (!pool) {return;}
    await pool.query('DELETE FROM medication_admin_authorization_requirements WHERE authorization_id IN (SELECT id FROM medication_admin_authorizations WHERE organization_id = ANY($1::int[]))', [units]);
    await pool.query('DELETE FROM medication_admin_authorizations WHERE organization_id = ANY($1::int[])', [units]);
    await pool.query('DELETE FROM medication_requirement_revisions WHERE organization_id = ANY($1::int[])', [units]);
    await pool.query('DELETE FROM medication_distributions WHERE organization_id = ANY($1::int[])', [units]);
    await pool.query('DELETE FROM participant_medications WHERE organization_id = ANY($1::int[])', [units]);
    await pool.query('DELETE FROM medication_requirements WHERE organization_id = ANY($1::int[])', [units]);
    await pool.query('DELETE FROM user_participants WHERE participant_id = ANY($1::int[])', [participants]);
    await pool.query('DELETE FROM participant_enrollments WHERE organization_id = ANY($1::int[])', [units]);
    await pool.query('DELETE FROM participants WHERE id = ANY($1::int[])', [participants]);
    await pool.query('DELETE FROM parents_guardians WHERE id = ANY($1::int[])', [guardians]);
    await pool.query('DELETE FROM scout_years WHERE organization_id = ANY($1::int[])', [units]);
    await pool.query('DELETE FROM organizations WHERE id = ANY($1::int[])', [units]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    await pool.end();
  });

  test('a parent corrects the dose on the same plan; given doses keep theirs, later ones follow', async () => {
    const syrup = await plan(ids.unit, ids.rosalind, ids.mother);
    const given = await dose(syrup, ids.rosalind, '-1 day', 'given');
    const later = await dose(syrup, ids.rosalind, '1 day', 'scheduled');
    const setApart = await dose(syrup, ids.rosalind, '2 days', 'scheduled', 2.5);

    const response = await call('put', `/requirements/${syrup}`, ids.mother, await correction(syrup, ids.rosalind, { default_dose_amount: 7.5 }));

    expect(response.status).toBe(200);
    expect(response.body.data.requirement.id).toBe(syrup);
    expect(Number(await one('SELECT default_dose_amount FROM medication_requirements WHERE id = $1', [syrup]))).toBe(7.5);
    expect(Number(await one('SELECT COUNT(*) FROM medication_requirements WHERE participant_id = $1', [ids.rosalind]))).toBe(1);
    expect(Number(await one('SELECT COUNT(*) FROM participant_medications WHERE medication_requirement_id = $1', [syrup]))).toBe(1);
    expect(Number(await one('SELECT dose_amount FROM medication_distributions WHERE id = $1', [given]))).toBe(5);
    expect(Number(await one('SELECT dose_amount FROM medication_distributions WHERE id = $1', [later]))).toBe(7.5);
    expect(Number(await one('SELECT dose_amount FROM medication_distributions WHERE id = $1', [setApart]))).toBe(2.5);

    const revision = (await pool.query('SELECT changes, changed_by FROM medication_requirement_revisions WHERE medication_requirement_id = $1', [syrup])).rows;
    expect(revision).toEqual([{ changes: { default_dose_amount: { from: 5, to: 7.5 } }, changed_by: ids.mother }]);

    const listed = await call('get', `/requirements?participant_id=${ids.rosalind}`, ids.leader);
    const shown = listed.body.data.requirements.find((row) => row.id === syrup);
    expect(shown.revisions[0]).toEqual(expect.objectContaining({ changed_by_name: 'Léa Tremblay', requires_new_signature: false }));
  });

  test('the signer correcting what is given is not asked to sign again; another parent\'s change is', async () => {
    const syrup = await plan(ids.unit, ids.rosalind, ids.mother);
    const authorization = await signedBy(ids.mother, ids.rosalind, syrup);

    const own = await call('put', `/requirements/${syrup}`, ids.mother, await correction(syrup, ids.rosalind, { frequency_times: ['08:00', '20:00'] }));
    expect(own.status).toBe(200);
    expect(await one('SELECT status FROM medication_admin_authorizations WHERE id = $1', [authorization])).toBe('signed');

    const notes = await call('put', `/requirements/${syrup}`, ids.father, await correction(syrup, ids.rosalind, {
      frequency_times: ['08:00', '20:00'], general_notes: 'Dans son sac',
    }));
    expect(notes.status).toBe(200);
    expect(await one('SELECT status FROM medication_admin_authorizations WHERE id = $1', [authorization])).toBe('signed');

    const other = await call('put', `/requirements/${syrup}`, ids.father, await correction(syrup, ids.rosalind, {
      frequency_times: ['20:00'], general_notes: 'Dans son sac',
    }));
    expect(other.status).toBe(200);
    expect(other.body.data.revision.requires_new_signature).toBe(true);
    expect(await one('SELECT status FROM medication_admin_authorizations WHERE id = $1', [authorization])).toBe('plan_changed');

    const pending = await call('get', '/authorizations/pending-signature', ids.mother);
    expect(pending.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ participant_id: ids.rosalind, kind: 'administration' }),
    ]));
  });

  test('only the authorization in force counts: its signer correcting the plan is not asked to sign again', async () => {
    const syrup = await plan(ids.unit, ids.rosalind, ids.mother);
    const older = await signedBy(ids.mother, ids.rosalind, syrup);
    await pool.query("UPDATE medication_admin_authorizations SET created_at = NOW() - interval '1 day' WHERE id = $1", [older]);
    const current = await signedBy(ids.father, ids.rosalind, syrup);

    const response = await call('put', `/requirements/${syrup}`, ids.father, await correction(syrup, ids.rosalind, { default_dose_amount: 8 }));

    expect(response.status).toBe(200);
    expect(response.body.data.revision.requires_new_signature).toBe(false);
    expect(await one('SELECT status FROM medication_admin_authorizations WHERE id = $1', [current])).toBe('signed');
    expect(await one('SELECT status FROM medication_admin_authorizations WHERE id = $1', [older])).toBe('signed');
  });

  test('a leader corrects a plan filled in for a family; the parent who signed signs again', async () => {
    const syrup = await plan(ids.unit, ids.rosalind, ids.leader);
    const authorization = await signedBy(ids.mother, ids.rosalind, syrup);

    const leader = await call('put', `/requirements/${syrup}`, ids.leader, await correction(syrup, ids.rosalind, { default_dose_amount: 6 }));

    expect(leader.status).toBe(200);
    expect(Number(await one('SELECT default_dose_amount FROM medication_requirements WHERE id = $1', [syrup]))).toBe(6);
    expect(await one('SELECT status FROM medication_admin_authorizations WHERE id = $1', [authorization])).toBe('plan_changed');
    expect(await one('SELECT changed_by FROM medication_requirement_revisions WHERE medication_requirement_id = $1', [syrup])).toBe(ids.leader);
  });

  test('a parent cannot correct the plan of a child they are not linked to', async () => {
    const syrup = await plan(ids.unit, ids.rosalind, ids.mother);

    const stranger = await call('put', `/requirements/${syrup}`, ids.otherParent, await correction(syrup, ids.rosalind, { default_dose_amount: 50 }));

    expect(stranger.status).toBe(403);
    expect(stranger.body).toEqual(expect.objectContaining({ required: ['medication.manage'], missing: ['medication.manage'] }));
    expect(Number(await one('SELECT default_dose_amount FROM medication_requirements WHERE id = $1', [syrup]))).toBe(5);
  });

  test('a note added to a meal plan by another parent keeps the signature: jsonb key order is not a change', async () => {
    const syrup = await plan(ids.unit, ids.rosalind, ids.mother);
    await pool.query(`UPDATE medication_requirements SET frequency_preset_type = 'meal', frequency_times = '["08:00","12:00"]',
      frequency_slots = '{"breakfast":"08:00","lunch":"12:00"}' WHERE id = $1`, [syrup]);
    const authorization = await signedBy(ids.mother, ids.rosalind, syrup);

    const response = await call('put', `/requirements/${syrup}`, ids.father, await correction(syrup, ids.rosalind, {
      frequency_preset_type: 'meal', frequency_times: ['08:00', '12:00'],
      frequency_slots: { breakfast: '08:00', lunch: '12:00' }, general_notes: 'Dans son sac',
    }));

    expect(response.status).toBe(200);
    expect(response.body.data.revision.changes).toEqual({ general_notes: { from: null, to: 'Dans son sac' } });
    expect(await one('SELECT status FROM medication_admin_authorizations WHERE id = $1', [authorization])).toBe('signed');
  });

  test('a plan is not moved to another child, nor overwritten by a correction started from an older version', async () => {
    const syrup = await plan(ids.unit, ids.rosalind, ids.mother);

    const moved = await call('put', `/requirements/${syrup}`, ids.mother, await correction(syrup, ids.rosalind, { participant_ids: [ids.hedy] }));
    expect(moved.status).toBe(409);
    expect(moved.body.message).toBe('medication_participant_immutable');

    const stale = await correction(syrup, ids.rosalind, { default_dose_amount: 6 });
    expect((await call('put', `/requirements/${syrup}`, ids.father, await correction(syrup, ids.rosalind, { default_dose_amount: 7 }))).status).toBe(200);
    const late = await call('put', `/requirements/${syrup}`, ids.mother, stale);
    expect(late.status).toBe(409);
    expect(late.body.message).toBe('medication_requirement_changed');
    expect(Number(await one('SELECT default_dose_amount FROM medication_requirements WHERE id = $1', [syrup]))).toBe(7);
    expect(Number(await one('SELECT participant_id FROM medication_requirements WHERE id = $1', [syrup]))).toBe(ids.rosalind);
  });

  test('a plan of another unit is not found', async () => {
    const response = await call('put', `/requirements/${ids.foreignPlan}`, ids.leader, await correction(ids.foreignPlan, ids.foreign, {}));
    expect(response.status).toBe(404);
  });
});
