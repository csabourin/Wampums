/**
 * An outing that replaces a meeting (#1327), on a disposable database: a one-day
 * outing with every youth, on a meeting's date, replaces that meeting. The meeting
 * stays in the planner, marked with the outing; the day's programme, the next
 * meeting and the action roster follow the outing; cancelling the outing either
 * brings the meeting back or leaves it cancelled, as the person chose.
 */
const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
require('./jest-conditional-helpers');
process.env.JWT_SECRET_KEY ||= 'fictional-meeting-replacement-integration';
const DATABASE_URL = process.env.TEST_DATABASE_URL;

const LEADER = [
  'meetings.view', 'meetings.manage', 'meetings.edit', 'activities.view', 'activities.create', 'activities.edit',
  'activities.delete', 'attendance.view',
];

describe.skipIf(!DATABASE_URL)('An outing that replaces a meeting', () => {
  let pool; let app;
  const ids = {}; const units = []; const users = []; const participants = [];
  const one = async (sql, params = []) => Object.values((await pool.query(sql, params)).rows[0] || {})[0];
  let day = 0;
  /** A fresh far-future Tuesday-ish date per test, so the tests never share a meeting. */
  const nextDate = () => {
    day += 7;
    const date = new Date(Date.UTC(2031, 0, 7 + day));
    return date.toISOString().slice(0, 10);
  };

  async function unit() {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const id = (await db.query("INSERT INTO organizations (name) VALUES ('Fictional Outing Unit') RETURNING id")).rows[0].id;
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
  async function member(unitId, keys, name) {
    const role = await one("INSERT INTO roles (role_name, display_name, data_scope, organization_id) VALUES ('outing_' || gen_random_uuid(), 'Leaders', 'organization', $1) RETURNING id", [unitId]);
    await pool.query('INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE permission_key = ANY($2::text[])', [role, keys]);
    const user = await one("INSERT INTO users (email, password, full_name) VALUES ('outing-' || gen_random_uuid() || '@example.test', 'x', $1) RETURNING id", [name]);
    users.push(user);
    await pool.query('INSERT INTO user_organizations (organization_id, user_id, role_ids) VALUES ($1, $2, $3)', [unitId, user, JSON.stringify([role])]);
    return user;
  }
  async function youth(name, status = 'active') {
    const id = await one("INSERT INTO participants (first_name, last_name) VALUES ($1, 'Fiction') RETURNING id", [name]);
    participants.push(id);
    await pool.query('INSERT INTO participant_enrollments (participant_id, organization_id, scout_year_id, status) VALUES ($1, $2, $3, $4)', [id, ids.unit, ids.year, status]);
    return id;
  }
  function meeting(date, extra = {}) {
    return one(`INSERT INTO year_plan_meetings (organization_id, meeting_date, theme, meeting_kind, start_time)
      VALUES ($1, $2, $3, $4, '18:30') RETURNING id`, [ids.unit, date, extra.theme || 'Fictional meeting', extra.kind || 'regular']);
  }
  function outing(date, { endDate = date, invitesEveryone = true, isCamp = false, name = 'Fictional museum outing' } = {}) {
    return one(`INSERT INTO activities (organization_id, created_by, name, activity_date, meeting_location_going,
      meeting_time_going, departure_time_going, activity_start_date, activity_start_time, activity_end_date, activity_end_time,
      invites_everyone, is_camp)
      VALUES ($1, $2, $3, $4, 'Hall', '09:00', '09:15', $4, '09:00', $5, '16:00', $6, $7) RETURNING id`,
    [ids.unit, ids.leader, name, date, endDate, invitesEveryone, isCamp]);
  }
  const slip = (activityId, participantId, date, status = 'pending') => pool.query(
    `INSERT INTO permission_slips (organization_id, participant_id, activity_id, meeting_date, status)
     VALUES ($1, $2, $3, $4, $5)`, [ids.unit, participantId, activityId, date, status]);
  const auth = (user = ids.leader, unitId = ids.unit) => ({ Authorization: `Bearer ${jwt.sign({ user_id: user, organizationId: unitId }, process.env.JWT_SECRET_KEY)}` });
  const api = (method, path, user, unitId) => request(app)[method](`/api/v1${path}`).set(auth(user, unitId));
  const replacedOn = (date) => {
    const { findReplacedMeetings } = require('../services/meetingReplacement');
    return findReplacedMeetings(pool, ids.unit, date, date);
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    ids.unit = await unit(); ids.otherUnit = await unit();
    ids.year = await one("INSERT INTO scout_years (organization_id, label, start_date, end_date, status) VALUES ($1, 'Current', '2030-09-01', '2031-08-31', 'active') RETURNING id", [ids.unit]);
    ids.leader = await member(ids.unit, LEADER, 'Ada Lovelace');
    ids.ada = await youth('Ada');
    ids.lea = await youth('Léa');
    // A youth who left the unit this year does not count among "every youth".
    ids.former = await youth('Former', 'left');
    const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() };
    app = express(); app.locals.pool = pool; app.use(express.json());
    app.use('/api/v1/activities', require('../routes/activities')(pool));
    app.use('/api/v1/meetings', require('../routes/meetings')(pool, logger));
    app.use('/api/v1/action-roster', require('../routes/action-roster')(pool));
    app.use('/api/v1/yearly-planner', require('../routes/yearlyPlanner')(pool, logger));
    app.use((err, _req, res, _next) => res.status(500).json({ success: false, message: 'internal_server_error' }));
  });

  afterAll(async () => {
    if (!pool) {return;}
    await pool.query('DELETE FROM permission_slips WHERE organization_id = ANY($1::int[])', [units]);
    await pool.query('DELETE FROM participant_enrollments WHERE organization_id = ANY($1::int[])', [units]);
    await pool.query('DELETE FROM year_plan_meetings WHERE organization_id = ANY($1::int[])', [units]);
    await pool.query('DELETE FROM scout_years WHERE organization_id = ANY($1::int[])', [units]);
    await pool.query('DELETE FROM organizations WHERE id = ANY($1::int[])', [units]);
    await pool.query('DELETE FROM participants WHERE id = ANY($1::int[])', [participants]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    await pool.end();
  });

  test('an outing without permission requests, on a meeting\'s date, replaces the meeting', async () => {
    const date = nextDate();
    const meetingId = await meeting(date);
    const activityId = await outing(date);

    expect(await replacedOn(date)).toEqual([{
      meeting_id: meetingId, meeting_date: date, activity_id: activityId, activity_name: 'Fictional museum outing',
    }]);
  });

  test('an outing with permission requests replaces the meeting only once every active youth has received one', async () => {
    const date = nextDate();
    await meeting(date);
    const activityId = await outing(date);
    await slip(activityId, ids.ada, date);

    // Léa has not received hers: the meeting stays.
    expect(await replacedOn(date)).toEqual([]);

    await slip(activityId, ids.lea, date, 'declined');
    expect((await replacedOn(date)).map((row) => row.activity_id)).toEqual([activityId]);
  });

  test('an outing for some youths, a camp, or an outing of several days does not replace a meeting', async () => {
    const date = nextDate();
    await meeting(date);
    await outing(date, { invitesEveryone: false, name: 'Fictional patrol outing' });
    await outing(date, { isCamp: true, name: 'Fictional camp' });
    const following = new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
    await outing(date, { endDate: following, name: 'Fictional weekend' });

    expect(await replacedOn(date)).toEqual([]);
  });

  test('the planner keeps the replaced meeting and names the outing replacing it', async () => {
    const date = nextDate();
    const meetingId = await meeting(date);
    const activityId = await outing(date, { name: 'Fictional zoo outing' });
    const planId = await one(`INSERT INTO year_plans (organization_id, title, start_date, end_date, created_by)
      VALUES ($1, 'Fictional plan', $2, $2, $3) RETURNING id`, [ids.unit, date, ids.leader]);
    await pool.query('UPDATE year_plan_meetings SET year_plan_id = $1 WHERE id = $2', [planId, meetingId]);

    const response = await api('get', `/yearly-planner/plans/${planId}`);

    expect(response.status).toBe(200);
    const listed = response.body.data.meetings.find((row) => row.id === meetingId);
    expect(listed).toMatchObject({ replaced_by_activity_id: activityId, replaced_by_activity_name: 'Fictional zoo outing', is_cancelled: false });
  });

  test('the day follows the outing: no meeting programme, and the roster no longer treats it as a meeting day', async () => {
    const date = nextDate();
    await meeting(date);
    await pool.query(`INSERT INTO year_plan_meeting_activities (organization_id, meeting_id, name, start_time, day_offset, sort_order)
      SELECT organization_id, id, 'Fictional game', '18:30', 0, 0 FROM year_plan_meetings WHERE organization_id = $1 AND meeting_date = $2`, [ids.unit, date]);
    const activityId = await outing(date);

    const programme = await api('get', `/meetings/programme?date=${date}`);
    expect(programme.status).toBe(200);
    expect(programme.body.data).toBeNull();

    const roster = await api('get', `/action-roster?date=${date}`);
    expect(roster.status).toBe(200);
    expect(roster.body.data.meeting_dates).not.toContain(date);
    expect(roster.body.data.activities.map((row) => row.id)).toContain(activityId);

    // The meeting's lines are kept.
    expect(await one(`SELECT COUNT(*)::int FROM year_plan_meeting_activities l JOIN year_plan_meetings m ON m.id = l.meeting_id
      WHERE m.organization_id = $1 AND m.meeting_date = $2`, [ids.unit, date])).toBe(1);
  });

  test('the outing says which meeting it replaces in the list of activities', async () => {
    const date = nextDate();
    const meetingId = await meeting(date);
    const activityId = await outing(date);

    const response = await api('get', '/activities');

    expect(response.status).toBe(200);
    const listed = response.body.data.find((row) => row.id === activityId);
    expect(listed).toMatchObject({ replaces_meeting_id: meetingId, replaces_meeting_date: date });
  });

  test('cancelling the outing brings the meeting back by default', async () => {
    const date = nextDate();
    const meetingId = await meeting(date);
    const activityId = await outing(date);

    const response = await api('delete', `/activities/${activityId}`);

    expect(response.status).toBe(200);
    expect(response.body.data.replaced_meeting).toEqual({ id: meetingId, date, restored: true });
    expect(await one('SELECT is_cancelled FROM year_plan_meetings WHERE id = $1', [meetingId])).toBe(false);
    expect(await replacedOn(date)).toEqual([]);
  });

  test('cancelling the outing without restoring the meeting leaves the meeting cancelled, and changes nothing else of it', async () => {
    const date = nextDate();
    const meetingId = await meeting(date, { theme: 'Fictional kept theme' });
    const activityId = await outing(date);
    await slip(activityId, ids.ada, date);
    await slip(activityId, ids.lea, date);

    const response = await api('delete', `/activities/${activityId}?restore_meeting=false`);

    expect(response.status).toBe(200);
    expect(response.body.data.replaced_meeting).toEqual({ id: meetingId, date, restored: false });
    const row = (await pool.query('SELECT is_cancelled, theme, meeting_kind FROM year_plan_meetings WHERE id = $1', [meetingId])).rows[0];
    expect(row).toEqual({ is_cancelled: true, theme: 'Fictional kept theme', meeting_kind: 'regular' });
  });

  test('keeping the meeting cancelled takes the right to cancel meetings: without it, nothing is deleted', async () => {
    const date = nextDate();
    const meetingId = await meeting(date);
    const activityId = await outing(date);
    const deleter = await member(ids.unit, ['activities.view', 'activities.delete'], 'Grace Hopper');

    const refused = await api('delete', `/activities/${activityId}?restore_meeting=false`, deleter);
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ required: expect.arrayContaining(['meetings.edit']), missing: ['meetings.edit'] });
    expect(await one('SELECT is_active FROM activities WHERE id = $1', [activityId])).toBe(true);
    expect(await one('SELECT is_cancelled FROM year_plan_meetings WHERE id = $1', [meetingId])).toBe(false);

    // Without asking to keep it cancelled, deleting the outing needs only its own right; the meeting comes back.
    const allowed = await api('delete', `/activities/${activityId}`, deleter);
    expect(allowed.status).toBe(200);
    expect(allowed.body.data.replaced_meeting).toEqual({ id: meetingId, date, restored: true });
  });

  test('the roster names the outing a replaced date follows, even beside another activity', async () => {
    const date = nextDate();
    await meeting(date);
    const activityId = await outing(date);
    await outing(date, { invitesEveryone: false, name: 'Fictional patrol errand' });

    const roster = await api('get', `/action-roster?date=${date}`);

    expect(roster.status).toBe(200);
    expect(roster.body.data.activities).toHaveLength(2);
    expect(roster.body.data.replacing_activities).toEqual({ [date]: activityId });
  });

  test('cancelling an outing that replaced nothing touches no meeting, whatever is asked', async () => {
    const date = nextDate();
    const meetingId = await meeting(date);
    const activityId = await outing(date, { invitesEveryone: false });

    const response = await api('delete', `/activities/${activityId}?restore_meeting=false`);

    expect(response.status).toBe(200);
    expect(response.body.data.replaced_meeting).toBeNull();
    expect(await one('SELECT is_cancelled FROM year_plan_meetings WHERE id = $1', [meetingId])).toBe(false);
  });

  test('another unit\'s outing never replaces this unit\'s meeting', async () => {
    const date = nextDate();
    await meeting(date);
    await pool.query(`INSERT INTO activities (organization_id, created_by, name, activity_date, meeting_location_going,
      meeting_time_going, departure_time_going, activity_start_date, activity_start_time, activity_end_date, activity_end_time)
      VALUES ($1, $2, 'Foreign outing', $3, 'Hall', '09:00', '09:15', $3, '09:00', $3, '16:00')`, [ids.otherUnit, ids.leader, date]);

    expect(await replacedOn(date)).toEqual([]);
  });

  test('the next meeting skips a meeting an outing replaces', async () => {
    const quietUnit = await unit();
    const leader = await member(quietUnit, LEADER, 'Léa Tremblay');
    await pool.query("INSERT INTO scout_years (organization_id, label, start_date, end_date, status) VALUES ($1, 'Current', '2030-09-01', '2031-08-31', 'active')", [quietUnit]);
    const insertMeeting = (date) => pool.query(`INSERT INTO year_plan_meetings (organization_id, meeting_date, theme, meeting_kind)
      VALUES ($1, $2, 'Fictional meeting', 'regular')`, [quietUnit, date]);
    await insertMeeting('2032-03-02');
    await insertMeeting('2032-03-09');
    await pool.query(`INSERT INTO activities (organization_id, created_by, name, activity_date, meeting_location_going,
      meeting_time_going, departure_time_going, activity_start_date, activity_start_time, activity_end_date, activity_end_time)
      VALUES ($1, $2, 'Fictional sugar shack', '2032-03-02', 'Hall', '09:00', '09:15', '2032-03-02', '09:00', '2032-03-02', '16:00')`,
    [quietUnit, leader]);

    const response = await api('get', '/meetings/next', leader, quietUnit);

    expect(response.status).toBe(200);
    expect(response.body.data.date).toBe('2032-03-09');
  });

  test('if many consecutive dates are replaced, the next meeting is found beyond the first candidate window', async () => {
    const quietUnit = await unit();
    const leader = await member(quietUnit, LEADER, 'Léa Tremblay');
    await pool.query("INSERT INTO scout_years (organization_id, label, start_date, end_date, status) VALUES ($1, 'Current', '2030-09-01', '2031-08-31', 'active')", [quietUnit]);
    const insertMeeting = (date) => pool.query(`INSERT INTO year_plan_meetings (organization_id, meeting_date, theme, meeting_kind)
      VALUES ($1, $2, 'Fictional meeting', 'regular')`, [quietUnit, date]);
    const dates = ['2032-03-02', '2032-03-09', '2032-03-16', '2032-03-23', '2032-03-30', '2032-04-06', '2032-04-13', '2032-04-20', '2032-04-27', '2032-05-04'];
    await Promise.all(dates.map(insertMeeting));
    await Promise.all(dates.slice(0, 9).map((date) => pool.query(`INSERT INTO activities (organization_id, created_by, name, activity_date, meeting_location_going,
        meeting_time_going, departure_time_going, activity_start_date, activity_start_time, activity_end_date, activity_end_time)
        VALUES ($1, $2, 'Fictional replaced outing', $3, 'Hall', '09:00', '09:15', $3, '09:00', $3, '16:00')`,
    [quietUnit, leader, date])));

    const response = await api('get', '/meetings/next', leader, quietUnit);

    expect(response.status).toBe(200);
    expect(response.body.data.date).toBe('2032-05-04');
  });
});
