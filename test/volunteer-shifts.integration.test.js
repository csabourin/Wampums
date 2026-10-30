/**
 * Volunteer shifts (#1251) on a migrated PostgreSQL.
 *
 * A volunteer account takes part without reading any youth or health record, and two
 * people taking the last place at the same moment cannot both get it: one is confirmed,
 * the other is told the shift is full (409).
 */
const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');

require('./jest-conditional-helpers');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || 'volunteer-shifts-integration-secret';

const mockContext = { userId: null, organizationId: null };
// Only authentication is faked; membership, permissions and scope come from the database.
jest.mock('../middleware/auth', () => {
  const actual = jest.requireActual('../middleware/auth');
  return {
    ...actual,
    authenticate: (req, _res, next) => {
      req.user = { id: mockContext.userId, organizationId: mockContext.organizationId };
      next();
    },
  };
});

const { signUp, saveShift, listShifts, recordRequirements, teamChecks } = require('../services/volunteerShifts');
const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

describe.skipIf(!DATABASE_URL)('volunteer shifts', () => {
  let pool; let app;
  const ids = {};
  const one = async (sql, params = []) => Object.values((await pool.query(sql, params)).rows[0])[0];
  /** A unit and its program section, created together as the deferred foreign key expects. */
  const unit = async (name) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const id = (await client.query('INSERT INTO organizations (name) VALUES ($1) RETURNING id', [name])).rows[0].id;
      await client.query("INSERT INTO organization_program_sections (organization_id, section_key, display_name) VALUES ($1, 'general', 'General')", [id]);
      await client.query('COMMIT');
      return id;
    } finally {
      client.release();
    }
  };
  const member = async (name, roleName) => {
    const userId = await one(`INSERT INTO users (email, password, full_name, is_verified)
      VALUES ('volunteer-' || gen_random_uuid() || '@example.test', 'x', $1, TRUE) RETURNING id`, [name]);
    const roleId = await one('SELECT id FROM roles WHERE role_name = $1 AND organization_id IS NULL', [roleName]);
    await pool.query(`INSERT INTO user_organizations (user_id, organization_id, role_ids, status)
      VALUES ($1, $2, $3, 'active')`, [userId, ids.unit, JSON.stringify([roleId])]);
    return userId;
  };
  const as = (userId, unit = ids.unit) => {
    mockContext.userId = userId;
    mockContext.organizationId = unit;
    return request(app);
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    ids.unit = await unit('Fictional volunteer unit');
    ids.other = await unit('Another fictional unit');
    // The district role holds every permission by design; a test DB's 'unitadmin' may be another suite's fixture.
    ids.manager = await member('Ada Lovelace', 'district');
    ids.cook = await member('Léa Tremblay', 'volunteer');
    ids.driver = await member('Grace Hopper', 'volunteer');
    ids.camp = await one(`INSERT INTO activities (organization_id, created_by, name, activity_date, meeting_location_going,
        meeting_time_going, departure_time_going, activity_start_date, activity_start_time, activity_end_date, activity_end_time, is_camp)
      VALUES ($1, $2, 'Camp de la Toussaint', CURRENT_DATE + 3, 'Hall', '18:00', '18:15', CURRENT_DATE + 3, '18:00', CURRENT_DATE + 5, '14:00', TRUE)
      RETURNING id`, [ids.unit, ids.manager]);

    app = express();
    app.locals.pool = pool;
    app.use(express.json());
    app.use('/api/v1/volunteer-shifts', require('../routes/volunteer-shifts')(pool));
    app.use('/api/v1/participants', require('../routes/participants')(pool));
    app.use('/api', require('../routes/medication')(pool, logger));
    app.use('/api/v1/forms', require('../routes/forms')(pool, logger));
  });

  afterAll(async () => { if (pool) { await pool.end(); } });

  test('the volunteer role holds only shifts and its own tasks: no youth, family or health permission', async () => {
    const keys = (await pool.query(`SELECT p.permission_key FROM roles r
      JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id
      WHERE r.role_name = 'volunteer' AND r.organization_id IS NULL ORDER BY 1`)).rows.map((row) => row.permission_key);
    expect(keys).toEqual(['tasks.view', 'volunteers.view']);
  });

  test.each([
    ['the youth list', '/api/v1/participants'],
    ['youth details', '/api/v1/participants/details'],
    ['medication requirements', '/api/v1/medication/requirements'],
    ['health declarations', '/api/v1/medication/fiche-declarations'],
    ['submitted forms', '/api/v1/forms'],
  ])('a volunteer is refused %s', async (_label, path) => {
    const response = await as(ids.cook).get(path);
    expect(response.status).toBe(403);
    expect(response.body.missing.length).toBeGreaterThan(0);
  });

  test('a volunteer sees shifts and places, but not who else signed up', async () => {
    const shift = await saveShift(pool, ids.unit, ids.manager, {
      activity_id: ids.camp, volunteer_type: 'other', title: 'Cuisine', shift_date: await one('SELECT (CURRENT_DATE + 3)::text'),
      start_time: '17:00', end_time: '19:00', slots: 2, notes: '',
    });
    await signUp(pool, ids.unit, shift.id, ids.driver);
    const response = await as(ids.cook).get('/api/v1/volunteer-shifts');
    expect(response.status).toBe(200);
    const listed = response.body.data.find((row) => row.id === shift.id);
    expect(listed).toMatchObject({ volunteer_type: 'other', title: 'Cuisine', slots: 2, taken: 1, mine: false, volunteers: null });
    expect(JSON.stringify(response.body)).not.toContain('Grace Hopper');
    const managerView = await listShifts(pool, ids.unit, ids.manager, { withNames: true });
    expect(managerView.find((row) => row.id === shift.id).volunteers.map((person) => person.name)).toEqual(['Grace Hopper']);
  });

  test('two volunteers taking the last place at once: one is confirmed, the other is refused with 409', async () => {
    const shift = await saveShift(pool, ids.unit, ids.manager, {
      activity_id: ids.camp, volunteer_type: 'other', title: 'Veille de nuit', shift_date: await one('SELECT (CURRENT_DATE + 4)::text'),
      start_time: '22:00', end_time: '23:30', slots: 1, notes: '',
    });
    const results = await Promise.allSettled([
      signUp(pool, ids.unit, shift.id, ids.cook),
      signUp(pool, ids.unit, shift.id, ids.driver),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const refused = results.find((result) => result.status === 'rejected');
    expect(refused.reason).toMatchObject({ message: 'volunteer_shift_full', status: 409 });
    expect(await one('SELECT COUNT(*)::int FROM volunteer_signups WHERE shift_id = $1', [shift.id])).toBe(1);
  });

  test('through the API, the second person on a full shift gets a clear 409', async () => {
    const shift = await saveShift(pool, ids.unit, ids.manager, {
      activity_id: ids.camp, volunteer_type: 'other', title: 'Transport', shift_date: await one('SELECT (CURRENT_DATE + 3)::text'),
      start_time: '08:00', end_time: '09:00', slots: 1, notes: '',
    });
    expect((await as(ids.cook).post(`/api/v1/volunteer-shifts/${shift.id}/signups`)).status).toBe(201);
    const second = await as(ids.driver).post(`/api/v1/volunteer-shifts/${shift.id}/signups`);
    expect(second.status).toBe(409);
    expect(second.body.message).toBe('volunteer_shift_full');
    expect((await as(ids.cook).post(`/api/v1/volunteer-shifts/${shift.id}/signups`)).status).toBe(200);
  });

  test('places cannot drop below the people already signed up, and a shift stays within its activity', async () => {
    const day = await one('SELECT (CURRENT_DATE + 3)::text');
    const shift = await saveShift(pool, ids.unit, ids.manager, {
      activity_id: ids.camp, volunteer_type: 'other', title: 'Vaisselle', shift_date: day, start_time: '19:00', end_time: '20:00', slots: 2, notes: '',
    });
    await signUp(pool, ids.unit, shift.id, ids.cook);
    await signUp(pool, ids.unit, shift.id, ids.driver);
    await expect(saveShift(pool, ids.unit, ids.manager, {
      activity_id: ids.camp, volunteer_type: 'other', title: 'Vaisselle', shift_date: day, start_time: '19:00', end_time: '20:00', slots: 1, notes: '',
    }, shift.id)).rejects.toMatchObject({ message: 'volunteer_slots_below_signups', status: 409 });
    await expect(saveShift(pool, ids.unit, ids.manager, {
      activity_id: ids.camp, volunteer_type: 'other', title: 'Trop tard', shift_date: await one('SELECT (CURRENT_DATE + 30)::text'),
      start_time: '19:00', end_time: '20:00', slots: 1, notes: '',
    })).rejects.toMatchObject({ message: 'volunteer_shift_outside_activity', status: 400 });
  });

  test('another unit cannot see, fill or change this unit\'s shifts', async () => {
    const shift = await saveShift(pool, ids.unit, ids.manager, {
      activity_id: ids.camp, volunteer_type: 'other', title: 'Accueil', shift_date: await one('SELECT (CURRENT_DATE + 3)::text'),
      start_time: '18:00', end_time: '19:00', slots: 3, notes: '',
    });
    await expect(signUp(pool, ids.other, shift.id, ids.cook)).rejects.toMatchObject({ status: 404 });
    expect((await listShifts(pool, ids.other, ids.cook, { withNames: true })).map((row) => row.id)).not.toContain(shift.id);
    await expect(saveShift(pool, ids.other, ids.manager, {
      activity_id: ids.camp, volunteer_type: 'other', title: 'Hijack', shift_date: await one('SELECT (CURRENT_DATE + 3)::text'),
      start_time: '18:00', end_time: '19:00', slots: 3, notes: '',
    }, shift.id)).rejects.toMatchObject({ status: 404 });
  });

  test('a volunteer cannot create shifts or remove someone else', async () => {
    const created = await as(ids.cook).post('/api/v1/volunteer-shifts').send({
      activity_id: ids.camp, volunteer_type: 'other', title: 'Cuisine', shift_date: await one('SELECT (CURRENT_DATE + 3)::text'),
      start_time: '17:00', end_time: '19:00', slots: 2,
    });
    expect(created.status).toBe(403);
    expect(created.body.missing).toEqual(['volunteers.manage']);
  });

  describe('a type with requirements, such as camp aide', () => {
    const day = (offset) => one(`SELECT (CURRENT_DATE + ${Number(offset)})::text`);
    const aideShift = async (slots = 2) => saveShift(pool, ids.unit, ids.manager, {
      activity_id: ids.camp, volunteer_type: 'camp_aide', title: '', shift_date: await day(4),
      start_time: '09:00', end_time: '12:00', slots, notes: '',
    });
    const placeOf = (shiftId, userId) => one(
      'SELECT status FROM volunteer_signups WHERE shift_id = $1 AND user_id = $2', [shiftId, userId]);

    test('a person not yet verified holds the place, pending, and is told what is missing', async () => {
      const aide = await member('Mary Jackson', 'volunteer');
      const shift = await aideShift();
      const result = await signUp(pool, ids.unit, shift.id, aide);
      expect(result).toEqual({ created: true, status: 'pending', missing: ['background_check', 'safety_training'] });
      const listed = (await listShifts(pool, ids.unit, aide, { withNames: false })).find((row) => row.id === shift.id);
      expect(listed).toMatchObject({ mine: true, my_status: 'pending', pending: 1, taken: 1,
        my_missing: ['background_check', 'safety_training'] });
    });

    test('a pending place still counts: the last seat is not given twice', async () => {
      const first = await member('Katherine Johnson', 'volunteer');
      const second = await member('Dorothy Vaughan', 'volunteer');
      const shift = await aideShift(1);
      await signUp(pool, ids.unit, shift.id, first);
      await expect(signUp(pool, ids.unit, shift.id, second)).rejects.toMatchObject({ message: 'volunteer_shift_full', status: 409 });
    });

    test('recording the requirements confirms the person\'s places; withdrawing one holds them again', async () => {
      const aide = await member('Annie Easley', 'volunteer');
      const shift = await aideShift();
      await signUp(pool, ids.unit, shift.id, aide);
      expect(await recordRequirements(pool, ids.unit, ids.manager, aide, {
        background_check: { checked_on: await day(0) }, safety_training: { valid_until: await day(365) },
      })).toEqual({ confirmed: 1 });
      expect(await placeOf(shift.id, aide)).toBe('confirmed');
      const managerView = (await listShifts(pool, ids.unit, ids.manager, { withNames: true })).find((row) => row.id === shift.id);
      expect(managerView.volunteers).toEqual([expect.objectContaining({ name: 'Annie Easley', status: 'confirmed', missing: [] })]);

      await recordRequirements(pool, ids.unit, ids.manager, aide, { safety_training: { valid_until: null } });
      expect(await placeOf(shift.id, aide)).toBe('pending');
    });

    test('a requirement expired by the shift\'s day counts as missing', async () => {
      const aide = await member('Joan Clarke', 'volunteer');
      await recordRequirements(pool, ids.unit, ids.manager, aide, {
        // Done three years ago less a day: it lapses tomorrow, before the shift.
        background_check: { checked_on: await one("SELECT ((CURRENT_DATE - INTERVAL '3 years')::date + 1)::text") },
        safety_training: { valid_until: null },
      });
      const shift = await aideShift();
      expect((await signUp(pool, ids.unit, shift.id, aide)).missing).toEqual(['background_check']);
    });

    test('a verified person is confirmed at once', async () => {
      const aide = await member('Hedy Lamarr', 'volunteer');
      await recordRequirements(pool, ids.unit, ids.manager, aide, {
        background_check: { checked_on: await day(0) }, safety_training: { valid_until: null },
      });
      const shift = await aideShift();
      expect((await signUp(pool, ids.unit, shift.id, aide)).status).toBe('confirmed');
    });

    test('a cook needs a background check too, and nothing more', async () => {
      const cook = await member('Julia Child', 'volunteer');
      const cookShift = await saveShift(pool, ids.unit, ids.manager, {
        activity_id: ids.camp, volunteer_type: 'cook', title: '', shift_date: await day(4),
        start_time: '07:00', end_time: '08:00', slots: 2, notes: '',
      });
      expect(await signUp(pool, ids.unit, cookShift.id, cook)).toEqual({ created: true, status: 'pending', missing: ['background_check'] });
      expect(await recordRequirements(pool, ids.unit, ids.manager, cook, { background_check: { checked_on: await day(0) } })).toEqual({ confirmed: 1 });
      expect(await placeOf(cookShift.id, cook)).toBe('confirmed');
    });

    test('changing a shift into a camp aide shift holds places that lack the requirements', async () => {
      const shift = await saveShift(pool, ids.unit, ids.manager, {
        activity_id: ids.camp, volunteer_type: 'other', title: '', shift_date: await day(4),
        start_time: '13:00', end_time: '14:00', slots: 2, notes: '',
      });
      await signUp(pool, ids.unit, shift.id, ids.driver);
      await saveShift(pool, ids.unit, ids.manager, {
        activity_id: ids.camp, volunteer_type: 'camp_aide', title: '', shift_date: await day(4),
        start_time: '13:00', end_time: '14:00', slots: 2, notes: '',
      }, shift.id);
      expect(await placeOf(shift.id, ids.driver)).toBe('pending');
    });

    test('a volunteer cannot read or record anyone\'s requirements; managers only record for members', async () => {
      const read = await as(ids.cook).get(`/api/v1/volunteer-shifts/requirements/${ids.driver}`);
      expect(read.status).toBe(403);
      expect((await as(ids.cook).get('/api/v1/volunteer-shifts/requirements/me')).status).toBe(200);
      const stranger = await one(`INSERT INTO users (email, password, full_name)
        VALUES ('stranger-' || gen_random_uuid() || '@example.test', 'x', 'Stranger') RETURNING id`);
      await expect(recordRequirements(pool, ids.unit, ids.manager, stranger, { background_check: { checked_on: await day(0) } }))
        .rejects.toMatchObject({ message: 'volunteer_member_not_found', status: 404 });
    });
  });

  describe('background checks for every adult, valid three years', () => {
    test('a check lasts three years from the day it was done, whatever expiry is sent', async () => {
      const person = await member('Rosalind Franklin', 'volunteer');
      await recordRequirements(pool, ids.unit, ids.manager, person, {
        background_check: { checked_on: '2025-03-15', valid_until: '2099-01-01' },
      });
      expect(await one(`SELECT valid_until::text FROM volunteer_requirements
        WHERE user_id = $1 AND requirement_key = 'background_check'`, [person])).toBe('2028-03-15');
    });

    test('a check done on 29 February lasts until 28 February three years later', async () => {
      const person = await member('Lise Meitner', 'volunteer');
      await recordRequirements(pool, ids.unit, ids.manager, person, { background_check: { checked_on: '2024-02-29' } });
      expect(await one(`SELECT valid_until::text FROM volunteer_requirements
        WHERE user_id = $1 AND requirement_key = 'background_check'`, [person])).toBe('2027-02-28');
    });

    test('every type, "other" included, holds a place until the check is recorded', async () => {
      const person = await member('Chien-Shiung Wu', 'volunteer');
      const shift = await saveShift(pool, ids.unit, ids.manager, {
        activity_id: ids.camp, volunteer_type: 'other', title: 'Accueil des familles', shift_date: await one('SELECT (CURRENT_DATE + 3)::text'),
        start_time: '17:00', end_time: '18:00', slots: 3, notes: '',
      });
      expect(await signUp(pool, ids.unit, shift.id, person)).toMatchObject({ status: 'pending', missing: ['background_check'] });
    });

    test('managers follow the whole team and every volunteer, most urgent first; a parent alone is not listed', async () => {
      const leader = await member('Margaret Hamilton', 'leader');
      const treasurer = await member('Mary Somerville', 'district');
      const parent = await member('Parent Only', 'parent');
      await recordRequirements(pool, ids.unit, ids.manager, treasurer, { background_check: { checked_on: await one("SELECT ((CURRENT_DATE - INTERVAL '3 years')::date + 30)::text") } });
      await recordRequirements(pool, ids.unit, ids.manager, ids.manager, { background_check: { checked_on: await one('SELECT CURRENT_DATE::text') } });
      const checks = await teamChecks(pool, ids.unit);
      const byId = new Map(checks.map((row) => [row.user_id, row]));
      expect(byId.get(leader)).toMatchObject({ on_team: true, state: 'missing' });
      expect(byId.get(treasurer)).toMatchObject({ on_team: true, state: 'expiring' });
      expect(byId.get(ids.manager)).toMatchObject({ on_team: true, state: 'valid' });
      expect(byId.has(parent)).toBe(false);
      const states = checks.map((row) => row.state);
      expect(states.indexOf('missing')).toBeLessThan(states.indexOf('expiring'));
      expect(states.indexOf('expiring')).toBeLessThan(states.indexOf('valid'));
    });

    test('through the API, the team list is for managers only', async () => {
      expect((await as(ids.manager).get('/api/v1/volunteer-shifts/checks')).status).toBe(200);
      const refused = await as(ids.cook).get('/api/v1/volunteer-shifts/checks');
      expect(refused.status).toBe(403);
      expect(refused.body.missing).toEqual(['volunteers.manage']);
    });
  });

  describe('changes racing each other', () => {
    const day = (offset) => one(`SELECT (CURRENT_DATE + ${Number(offset)})::text`);

    test('a shift of a removed activity takes no place', async () => {
      const outing = await one(`INSERT INTO activities (organization_id, created_by, name, activity_date, meeting_location_going,
          meeting_time_going, departure_time_going, activity_start_date, activity_start_time, activity_end_date, activity_end_time)
        VALUES ($1, $2, 'Removed outing', CURRENT_DATE + 3, 'Hall', '09:00', '09:15', CURRENT_DATE + 3, '09:00', CURRENT_DATE + 3, '16:00')
        RETURNING id`, [ids.unit, ids.manager]);
      const shift = await saveShift(pool, ids.unit, ids.manager, {
        activity_id: outing, volunteer_type: 'other', title: 'Accueil', shift_date: await day(3),
        start_time: '09:00', end_time: '10:00', slots: 2, notes: '',
      });
      await pool.query('UPDATE activities SET is_active = FALSE WHERE id = $1', [outing]);
      await expect(signUp(pool, ids.unit, shift.id, ids.cook)).rejects.toMatchObject({ message: 'volunteer_shift_not_found', status: 404 });
    });

    test('a check withdrawn while the person signs up never leaves a confirmed place without it', async () => {
      const person = await member('Grace Murray', 'volunteer');
      await recordRequirements(pool, ids.unit, ids.manager, person, { background_check: { checked_on: await day(0) } });
      const shift = await saveShift(pool, ids.unit, ids.manager, {
        activity_id: ids.camp, volunteer_type: 'cook', title: '', shift_date: await day(4),
        start_time: '12:00', end_time: '13:00', slots: 3, notes: '',
      });
      await Promise.all([
        signUp(pool, ids.unit, shift.id, person),
        recordRequirements(pool, ids.unit, ids.manager, person, {}),
      ]);
      expect(await one('SELECT status FROM volunteer_signups WHERE shift_id = $1 AND user_id = $2', [shift.id, person])).toBe('pending');
    });

    test('a shift turned into a camp aide shift while a cook is verified is judged on its new type', async () => {
      const person = await member('Edith Clarke', 'volunteer');
      const values = async (type) => ({
        activity_id: ids.camp, volunteer_type: type, title: '', shift_date: await day(4),
        start_time: '11:00', end_time: '12:00', slots: 3, notes: '',
      });
      const shift = await saveShift(pool, ids.unit, ids.manager, await values('cook'));
      await signUp(pool, ids.unit, shift.id, person);
      await Promise.all([
        saveShift(pool, ids.unit, ids.manager, await values('camp_aide'), shift.id),
        recordRequirements(pool, ids.unit, ids.manager, person, { background_check: { checked_on: await day(0) } }),
      ]);
      // A camp aide also needs safety training, which was never recorded.
      expect(await one('SELECT status FROM volunteer_signups WHERE shift_id = $1 AND user_id = $2', [shift.id, person])).toBe('pending');
    });

    test('lowering places while someone signs up never leaves more people than places', async () => {
      const people = await Promise.all(['Alan Kay', 'Barbara Liskov'].map((name) => member(name, 'volunteer')));
      const values = async (slots) => ({
        activity_id: ids.camp, volunteer_type: 'other', title: 'Rangement', shift_date: await day(4),
        start_time: '15:00', end_time: '16:00', slots, notes: '',
      });
      const shift = await saveShift(pool, ids.unit, ids.manager, await values(2));
      await signUp(pool, ids.unit, shift.id, people[0]);
      await Promise.allSettled([
        signUp(pool, ids.unit, shift.id, people[1]),
        saveShift(pool, ids.unit, ids.manager, await values(1), shift.id),
      ]);
      const { slots, taken } = (await pool.query(`SELECT s.slots, (SELECT COUNT(*)::int FROM volunteer_signups v WHERE v.shift_id = s.id) AS taken
        FROM volunteer_shifts s WHERE s.id = $1`, [shift.id])).rows[0];
      expect(taken).toBeLessThanOrEqual(slots);
    });
  });
});
