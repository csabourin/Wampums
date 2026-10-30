/**
 * A camp is always an activity, and keeps one set of dates whether it is moved
 * from the year plan or from the activities page. Runs on a migrated PostgreSQL.
 */
const { Pool } = require('pg');
const { planCamp, unplanCamp, alignPlannedDate, assertMovable, CampDateError } = require('../services/campDates');
require('./jest-conditional-helpers');

const DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!DATABASE_URL)('camp dates and the year plan', () => {
  let pool; let db; let unit; let user; let plan;
  const one = async (sql, params = []) => Object.values((await db.query(sql, params)).rows[0])[0];
  const activity = (name, start, end, isCamp = true) => db.query(
    `INSERT INTO activities (organization_id, created_by, name, activity_date, meeting_location_going, meeting_time_going,
       departure_time_going, activity_start_date, activity_start_time, activity_end_date, activity_end_time, is_camp)
     VALUES ($1,$2,$3,$4,'Hall','18:00','18:15',$4,'18:00',$5,'14:00',$6) RETURNING *`,
    [unit, user, name, start, end, isCamp]
  ).then((result) => result.rows[0]);
  const plannedFor = (activityId) => db.query(
    'SELECT id, meeting_date::text AS meeting_date, meeting_kind FROM year_plan_meetings WHERE organization_id = $1 AND activity_id = $2',
    [unit, activityId]
  ).then((result) => result.rows);

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL }); db = await pool.connect(); await db.query('BEGIN');
    unit = await one("INSERT INTO organizations (name) VALUES ('Fictional camp-dates unit') RETURNING id");
    user = await one("INSERT INTO users (email,password,full_name) VALUES ('camp-dates-' || gen_random_uuid() || '@example.test','x','Ada Lovelace') RETURNING id");
    plan = await one(`INSERT INTO year_plans (organization_id, title, start_date, end_date, created_by)
      VALUES ($1, 'Fictional year', '2030-09-01', '2031-06-30', $2) RETURNING id`, [unit, user]);
  });
  afterAll(async () => { if (db) { await db.query('ROLLBACK'); db.release(); } if (pool) { await pool.end(); } });

  test('a camp created as an activity joins the year plan covering its first day, as a camp', async () => {
    const camp = await activity('Camp de la Toussaint', '2030-10-30', '2030-11-01');
    const plannedId = await planCamp(db, unit, camp.id);
    expect(await plannedFor(camp.id)).toEqual([{ id: plannedId, meeting_date: '2030-10-30', meeting_kind: 'camp' }]);
    expect(await one('SELECT year_plan_id FROM year_plan_meetings WHERE id = $1', [plannedId])).toBe(plan);
  });

  test('an ordinary meeting on that day becomes the camp; a day holding another activity is left alone', async () => {
    const meeting = await one(`INSERT INTO year_plan_meetings (organization_id, year_plan_id, meeting_date, theme)
      VALUES ($1, $2, '2030-11-15', 'Regular night') RETURNING id`, [unit, plan]);
    const camp = await activity('Camp d\'automne', '2030-11-15', '2030-11-17');
    expect(await planCamp(db, unit, camp.id)).toBe(meeting);
    expect(await plannedFor(camp.id)).toEqual([{ id: meeting, meeting_date: '2030-11-15', meeting_kind: 'camp' }]);

    const second = await activity('Second camp, same day', '2030-11-15', '2030-11-16');
    expect(await planCamp(db, unit, second.id)).toBeNull();
    expect(await plannedFor(second.id)).toEqual([]);
  });

  test('a camp no active year plan covers stays an unplanned camp', async () => {
    const camp = await activity('Summer camp', '2031-07-10', '2031-07-14');
    expect(await planCamp(db, unit, camp.id)).toBeNull();
  });

  test('moving a camp moves its planned date, keeping one set of dates', async () => {
    const camp = await activity('Winter camp', '2031-02-06', '2031-02-08');
    const plannedId = await planCamp(db, unit, camp.id);
    expect(await alignPlannedDate(db, unit, camp.id, '2031-02-13', '2031-02-15')).toBe(plannedId);
    expect((await plannedFor(camp.id))[0].meeting_date).toBe('2031-02-13');
  });

  test('a camp moved into another year moves to the year plan covering it', async () => {
    const nextPlan = await one(`INSERT INTO year_plans (organization_id, title, start_date, end_date, created_by)
      VALUES ($1, 'Next fictional year', '2031-09-01', '2032-06-30', $2) RETURNING id`, [unit, user]);
    const camp = await activity('Mistyped camp', '2031-02-20', '2031-02-22');
    const plannedId = await planCamp(db, unit, camp.id);
    await alignPlannedDate(db, unit, camp.id, '2032-02-20', '2032-02-22');
    expect(await one('SELECT year_plan_id FROM year_plan_meetings WHERE id = $1', [plannedId])).toBe(nextPlan);
  });

  test('a camp cannot move onto a first day the unit already uses, nor shrink under its schedule', async () => {
    const camp = await activity('Spring camp', '2031-03-06', '2031-03-08');
    const plannedId = await planCamp(db, unit, camp.id);
    await db.query(`INSERT INTO year_plan_meetings (organization_id, year_plan_id, meeting_date) VALUES ($1, $2, '2031-03-20')`, [unit, plan]);
    await db.query('SAVEPOINT taken');
    await expect(alignPlannedDate(db, unit, camp.id, '2031-03-20', '2031-03-22'))
      .rejects.toEqual(expect.objectContaining({ code: 'camp_date_taken', status: 409 }));
    await db.query('ROLLBACK TO SAVEPOINT taken');

    await db.query(`INSERT INTO year_plan_meeting_activities (organization_id, meeting_id, name, day_offset)
      VALUES ($1, $2, 'Last-day hike', 2)`, [unit, plannedId]);
    const refusal = await alignPlannedDate(db, unit, camp.id, '2031-03-06', '2031-03-07').catch((err) => err);
    expect(refusal).toBeInstanceOf(CampDateError);
    expect(refusal.code).toBe('camp_schedule_outside_dates');
    expect((await plannedFor(camp.id))[0].meeting_date).toBe('2031-03-06');
  });

  test('an activity that stops being a camp keeps its planned date as an outing', async () => {
    const camp = await activity('Former camp', '2031-04-10', '2031-04-12');
    await planCamp(db, unit, camp.id);
    await unplanCamp(db, unit, camp.id);
    expect((await plannedFor(camp.id))[0].meeting_kind).toBe('weekend');
  });

  describe('what a camp move must not leave behind', () => {
    const refusal = (promise) => promise.then(() => null, (err) => err.code);

    test('volunteer shifts on days the new dates drop hold the camp in place', async () => {
      const camp = await activity('Shifted camp', '2031-05-01', '2031-05-03');
      await db.query(`INSERT INTO volunteer_shifts (organization_id, activity_id, volunteer_type, title, shift_date, start_time, end_time, slots)
        VALUES ($1, $2, 'cook', '', '2031-05-03', '17:00', '19:00', 2)`, [unit, camp.id]);
      expect(await refusal(assertMovable(db, unit, camp.id, { start: '2031-05-01', end: '2031-05-03' }, { start: '2031-05-01', end: '2031-05-02' })))
        .toBe('volunteer_shifts_outside_dates');
      expect(await refusal(assertMovable(db, unit, camp.id, { start: '2031-05-01', end: '2031-05-03' }, { start: '2031-04-30', end: '2031-05-03' })))
        .toBeNull();
    });

    test('equipment reserved for the camp, or its planned date, must be moved first', async () => {
      const camp = await activity('Reserved camp', '2031-05-08', '2031-05-10');
      const plannedId = await planCamp(db, unit, camp.id);
      const item = await one(`INSERT INTO equipment_items (organization_id, name, category, quantity_total, quantity_available)
        VALUES ($1, 'Tente', 'camping', 4, 4) RETURNING id`, [unit]);
      await db.query(`INSERT INTO equipment_reservations (organization_id, equipment_id, meeting_id, meeting_date, reserved_quantity, reserved_for, status, date_from, date_to)
        VALUES ($1, $2, $3, '2031-05-08', 2, 'Reserved camp', 'reserved', '2031-05-08', '2031-05-10')`, [unit, item, plannedId]);
      expect(await refusal(assertMovable(db, unit, camp.id, { start: '2031-05-08', end: '2031-05-10' }, { start: '2031-05-15', end: '2031-05-17' })))
        .toBe('camp_reservations_need_moving');
      expect(await refusal(assertMovable(db, unit, camp.id, { start: '2031-05-08', end: '2031-05-10' }, { start: '2031-05-08', end: '2031-05-10' })))
        .toBeNull();
    });

    test('a planned camp whose days already have attendance keeps its dates', async () => {
      const camp = await activity('Attended camp', '2031-05-22', '2031-05-24');
      await planCamp(db, unit, camp.id);
      const youth = await one("INSERT INTO participants (first_name, last_name) VALUES ('Fictional', 'Camper') RETURNING id");
      await db.query(`INSERT INTO attendance (participant_id, date, status, organization_id) VALUES ($1, '2031-05-23', 'present', $2)`, [youth, unit]);
      expect(await refusal(assertMovable(db, unit, camp.id, { start: '2031-05-22', end: '2031-05-24' }, { start: '2031-05-29', end: '2031-05-31' })))
        .toBe('camp_attendance_recorded');
    });
  });
});
