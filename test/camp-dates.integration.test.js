/**
 * A camp is always an activity, and keeps one set of dates whether it is moved
 * from the year plan or from the activities page. Runs on a migrated PostgreSQL.
 */
const { Pool } = require('pg');
const { planCamp, unplanCamp, alignPlannedDate, CampDateError } = require('../services/campDates');
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
});
