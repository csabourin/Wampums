/** Personal contacts, health access and volunteer ages against a migrated PostgreSQL. All fixtures are invented. */
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('./jest-conditional-helpers');
const { saveOwnForm, readOwnProfile } = require('../services/memberProfile');
const { signUp, saveShift } = require('../services/volunteerShifts');
const { saveTeamMember } = require('../services/campRoster');
process.env.JWT_SECRET_KEY ||= 'fictional-member-profile-integration';
const URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!URL)('personal profiles and consent', () => {
  let pool; let app;
  const units = []; const users = []; const ids = {};
  const one = async (sql, args = []) => Object.values((await pool.query(sql, args)).rows[0])[0];
  async function unit() {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const id = (await db.query("INSERT INTO organizations (name) VALUES ('Fictional Profile Unit') RETURNING id")).rows[0].id;
      await db.query("INSERT INTO organization_program_sections (organization_id, section_key, display_name) VALUES ($1, 'general', 'General')", [id]);
      await db.query('COMMIT'); units.push(id); return id;
    } finally { db.release(); }
  }
  async function member(unitId, roleName, birth = '1980-01-01') {
    const user = await one(`INSERT INTO users (email, password, full_name, date_of_birth)
      VALUES ('profile-' || gen_random_uuid() || '@example.test', 'x', 'Fictional Adult', $1) RETURNING id`, [birth]);
    users.push(user);
    await pool.query(`INSERT INTO user_organizations (organization_id, user_id, role_ids, status)
      SELECT $1, $2, jsonb_build_array(id), 'active' FROM roles WHERE role_name = $3 AND organization_id IS NULL`, [unitId, user, roleName]);
    return user;
  }
  async function camp(unitId, creator, offset = 3) {
    const activity = await one(`INSERT INTO activities (organization_id, created_by, name, activity_date, meeting_location_going,
      meeting_time_going, departure_time_going, activity_start_date, activity_start_time, activity_end_date, activity_end_time, is_camp)
      VALUES ($1, $2, 'Fictional Profile Camp', CURRENT_DATE + $3::int, 'Hall', '09:00', '09:15', CURRENT_DATE + $3::int, '09:00', CURRENT_DATE + $3::int + 2, '16:00', TRUE) RETURNING id`, [unitId, creator, offset]);
    const meeting = await one(`INSERT INTO year_plan_meetings (organization_id, meeting_date, theme, meeting_kind, activity_id)
      VALUES ($1, CURRENT_DATE + $3::int, 'Fictional Profile Camp', 'camp', $2) RETURNING id`, [unitId, activity, offset]);
    return { activity, meeting };
  }
  const call = (method, endpoint, user = ids.owner, unitId = ids.unit) => request(app)[method](`/api/v1/${endpoint}`)
    .set('Authorization', `Bearer ${jwt.sign({ user_id: user, organizationId: unitId }, process.env.JWT_SECRET_KEY)}`);
  const consent = (share, user = ids.owner, unitId = ids.unit) => saveOwnForm(pool, unitId, user, {
    phone: '555-0100', emergency_contact_name: 'Private Emergency Contact', emergency_contact_phone: '555-0199', share_camp_contacts: share,
  });
  const contacts = (campId, user = ids.peer, unitId = ids.unit) => call('get', `volunteer-space/camps/${campId}/contacts`, user, unitId);

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL });
    ids.unit = await unit(); ids.other = await unit();
    ids.manager = await member(ids.unit, 'district'); ids.owner = await member(ids.unit, 'volunteer');
    ids.peer = await member(ids.unit, 'volunteer'); ids.unrelated = await member(ids.unit, 'volunteer');
    ids.outsider = await member(ids.other, 'district');
    await pool.query(`INSERT INTO user_organizations (organization_id, user_id, role_ids, status)
      SELECT $1, $2, jsonb_build_array(id), 'active' FROM roles WHERE role_name = 'volunteer' AND organization_id IS NULL`, [ids.other, ids.owner]);
    ids.camp = await camp(ids.unit, ids.manager); ids.otherCamp = await camp(ids.unit, ids.manager, 10); ids.foreignCamp = await camp(ids.other, ids.outsider);
    for (const user of [ids.owner, ids.peer]) {
      // eslint-disable-next-line no-await-in-loop -- fixture members
      await saveTeamMember(pool, ids.unit, ids.manager, ids.camp.meeting, user, { team_role: 'leader' });
    }
    await saveTeamMember(pool, ids.unit, ids.manager, ids.otherCamp.meeting, ids.unrelated, { team_role: 'leader' });
    app = express(); app.locals.pool = pool; app.use(express.json());
    app.use('/api/v1/member-profile', require('../routes/member-profile')(pool));
    app.use('/api/v1/volunteer-space', require('../routes/volunteer-space')(pool));
    app.use('/api/v1/camp-rosters', require('../routes/camp-rosters')(pool));
    app.use((err, _req, res, _next) => res.status(500).json({ success: false, message: 'internal_server_error' }));
  });
  afterAll(async () => {
    if (!pool) { return; }
    await pool.query('DELETE FROM organizations WHERE id = ANY($1::int[])', [units]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    await pool.end();
  });

  test('migration is rerunnable and existing members share nothing by default', async () => {
    await pool.query(fs.readFileSync(path.join(__dirname, '../migrations/076_member_profile.sql'), 'utf8'));
    expect((await call('get', 'member-profile/me')).body.data.share_camp_contacts).toBe(false);
    expect((await contacts(ids.camp.activity)).body.data).toEqual([]);
  });
  test('a form belongs to the account across units and a submitted target id cannot change another account', async () => {
    const response = await call('put', 'member-profile/me').send({ user_id: ids.peer, phone: '555-0100', share_camp_contacts: false });
    expect(response.status).toBe(200);
    expect((await readOwnProfile(pool, ids.other, ids.owner)).phone).toBe('555-0100');
    expect((await readOwnProfile(pool, ids.unit, ids.peer)).phone).toBeNull();
    expect((await call('put', `member-profile/${ids.peer}`).send({})).status).toBe(404);
  });
  test('only consenting adults at the same camp appear, without emergency or health information', async () => {
    await consent(true); await consent(true, ids.unrelated);
    const response = await contacts(ids.camp.activity);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.data).toEqual([expect.objectContaining({ user_id: ids.owner, phone: '555-0100' })]);
    expect(JSON.stringify(response.body)).not.toContain('Private Emergency Contact');
    expect(JSON.stringify(response.body)).not.toContain('555-0199');
    expect((await contacts(ids.camp.activity, ids.unrelated)).status).toBe(404);
    expect((await contacts(ids.foreignCamp.activity)).status).toBe(404);
  });
  test('revoking consent removes the phone on the next read', async () => {
    await consent(false);
    expect((await contacts(ids.camp.activity)).body.data).toEqual([]);
  });
  test('a departure hides contacts and health information without deleting the personal profile', async () => {
    await consent(true);
    await saveOwnForm(pool, ids.unit, ids.owner, { health_conditions: 'Private health condition' }, true);
    await pool.query("UPDATE user_organizations SET status = 'inactive' WHERE user_id = $1 AND organization_id = $2", [ids.owner, ids.unit]);
    expect((await contacts(ids.camp.activity)).body.data).toEqual([]);
    const roster = await call('get', `camp-rosters/${ids.camp.meeting}`, ids.manager);
    expect(roster.status).toBe(200);
    expect(roster.body.data.adult_health_forms.some((p) => p.user_id === ids.owner)).toBe(false);
    expect((await call('get', 'member-profile/me')).status).toBe(403);
    expect((await readOwnProfile(pool, ids.other, ids.owner)).phone).toBe('555-0100');
    await pool.query("UPDATE user_organizations SET status = 'active' WHERE user_id = $1 AND organization_id = $2", [ids.owner, ids.unit]);
  });
  test('camp health readers see only active team members; a volunteer receives no team health information', async () => {
    await saveOwnForm(pool, ids.unit, ids.owner, { health_conditions: 'Private health condition' }, true);
    const own = await call('get', 'member-profile/me/health');
    expect(own.body.data.health_conditions).toBe('Private health condition');
    const roster = await call('get', `camp-rosters/${ids.camp.meeting}`, ids.manager);
    expect(roster.body.data.adult_health_forms).toEqual(expect.arrayContaining([expect.objectContaining({ user_id: ids.owner, health_conditions: 'Private health condition', emergency_contact_phone: '555-0199' })]));
    expect((await call('get', `camp-rosters/${ids.camp.meeting}`, ids.peer)).status).toBe(403);
    expect(JSON.stringify((await contacts(ids.camp.activity)).body)).not.toContain('Private health condition');
  });
  test('minors and unknown ages neither disclose nor receive peer contacts', async () => {
    await consent(true);
    await pool.query("UPDATE users SET date_of_birth = (CURRENT_DATE - interval '16 years')::date WHERE id = $1", [ids.owner]);
    expect((await contacts(ids.camp.activity)).body.data).toEqual([]);
    expect((await contacts(ids.camp.activity, ids.owner)).body.data).toEqual([]);
    await pool.query('UPDATE users SET date_of_birth = NULL WHERE id = $1', [ids.owner]);
    expect((await contacts(ids.camp.activity)).body.data).toEqual([]);
  });
  test('a known under-14 account cannot take a shift or join the team; the fourteenth birthday is accepted', async () => {
    const young = await member(ids.unit, 'volunteer');
    const shift = await saveShift(pool, ids.unit, ids.manager, { activity_id: ids.camp.activity, volunteer_type: 'cook', shift_date: await one('SELECT (CURRENT_DATE + 3)::text'), start_time: '12:00', end_time: '13:00', slots: 2, title: '', notes: '' });
    await pool.query("UPDATE users SET date_of_birth = (CURRENT_DATE - interval '14 years' + interval '1 day')::date WHERE id = $1", [young]);
    await expect(signUp(pool, ids.unit, shift.id, young)).rejects.toMatchObject({ message: 'member_profile_volunteer_too_young' });
    await expect(saveTeamMember(pool, ids.unit, ids.manager, ids.camp.meeting, young, { team_role: 'camp_aide' })).rejects.toMatchObject({ message: 'member_profile_volunteer_too_young' });
    await pool.query("UPDATE users SET date_of_birth = (CURRENT_DATE - interval '14 years')::date WHERE id = $1", [young]);
    await expect(signUp(pool, ids.unit, shift.id, young)).resolves.toMatchObject({ created: true });
    await expect(saveTeamMember(pool, ids.unit, ids.manager, ids.camp.meeting, young, { team_role: 'camp_aide' })).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ user_id: young })]));
  });

  test('a manager can clear an erroneous under-age birth date, while omission still refuses the stored under-age date', async () => {
    const person = await member(ids.unit, 'volunteer');
    await pool.query("UPDATE users SET date_of_birth = (CURRENT_DATE - interval '13 years')::date WHERE id = $1", [person]);
    await expect(saveTeamMember(pool, ids.unit, ids.manager, ids.camp.meeting, person, { team_role: 'camp_aide' }))
      .rejects.toMatchObject({ message: 'member_profile_volunteer_too_young' });
    await expect(saveTeamMember(pool, ids.unit, ids.manager, ids.camp.meeting, person, { team_role: 'camp_aide', date_of_birth: null }))
      .resolves.toEqual(expect.arrayContaining([expect.objectContaining({ user_id: person, age_status: 'unknown', date_of_birth: null })]));
    expect(await one('SELECT date_of_birth FROM users WHERE id = $1', [person])).toBeNull();
  });

});
