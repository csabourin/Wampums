'use strict';

/**
 * Not every activity invites the whole unit: a fall camp may be offered only
 * to the children aged 10 and over who have never been. Only invited children
 * appear in the activity's carpool lists, can be seated in one of its cars, or
 * receive one of its permission slips. Narrowing the invitation frees the
 * seats of children no longer invited and archives their unanswered slips,
 * while a slip a guardian already answered stays as the record of that answer.
 */

const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');
const { randomUUID } = require('crypto');
require('./jest-conditional-helpers');
process.env.JWT_SECRET_KEY ||= 'activity-invitations-integration-secret';

const { signJWTToken } = require('../utils/jwt-config');
const { grantParticipantAccess, ACCESS_SOURCE } = require('../services/participantAccess');

const DATABASE_URL = process.env.TEST_DATABASE_URL;

// No email leaves a test; the update notice's recipients are read from sendEmail.
jest.mock('../utils/index', () => ({
  ...jest.requireActual('../utils/index'),
  sendEmail: jest.fn().mockResolvedValue(true),
}));
const { sendEmail } = require('../utils/index');

jest.mock('../utils/carpool-notifications', () => ({
  sendRideCancellationNotifications: jest.fn().mockResolvedValue(undefined),
  sendActivityUpdateNotifications: jest.fn().mockResolvedValue(undefined),
  sendActivityCancellationNotifications: jest.fn().mockResolvedValue(undefined),
}));

