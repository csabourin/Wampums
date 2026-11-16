/**
 * "Today" is the unit's day, on a migrated PostgreSQL (#1458).
 *
 * The server and the database keep UTC, where the day turns over during an
 * evening meeting in the Americas. Two fictional units sit in the zones the
 * furthest apart on Earth (26 hours): at any instant their calendar days
 * differ, so at least one of them never agrees with the server's own day. Any
 * code that still read the server's day would fail here whenever it runs.
 */
const { Pool } = require('pg');

require('./jest-conditional-helpers');

const { unitToday } = require('../utils/unit-clock');
const { moveUpcomingMeetings } = require('../services/meetingTimeChange');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const EARLIEST_ZONE = 'Pacific/Kiritimati';
const LATEST_ZONE = 'Etc/GMT+12';
const HOURS_APART = 26;

/** The calendar day in a zone, computed without the database. */
const dayIn = (timeZone) => new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());

describe.skipIf(!DATABASE_URL)('the unit\'s clock', () => {
  let pool;
  const ids = {};
  const one = async (sql, params = []) => Object.values((await pool.query(sql, params)).rows[0])[0];
  /** A unit, placed in a time zone or left where units start, with the program section its deferred foreign key expects. */
  const unit = async (name, timeZone) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const id = (await client.query('INSERT INTO organizations (name) VALUES ($1) RETURNING id', [name])).rows[0].id;
      if (timeZone) {
        await client.query('UPDATE organizations SET time_zone = $2 WHERE id = $1', [id, timeZone]);
      }
      await client.query("INSERT INTO organization_program_sections (organization_id, section_key, display_name) VALUES ($1, 'general', 'General')", [id]);
      await client.query('COMMIT');
      return id;
    } finally {
      client.release();
    }
  };
  /** A 19:00 meeting `days` from today in a zone: the day is worked out here, not by the database. */
  const meeting = (unitId, timeZone, days) => one(
    `INSERT INTO year_plan_meetings (organization_id, meeting_date, start_time, end_time, meeting_kind)
     VALUES ($1, $2::date + $3::int, '19:00', '21:00', 'regular') RETURNING id`, [unitId, dayIn(timeZone), days]
  );
  const startOf = (id) => one("SELECT to_char(start_time, 'HH24:MI') FROM year_plan_meetings WHERE id = $1", [id]);

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    ids.early = await unit('Fictional unit of the first sunrise', EARLIEST_ZONE);
    ids.late = await unit('Fictional unit of the last sunset', LATEST_ZONE);
  });

  afterAll(async () => {
    if (pool) {
      const units = [ids.early, ids.late, ids.plain].filter(Boolean);
      await pool.query('DELETE FROM year_plan_meetings WHERE organization_id = ANY($1::int[])', [units]);
      await pool.query('DELETE FROM organizations WHERE id = ANY($1::int[])', [units]);
      await pool.end();
    }
  });

  test('today is the calendar day where the unit is, not where the server is', async () => {
    const early = await unitToday(pool, ids.early);
    const late = await unitToday(pool, ids.late);

    expect(early).toBe(dayIn(EARLIEST_ZONE));
    expect(late).toBe(dayIn(LATEST_ZONE));
    expect(early > late).toBe(true);
  });

  test('the time of day is the one on the unit\'s wall, to compare with an activity\'s hours', async () => {
    const hours = await one(
      'SELECT EXTRACT(EPOCH FROM unit_now($1) - unit_now($2)) / 3600', [ids.early, ids.late]
    );

    expect(Number(hours)).toBe(HOURS_APART);
  });

  test.each([['early', EARLIEST_ZONE], ['late', LATEST_ZONE]])(
    'a meeting held today is still upcoming, and yesterday\'s is past (%s unit)',
    async (key, timeZone) => {
      const tonight = await meeting(ids[key], timeZone, 0);
      const yesterday = await meeting(ids[key], timeZone, -1);
      const client = await pool.connect();
      let moved;
      try {
        await client.query('BEGIN');
        moved = await moveUpcomingMeetings(client, ids[key], '19:00', '18:45');
        await client.query('COMMIT');
      } finally {
        client.release();
      }

      expect(moved).toBe(1);
      expect(await startOf(tonight)).toBe('18:45');
      expect(await startOf(yesterday)).toBe('19:00');
    }
  );

  test('a unit nobody placed is in the default zone, and an unknown unit still gets a day', async () => {
    ids.plain = await unit('Fictional unit without a zone');

    expect(await one('SELECT time_zone FROM organizations WHERE id = $1', [ids.plain])).toBe('America/Toronto');
    expect(await unitToday(pool, ids.plain)).toBe(dayIn('America/Toronto'));
    expect(await one('SELECT unit_today(NULL)::text')).toBe(dayIn('America/Toronto'));
  });

  test('a time zone PostgreSQL does not know is refused', async () => {
    await expect(pool.query("UPDATE organizations SET time_zone = 'Mars/Olympus_Mons' WHERE id = $1", [ids.early]))
      .rejects.toMatchObject({ code: '23514' });
    expect(await one('SELECT time_zone FROM organizations WHERE id = $1', [ids.early])).toBe(EARLIEST_ZONE);
  });
});
