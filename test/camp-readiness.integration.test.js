/** Team overview against the migrated schema, with fictional unit and camp records. */
const { Pool } = require('pg');
const { campReadiness, campReadinessForActivity, upcomingCamps } = require('../services/campReadiness');
require('./jest-conditional-helpers');
const DATABASE_URL = process.env.TEST_DATABASE_URL;
describe.skipIf(!DATABASE_URL)('Camp preparation isolation', () => {
  let pool; let db; let unit; let other; let camp; let activity;
  const one = async (sql, params = []) => Object.values((await db.query(sql, params)).rows[0])[0];
  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL }); db = await pool.connect(); await db.query('BEGIN');
    unit = await one("INSERT INTO organizations (name) VALUES ('Fictional readiness unit') RETURNING id");
    other = await one("INSERT INTO organizations (name) VALUES ('Foreign readiness unit') RETURNING id");
    for (const id of [unit, other]) {
      // eslint-disable-next-line no-await-in-loop -- fixture rows share a transaction
      await db.query("INSERT INTO organization_program_sections (organization_id, section_key, display_name) VALUES ($1, 'general', 'General')", [id]);
    }
    const user = await one("INSERT INTO users (email,password,full_name) VALUES ('readiness-' || gen_random_uuid() || '@example.test','x','Fictional helper') RETURNING id");
    activity = await one(`INSERT INTO activities (organization_id, created_by, name, activity_date, meeting_location_going, meeting_time_going,
      departure_time_going, activity_start_date, activity_start_time, activity_end_date, activity_end_time)
      VALUES ($1,$2,'Fictional camp','2026-11-14','Hall','09:00','09:15','2026-11-14','09:00','2026-11-16','16:00') RETURNING id`, [unit, user]);
    camp = await one("INSERT INTO year_plan_meetings (organization_id,meeting_date,theme,meeting_kind,activity_id) VALUES ($1,'2026-11-14','Fictional camp','camp',$2) RETURNING id", [unit, activity]);
    await db.query("INSERT INTO activity_tasks (organization_id,meeting_id,title,assignee_id,due_date,created_by) VALUES ($1,$2,'Pack the tent',$3,'2026-11-14',$3)", [unit, camp, user]);
    await db.query("INSERT INTO activity_tasks (organization_id,activity_id,title,assignee_id,due_date,created_by) VALUES ($1,$2,'Check the route',$3,'2026-11-13',$3)", [unit, activity, user]);
  });
  afterAll(async () => { if (db) { await db.query('ROLLBACK'); db.release(); } if (pool) { await pool.end(); } });
  test('another unit cannot read the camp even with all section rights', async () => {
    expect(await campReadiness(db, other, camp, { inventory: true, lots: true, tasks: true, permissions: true })).toBeNull();
  });
  test('only enabled sections are returned and tasks include the planned camp and linked outing', async () => {
    const limited = await campReadiness(db, unit, camp, {});
    expect(Object.keys(limited.sections)).toEqual(['material']);
    const all = await campReadiness(db, unit, camp, { lots: true, tasks: true, permissions: true });
    expect(all.sections.tasks.map((task) => task.title).sort()).toEqual(['Check the route', 'Pack the tent']);
    expect(all.sections.permissions).toEqual([]); expect(all.sections.lots).toEqual([]);
    expect(all.camp.date_to).toBe('2026-11-16');
  });
  test('camps under way or starting soon are listed for their own unit only, cancelled ones left out', async () => {
    const soon = await one("INSERT INTO year_plan_meetings (organization_id,meeting_date,theme,meeting_kind) VALUES ($1,CURRENT_DATE + 3,'Soon camp','camp') RETURNING id", [unit]);
    await db.query("INSERT INTO year_plan_meetings (organization_id,meeting_date,theme,meeting_kind,is_cancelled) VALUES ($1,CURRENT_DATE + 2,'Cancelled camp','camp',TRUE)", [unit]);
    await db.query("INSERT INTO year_plan_meetings (organization_id,meeting_date,theme,meeting_kind) VALUES ($1,CURRENT_DATE + 30,'Far camp','camp')", [unit]);
    await db.query("INSERT INTO year_plan_meetings (organization_id,meeting_date,theme,meeting_kind) VALUES ($1,CURRENT_DATE + 1,'Foreign camp','camp')", [other]);
    const camps = await upcomingCamps(db, unit, 14, 3);
    expect(camps.map((entry) => entry.theme)).toContain('Soon camp');
    expect(camps.map((entry) => entry.theme)).not.toEqual(expect.arrayContaining(['Cancelled camp']));
    expect(camps.map((entry) => entry.theme)).not.toEqual(expect.arrayContaining(['Far camp']));
    expect(camps.map((entry) => entry.theme)).not.toEqual(expect.arrayContaining(['Foreign camp']));
    expect(camps.find((entry) => entry.id === soon)).toBeDefined();
  });
  test('a camp created only as an activity has its own overview, with tasks and consent but no schedule', async () => {
    const helper = await one('SELECT created_by FROM activities WHERE id = $1', [activity]);
    const outing = await one(`INSERT INTO activities (organization_id, created_by, name, activity_date, meeting_location_going, meeting_time_going,
      departure_time_going, activity_start_date, activity_start_time, activity_end_date, activity_end_time)
      VALUES ($1,$2,'Activity-only camp',CURRENT_DATE + 1,'Hall','18:00','18:15',CURRENT_DATE + 1,'18:00',CURRENT_DATE + 3,'14:00') RETURNING id`, [unit, helper]);
    await db.query("INSERT INTO activity_tasks (organization_id,activity_id,title,assignee_id,due_date,created_by) VALUES ($1,$2,'Buy food',$3,CURRENT_DATE,$3)", [unit, outing, helper]);
    const result = await campReadinessForActivity(db, unit, outing, { inventory: true, lots: true, tasks: true, permissions: true });
    expect(result.camp).toMatchObject({ id: null, activity_id: outing, theme: 'Activity-only camp', scheduled: false });
    expect(Object.keys(result.sections).sort()).toEqual(['permissions', 'tasks']);
    expect(result.sections.tasks.map((task) => task.title)).toEqual(['Buy food']);
    expect(await campReadinessForActivity(db, other, outing, { tasks: true })).toBeNull();
    const camps = await upcomingCamps(db, unit, 14, 10);
    expect(camps.filter((entry) => entry.activity_id === outing)).toEqual([expect.objectContaining({ id: null, theme: 'Activity-only camp' })]);
    expect(await upcomingCamps(db, other, 14, 10)).not.toEqual(expect.arrayContaining([expect.objectContaining({ activity_id: outing })]));
  });
  test('an activity the year plan schedules as a camp answers with that camp, and is listed once', async () => {
    const result = await campReadinessForActivity(db, unit, activity, { tasks: true });
    expect(result.camp.id).toBe(camp);
    expect(Object.keys(result.sections)).toContain('material');
    await db.query('UPDATE activities SET activity_start_date = CURRENT_DATE + 6, activity_end_date = CURRENT_DATE + 8 WHERE id = $1', [activity]);
    await db.query('UPDATE year_plan_meetings SET meeting_date = CURRENT_DATE + 6 WHERE id = $1', [camp]);
    const listed = (await upcomingCamps(db, unit, 14, 10)).filter((entry) => entry.activity_id === activity);
    expect(listed).toEqual([expect.objectContaining({ id: camp })]);
  });
  test('a one-day outing or a removed activity has no camp overview', async () => {
    const helper = await one('SELECT created_by FROM activities WHERE id = $1', [activity]);
    const outing = await one(`INSERT INTO activities (organization_id, created_by, name, activity_date, meeting_location_going, meeting_time_going,
      departure_time_going, activity_start_date, activity_start_time, activity_end_date, activity_end_time)
      VALUES ($1,$2,'Day hike',CURRENT_DATE + 1,'Hall','09:00','09:15',CURRENT_DATE + 1,'09:00',CURRENT_DATE + 1,'16:00') RETURNING id`, [unit, helper]);
    expect(await campReadinessForActivity(db, unit, outing, {})).toBeNull();
    const removed = await one(`INSERT INTO activities (organization_id, created_by, name, activity_date, meeting_location_going, meeting_time_going,
      departure_time_going, activity_start_date, activity_start_time, activity_end_date, activity_end_time, is_active)
      VALUES ($1,$2,'Removed camp',CURRENT_DATE + 1,'Hall','09:00','09:15',CURRENT_DATE + 1,'09:00',CURRENT_DATE + 2,'16:00',FALSE) RETURNING id`, [unit, helper]);
    expect(await campReadinessForActivity(db, unit, removed, {})).toBeNull();
    expect((await upcomingCamps(db, unit, 14, 10)).map((entry) => entry.theme)).not.toEqual(expect.arrayContaining(['Day hike', 'Removed camp']));
  });
  test('consent deadlines remain ISO instants when the database uses a non-UTC time zone', async () => {
    const participant = await one("INSERT INTO participants (first_name,last_name) VALUES ('Fictional','Camper') RETURNING id");
    await db.query(`INSERT INTO permission_slips (organization_id, participant_id, activity_id, meeting_date, deadline_date)
      VALUES ($1,$2,$3,'2026-11-14','2026-11-10T00:00:00Z')`, [unit, participant, activity]);
    await db.query("SET LOCAL TIME ZONE 'Pacific/Auckland'");
    try {
      const result = JSON.parse(JSON.stringify(await campReadiness(db, unit, camp, { permissions: true })));
      expect(result.sections.permissions).toEqual([{ status: 'pending', count: 1, deadline: '2026-11-10T00:00:00.000Z' }]);
    } finally {
      await db.query("SET LOCAL TIME ZONE 'UTC'");
    }
  });
});
