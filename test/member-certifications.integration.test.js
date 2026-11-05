/**
 * Adult certifications and the camp lists (#1319, second slice) on a disposable database: an
 * adult declares their own, a manager of volunteers verifies them, and only a verified one valid
 * through the camp's last day lifts the blocking "no first aider" gap. Who reads them, and what
 * stays inside one unit. Every person here is invented.
 */
const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
require('./jest-conditional-helpers');
process.env.JWT_SECRET_KEY ||= 'fictional-certification-integration';
const DATABASE_URL = process.env.TEST_DATABASE_URL;

const READ = ['meetings.view', 'participants.view'];
const MANAGE = [...READ, 'meetings.manage'];

describe.skipIf(!DATABASE_URL)('Adult certifications in the camp lists', () => {
  let pool; let app;
  const ids = {}; const units = []; const users = [];
  const one = async (sql, params = []) => Object.values((await pool.query(sql, params)).rows[0] || {})[0];

  /** A unit and its section, together: the unit's section is checked at commit. */
  async function unit() {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const id = (await db.query("INSERT INTO organizations (name) VALUES ('Fictional Certification Unit') RETURNING id")).rows[0].id;
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
    const role = await one("INSERT INTO roles (role_name, display_name, data_scope, organization_id) VALUES ('cert_' || gen_random_uuid(), 'Camp team', $2, $1) RETURNING id", [unitId, scope]);
    await pool.query('INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE permission_key = ANY($2::text[])', [role, keys]);
    const user = await one("INSERT INTO users (email, password, full_name) VALUES ('cert-' || gen_random_uuid() || '@example.test', 'x', $1) RETURNING id", [name]);
    users.push(user);
    await pool.query('INSERT INTO user_organizations (organization_id, user_id, role_ids) VALUES ($1, $2, $3)', [unitId, user, JSON.stringify([role])]);
    return user;
  }
  /** A planned camp; its last day comes from its activity. */
  async function camp(unitId, start, end) {
    const outing = await one(`INSERT INTO activities (organization_id, created_by, name, activity_date, meeting_location_going,
      meeting_time_going, departure_time_going, activity_start_date, activity_start_time, activity_end_date, activity_end_time, is_camp)
      VALUES ($1, $2, 'Fictional camp', $3, 'Hall', '09:00', '09:15', $3, '09:00', $4, '16:00', TRUE) RETURNING id`, [unitId, ids.manager, start, end]);
    return one(`INSERT INTO year_plan_meetings (organization_id, meeting_date, theme, meeting_kind, activity_id)
      VALUES ($1, $2, 'Fictional camp', 'camp', $3) RETURNING id`, [unitId, start, outing]);
  }
  const auth = (user, unitId = ids.unit) => ({ Authorization: `Bearer ${jwt.sign({ user_id: user, organizationId: unitId }, process.env.JWT_SECRET_KEY)}` });
  const call = (method, path, user, unitId) => request(app)[method](`/api/v1${path}`).set(auth(user, unitId));
  const roster = async (meeting, user = ids.manager) => (await call('get', `/camp-rosters/${meeting}`, user)).body.data;
  const declare = (user, declared, unitId) => call('put', '/member-certifications/me', user, unitId).send({ declared });
  /** Verify each named certification as declared (true), or withdraw it (false). */
  const verify = async (user, keys, verified = true, by = ids.volunteerManager, unitId = ids.unit) => {
    const responses = [];
    for (const key of keys) {
      // eslint-disable-next-line no-await-in-loop -- one certification at a time, as a manager ticks them
      responses.push(await call('put', `/member-certifications/${user}/${key}/verification`, by, unitId).send({ verified }));
    }
    return responses;
  };
  const name = (meeting, user) => call('put', `/camp-rosters/${meeting}/team/${user}`, ids.manager).send({ team_role: 'leader' });

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    ids.unit = await unit(); ids.otherUnit = await unit();
    ids.manager = await member(ids.unit, MANAGE, 'Ada Lovelace');
    ids.reader = await member(ids.unit, READ, 'Grace Hopper');
    ids.leader = await member(ids.unit, ['volunteers.view'], 'Alan Turing');
    ids.volunteerManager = await member(ids.unit, [...READ, 'volunteers.view', 'volunteers.manage'], 'Katherine Johnson');
    ids.outsider = await member(ids.otherUnit, [...MANAGE, 'volunteers.manage'], 'Mary Somerville');
    app = express(); app.locals.pool = pool; app.use(express.json());
    app.use('/api/v1/camp-rosters', require('../routes/camp-rosters')(pool));
    app.use('/api/v1/member-certifications', require('../routes/member-certifications')(pool));
    app.use('/api/v1/volunteer-shifts', require('../routes/volunteer-shifts')(pool));
    app.use((err, _req, res, _next) => res.status(500).json({ success: false, message: 'internal_server_error' }));
  });

  afterAll(async () => {
    if (!pool) {return;}
    await pool.query('DELETE FROM organizations WHERE id = ANY($1::int[])', [units]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    await pool.end();
  });

  test('an adult declares their own certifications; a declaration never reads as verified', async () => {
    const saved = await declare(ids.leader, { first_aid_certificate: { obtained_on: '2025-03-01', valid_until: '2028-03-01' } });
    expect(saved.status).toBe(200);
    const mine = (await call('get', '/member-certifications/me', ids.leader)).body.data;
    expect(mine.find((row) => row.certification_key === 'first_aid_certificate')).toMatchObject({
      declared: { obtained_on: '2025-03-01', valid_until: '2028-03-01' }, verified: null,
    });
    expect(mine.map((row) => row.certification_key)).toEqual(['first_aid_certificate', 'wilderness_first_aid', 'winter_camping']);
    // The complete set: leaving one out withdraws it.
    await declare(ids.leader, { winter_camping: { obtained_on: '2024-01-15' } });
    const now = (await call('get', '/member-certifications/me', ids.leader)).body.data;
    expect(now.filter((row) => row.declared).map((row) => row.certification_key)).toEqual(['winter_camping']);
    expect((await declare(ids.leader, { first_aid_certificate: { obtained_on: '2999-01-01' } })).status).toBe(400);
  });

  test('only a verified first-aid certification valid through the camp’s last day lifts the blocking gap', async () => {
    const meeting = await camp(ids.unit, '2031-07-04', '2031-07-11');
    await name(meeting, ids.leader);
    await declare(ids.leader, { first_aid_certificate: { obtained_on: '2025-03-01', valid_until: '2031-07-08' } });
    let data = await roster(meeting);
    expect(data.blocking_gaps).toEqual(['no_first_aider']);
    // Declared, but it lapses before the camp ends: not even to verify for this camp.
    expect(data.gaps).not.toContain('certification_to_verify');

    await declare(ids.leader, { first_aid_certificate: { obtained_on: '2025-03-01', valid_until: '2032-03-01' } });
    data = await roster(meeting);
    expect(data.blocking_gaps).toEqual(['no_first_aider']);
    expect(data.gaps).toContain('certification_to_verify');
    expect(data.team[0].certifications).toEqual({ verified: [], to_verify: ['first_aid_certificate'] });

    // Verified, but expiring during the camp: still blocking.
    await declare(ids.leader, { first_aid_certificate: { obtained_on: '2025-03-01', valid_until: '2031-07-08' } });
    expect((await verify(ids.leader, ['first_aid_certificate']))[0].status).toBe(200);
    expect((await roster(meeting)).blocking_gaps).toEqual(['no_first_aider']);

    // New dates withdraw the verification; verified again, they count.
    await declare(ids.leader, { first_aid_certificate: { obtained_on: '2025-03-01', valid_until: '2032-03-01' } });
    expect((await roster(meeting)).gaps).toContain('certification_to_verify');
    await verify(ids.leader, ['first_aid_certificate']);
    data = await roster(meeting);
    expect(data.blocking_gaps).toEqual([]);
    expect(data.gaps).not.toContain('no_first_aider');
    expect(data.gaps).not.toContain('certification_to_verify');
    expect(data.team[0].certifications).toEqual({ verified: ['first_aid_certificate'], to_verify: [] });
  });

  test('wilderness first aid counts as first aid; winter camping does not', async () => {
    const aider = await member(ids.unit, ['volunteers.view'], 'Hedy Lamarr');
    const meeting = await camp(ids.unit, '2031-01-15', '2031-01-17');
    await name(meeting, aider);
    await declare(aider, { winter_camping: { obtained_on: '2024-01-15' }, wilderness_first_aid: { obtained_on: '2025-05-01' } });
    await verify(aider, ['winter_camping']);
    expect((await roster(meeting)).blocking_gaps).toEqual(['no_first_aider']);
    await verify(aider, ['wilderness_first_aid']);
    expect((await roster(meeting)).blocking_gaps).toEqual([]);
  });

  test('a first aider who left the unit no longer covers its camp', async () => {
    const leaving = await member(ids.unit, ['volunteers.view'], 'Dorothy Vaughan');
    const meeting = await camp(ids.unit, '2031-02-10', '2031-02-12');
    await name(meeting, leaving);
    await declare(leaving, { first_aid_certificate: { obtained_on: '2025-01-01' } });
    await verify(leaving, ['first_aid_certificate']);
    expect((await roster(meeting)).blocking_gaps).toEqual([]);
    await pool.query("UPDATE user_organizations SET status = 'inactive' WHERE organization_id = $1 AND user_id = $2", [ids.unit, leaving]);
    const data = await roster(meeting);
    expect(data.blocking_gaps).toEqual(['no_first_aider']);
    expect(data.gaps).toContain('member_left_unit');
    // Still listed, but their person-wide certifications are no longer this unit's to read.
    expect(data.team.find((row) => row.user_id === leaving)).not.toHaveProperty('certifications');
  });

  test('a certification obtained after the camp began does not cover that camp', async () => {
    const late = await member(ids.unit, ['volunteers.view'], 'Barbara Liskov');
    const meeting = await camp(ids.unit, '2025-07-04', '2025-07-11');
    await name(meeting, late);
    await declare(late, { first_aid_certificate: { obtained_on: '2025-07-06' } });
    await verify(late, ['first_aid_certificate']);
    expect((await roster(meeting)).blocking_gaps).toEqual(['no_first_aider']);
    await declare(late, { first_aid_certificate: { obtained_on: '2025-07-04' } });
    await verify(late, ['first_aid_certificate']);
    expect((await roster(meeting)).blocking_gaps).toEqual([]);
  });

  test('certifications go to whoever manages the camp or its volunteers; a reader sees only the gaps', async () => {
    const meeting = await camp(ids.unit, '2031-03-01', '2031-03-02');
    await name(meeting, ids.leader);
    const asReader = await roster(meeting, ids.reader);
    expect(asReader.team[0]).not.toHaveProperty('certifications');
    expect(asReader.gaps).toEqual(expect.any(Array));
    expect((await roster(meeting, ids.volunteerManager)).team[0]).toHaveProperty('certifications');
    expect((await roster(meeting, ids.manager)).team[0]).toHaveProperty('certifications');
  });

  test('a volunteer manager reads a member’s declarations; no one else, and never across units', async () => {
    await declare(ids.leader, { winter_camping: { obtained_on: '2024-01-15' } });
    const read = await call('get', `/member-certifications/${ids.leader}`, ids.volunteerManager);
    expect(read.status).toBe(200);
    expect(read.body.data.find((row) => row.certification_key === 'winter_camping').declared).toMatchObject({ obtained_on: '2024-01-15' });
    const refused = await call('get', `/member-certifications/${ids.leader}`, ids.manager);
    expect(refused.status).toBe(403);
    expect(refused.body.missing).toEqual(['volunteers.manage']);
    expect((await call('get', `/member-certifications/${ids.leader}`, ids.outsider, ids.otherUnit)).status).toBe(404);
  });

  test('a person declares once; verified in one unit, it counts in every unit they belong to', async () => {
    const both = await member(ids.unit, ['volunteers.view'], 'Frances Allen');
    const otherRole = await one("INSERT INTO roles (role_name, display_name, data_scope, organization_id) VALUES ('cert_' || gen_random_uuid(), 'Team', 'organization', $1) RETURNING id", [ids.otherUnit]);
    await pool.query('INSERT INTO user_organizations (organization_id, user_id, role_ids) VALUES ($1, $2, $3)', [ids.otherUnit, both, JSON.stringify([otherRole])]);
    await declare(both, { first_aid_certificate: { obtained_on: '2025-01-01' } }, ids.unit);
    await verify(both, ['first_aid_certificate']);
    const elsewhere = (await call('get', '/member-certifications/me', both, ids.otherUnit)).body.data;
    expect(elsewhere.find((row) => row.certification_key === 'first_aid_certificate').verified).not.toBeNull();
    const theirCamp = await camp(ids.otherUnit, '2031-04-01', '2031-04-02');
    await call('put', `/camp-rosters/${theirCamp}/team/${both}`, ids.outsider, ids.otherUnit).send({ team_role: 'leader' });
    expect((await call('get', `/camp-rosters/${theirCamp}`, ids.outsider, ids.otherUnit)).body.data.blocking_gaps).toEqual([]);
  });

  test('a manager verifies only members of their own unit, and only what was declared', async () => {
    const [outsiders] = await verify(ids.leader, ['winter_camping'], true, ids.outsider, ids.otherUnit);
    expect(outsiders.status).toBe(404);
    await declare(ids.leader, {});
    const [undeclared] = await verify(ids.leader, ['winter_camping']);
    expect(undeclared.status).toBe(404);
    expect(undeclared.body.message).toBe('certification_not_declared');
    const refused = await call('put', `/member-certifications/${ids.leader}/winter_camping/verification`, ids.manager).send({ verified: true });
    expect(refused.status).toBe(403);
    expect(refused.body.missing).toEqual(['volunteers.manage']);
  });

  test('a camp that plans swimming lists its supervision to check, never as blocking', async () => {
    const meeting = await camp(ids.unit, '2031-05-01', '2031-05-03');
    const saved = await call('patch', `/camp-rosters/${meeting}`, ids.manager).send({ swimming_planned: true });
    expect(saved.status).toBe(200);
    const data = await roster(meeting);
    expect(data.camp.swimming_planned).toBe(true);
    expect(data.gaps).toContain('swimming_supervision');
    expect(data.blocking_gaps).not.toContain('swimming_supervision');
    expect((await call('patch', `/camp-rosters/${meeting}`, ids.reader).send({ swimming_planned: false })).status).toBe(403);
    expect((await call('patch', `/camp-rosters/${meeting}`, ids.outsider, ids.otherUnit).send({ swimming_planned: false })).status).toBe(404);
    await pool.query('UPDATE year_plan_meetings SET is_cancelled = TRUE WHERE id = $1', [meeting]);
    expect((await call('patch', `/camp-rosters/${meeting}`, ids.manager).send({ swimming_planned: false })).status).toBe(409);
    expect((await roster(meeting)).camp.swimming_planned).toBe(true);
  });
});
