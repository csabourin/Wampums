/**
 * The programme a unit runs on one day: a regular meeting's timeline, or one
 * day of a camp or weekend that spans several days.
 *
 * Read by the leaders' "now / next" bar, which only needs, for each planned
 * activity, when it starts, how long it lasts, who leads it and what to bring.
 *
 * @module services/meetingProgramme
 */

const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const TIME_PATTERN = /^(\d{1,2}):(\d{2})/;
const DURATION_PATTERN = /^(\d{1,2}):(\d{2})$/;
const TIME_PART_WIDTH = 2;

/**
 * Convert a legacy "HH:MM" duration (or plain minutes) to minutes.
 *
 * @param {string|number|null} duration - Duration value
 * @returns {number|null} Minutes, or null when it cannot be read
 */
function durationToMinutes(duration) {
  if (duration === null || duration === undefined || duration === '') {
    return null;
  }
  if (typeof duration === 'number') {
    return duration;
  }
  const text = String(duration);
  if (/^\d+$/.test(text)) {
    return parseInt(text, 10);
  }
  const match = text.match(DURATION_PATTERN);
  if (!match) {
    return null;
  }
  return parseInt(match[1], 10) * MINUTES_PER_HOUR + parseInt(match[2], 10);
}

/**
 * A time of day as "HH:MM", or null when the value is not one.
 *
 * @param {string|null} value - "HH:MM" or "HH:MM:SS"
 * @returns {string|null}
 */
function toClockTime(value) {
  const match = String(value || '').match(TIME_PATTERN);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours >= HOURS_PER_DAY || minutes >= MINUTES_PER_HOUR) {
    return null;
  }
  return `${String(hours).padStart(TIME_PART_WIDTH, '0')}:${match[2]}`;
}

/**
 * One planned activity as the bar reads it. Older meeting preparations kept
 * the time and duration only in the timeline they were typed into
 * (metadata.legacy), so those are read as a fallback.
 *
 * @param {Object} row - year_plan_meeting_activities row
 * @returns {{id: number, time: ?string, duration_minutes: ?number, name: string, leader: string, material: string}}
 */
function toProgrammeActivity(row) {
  const legacy = row.legacy || {};
  const duration = row.duration_minutes ?? durationToMinutes(legacy.duration);
  return {
    id: row.id,
    time: toClockTime(row.start_time) || toClockTime(legacy.time),
    duration_minutes: Number.isFinite(duration) && duration > 0 ? duration : null,
    name: row.name,
    leader: row.responsable || '',
    material: row.material || '',
  };
}

/**
 * The programme running on a date in a unit, or null when nothing is planned.
 *
 * A camp covers every day from its meeting date to its activity's end date;
 * the day's own activities are those at that day offset. When a regular
 * meeting falls on a day a longer event also covers, the one that started
 * last (the more specific) is shown.
 *
 * @param {import('pg').Pool} pool - Database pool
 * @param {number} organizationId - Unit
 * @param {string} date - Day, YYYY-MM-DD, in the leader's own calendar
 * @returns {Promise<?Object>} Programme, activities in time order (untimed last)
 */
async function getProgrammeForDate(pool, organizationId, date) {
  const meetingResult = await pool.query(
    `WITH spans AS (
       SELECT m.id, m.meeting_kind, m.theme, m.meeting_date,
              act.name AS activity_name,
              GREATEST(
                1,
                COALESCE(act.activity_end_date, act.activity_start_date, act.activity_date, m.meeting_date)
                  - m.meeting_date + 1
              )::integer AS span_days
         FROM year_plan_meetings m
         LEFT JOIN activities act
                ON act.id = m.activity_id
               AND act.organization_id = m.organization_id
               AND act.is_active = TRUE
        WHERE m.organization_id = $1
          AND m.is_cancelled = FALSE
          AND m.meeting_date <= $2::date
     )
     SELECT id, meeting_kind, theme, activity_name, span_days,
            meeting_date::text AS meeting_date,
            ($2::date - meeting_date)::integer AS day_offset
       FROM spans
      WHERE $2::date < meeting_date + span_days
      ORDER BY meeting_date DESC, id DESC
      LIMIT 1`,
    [organizationId, date]
  );
  const meeting = meetingResult.rows[0];
  if (!meeting) {
    return null;
  }

  const [activitiesResult, dayResult] = await Promise.all([
    pool.query(
      `SELECT id, name, start_time::text AS start_time, duration_minutes, responsable, material,
              metadata->'legacy' AS legacy
         FROM year_plan_meeting_activities
        WHERE meeting_id = $1 AND organization_id = $2 AND day_offset = $3
        ORDER BY sort_order, id`,
      [meeting.id, organizationId, meeting.day_offset]
    ),
    pool.query(
      `SELECT title FROM year_plan_meeting_days
        WHERE meeting_id = $1 AND organization_id = $2 AND day_offset = $3`,
      [meeting.id, organizationId, meeting.day_offset]
    ),
  ]);

  const activities = activitiesResult.rows.map(toProgrammeActivity);
  const timed = activities.filter((activity) => activity.time)
    .sort((a, b) => a.time.localeCompare(b.time));
  const untimed = activities.filter((activity) => !activity.time);

  return {
    meeting_id: meeting.id,
    kind: meeting.meeting_kind,
    date,
    title: dayResult.rows[0]?.title || meeting.theme || meeting.activity_name || null,
    day_number: meeting.day_offset + 1,
    day_count: meeting.span_days,
    activities: [...timed, ...untimed],
  };
}

module.exports = {
  durationToMinutes,
  getProgrammeForDate,
};
