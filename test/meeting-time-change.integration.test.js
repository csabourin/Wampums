/**
 * Changing a unit's usual meeting time moves its upcoming planned meetings
 * still at the old hour, on a migrated PostgreSQL.
 *
 * The yearly planner copied the unit's meeting time into each meeting it
 * generated; a unit that moved from 19:00 to 18:45 kept seeing 19:00.
 */
const { Pool } = require('pg');

require('./jest-conditional-helpers');

const { currentMeetingTime, moveUpcomingMeetings } = require('../services/meetingTimeChange');

const DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!DATABASE_URL)('moving upcoming meetings to a new usual time', () => {
  let pool;
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
  /** A planned meeting `days` from today, with its hours and kind. */
  const meeting = (unitId, days, fields = {}) => one(
    `INSERT INTO year_plan_meetings (organization_id, meeting_date, start_time, end_time, meeting_kind, is_cancelled, activity_id)
     VALUES ($1, CURRENT_DATE + $2::int, $3, $4, $5, $6, $7) RETURNING id`,
    [unitId, days, fields.start ?? '19:00', 'end' in fields ? fields.end : '21:00', fields.kind ?? 'regular',
      fields.cancelled ?? false, fields.activityId ?? null]
  );
  const hours = async (id) => (await pool.query(
    "SELECT to_char(start_time, 'HH24:MI') AS start, to_char(end_time, 'HH24:MI') AS end FROM year_plan_meetings WHERE id = $1", [id]
  )).rows[0];
  /** Run the move in one transaction, as the settings route does. */
  const move = async (unitId, from, to) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const moved = await moveUpcomingMeetings(client, unitId, from, to);
      await client.query('COMMIT');
      return moved;
    } finally {
      client.release();
    }
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    ids.unit = await unit('Fictional meeting-time unit');
    ids.other = await unit('Another fictional unit');
    ids.user = await one(`INSERT INTO users (email, password, full_name, is_verified)
      VALUES ('meeting-time-' || gen_random_uuid() || '@example.test', 'x', 'Ada Lovelace', TRUE) RETURNING id`);
    ids.outing = await one(`INSERT INTO activities (organization_id, created_by, name, activity_date, meeting_location_going,
        meeting_time_going, departure_time_going, activity_start_date, activity_start_time, activity_end_date, activity_end_time)
      VALUES ($1, $2, 'Sortie au musée', CURRENT_DATE + 21, 'Hall', '09:00', '09:15', CURRENT_DATE + 21, '09:00', CURRENT_DATE + 21, '16:00')
      RETURNING id`, [ids.unit, ids.user]);
  });

  afterAll(async () => {
    if (pool) {
      await pool.query('DELETE FROM year_plan_meetings WHERE organization_id = ANY($1::int[])', [[ids.unit, ids.other]]);
      await pool.query('DELETE FROM activities WHERE organization_id = ANY($1::int[])', [[ids.unit, ids.other]]);
      await pool.query('DELETE FROM organizations WHERE id = ANY($1::int[])', [[ids.unit, ids.other]]);
      await pool.query('DELETE FROM users WHERE id = $1', [ids.user]);
      await pool.end();
    }
  });

  test('upcoming ordinary meetings at the old hour move, their end by the same amount', async () => {
    const next = await meeting(ids.unit, 2);
    const later = await meeting(ids.unit, 9, { end: null });

    expect(await move(ids.unit, '19:00', '18:45')).toBe(2);
    expect(await hours(next)).toEqual({ start: '18:45', end: '20:45' });
    expect(await hours(later)).toEqual({ start: '18:45', end: null });
  });

  test('a meeting set to another hour, a past, cancelled or special one, and an outing\'s day keep theirs', async () => {
    const kept = await Promise.all([
      meeting(ids.unit, 3, { start: '18:00', end: '20:00' }),
      meeting(ids.unit, -7),
      meeting(ids.unit, 4, { cancelled: true }),
      meeting(ids.unit, 5, { kind: 'weekend' }),
      meeting(ids.unit, 21, { activityId: ids.outing }),
    ]);
    const before = await Promise.all(kept.map(hours));

    expect(await move(ids.unit, '19:00', '18:30')).toBe(0);
    expect(await Promise.all(kept.map(hours))).toEqual(before);
  });

  test('another unit\'s meetings never move', async () => {
    const theirs = await meeting(ids.other, 6);
    await move(ids.unit, '19:00', '18:15');
    expect(await hours(theirs)).toEqual({ start: '19:00', end: '21:00' });
  });

  test('the old hour is the unit\'s setting, or the default the year was generated with', async () => {
    const client = await pool.connect();
    try {
      expect(await currentMeetingTime(client, ids.other)).toBe('19:00');
      await client.query(`INSERT INTO organization_settings (organization_id, setting_key, setting_value)
        VALUES ($1, 'organization_info', '{"meeting_time": "18:45"}'::jsonb)`, [ids.other]);
      expect(await currentMeetingTime(client, ids.other)).toBe('18:45');
    } finally {
      await client.query('DELETE FROM organization_settings WHERE organization_id = $1', [ids.other]);
      client.release();
    }
  });
});
