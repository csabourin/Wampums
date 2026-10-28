/** Team overview against the migrated schema, with fictional unit and camp records. */
const { Pool } = require('pg');
const { campReadiness } = require('../services/campReadiness');
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
