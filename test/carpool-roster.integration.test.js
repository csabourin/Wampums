'use strict';

/**
 * carpools.view lets a family offer rides and seat its own children. It is not
 * a right to the unit's roster: in the children lists a linked-scope member
 * sees only their own children. In the list of cars, every family sees who
 * rides where (child and guardian names, so children can ride with friends),
 * without email addresses. Staff see everything.
 */

const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');
const { randomUUID } = require('crypto');
require('./jest-conditional-helpers');
process.env.JWT_SECRET_KEY ||= 'carpool-roster-integration-secret';

const { signJWTToken } = require('../utils/jwt-config');
const { grantParticipantAccess, ACCESS_SOURCE } = require('../services/participantAccess');

const DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!DATABASE_URL)('Carpool roster visibility', () => {
  let pool;
  let app;
  const ids = {};

  async function one(sql, params = []) {
    const result = await pool.query(sql, params);
    return Object.values(result.rows[0] || {})[0];
  }

  async function role(keys, scope) {
    const id = await one('INSERT INTO roles (role_name, display_name, data_scope) VALUES ($1, $1, $2) RETURNING id',
      [`carpool_${randomUUID()}`, scope]);
    await pool.query('INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE permission_key = ANY($2::text[])',
      [id, keys]);
    return id;
  }

  async function member(roleId, name) {
    const id = await one('INSERT INTO users (email, password, full_name) VALUES ($1, \'x\', $2) RETURNING id',
      [`${randomUUID()}@example.test`, name]);
    await pool.query("INSERT INTO user_organizations (user_id, organization_id, role_ids, status) VALUES ($1, $2, $3::jsonb, 'active')",
      [id, ids.unit, JSON.stringify([roleId])]);
    return id;
  }

  async function child(firstName) {
    const id = await one("INSERT INTO participants (first_name, last_name, date_naissance) VALUES ($1, 'Carpool', '2016-01-01') RETURNING id",
      [firstName]);
    await pool.query(`INSERT INTO participant_enrollments (participant_id, organization_id, scout_year_id)
      SELECT $1, $2, id FROM scout_years WHERE organization_id = $2 AND status = 'active'`, [id, ids.unit]);
    return id;
  }

  function offer(driverId) {
    return one(`INSERT INTO carpool_offers (activity_id, user_id, organization_id, vehicle_make, vehicle_color,
        total_seats_available, trip_direction)
      VALUES ($1, $2, $3, 'Car', 'Blue', 4, 'both') RETURNING id`, [ids.activity, driverId, ids.unit]);
  }

  async function seat(offerId, participantId, assignedBy) {
    await pool.query(`INSERT INTO carpool_assignments (carpool_offer_id, participant_id, assigned_by, organization_id, trip_direction)
      VALUES ($1, $2, $3, $4, 'both')`, [offerId, participantId, assignedBy, ids.unit]);
  }

  function auth(userId) {
    // The JWT claims everything; only the database may grant keys and scope.
    const token = signJWTToken({ user_id: userId, organizationId: ids.unit, roleNames: ['district'], permissions: ['carpools.manage'] });
    return `Bearer ${token}`;
  }

  function get(path, userId) {
    return request(app).get(path).set('Authorization', auth(userId));
  }

  const names = (rows) => rows.map((row) => row.first_name).sort();

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      ids.unit = (await client.query("INSERT INTO organizations (name) VALUES ('Carpool roster unit') RETURNING id")).rows[0].id;
      await client.query("INSERT INTO organization_program_sections (organization_id, section_key, display_name) VALUES ($1, 'general', 'General')", [ids.unit]);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    await pool.query("INSERT INTO scout_years (organization_id, label, start_date, end_date, status) VALUES ($1, '2026-2027', '2026-09-01', '2027-08-31', 'active')", [ids.unit]);

    const familyRole = await role(['participants.view', 'activities.view', 'carpools.view'], 'linked');
    const staffRole = await role(['activities.view', 'carpools.view', 'carpools.manage'], 'organization');
    ids.family = await member(familyRole, 'Family Driver');
    ids.otherFamily = await member(familyRole, 'Other Family');
    ids.staff = await member(staffRole, 'Staff Member');
    ids.own = await child('Own');
    ids.foreign = await child('Foreign');
    ids.unseated = await child('Unseated');
    await grantParticipantAccess(pool, { participantId: ids.own, userId: ids.family, sourceType: ACCESS_SOURCE.DIRECT });
    await grantParticipantAccess(pool, { participantId: ids.foreign, userId: ids.otherFamily, sourceType: ACCESS_SOURCE.DIRECT });
    await grantParticipantAccess(pool, { participantId: ids.unseated, userId: ids.otherFamily, sourceType: ACCESS_SOURCE.DIRECT });

    // The foreign child is also enrolled in another unit, where an account
    // outside this unit is linked to them. user_participants has no unit, so
    // that account must not surface here.
    const client2 = await pool.connect();
    try {
      await client2.query('BEGIN');
      ids.elsewhere = (await client2.query("INSERT INTO organizations (name) VALUES ('Carpool roster other unit') RETURNING id")).rows[0].id;
      await client2.query("INSERT INTO organization_program_sections (organization_id, section_key, display_name) VALUES ($1, 'general', 'General')", [ids.elsewhere]);
      await client2.query('COMMIT');
    } finally {
      client2.release();
    }
    ids.outsider = await one("INSERT INTO users (email, password, full_name) VALUES ($1, 'x', 'Outside Unit') RETURNING id", [`${randomUUID()}@example.test`]);
    await pool.query("INSERT INTO user_organizations (user_id, organization_id, role_ids, status) VALUES ($1, $2, $3::jsonb, 'active')",
      [ids.outsider, ids.elsewhere, JSON.stringify([familyRole])]);
    await grantParticipantAccess(pool, { participantId: ids.foreign, userId: ids.outsider, sourceType: ACCESS_SOURCE.DIRECT });

    ids.activity = await one(`INSERT INTO activities (organization_id, created_by, name, activity_date, activity_start_date,
        activity_start_time, activity_end_date, activity_end_time, meeting_location_going, meeting_time_going, departure_time_going)
      VALUES ($1, $2, 'Camp', '2026-10-24', '2026-10-24', '08:00', '2026-10-24', '16:00', 'Hall', '08:00', '08:30') RETURNING id`,
    [ids.unit, ids.staff]);

    // The other family's car carries the foreign child; the family's own car
    // carries the foreign child too (the driver must know who rides with them).
    ids.otherCar = await offer(ids.otherFamily);
    ids.ownCar = await offer(ids.family);
    await seat(ids.otherCar, ids.foreign, ids.otherFamily);

    app = express();
    app.use(express.json());
    app.locals.pool = pool;
    app.use('/api/v1/activities', require('../routes/activities')(pool));
    app.use('/api/v1/carpools', require('../routes/carpools')(pool));
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    app.use('/api/v1/offline', require('../routes/offline')(pool, logger));
    app.use('/api/v1/resources', require('../routes/resources')(pool));
  });

  afterAll(async () => {
    if (!pool) {return;}
    await pool.query('DELETE FROM carpool_assignments WHERE organization_id = $1', [ids.unit]);
    await pool.query('DELETE FROM carpool_offers WHERE organization_id = $1', [ids.unit]);
    await pool.query('DELETE FROM activities WHERE organization_id = $1', [ids.unit]);
    await pool.end();
  });

  test('a family lists only its own children for an activity', async () => {
    const response = await get(`/api/v1/activities/${ids.activity}/participants`, ids.family);
    expect(response.status).toBe(200);
    expect(names(response.body.data)).toEqual(['Own']);
    expect(JSON.stringify(response.body.data)).not.toContain('Other Family');
  });

  test('a family\'s "without a ride" list holds only its own children', async () => {
    const response = await get(`/api/v1/carpools/activity/${ids.activity}/unassigned`, ids.family);
    expect(response.status).toBe(200);
    expect(names(response.body.data)).toEqual(['Own']);
  });

  test('staff keep the whole roster', async () => {
    const roster = await get(`/api/v1/activities/${ids.activity}/participants`, ids.staff);
    expect(names(roster.body.data)).toEqual(['Foreign', 'Own', 'Unseated']);
    const unassigned = await get(`/api/v1/carpools/activity/${ids.activity}/unassigned`, ids.staff);
    expect(names(unassigned.body.data)).toEqual(['Own', 'Unseated']);
  });

  test('a family sees who rides in another car, by name only', async () => {
    const response = await get(`/api/v1/carpools/activity/${ids.activity}`, ids.family);
    expect(response.status).toBe(200);
    const otherCar = response.body.data.find((row) => row.id === ids.otherCar);
    expect(Number(otherCar.seats_used_going)).toBe(1);
    expect(otherCar.assignments.map((a) => a.participant_name)).toEqual(['Foreign Carpool']);
    // Only guardians active in this unit; not the account from another unit.
    expect(otherCar.assignments[0].guardian_names).toEqual(['Other Family']);
    // No contact details: neither the driver's nor any guardian's address.
    expect(otherCar.driver_email).toBeNull();
    expect(JSON.stringify(response.body.data)).not.toMatch(/@example\.test/);
  });

  test('staff also see the driver\'s email address', async () => {
    const response = await get(`/api/v1/carpools/activity/${ids.activity}`, ids.staff);
    const otherCar = response.body.data.find((row) => row.id === ids.otherCar);
    expect(otherCar.driver_email).toMatch(/@example\.test$/);
    expect(otherCar.assignments[0].guardian_names).toEqual(['Other Family']);
  });

  test('a driver sees every child seated in their own car', async () => {
    await seat(ids.ownCar, ids.foreign, ids.staff);
    try {
      const response = await get(`/api/v1/carpools/activity/${ids.activity}`, ids.family);
      const ownCar = response.body.data.find((row) => row.id === ids.ownCar);
      expect(ownCar.assignments.map((a) => a.participant_id)).toEqual([ids.foreign]);
    } finally {
      await pool.query('DELETE FROM carpool_assignments WHERE carpool_offer_id = $1', [ids.ownCar]);
    }
  });

  describe('unit-wide exports stay with unit-wide roles', () => {
    test('a family holding activities.view cannot download the offline bundle', async () => {
      const response = await request(app).post('/api/v1/offline/prepare-activity')
        .set('Authorization', auth(ids.family))
        .send({ start_date: '2026-10-24', end_date: '2026-10-25' });
      expect(response.status).toBe(403);
      expect(response.body.data).toBeUndefined();
    });

    test('nor read the unit\'s permission slip and reservation dashboard', async () => {
      const response = await get('/api/v1/resources/status/dashboard', ids.family);
      expect(response.status).toBe(403);
    });

    test('staff still can', async () => {
      const bundle = await request(app).post('/api/v1/offline/prepare-activity')
        .set('Authorization', auth(ids.staff))
        .send({ start_date: '2026-10-24', end_date: '2026-10-25' });
      expect(bundle.status).toBe(200);
      const dashboard = await get('/api/v1/resources/status/dashboard', ids.staff);
      expect(dashboard.status).toBe(200);
    });
  });
});
