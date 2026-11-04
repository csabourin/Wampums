/**
 * Doses on a disposable database: only the unit's team gives them (#1339), a
 * dose is scheduled only for the youth its medication names and the unit
 * enrolls (#1340), and of two devices confirming one dose at once only one
 * succeeds, after which the dose never changes again (#1341). Every person
 * here is invented.
 */
const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
require('./jest-conditional-helpers');
process.env.JWT_SECRET_KEY ||= 'fictional-medication-dose-integration';
const DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!DATABASE_URL)('Medication doses', () => {
  let pool; let app;
  const ids = {}; const units = []; const users = []; const participants = [];
  const one = async (sql, params = []) => Object.values((await pool.query(sql, params)).rows[0] || {})[0];

  async function unit() {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const id = (await db.query("INSERT INTO organizations (name) VALUES ('Fictional Dose Unit') RETURNING id")).rows[0].id;
      await db.query("INSERT INTO organization_program_sections (organization_id, section_key, display_name) VALUES ($1, 'general', 'General')", [id]);
      await db.query('COMMIT');
      units.push(id);
      return id;
    } finally {
      db.release();
    }
  }
  async function member(unitId, name, scope) {
    const role = await one("INSERT INTO roles (role_name, display_name, data_scope, organization_id) VALUES ('dose_' || gen_random_uuid(), 'Fictional', $2, $1) RETURNING id", [unitId, scope]);
    await pool.query("INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE permission_key IN ('medication.manage', 'medication.view')", [role]);
    const user = await one("INSERT INTO users (email, password, full_name) VALUES ('dose-' || gen_random_uuid() || '@example.test', 'x', $1) RETURNING id", [name]);
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
  const medication = (unitId, participantId) => one(
    "INSERT INTO medication_requirements (organization_id, medication_name, participant_id) VALUES ($1, 'Fictional syrup', $2) RETURNING id",
    [unitId, participantId]);
  const call = (method, path, user, body, unitId = ids.unit) => request(app)[method](`/api/v1/medication${path}`)
    .set('Authorization', `Bearer ${jwt.sign({ user_id: user, organizationId: unitId }, process.env.JWT_SECRET_KEY)}`)
    .send(body);

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    ids.unit = await unit(); ids.otherUnit = await unit();
    const year = await one("INSERT INTO scout_years (organization_id, label, start_date, end_date, status) VALUES ($1, 'Current', CURRENT_DATE - 30, CURRENT_DATE + 300, 'active') RETURNING id", [ids.unit]);
    const otherYear = await one("INSERT INTO scout_years (organization_id, label, start_date, end_date, status) VALUES ($1, 'Current', CURRENT_DATE - 30, CURRENT_DATE + 300, 'active') RETURNING id", [ids.otherUnit]);
    ids.leader = await member(ids.unit, 'Ada Lovelace', 'organization');
    ids.leader2 = await member(ids.unit, 'Grace Hopper', 'organization');
    ids.family = await member(ids.unit, 'Léa Tremblay', 'linked');
    ids.rosalind = await child(ids.unit, year, 'Rosalind');
    ids.hedy = await child(ids.unit, year, 'Hedy');
    ids.foreign = await child(ids.otherUnit, otherYear, 'Barbara');
    ids.syrup = await medication(ids.unit, ids.rosalind);
    await pool.query('INSERT INTO user_participants (user_id, participant_id) VALUES ($1, $2)', [ids.family, ids.rosalind]);
    app = express(); app.locals.pool = pool; app.use(express.json());
    app.use('/api', require('../routes/medication')(pool, { info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
    app.use((err, _req, res, _next) => res.status(500).json({ success: false, message: 'internal_server_error' }));
  });

  afterAll(async () => {
    if (!pool) {return;}
    await pool.query('DELETE FROM medication_distributions WHERE organization_id = ANY($1::int[])', [units]);
    await pool.query('DELETE FROM participant_medications WHERE organization_id = ANY($1::int[])', [units]);
    await pool.query('DELETE FROM medication_requirements WHERE organization_id = ANY($1::int[])', [units]);
    await pool.query('DELETE FROM user_participants WHERE participant_id = ANY($1::int[])', [participants]);
    await pool.query('DELETE FROM participant_enrollments WHERE organization_id = ANY($1::int[])', [units]);
    await pool.query('DELETE FROM participants WHERE id = ANY($1::int[])', [participants]);
    await pool.query('DELETE FROM scout_years WHERE organization_id = ANY($1::int[])', [units]);
    await pool.query('DELETE FROM organizations WHERE id = ANY($1::int[])', [units]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    await pool.end();
  });

  const scheduleFor = (participantId, at, user = ids.leader) => call('post', '/distributions', user,
    { medication_requirement_id: ids.syrup, participant_ids: [participantId], scheduled_for: at });
  const doseAt = (at) => one('SELECT id FROM medication_distributions WHERE medication_requirement_id = $1 AND scheduled_for = $2', [ids.syrup, at]);

  test('a dose is scheduled only for the youth its medication names, never another child or another unit’s', async () => {
    expect((await scheduleFor(ids.hedy, '2030-01-01T08:00:00Z')).status).toBe(404);
    expect((await scheduleFor(ids.foreign, '2030-01-01T08:00:00Z')).status).toBe(404);
    expect(await one('SELECT COUNT(*)::int FROM medication_distributions WHERE medication_requirement_id = $1', [ids.syrup])).toBe(0);
    expect(await one('SELECT COUNT(*)::int FROM participant_medications WHERE medication_requirement_id = $1', [ids.syrup])).toBe(0);
    expect((await scheduleFor(ids.rosalind, '2030-01-01T08:00:00Z')).status).toBe(201);
  });

  test('a family role holding medication.manage neither lists the unit’s doses nor confirms one', async () => {
    await scheduleFor(ids.rosalind, '2030-01-02T08:00:00Z');
    const dose = await doseAt('2030-01-02T08:00:00Z');
    expect((await call('get', '/distributions', ids.family)).status).toBe(403);
    expect((await call('patch', `/distributions/${dose}`, ids.family, { status: 'given' })).status).toBe(403);
    expect((await scheduleFor(ids.rosalind, '2030-01-03T08:00:00Z', ids.family)).status).toBe(403);
    expect(await one('SELECT status FROM medication_distributions WHERE id = $1', [dose])).toBe('scheduled');
  });

  test('of two devices confirming one dose at once, one succeeds and the other learns it was given', async () => {
    await scheduleFor(ids.rosalind, '2030-01-04T08:00:00Z');
    const dose = await doseAt('2030-01-04T08:00:00Z');
    const [first, second] = await Promise.all([
      call('patch', `/distributions/${dose}`, ids.leader, { status: 'given', witness_name: 'Witness one' }),
      call('patch', `/distributions/${dose}`, ids.leader2, { status: 'given', witness_name: 'Witness two' }),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const winner = first.status === 200 ? ids.leader : ids.leader2;
    expect(await one('SELECT administered_by FROM medication_distributions WHERE id = $1', [dose])).toBe(winner);
  });

  test('a given dose is never put back to “to give”, nor its giver erased', async () => {
    await scheduleFor(ids.rosalind, '2030-01-05T08:00:00Z');
    const dose = await doseAt('2030-01-05T08:00:00Z');
    expect((await call('patch', `/distributions/${dose}`, ids.leader, { status: 'given' })).status).toBe(200);
    for (const body of [{ status: 'scheduled' }, { status: 'missed' }, {}]) {
      // eslint-disable-next-line no-await-in-loop -- each attempt in turn
      expect((await call('patch', `/distributions/${dose}`, ids.leader2, body)).status).toBe(409);
    }
    const row = (await pool.query('SELECT status, administered_by FROM medication_distributions WHERE id = $1', [dose])).rows[0];
    expect(row).toEqual({ status: 'given', administered_by: ids.leader });
    expect((await call('patch', `/distributions/${dose}`, ids.leader, { status: 'given' }, ids.otherUnit)).status).not.toBe(200);
  });
});
