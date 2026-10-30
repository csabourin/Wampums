/**
 * One set of dates for a camp: its activity and the year-plan date it is planned on.
 *
 * A camp planned in the year plan is a `year_plan_meetings` row (its first day) linked to an
 * `activities` row (its whole span). Editing either moves both, in the caller's transaction,
 * so the calendar, the activities, camp readiness and the camp schedule never disagree.
 */

/** The longest event a unit records, in days; a longer one is almost always a mistyped year. Shared with the SPA. */
const MAX_EVENT_DAYS = require('../config/event_limits.json').max_event_days;
const HTTP_CONFLICT = 409;
const MS_PER_DAY = 86400000;

class CampDateError extends Error {
  /** @param {string} code - Translation key the SPA explains @param {number} status */
  constructor(code, status = HTTP_CONFLICT) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

/**
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @returns {number} Calendar days covered, the first and last included
 */
function eventDays(startDate, endDate) {
  return Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / MS_PER_DAY) + 1;
}

/** @returns {boolean} Whether an event of these dates is longer than any a unit records */
function isTooLong(startDate, endDate) {
  return eventDays(startDate, endDate) > MAX_EVENT_DAYS;
}

/**
 * Move the year-plan date linked to an activity onto the activity's new dates.
 * Refuses, with a translated code, a first day another date of the unit already holds,
 * and a shorter camp that would leave schedule lines on days it no longer has.
 *
 * @param {Object} client - pg client inside the caller's transaction
 * @param {number} organizationId - Authenticated unit
 * @param {number} activityId - The activity just updated
 * @param {string} startDate - Its first day, YYYY-MM-DD
 * @param {string} endDate - Its last day, YYYY-MM-DD
 * @returns {Promise<number|null>} The planned date moved, or null when none is linked
 * @throws {CampDateError}
 */
async function alignPlannedDate(client, organizationId, activityId, startDate, endDate) {
  const planned = (await client.query(
    `SELECT id, meeting_date::text AS meeting_date FROM year_plan_meetings
      WHERE organization_id = $1 AND activity_id = $2 ORDER BY id LIMIT 1 FOR UPDATE`,
    [organizationId, activityId]
  )).rows[0];
  if (!planned) { return null; }
  const outside = await client.query(
    `SELECT 1 FROM year_plan_meeting_activities
      WHERE organization_id = $1 AND meeting_id = $2 AND day_offset >= $3 LIMIT 1`,
    [organizationId, planned.id, eventDays(startDate, endDate)]
  );
  if (outside.rows.length) { throw new CampDateError('camp_schedule_outside_dates'); }
  if (planned.meeting_date !== startDate) {
    const taken = await client.query(
      'SELECT 1 FROM year_plan_meetings WHERE organization_id = $1 AND meeting_date = $2 AND id <> $3 LIMIT 1',
      [organizationId, startDate, planned.id]
    );
    if (taken.rows.length) { throw new CampDateError('camp_date_taken'); }
    // A year plan lists its own dates: a camp moved into another plan's year follows it there.
    await client.query(
      `UPDATE year_plan_meetings m SET meeting_date = $1, updated_at = NOW(),
         year_plan_id = COALESCE((SELECT p.id FROM year_plans p
           WHERE p.organization_id = m.organization_id AND p.is_active = TRUE
             AND p.start_date <= $1::date AND p.end_date >= $1::date
           ORDER BY (p.id = m.year_plan_id) DESC, p.start_date DESC, p.id DESC LIMIT 1), m.year_plan_id)
       WHERE m.id = $2 AND m.organization_id = $3`,
      [startDate, planned.id, organizationId]
    );
  }
  return planned.id;
}

/**
 * Put a camp recorded as an activity on the year plan covering its first day, so it appears
 * there as a camp. A free date, or an ordinary date there, becomes the camp; a date already
 * holding another activity is left alone, as is a camp no active plan covers.
 *
 * @param {Object} client - pg client inside the caller's transaction
 * @param {number} organizationId - Authenticated unit
 * @param {number} activityId - The saved activity
 * @returns {Promise<number|null>} The planned date, or null when it could not be planned
 */