describe.skipIf(!DATABASE_URL)('Activities for some participants', () => {
  let pool;
  let app;
  const ids = {};

  const ACTIVITY = {
    activity_name: 'Fall camp',
    activity_start_date: '2026-10-24',
    activity_start_time: '08:00',
    activity_end_date: '2026-10-25',
    activity_end_time: '16:00',
    meeting_location_going: 'Hall',
    meeting_time_going: '08:00',
    departure_time_going: '08:30',
  };

  async function one(sql, params = []) {
    const result = await pool.query(sql, params);
    return Object.values(result.rows[0] || {})[0];
  }

  async function role(keys, scope) {
    const id = await one('INSERT INTO roles (role_name, display_name, data_scope) VALUES ($1, $1, $2) RETURNING id',
      [`invite_${randomUUID()}`, scope]);
    await pool.query('INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE permission_key = ANY($2::text[])',
      [id, keys]);
    return id;
  }

  async function member(roleId, name, unit = ids.unit) {
    const id = await one('INSERT INTO users (email, password, full_name) VALUES ($1, \'x\', $2) RETURNING id',
      [`${randomUUID()}@example.test`, name]);
    await pool.query("INSERT INTO user_organizations (user_id, organization_id, role_ids, status) VALUES ($1, $2, $3::jsonb, 'active')",
      [id, unit, JSON.stringify([roleId])]);
    return id;
  }

  async function child(firstName, unit = ids.unit) {
    const id = await one("INSERT INTO participants (first_name, last_name, date_naissance) VALUES ($1, 'Invite', '2015-01-01') RETURNING id",
      [firstName]);
    await pool.query(`INSERT INTO participant_enrollments (participant_id, organization_id, scout_year_id)
      SELECT $1, $2, id FROM scout_years WHERE organization_id = $2 AND status = 'active'`, [id, unit]);
    return id;
  }

  async function unit(name) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const id = (await client.query('INSERT INTO organizations (name) VALUES ($1) RETURNING id', [name])).rows[0].id;
      await client.query("INSERT INTO organization_program_sections (organization_id, section_key, display_name) VALUES ($1, 'general', 'General')", [id]);
      await client.query('COMMIT');
      await pool.query("INSERT INTO scout_years (organization_id, label, start_date, end_date, status) VALUES ($1, '2026-2027', '2026-09-01', '2027-08-31', 'active')", [id]);
      return id;
    } finally {
      client.release();
    }
  }

  function auth(userId) {
    // The JWT claims everything; only the database may grant keys and scope.
    return `Bearer ${signJWTToken({ user_id: userId, organizationId: ids.unit, roleNames: ['district'], permissions: ['activities.edit'] })}`;
  }

  const call = (method, path, userId) => request(app)[method](path).set('Authorization', auth(userId));
  const names = (rows) => rows.map((row) => row.first_name).sort();

  function offer(driverId, activityId) {
    return one(`INSERT INTO carpool_offers (activity_id, user_id, organization_id, vehicle_make, vehicle_color,
        total_seats_available, trip_direction)
      VALUES ($1, $2, $3, 'Car', 'Blue', 4, 'both') RETURNING id`, [activityId, driverId, ids.unit]);
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    ids.unit = await unit('Invitations unit');
    ids.otherUnit = await unit('Invitations other unit');

    const staffRole = await role(['activities.view', 'activities.create', 'activities.edit', 'carpools.view',
      'carpools.manage', 'participants.view'], 'organization');
    const familyRole = await role(['activities.view', 'carpools.view'], 'linked');
    ids.staff = await member(staffRole, 'Staff Member');
    ids.family = await member(familyRole, 'Family Driver');
    ids.older = await child('Older');
    ids.veteran = await child('Veteran');
    ids.younger = await child('Younger');
    ids.elsewhere = await child('Elsewhere', ids.otherUnit);
    await grantParticipantAccess(pool, { participantId: ids.younger, userId: ids.family, sourceType: ACCESS_SOURCE.DIRECT });

    app = express();
    app.use(express.json());
    app.locals.pool = pool;
    app.use('/api/v1/activities', require('../routes/activities')(pool));
    app.use('/api/v1/carpools', require('../routes/carpools')(pool));
    app.use('/api/v1/resources', require('../routes/resources')(pool));
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    app.use('/api/v1/offline', require('../routes/offline')(pool, logger));
  });

  afterAll(async () => {
    if (!pool) {return;}
    await pool.query('DELETE FROM permission_slips WHERE organization_id = $1', [ids.unit]);
    await pool.query('DELETE FROM carpool_assignments WHERE organization_id = $1', [ids.unit]);
    await pool.query('DELETE FROM carpool_offers WHERE organization_id = $1', [ids.unit]);
    await pool.query('DELETE FROM activities WHERE organization_id = $1', [ids.unit]);
    await pool.end();
  });

  test('a new activity invites the whole unit unless told otherwise', async () => {
    const response = await call('post', '/api/v1/activities', ids.staff).send(ACTIVITY);
    expect(response.status).toBe(201);
    expect(response.body.data.invites_everyone).toBe(true);

    const roster = await call('get', `/api/v1/activities/${response.body.data.id}/participants`, ids.staff);
    expect(names(roster.body.data)).toEqual(['Older', 'Veteran', 'Younger']);
  });

  test('an activity may invite only some participants', async () => {
    const response = await call('post', '/api/v1/activities', ids.staff)
      .send({ ...ACTIVITY, invites_everyone: false, invited_participant_ids: [ids.older, ids.veteran] });
    expect(response.status).toBe(201);
    ids.camp = response.body.data.id;

    const details = await call('get', `/api/v1/activities/${ids.camp}`, ids.staff);
    expect(details.body.data.invites_everyone).toBe(false);
    expect(details.body.data.invited_participant_ids).toEqual([ids.older, ids.veteran].sort((a, b) => a - b));

    const list = await call('get', '/api/v1/activities', ids.staff);
    const camp = list.body.data.find((row) => row.id === ids.camp);
    expect(Number(camp.invited_count)).toBe(2);
  });

  test('the offline bundle tells camp mode who is invited', async () => {
    const response = await call('post', '/api/v1/offline/prepare-activity', ids.staff)
      .send({ activity_id: ids.camp, start_date: '2026-10-24', end_date: '2026-10-25' });
    expect(response.status).toBe(200);
    expect(response.body.data.activity.invites_everyone).toBe(false);
    expect(response.body.data.activity.invited_participant_ids).toEqual([ids.older, ids.veteran].sort((a, b) => a - b));
  });

  test('the offline bundle hides the invited list from view-only unit roles', async () => {
    const viewerRole = await role(['activities.view', 'participants.view'], 'organization');
    const viewer = await member(viewerRole, 'Viewer Only');
    const response = await call('post', '/api/v1/offline/prepare-activity', viewer)
      .send({ activity_id: ids.camp, start_date: '2026-10-24', end_date: '2026-10-25' });
    expect(response.status).toBe(200);
    expect(response.body.data.activity.invites_everyone).toBe(false);
    expect(response.body.data.activity.invited_participant_ids).toBeNull();
  });

  test('a family does not receive the list of invited children', async () => {
    const details = await call('get', `/api/v1/activities/${ids.camp}`, ids.family);
    expect(details.status).toBe(200);
    expect(details.body.data.invited_participant_ids).toBeUndefined();
  });

  test('only invited children appear in its carpool lists', async () => {
    const roster = await call('get', `/api/v1/activities/${ids.camp}/participants`, ids.staff);
    expect(names(roster.body.data)).toEqual(['Older', 'Veteran']);
    const unassigned = await call('get', `/api/v1/carpools/activity/${ids.camp}/unassigned`, ids.staff);
    expect(names(unassigned.body.data)).toEqual(['Older', 'Veteran']);

    // A family whose child is not invited has no child to seat
    const familyRoster = await call('get', `/api/v1/activities/${ids.camp}/participants`, ids.family);
    expect(familyRoster.body.data).toEqual([]);
  });

  test('a child who is not invited cannot be seated in one of its cars', async () => {
    ids.car = await offer(ids.staff, ids.camp);
    const refused = await call('post', '/api/v1/carpools/assignments', ids.staff)
      .send({ carpool_offer_id: ids.car, participant_id: ids.younger, trip_direction: 'both' });
    expect(refused.status).toBe(400);
    expect(refused.body.message).toMatch(/not invited/i);

    const seated = await call('post', '/api/v1/carpools/assignments', ids.staff)
      .send({ carpool_offer_id: ids.car, participant_id: ids.veteran, trip_direction: 'both' });
    expect(seated.status).toBe(201);
  });

  test('a child who is not invited cannot receive one of its permission slips', async () => {
    const refused = await call('post', '/api/v1/resources/permission-slips', ids.staff)
      .send({ activity_id: ids.camp, participant_ids: [ids.older, ids.younger] });
    expect(refused.status).toBe(400);
    expect(refused.body.errors).toEqual([{ field: 'participant_ids', value: [ids.younger] }]);
    expect(await one('SELECT COUNT(*)::int FROM permission_slips WHERE activity_id = $1', [ids.camp])).toBe(0);

    const issued = await call('post', '/api/v1/resources/permission-slips', ids.staff)
      .send({ activity_id: ids.camp, participant_ids: [ids.older, ids.veteran] });
    expect(issued.status).toBe(201);
    expect(issued.body.data.count).toBe(2);
  });

  test('a child from another unit cannot be invited', async () => {
    const response = await call('put', `/api/v1/activities/${ids.camp}`, ids.staff)
      .send({ invites_everyone: false, invited_participant_ids: [ids.older, ids.elsewhere] });
    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual([{ field: 'invited_participant_ids', value: [ids.elsewhere] }]);
    // Nothing changed
    const details = await call('get', `/api/v1/activities/${ids.camp}`, ids.staff);
    expect(details.body.data.invited_participant_ids).toHaveLength(2);
  });

  test('an empty or malformed list is refused', async () => {
    const empty = await call('put', `/api/v1/activities/${ids.camp}`, ids.staff)
      .send({ invites_everyone: false, invited_participant_ids: [] });
    expect(empty.status).toBe(400);
    const malformed = await call('post', '/api/v1/activities', ids.staff)
      .send({ ...ACTIVITY, invites_everyone: false, invited_participant_ids: ['abc'] });
    expect(malformed.status).toBe(400);
    const outOfRange = await call('post', '/api/v1/activities', ids.staff)
      .send({ ...ACTIVITY, invites_everyone: false, invited_participant_ids: [2147483648] });
    expect(outOfRange.status).toBe(400);
    // An unclear mode never falls back to inviting the whole unit
    const unclear = await Promise.all([null, '', 'False', {}].map((mode) =>
      call('put', `/api/v1/activities/${ids.camp}`, ids.staff).send({ invites_everyone: mode })));
    expect(unclear.map((response) => response.status)).toEqual([400, 400, 400, 400]);
    const details = await call('get', `/api/v1/activities/${ids.camp}`, ids.staff);
    expect(details.body.data.invites_everyone).toBe(false);
  });

  test('narrowing the invitation frees seats and archives unanswered slips, keeping answered ones', async () => {
    // The veteran's guardian already signed; the older child's slip is unanswered
    await pool.query("UPDATE permission_slips SET status = 'signed', signed_at = NOW() WHERE activity_id = $1 AND participant_id = $2",
      [ids.camp, ids.veteran]);
    await call('put', `/api/v1/activities/${ids.camp}`, ids.staff)
      .send({ invites_everyone: false, invited_participant_ids: [ids.veteran, ids.older] });
    await pool.query(`INSERT INTO carpool_assignments (carpool_offer_id, participant_id, assigned_by, organization_id, trip_direction)
      VALUES ($1, $2, $3, $4, 'both')`, [ids.car, ids.older, ids.staff, ids.unit]);

    // Only the veteran is still invited... then neither the older child
    const response = await call('put', `/api/v1/activities/${ids.camp}`, ids.staff)
      .send({ invites_everyone: false, invited_participant_ids: [ids.veteran] });
    expect(response.status).toBe(200);
    expect(response.body.data.invited_count).toBe(1);
    expect(response.body.data.uninvited_carpool_assignments_removed).toBe(1);
    expect(response.body.data.uninvited_permission_slips_archived).toBe(1);

    const slips = await pool.query('SELECT participant_id, status FROM permission_slips WHERE activity_id = $1 ORDER BY participant_id',
      [ids.camp]);
    expect(slips.rows).toEqual(expect.arrayContaining([
      { participant_id: ids.older, status: 'archived' },
      { participant_id: ids.veteran, status: 'signed' },
    ]));
    const seated = await pool.query('SELECT participant_id FROM carpool_assignments WHERE carpool_offer_id = $1', [ids.car]);
    expect(seated.rows.map((row) => row.participant_id)).toEqual([ids.veteran]);
  });

  test('an edit that does not mention the invitation leaves it as it is', async () => {
    const response = await call('put', `/api/v1/activities/${ids.camp}`, ids.staff).send({ description: 'Bring a sleeping bag' });
    expect(response.status).toBe(200);
    const details = await call('get', `/api/v1/activities/${ids.camp}`, ids.staff);
    expect(details.body.data.invites_everyone).toBe(false);
    expect(details.body.data.invited_participant_ids).toEqual([ids.veteran]);
  });

  test('a child who left the active scout year keeps their invitation when the list is saved again', async () => {
    await pool.query("UPDATE participant_enrollments SET status = 'left' WHERE participant_id = $1 AND organization_id = $2",
      [ids.veteran, ids.unit]);
    try {
      const resaved = await call('put', `/api/v1/activities/${ids.camp}`, ids.staff)
        .send({ invites_everyone: false, invited_participant_ids: [ids.veteran, ids.older] });
      expect(resaved.status).toBe(200);
      expect(resaved.body.data.invited_participant_ids).toEqual([ids.veteran, ids.older]);
    } finally {
      await pool.query("UPDATE participant_enrollments SET status = 'active' WHERE participant_id = $1 AND organization_id = $2",
        [ids.veteran, ids.unit]);
    }
  });

  test('the update notice reaches only guardians of children still invited', async () => {
    const { sendActivityUpdateNotifications } = jest.requireActual('../utils/carpool-notifications');
    const familyEmail = await one('SELECT email FROM users WHERE id = $1', [ids.family]);
    await grantParticipantAccess(pool, { participantId: ids.older, userId: ids.family, sourceType: ACCESS_SOURCE.DIRECT });
    // The older child's guardian signed, then the older child was uninvited
    await pool.query("UPDATE permission_slips SET status = 'signed', signed_at = NOW() WHERE activity_id = $1 AND participant_id = $2",
      [ids.camp, ids.older]);
    await call('put', `/api/v1/activities/${ids.camp}`, ids.staff)
      .send({ invites_everyone: false, invited_participant_ids: [ids.veteran] });

    sendEmail.mockClear();
    await sendActivityUpdateNotifications(pool, ids.camp, ids.unit);
    const recipients = sendEmail.mock.calls.map(([to]) => to);
    expect(recipients.length).toBeGreaterThan(0);
    expect(recipients).not.toContain(familyEmail);

    // Invited again, the same signed slip brings the guardian back
    await call('put', `/api/v1/activities/${ids.camp}`, ids.staff)
      .send({ invites_everyone: false, invited_participant_ids: [ids.veteran, ids.older] });
    sendEmail.mockClear();
    await sendActivityUpdateNotifications(pool, ids.camp, ids.unit);
    expect(sendEmail.mock.calls.map(([to]) => to)).toContain(familyEmail);
  });

  test('the update notice reaches the guardians of a newly invited child', async () => {
    const { sendActivityUpdateNotifications } = jest.requireActual('../utils/carpool-notifications');
    const familyEmail = await one('SELECT email FROM users WHERE id = $1', [ids.family]);
    // The younger child has no slip and no ride: only the invitation links them
    await call('put', `/api/v1/activities/${ids.camp}`, ids.staff)
      .send({ invites_everyone: false, invited_participant_ids: [ids.veteran, ids.younger] });
    await pool.query("UPDATE permission_slips SET status = 'archived' WHERE activity_id = $1 AND participant_id = $2",
      [ids.camp, ids.older]);

    sendEmail.mockClear();
    await sendActivityUpdateNotifications(pool, ids.camp, ids.unit);
    expect(sendEmail.mock.calls.map(([to]) => to)).toContain(familyEmail);
  });

  test('inviting everyone again opens the activity to the whole unit', async () => {
    const response = await call('put', `/api/v1/activities/${ids.camp}`, ids.staff).send({ invites_everyone: true });
    expect(response.status).toBe(200);
    expect(await one('SELECT COUNT(*)::int FROM activity_invitees WHERE activity_id = $1', [ids.camp])).toBe(0);
    const roster = await call('get', `/api/v1/activities/${ids.camp}/participants`, ids.staff);
    expect(names(roster.body.data)).toEqual(['Older', 'Veteran', 'Younger']);
  });

  test('opening an activity to the whole unit notifies every family it newly concerns', async () => {
    const { sendActivityUpdateNotifications } = jest.requireActual('../utils/carpool-notifications');
    const mocked = require('../utils/carpool-notifications');
    const familyRole = await one('SELECT role_ids->>0 FROM user_organizations WHERE user_id = $1 AND organization_id = $2',
      [ids.family, ids.unit]);
    const newcomerFamily = await member(Number(familyRole), 'Newcomer Family');
    const newcomer = await child('Newcomer');
    await grantParticipantAccess(pool, { participantId: newcomer, userId: newcomerFamily, sourceType: ACCESS_SOURCE.DIRECT });
    const newcomerEmail = await one('SELECT email FROM users WHERE id = $1', [newcomerFamily]);

    await call('put', `/api/v1/activities/${ids.camp}`, ids.staff)
      .send({ invites_everyone: false, invited_participant_ids: [ids.veteran] });
    mocked.sendActivityUpdateNotifications.mockClear();
    const opened = await call('put', `/api/v1/activities/${ids.camp}`, ids.staff)
      .send({ invites_everyone: true, notify_participants: true });
    expect(opened.status).toBe(200);
    expect(mocked.sendActivityUpdateNotifications).toHaveBeenCalledWith(pool, ids.camp, ids.unit, { wholeUnit: true });

    // An edit that keeps the whole unit invited does not email it
    mocked.sendActivityUpdateNotifications.mockClear();
    await call('put', `/api/v1/activities/${ids.camp}`, ids.staff)
      .send({ invites_everyone: true, notify_participants: true });
    expect(mocked.sendActivityUpdateNotifications).toHaveBeenCalledWith(pool, ids.camp, ids.unit, { wholeUnit: false });

    sendEmail.mockClear();
    await sendActivityUpdateNotifications(pool, ids.camp, ids.unit, { wholeUnit: true });
    expect(sendEmail.mock.calls.map(([to]) => to)).toContain(newcomerEmail);
    sendEmail.mockClear();
    await sendActivityUpdateNotifications(pool, ids.camp, ids.unit);
    expect(sendEmail.mock.calls.map(([to]) => to)).not.toContain(newcomerEmail);
  });
});
