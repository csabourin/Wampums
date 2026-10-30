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
    await client.query(
      'UPDATE year_plan_meetings SET meeting_date = $1, updated_at = NOW() WHERE id = $2 AND organization_id = $3',
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

module.exports = { MAX_EVENT_DAYS, CampDateError, eventDays, isTooLong, alignPlannedDate, planCamp, unplanCamp };
