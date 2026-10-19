/**
 * The day's programme — integration suite
 *
 * Which planned meeting covers a date is decided in SQL, so it is checked on a
 * real database: a regular meeting on its own day, every day of a camp whose
 * outing spans several days (and not the day after), a cancelled meeting never,
 * and another unit's plan never.
 *
 * Skipped unless TEST_DATABASE_URL points at a disposable database holding the
 * project schema and migrations.
 *
 * @module test/meeting-programme.integration
 */

const { Pool } = require('pg');

require('./jest-conditional-helpers');

const { getProgrammeForDate } = require('../services/meetingProgramme');

const DATABASE_URL = process.env.SCOUT_YEAR_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL;

describe.skipIf(!DATABASE_URL)('The programme running on a day', () => {
  let pool;
  const ids = {};

  /**
   * @param {string} sql - Query returning one row and one column
   * @param {Array} params - Query parameters
   * @returns {Promise<*>} The value, or undefined
   */
  async function one(sql, params = []) {
    const result = await pool.query(sql, params);
    return result.rows[0] ? Object.values(result.rows[0])[0] : undefined;
  }

  /**
   * A unit with its program section.
   *
   * @param {string} name - Unit name
   * @returns {Promise<number>} Organization ID
   */
  async function createUnit(name) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const organizationId = (await client.query('INSERT INTO organizations (name) VALUES ($1) RETURNING id', [name])).rows[0].id;
      await client.query(
        `INSERT INTO organization_program_sections (organization_id, section_key, display_name)
         VALUES ($1, 'general', 'General')`,
        [organizationId]
      );
      await client.query('COMMIT');
      return organizationId;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * A planned meeting, optionally tied to an outing that ends later.
   *
   * @param {number} organizationId - Unit
   * @param {Object} meeting
   * @param {string} meeting.date - First day
   * @param {string} [meeting.kind='regular'] - meeting_kind
   * @param {string} [meeting.theme] - Theme
   * @param {string} [meeting.endDate] - Last day of the tied outing
   * @param {boolean} [meeting.cancelled=false] - Cancelled
   * @returns {Promise<number>} Meeting ID
   */
  async function plan(organizationId, { date, kind = 'regular', theme = null, endDate = null, cancelled = false }) {
    let activityId = null;
    if (endDate) {
      const creator = await one(
        `INSERT INTO users (email, password, full_name)
         VALUES ('creator-' || gen_random_uuid() || '@example.test', 'x', 'Creator') RETURNING id`
      );
      activityId = await one(
        `INSERT INTO activities (organization_id, created_by, name, activity_date, meeting_location_going,
                                 meeting_time_going, departure_time_going, activity_start_date, activity_start_time,
                                 activity_end_date, activity_end_time)
         VALUES ($1, $2, 'Camp d’automne', $3, 'Base', '08:30', '09:00', $3, '09:00', $4, '15:00')
         RETURNING id`,
        [organizationId, creator, date, endDate]
      );
    }
    return one(
      `INSERT INTO year_plan_meetings (organization_id, meeting_date, meeting_kind, theme, is_cancelled, activity_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [organizationId, date, kind, theme, cancelled, activityId]
    );
  }

  /**
   * @param {number} organizationId - Unit
   * @param {number} meetingId - Meeting
   * @param {Object} activity - day_offset, name, start_time, duration_minutes, responsable, material
   */
  async function addActivity(organizationId, meetingId, activity) {
    await pool.query(
      `INSERT INTO year_plan_meeting_activities
         (organization_id, meeting_id, day_offset, name, start_time, duration_minutes, responsable, material, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [organizationId, meetingId, activity.day_offset || 0, activity.name, activity.start_time || null,
        activity.duration_minutes || null, activity.responsable || null, activity.material || null, activity.sort_order || 0]
    );
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    ids.unit = await createUnit('Programme unit');
    ids.otherUnit = await createUnit('Other unit');

    ids.meeting = await plan(ids.unit, { date: '2031-03-07', theme: 'La jungle' });
    await addActivity(ids.unit, ids.meeting, { name: 'Histoire de la jungle', start_time: '19:25', duration_minutes: 20, responsable: 'Akela', sort_order: 2 });
    await addActivity(ids.unit, ids.meeting, { name: 'Jeu de la tanière', start_time: '19:00', duration_minutes: 25, responsable: 'Baloo', material: 'Foulards', sort_order: 1 });

    ids.camp = await plan(ids.unit, { date: '2031-04-10', kind: 'camp', theme: 'Camp d’automne', endDate: '2031-04-12' });
    await pool.query(
      `INSERT INTO year_plan_meeting_days (organization_id, meeting_id, day_offset, title)
       VALUES ($1, $2, 1, 'La piste du loup')`,
      [ids.unit, ids.camp]
    );
    await addActivity(ids.unit, ids.camp, { day_offset: 0, name: 'Montage des tentes', start_time: '14:00', duration_minutes: 90 });
    await addActivity(ids.unit, ids.camp, { day_offset: 1, name: 'Grand jeu en forêt', start_time: '09:30', duration_minutes: 150, responsable: 'Akela' });
    await addActivity(ids.unit, ids.camp, { day_offset: 2, name: 'Démontage', start_time: '10:00', duration_minutes: 60 });

    ids.cancelled = await plan(ids.unit, { date: '2031-05-02', cancelled: true });
    await addActivity(ids.unit, ids.cancelled, { name: 'Annulée', start_time: '19:00', duration_minutes: 30 });

    ids.otherMeeting = await plan(ids.otherUnit, { date: '2031-03-07' });
    await addActivity(ids.otherUnit, ids.otherMeeting, { name: 'Autre unité', start_time: '19:00', duration_minutes: 30 });
  });

  afterAll(async () => {
    if (pool) {
      await pool.query('DELETE FROM organizations WHERE id = ANY($1::int[])', [[ids.unit, ids.otherUnit].filter(Boolean)]);
      await pool.end();
    }
  });

  test('a meeting day lists its activities in time order, with who leads them', async () => {
    const programme = await getProgrammeForDate(pool, ids.unit, '2031-03-07');

    expect(programme).toMatchObject({ meeting_id: ids.meeting, kind: 'regular', title: 'La jungle', day_number: 1, day_count: 1 });
    expect(programme.activities.map((a) => [a.time, a.name, a.leader, a.material])).toEqual([
      ['19:00', 'Jeu de la tanière', 'Baloo', 'Foulards'],
      ['19:25', 'Histoire de la jungle', 'Akela', ''],
    ]);
  });

  test('each day of a camp shows that day’s activities, under the day’s title when it has one', async () => {
    const first = await getProgrammeForDate(pool, ids.unit, '2031-04-10');
    const second = await getProgrammeForDate(pool, ids.unit, '2031-04-11');
    const last = await getProgrammeForDate(pool, ids.unit, '2031-04-12');

    expect(first).toMatchObject({ meeting_id: ids.camp, kind: 'camp', title: 'Camp d’automne', day_number: 1, day_count: 3 });
    expect(first.activities.map((a) => a.name)).toEqual(['Montage des tentes']);
    expect(second).toMatchObject({ title: 'La piste du loup', day_number: 2 });
    expect(second.activities.map((a) => a.name)).toEqual(['Grand jeu en forêt']);
    expect(last.activities.map((a) => a.name)).toEqual(['Démontage']);
  });

  test('the day after a camp, the day before a meeting, and a cancelled meeting have no programme', async () => {
    await expect(getProgrammeForDate(pool, ids.unit, '2031-04-13')).resolves.toBeNull();
    await expect(getProgrammeForDate(pool, ids.unit, '2031-03-06')).resolves.toBeNull();
    await expect(getProgrammeForDate(pool, ids.unit, '2031-05-02')).resolves.toBeNull();
  });

  test('another unit’s meeting on the same day stays its own', async () => {
    const programme = await getProgrammeForDate(pool, ids.unit, '2031-03-07');
    const other = await getProgrammeForDate(pool, ids.otherUnit, '2031-03-07');

    expect(programme.activities.map((a) => a.name)).not.toContain('Autre unité');
    expect(other.activities.map((a) => a.name)).toEqual(['Autre unité']);
  });
});
