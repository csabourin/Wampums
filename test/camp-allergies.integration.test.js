/**
 * Allergies in the camp lists (#1319, third slice) on a disposable database: who receives the new
 * permission, youth allergies read from their health form in the camp's unit, adults' as each
 * declared them, and who reads them. Every person here is invented.
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
require('./jest-conditional-helpers');
process.env.JWT_SECRET_KEY ||= 'fictional-camp-allergies-integration';
const DATABASE_URL = process.env.TEST_DATABASE_URL;

const READ = ['meetings.view', 'participants.view'];
const MANAGE = [...READ, 'meetings.manage'];
const MIGRATION = fs.readFileSync(path.join(__dirname, '../migrations/074_camp_allergies.sql'), 'utf8');

describe.skipIf(!DATABASE_URL)('Allergies in the camp lists', () => {
  let pool; let app;
  const ids = {}; const units = []; const users = []; const participants = [];
  const one = async (sql, params = []) => Object.values((await pool.query(sql, params)).rows[0] || {})[0];

  /** A unit and its section, together: the unit's section is checked at commit. */
  async function unit() {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const id = (await db.query("INSERT INTO organizations (name) VALUES ('Fictional Allergy Unit') RETURNING id")).rows[0].id;
      await db.query("INSERT INTO organization_program_sections (organization_id, section_key, display_name) VALUES ($1, 'general', 'General')", [id]);
      await db.query('COMMIT');
      units.push(id);
      return id;
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    } finally {
      db.release();
    }
  }
  async function role(unitId, keys, scope = 'organization') {
    const id = await one("INSERT INTO roles (role_name, display_name, data_scope, organization_id) VALUES ('allergy_' || gen_random_uuid(), 'Team', $2, $1) RETURNING id", [unitId, scope]);
    await pool.query('INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE permission_key = ANY($2::text[])', [id, keys]);
    return id;
  }
  async function member(unitId, keys, name, scope = 'organization') {
    const roleId = await role(unitId, keys, scope);
    const user = await one("INSERT INTO users (email, password, full_name) VALUES ('allergy-' || gen_random_uuid() || '@example.test', 'x', $1) RETURNING id", [name]);
    users.push(user);
    await pool.query('INSERT INTO user_organizations (organization_id, user_id, role_ids) VALUES ($1, $2, $3)', [unitId, user, JSON.stringify([roleId])]);
    return user;
  }
  async function youth(first, enrollments) {
    const id = await one("INSERT INTO participants (first_name, last_name, date_naissance) VALUES ($1, 'Fiction', '2020-01-01') RETURNING id", [first]);
    participants.push(id);
    for (const [unitId, year] of enrollments) {
      // eslint-disable-next-line no-await-in-loop -- a handful of fixture rows
      await pool.query("INSERT INTO participant_enrollments (participant_id, organization_id, scout_year_id, status) VALUES ($1, $2, $3, 'active')", [id, unitId, year]);
    }
    return id;
  }
  const healthForm = (unitId, participant, data) => pool.query(
    "INSERT INTO form_submissions (organization_id, participant_id, form_type, submission_data) VALUES ($1, $2, 'fiche_sante', $3)",
    [unitId, participant, JSON.stringify(data)]);
  async function camp(unitId, start, end) {
    const outing = await one(`INSERT INTO activities (organization_id, created_by, name, activity_date, meeting_location_going,
      meeting_time_going, departure_time_going, activity_start_date, activity_start_time, activity_end_date, activity_end_time, is_camp)
      VALUES ($1, $2, 'Fictional camp', $3, 'Hall', '09:00', '09:15', $3, '09:00', $4, '16:00', TRUE) RETURNING id`, [unitId, ids.manager, start, end]);
    return one(`INSERT INTO year_plan_meetings (organization_id, meeting_date, theme, meeting_kind, activity_id)
      VALUES ($1, $2, 'Fictional camp', 'camp', $3) RETURNING id`, [unitId, start, outing]);
  }
  const auth = (user, unitId = ids.unit) => ({ Authorization: `Bearer ${jwt.sign({ user_id: user, organizationId: unitId }, process.env.JWT_SECRET_KEY)}` });
  const call = (method, route, user, unitId) => request(app)[method](`/api/v1${route}`).set(auth(user, unitId));
  const roster = async (meeting, user = ids.nurse, unitId = ids.unit) => (await call('get', `/camp-rosters/${meeting}`, user, unitId)).body.data;
  const declare = (user, body, unitId) => call('put', '/member-allergies/me', user, unitId).send(body);
  const name = (meeting, user, unitId = ids.unit, by = ids.manager) =>
    call('put', `/camp-rosters/${meeting}/team/${user}`, by, unitId).send({ team_role: 'leader' });
  const holds = (roleId) => one(`SELECT COUNT(*)::int FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
    WHERE rp.role_id = $1 AND p.permission_key = 'camp_allergies.view'`, [roleId]);

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    ids.unit = await unit(); ids.otherUnit = await unit();
    ids.manager = await member(ids.unit, MANAGE, 'Ada Lovelace');
    ids.reader = await member(ids.unit, READ, 'Grace Hopper');
    ids.nurse = await member(ids.unit, [...READ, 'camp_allergies.view'], 'Florence Nightingale');
    ids.leader = await member(ids.unit, ['volunteers.view'], 'Alan Turing');
    ids.outsider = await member(ids.otherUnit, [...MANAGE, 'camp_allergies.view'], 'Mary Somerville');
    ids.year = await one("INSERT INTO scout_years (organization_id, label, start_date, end_date, status) VALUES ($1, 'Current', '2030-09-01', '2031-08-31', 'active') RETURNING id", [ids.unit]);
    ids.otherYear = await one("INSERT INTO scout_years (organization_id, label, start_date, end_date, status) VALUES ($1, 'Current', '2030-09-01', '2031-08-31', 'active') RETURNING id", [ids.otherUnit]);
    app = express(); app.locals.pool = pool; app.use(express.json());
    app.use('/api/v1/camp-rosters', require('../routes/camp-rosters')(pool));
    app.use('/api/v1/member-allergies', require('../routes/member-allergies')(pool));
    app.use((err, _req, res, _next) => res.status(500).json({ success: false, message: 'internal_server_error' }));
  });

  afterAll(async () => {
    if (!pool) {return;}
    await pool.query('DELETE FROM form_submissions WHERE organization_id = ANY($1::int[])', [units]);
    await pool.query('DELETE FROM participant_enrollments WHERE organization_id = ANY($1::int[])', [units]);
    await pool.query('DELETE FROM participants WHERE id = ANY($1::int[])', [participants]);
    await pool.query('DELETE FROM scout_years WHERE organization_id = ANY($1::int[])', [units]);
    await pool.query('DELETE FROM organizations WHERE id = ANY($1::int[])', [units]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    await pool.end();
  });

  test('roles that already read health forms across the unit receive the permission; a family role never does', async () => {
    const reports = await role(ids.unit, ['reports.view']);
    const medication = await role(ids.unit, ['medication.view']);
    const formReader = await role(ids.unit, ['meetings.view']);
    const format = await one(`INSERT INTO organization_form_formats (organization_id, form_type, form_structure)
      VALUES ($1, 'fiche_sante', '{}'::jsonb) RETURNING id`, [ids.unit]);
    await pool.query('INSERT INTO form_permissions (form_format_id, role_id, can_view) VALUES ($1, $2, TRUE)', [format, formReader]);
    const family = await role(ids.unit, ['medication.view', 'reports.view'], 'linked');
    const planner = await role(ids.unit, ['meetings.manage']);
    await pool.query(MIGRATION);
    expect([await holds(reports), await holds(medication), await holds(formReader)]).toEqual([1, 1, 1]);
    expect([await holds(family), await holds(planner)]).toEqual([0, 0]);
    expect(await one(`SELECT COUNT(*)::int FROM roles r JOIN role_permissions rp ON rp.role_id = r.id
      JOIN permissions p ON p.id = rp.permission_id WHERE r.role_name = 'district' AND p.permission_key = 'camp_allergies.view'`)).toBe(1);
  });

  test('youth allergies come from the health form in the camp’s unit; a youth without one is listed to check', async () => {
    const allergic = await youth('Rosalind', [[ids.unit, ids.year], [ids.otherUnit, ids.otherYear]]);
    const clear = await youth('Hedy', [[ids.unit, ids.year]]);
    await youth('Emmy', [[ids.unit, ids.year]]);
    await healthForm(ids.unit, allergic, { allergie: 'Arachides', epipen: 'oui', medicament: 'EpiPen 0,3 mg', allergie_reaction: 'Urticaire' });
    await healthForm(ids.unit, clear, { allergie: 'aucune' });
    // Another unit's health form for the same youth is that unit's, not this camp's.
    await healthForm(ids.otherUnit, clear, { allergie: 'Latex' });
    const meeting = await camp(ids.unit, '2031-07-04', '2031-07-11');
    const data = await roster(meeting);
    expect(data.allergies.youth).toEqual([expect.objectContaining({
      participant_id: allergic, allergies: 'Arachides', epipen: true, reaction: 'Urticaire',
    })]);
    expect(data.allergies.youth[0].emergency_medication).toEqual(expect.any(String));
    expect(data.allergies.youth_without_health_form).toBe(1);
    expect(data.gaps).toContain('youth_health_form_missing');
  });

  test('a reader without the permission receives no allergy, only the gaps', async () => {
    const meeting = await camp(ids.unit, '2031-06-01', '2031-06-03');
    const data = await roster(meeting, ids.reader);
    expect(data.allergies).toBeNull();
    expect(data.gaps).toContain('youth_health_form_missing');
    const managed = await roster(meeting, ids.manager);
    expect(managed.allergies).toBeNull();
  });

  test('a team member’s allergies are those they declared themselves, in this unit, while still a member', async () => {
    const meeting = await camp(ids.unit, '2031-05-01', '2031-05-03');
    await name(meeting, ids.leader);
    await name(meeting, ids.reader);
    let data = await roster(meeting);
    expect(data.allergies.adults).toEqual([]);
    expect(data.allergies.adults_without_declaration).toBe(2);
    expect(data.gaps).toContain('adult_allergies_not_declared');

    expect((await declare(ids.leader, { allergies: 'Pénicilline', carries_epipen: false, person_to_notify: 'Léa Tremblay, 555-0100' })).status).toBe(200);
    // Declared in another unit: not this unit's.
    await pool.query("INSERT INTO user_organizations (organization_id, user_id, role_ids) VALUES ($1, $2, '[]')", [ids.otherUnit, ids.reader]);
    expect((await declare(ids.reader, { allergies: 'Latex' }, ids.otherUnit)).status).toBe(200);
    data = await roster(meeting);
    expect(data.allergies.adults).toEqual([expect.objectContaining({
      user_id: ids.leader, allergies: 'Pénicilline', person_to_notify: 'Léa Tremblay, 555-0100',
    })]);
    expect(data.allergies.adults_without_declaration).toBe(1);

    await pool.query("UPDATE user_organizations SET status = 'inactive' WHERE organization_id = $1 AND user_id = $2", [ids.unit, ids.leader]);
    data = await roster(meeting);
    expect(data.allergies.adults).toEqual([]);
    await pool.query("UPDATE user_organizations SET status = 'active' WHERE organization_id = $1 AND user_id = $2", [ids.unit, ids.leader]);
  });

  test('an adult withdraws their declaration, and it leaves every camp list', async () => {
    const meeting = await camp(ids.unit, '2031-04-01', '2031-04-02');
    await name(meeting, ids.leader);
    await declare(ids.leader, { allergies: 'Pollen' });
    expect((await roster(meeting)).allergies.adults).toHaveLength(1);
    expect((await call('delete', '/member-allergies/me', ids.leader)).status).toBe(200);
    expect((await roster(meeting)).allergies.adults).toEqual([]);
    expect((await call('get', '/member-allergies/me', ids.leader)).body.data).toBeNull();
  });

  test('another unit cannot read this camp’s allergies', async () => {
    const meeting = await camp(ids.unit, '2031-03-01', '2031-03-02');
    expect((await call('get', `/camp-rosters/${meeting}`, ids.outsider, ids.otherUnit)).status).toBe(404);
  });
});
