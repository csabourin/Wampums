/**
 * Camp lists (#1319) on a disposable database: which youth a camp lists, who
 * may be named to its team and who may read it, and what stays inside one unit.
 * Every person here is invented.
 */
const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
require('./jest-conditional-helpers');
process.env.JWT_SECRET_KEY ||= 'fictional-camp-roster-integration';
const DATABASE_URL = process.env.TEST_DATABASE_URL;

const READ = ['meetings.view', 'participants.view'];
const MANAGE = [...READ, 'meetings.manage'];

describe.skipIf(!DATABASE_URL)('Camp lists', () => {
  let pool; let app;
  const ids = {}; const units = []; const users = []; const participants = [];
  const one = async (sql, params = []) => Object.values((await pool.query(sql, params)).rows[0] || {})[0];

  /** A unit and its section, together: the unit's section is checked at commit. */
  async function unit() {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const id = (await db.query("INSERT INTO organizations (name) VALUES ('Fictional Roster Unit') RETURNING id")).rows[0].id;
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
  async function member(unitId, keys, name, scope = 'organization') {
    const role = await one("INSERT INTO roles (role_name, display_name, data_scope, organization_id) VALUES ('roster_' || gen_random_uuid(), 'Camp team', $2, $1) RETURNING id", [unitId, scope]);
    await pool.query('INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE permission_key = ANY($2::text[])', [role, keys]);
    const user = await one("INSERT INTO users (email, password, full_name) VALUES ('roster-' || gen_random_uuid() || '@example.test', 'x', $1) RETURNING id", [name]);
    users.push(user);
    await pool.query('INSERT INTO user_organizations (organization_id, user_id, role_ids) VALUES ($1, $2, $3)', [unitId, user, JSON.stringify([role])]);
    return user;
  }
  async function youth(first, birth, enrollments) {
    const id = await one('INSERT INTO participants (first_name, last_name, date_naissance) VALUES ($1, $2, $3) RETURNING id', [first, 'Fiction', birth]);
    participants.push(id);
    for (const [unitId, year, status = 'active', endedOn = null, registeredOn = null] of enrollments) {
      // eslint-disable-next-line no-await-in-loop -- a handful of fixture rows
      await pool.query(`INSERT INTO participant_enrollments (participant_id, organization_id, scout_year_id, status, ended_on, inscription_date)
        VALUES ($1, $2, $3, $4, $5, $6)`, [id, unitId, year, status, endedOn, registeredOn]);
    }
    return id;
  }
  async function camp(unitId, start, end, creator) {
    const outing = await one(`INSERT INTO activities (organization_id, created_by, name, activity_date, meeting_location_going,
      meeting_time_going, departure_time_going, activity_start_date, activity_start_time, activity_end_date, activity_end_time, is_camp)
      VALUES ($1, $2, 'Fictional camp', $3, 'Hall', '09:00', '09:15', $3, '09:00', $4, '16:00', TRUE) RETURNING id`, [unitId, creator, start, end]);
    const meeting = await one(`INSERT INTO year_plan_meetings (organization_id, meeting_date, theme, meeting_kind, activity_id)
      VALUES ($1, $2, 'Fictional camp', 'camp', $3) RETURNING id`, [unitId, start, outing]);
    return { meeting, outing };
  }
  const slip = (unitId, participant, activity, status) => pool.query(
    'INSERT INTO permission_slips (organization_id, participant_id, activity_id, meeting_date, status) VALUES ($1, $2, $3, CURRENT_DATE, $4)',
    [unitId, participant, activity, status]);
  const auth = (user, unitId = ids.unit) => ({ Authorization: `Bearer ${jwt.sign({ user_id: user, organizationId: unitId }, process.env.JWT_SECRET_KEY)}` });
  const call = (method, path, user, unitId) => request(app)[method](`/api/v1/camp-rosters${path}`).set(auth(user, unitId));
  const names = (rows) => rows.map((row) => row.first_name);

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    ids.unit = await unit(); ids.otherUnit = await unit();
    ids.manager = await member(ids.unit, MANAGE, 'Ada Lovelace');
    ids.reader = await member(ids.unit, READ, 'Grace Hopper');
    ids.aide = await member(ids.unit, ['volunteers.view'], 'Alan Turing');
    ids.parent = await member(ids.unit, READ, 'Léa Tremblay', 'linked');
    ids.outsider = await member(ids.otherUnit, MANAGE, 'Mary Somerville');
    ids.year = await one("INSERT INTO scout_years (organization_id, label, start_date, end_date, status) VALUES ($1, 'Current', '2030-09-01', '2031-08-31', 'active') RETURNING id", [ids.unit]);
    ids.otherYear = await one("INSERT INTO scout_years (organization_id, label, start_date, end_date, status) VALUES ($1, 'Current', '2030-09-01', '2031-08-31', 'active') RETURNING id", [ids.otherUnit]);
    app = express(); app.locals.pool = pool; app.use(express.json());
    app.use('/api/v1/camp-rosters', require('../routes/camp-rosters')(pool));
    app.use((err, _req, res, _next) => res.status(500).json({ success: false, message: 'internal_server_error' }));
  });

  afterAll(async () => {
    if (!pool) {return;}
    await pool.query('DELETE FROM permission_slips WHERE organization_id = ANY($1::int[])', [units]);
    await pool.query('DELETE FROM participant_enrollments WHERE organization_id = ANY($1::int[])', [units]);
    await pool.query('DELETE FROM participants WHERE id = ANY($1::int[])', [participants]);
    await pool.query('DELETE FROM scout_years WHERE organization_id = ANY($1::int[])', [units]);
    await pool.query('DELETE FROM organizations WHERE id = ANY($1::int[])', [units]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    await pool.end();
  });

  test('without permission requests, every youth enrolled in the unit that year is listed, and not one who had left', async () => {
    await youth('Rosalind', '2020-03-01', [[ids.unit, ids.year]]);
    await youth('Emmy', null, [[ids.unit, ids.year, 'left', '2030-10-01']]);
    const { meeting } = await camp(ids.unit, '2031-07-04', '2031-07-11', ids.manager);
    const response = await call('get', `/${meeting}`, ids.reader);
    expect(response.status).toBe(200);
    const roster = response.body.data;
    expect(roster.consent.requested).toBe(false);
    expect(names(roster.youth)).toEqual(['Rosalind']);
    expect(roster.youth[0].age_at_camp).toBe(11);
    expect(roster.gaps).toEqual(['no_lead', 'no_first_aider']);
  });

  test('a youth registered after a camp ended never joins that camp’s list; one registered during it does', async () => {
    const { meeting } = await camp(ids.unit, '2030-10-10', '2030-10-12', ids.manager);
    await youth('Ida', '2020-01-01', [[ids.unit, ids.year, 'active', null, '2030-10-11']]);
    await youth('Sophie', '2020-01-01', [[ids.unit, ids.year, 'active', null, '2030-11-02']]);
    const listed = names((await call('get', `/${meeting}`, ids.reader)).body.data.youth);
    expect(listed).toContain('Ida');
    expect(listed).not.toContain('Sophie');
  });

  test('with permission requests, only youth whose request is signed take part; a withdrawal leaves the list', async () => {
    const signed = await youth('Hedy', '2021-01-01', [[ids.unit, ids.year]]);
    const declined = await youth('Katherine', '2021-01-01', [[ids.unit, ids.year]]);
    const waiting = await youth('Dorothy', '2021-01-01', [[ids.unit, ids.year]]);
    const { meeting, outing } = await camp(ids.unit, '2031-06-01', '2031-06-03', ids.manager);
    await slip(ids.unit, signed, outing, 'signed');
    await slip(ids.unit, declined, outing, 'revoked');
    await slip(ids.unit, waiting, outing, 'pending');
    const roster = (await call('get', `/${meeting}`, ids.reader)).body.data;
    expect(names(roster.youth)).toEqual(['Hedy']);
    expect(roster.consent).toEqual({ requested: true, signed: 1, pending: 1, withdrawn: 1 });
  });

  test('a youth enrolled in two units appears only in the camp of the unit that enrolls them', async () => {
    const shared = await youth('Barbara', '2021-01-01', [[ids.unit, ids.year], [ids.otherUnit, ids.otherYear]]);
    const theirs = await camp(ids.otherUnit, '2031-05-10', '2031-05-12', ids.outsider);
    const ours = await camp(ids.unit, '2031-05-10', '2031-05-12', ids.manager);
    // Signed for the other unit's camp only: our own camp, with requests of its own, does not list her.
    await slip(ids.otherUnit, shared, theirs.outing, 'signed');
    const other = await youth('Frances', '2021-01-01', [[ids.unit, ids.year]]);
    await slip(ids.unit, other, ours.outing, 'signed');
    expect(names((await call('get', `/${ours.meeting}`, ids.reader)).body.data.youth)).toEqual(['Frances']);
    expect(names((await call('get', `/${theirs.meeting}`, ids.outsider, ids.otherUnit)).body.data.youth)).toEqual(['Barbara']);
  });

  test('another unit’s camp is not found, and a parent whose role sees only their own children reads no camp list', async () => {
    const { meeting } = await camp(ids.unit, '2031-04-01', '2031-04-02', ids.manager);
    expect((await call('get', `/${meeting}`, ids.outsider, ids.otherUnit)).status).toBe(404);
    const refused = await call('get', `/${meeting}`, ids.parent);
    expect(refused.status).toBe(403);
    expect(refused.body.required).toEqual(READ);
  });

  test('a manager names the team; a camp aide without a birth date reads “not verified”, with one a minor on the camp’s dates', async () => {
    const { meeting } = await camp(ids.unit, '2031-03-01', '2031-03-03', ids.manager);
    expect((await call('put', `/${meeting}/team/${ids.reader}`, ids.manager).send({ team_role: 'lead' })).status).toBe(200);
    const aide = await call('put', `/${meeting}/team/${ids.aide}`, ids.manager).send({ team_role: 'camp_aide' });
    expect(aide.status).toBe(200);
    let roster = (await call('get', `/${meeting}`, ids.reader)).body.data;
    expect(roster.team.map((row) => [row.name, row.team_role, row.age_status])).toEqual([
      ['Grace Hopper', 'lead', 'unknown'], ['Alan Turing', 'camp_aide', 'unknown'],
    ]);
    expect(roster.gaps).toContain('aide_age_unknown');
    // A reader never receives a member's birth date.
    expect(roster.team[1]).not.toHaveProperty('date_of_birth');

    await call('put', `/${meeting}/team/${ids.aide}`, ids.manager).send({ team_role: 'camp_aide', date_of_birth: '2014-03-02' });
    roster = (await call('get', `/${meeting}`, ids.manager)).body.data;
    const named = roster.team.find((row) => row.user_id === ids.aide);
    expect(named).toMatchObject({ age_status: 'minor', date_of_birth: '2014-03-02' });
    expect(roster.gaps).not.toContain('aide_age_unknown');
    expect(roster.gaps).not.toContain('no_lead');

    await call('put', `/${meeting}/team/${ids.aide}`, ids.manager).send({ team_role: 'camp_aide', date_of_birth: '2013-03-01' });
    roster = (await call('get', `/${meeting}`, ids.reader)).body.data;
    expect(roster.team.find((row) => row.user_id === ids.aide).age_status).toBe('adult');
  });

  test('only active members of the unit’s team can be named, never a parent or someone from another unit', async () => {
    const { meeting } = await camp(ids.unit, '2031-02-01', '2031-02-02', ids.manager);
    const candidates = (await call('get', `/${meeting}/team-candidates`, ids.manager)).body.data.map((row) => row.user_id);
    expect(candidates).toEqual(expect.arrayContaining([ids.manager, ids.reader, ids.aide]));
    expect(candidates).not.toContain(ids.parent);
    expect(candidates).not.toContain(ids.outsider);
    expect((await call('put', `/${meeting}/team/${ids.parent}`, ids.manager).send({ team_role: 'leader' })).status).toBe(404);
    expect((await call('put', `/${meeting}/team/${ids.outsider}`, ids.manager).send({ team_role: 'leader' })).status).toBe(404);
    // Another unit's manager cannot reach this camp at all.
    expect((await call('put', `/${meeting}/team/${ids.outsider}`, ids.outsider, ids.otherUnit).send({ team_role: 'leader' })).status).toBe(404);
    expect(await one('SELECT COUNT(*)::int FROM camp_team_members WHERE meeting_id = $1', [meeting])).toBe(0);
  });

  test('a reader may not name the team, and an invalid role or birth date changes nothing', async () => {
    const { meeting } = await camp(ids.unit, '2031-01-10', '2031-01-11', ids.manager);
    const refused = await call('put', `/${meeting}/team/${ids.aide}`, ids.reader).send({ team_role: 'leader' });
    expect(refused.status).toBe(403);
    expect(refused.body.missing).toEqual(['meetings.manage']);
    expect((await call('put', `/${meeting}/team/${ids.aide}`, ids.manager).send({ team_role: 'chief' })).status).toBe(400);
    const future = await call('put', `/${meeting}/team/${ids.aide}`, ids.manager).send({ team_role: 'camp_aide', date_of_birth: '2999-01-01' });
    expect(future.status).toBe(400);
    expect(future.body.errors[0].path).toBe('date_of_birth');
    expect(await one('SELECT COUNT(*)::int FROM camp_team_members WHERE meeting_id = $1', [meeting])).toBe(0);
  });

  test('removing a member takes them off this camp only; a cancelled camp’s team can no longer change', async () => {
    const first = await camp(ids.unit, '2030-12-01', '2030-12-02', ids.manager);
    const second = await camp(ids.unit, '2030-12-10', '2030-12-11', ids.manager);
    await call('put', `/${first.meeting}/team/${ids.reader}`, ids.manager).send({ team_role: 'leader' });
    await call('put', `/${second.meeting}/team/${ids.reader}`, ids.manager).send({ team_role: 'leader' });
    expect((await call('delete', `/${first.meeting}/team/${ids.reader}`, ids.manager)).status).toBe(200);
    expect((await call('delete', `/${first.meeting}/team/${ids.reader}`, ids.manager)).status).toBe(404);
    expect((await call('get', `/${second.meeting}`, ids.reader)).body.data.team).toHaveLength(1);
    await pool.query('UPDATE year_plan_meetings SET is_cancelled = TRUE WHERE id = $1', [second.meeting]);
    expect((await call('delete', `/${second.meeting}/team/${ids.reader}`, ids.manager)).status).toBe(409);
  });

  test('volunteers of the camp’s shifts are named only to whoever manages volunteers', async () => {
    const { meeting, outing } = await camp(ids.unit, '2030-11-20', '2030-11-22', ids.manager);
    const shift = await one(`INSERT INTO volunteer_shifts (organization_id, activity_id, volunteer_type, shift_date, start_time, end_time, slots)
      VALUES ($1, $2, 'cook', '2030-11-20', '17:00', '19:00', 2) RETURNING id`, [ids.unit, outing]);
    await pool.query("INSERT INTO volunteer_signups (organization_id, shift_id, user_id, status) VALUES ($1, $2, $3, 'pending')", [ids.unit, shift, ids.aide]);
    expect((await call('get', `/${meeting}`, ids.reader)).body.data.volunteers).toEqual({ count: 1, people: null });
    const volunteersManager = await member(ids.unit, [...READ, 'volunteers.manage'], 'Katherine Johnson');
    const people = (await call('get', `/${meeting}`, volunteersManager)).body.data.volunteers.people;
    expect(people).toEqual([expect.objectContaining({ name: 'Alan Turing', types: ['cook'], pending: true })]);
  });
});