async function planCamp(client, organizationId, activityId) {
  const linked = (await client.query(
    `UPDATE year_plan_meetings SET meeting_kind = 'camp', updated_at = NOW()
      WHERE organization_id = $1 AND activity_id = $2 RETURNING id`,
    [organizationId, activityId]
  )).rows[0];
  if (linked) { return linked.id; }
  const activity = (await client.query(
    `SELECT id, name, activity_start_date::text AS start_date, activity_start_time, meeting_location_going
       FROM activities WHERE organization_id = $1 AND id = $2 AND is_active = TRUE`,
    [organizationId, activityId]
  )).rows[0];
  if (!activity) { return null; }
  const startDate = activity.start_date;
  const plan = (await client.query(
    `SELECT id FROM year_plans
      WHERE organization_id = $1 AND is_active = TRUE AND start_date <= $2::date AND end_date >= $2::date
      ORDER BY start_date DESC, id DESC LIMIT 1`,
    [organizationId, startDate]
  )).rows[0];
  if (!plan) { return null; }
  const planned = (await client.query(
    `INSERT INTO year_plan_meetings
       (organization_id, year_plan_id, meeting_date, start_time, location, theme, meeting_kind, activity_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, 'camp', $7, '{}'::jsonb)
     ON CONFLICT (organization_id, meeting_date) DO UPDATE SET
       year_plan_id = EXCLUDED.year_plan_id,
       meeting_kind = 'camp',
       activity_id = EXCLUDED.activity_id,
       theme = COALESCE(year_plan_meetings.theme, EXCLUDED.theme),
       updated_at = NOW()
     WHERE year_plan_meetings.activity_id IS NULL
     RETURNING id`,
    [organizationId, plan.id, startDate, activity.activity_start_time || null,
      activity.meeting_location_going || null, activity.name, activity.id]
  )).rows[0];
  return planned ? planned.id : null;
}

/**
 * An activity is no longer a camp: its planned date stays, as an outing of several days.
 * @param {Object} client - pg client inside the caller's transaction
 * @param {number} organizationId
 * @param {number} activityId
 * @returns {Promise<void>}
 */
async function unplanCamp(client, organizationId, activityId) {
  await client.query(
    `UPDATE year_plan_meetings SET meeting_kind = 'weekend', updated_at = NOW()
      WHERE organization_id = $1 AND activity_id = $2 AND meeting_kind = 'camp'`,
    [organizationId, activityId]
  );
}

/**
 * Refuse to move an activity's dates while something recorded for its current dates would be
 * left behind: volunteer shifts outside the new dates, equipment reserved for it, or attendance
 * already taken on the days of its planned camp. Each is moved or removed first, on its own screen.
 *
 * @param {Object} client - pg client inside the caller's transaction
 * @param {number} organizationId
 * @param {number} activityId
 * @param {{start: string, end: string}} from - Current first and last days
 * @param {{start: string, end: string}} to - New first and last days
 * @throws {CampDateError}
 */
async function assertMovable(client, organizationId, activityId, from, to) {
  if (from.start === to.start && from.end === to.end) { return; }
  const shifts = await client.query(
    `SELECT 1 FROM volunteer_shifts WHERE organization_id = $1 AND activity_id = $2
        AND (shift_date < $3::date OR shift_date > $4::date) LIMIT 1`,
    [organizationId, activityId, to.start, to.end]
  );
  if (shifts.rows.length) { throw new CampDateError('volunteer_shifts_outside_dates'); }
  const reserved = await client.query(
    `SELECT 1 FROM equipment_reservations r
      WHERE r.organization_id = $1 AND r.status IN ('reserved', 'confirmed')
        AND (r.activity_id = $2 OR r.meeting_id IN (
          SELECT m.id FROM year_plan_meetings m WHERE m.organization_id = $1 AND m.activity_id = $2))
      LIMIT 1`,
    [organizationId, activityId]
  );
  if (reserved.rows.length) { throw new CampDateError('camp_reservations_need_moving'); }
  const attended = await client.query(
    `SELECT 1 FROM attendance a
      WHERE a.organization_id = $1 AND a.date BETWEEN $3::date AND $4::date
        AND EXISTS (SELECT 1 FROM year_plan_meetings m WHERE m.organization_id = $1 AND m.activity_id = $2)
      LIMIT 1`,
    [organizationId, activityId, from.start, from.end]
  );
  if (attended.rows.length) { throw new CampDateError('camp_attendance_recorded'); }
}

module.exports = { MAX_EVENT_DAYS, CampDateError, eventDays, isTooLong, alignPlannedDate, assertMovable, planCamp, unplanCamp };
