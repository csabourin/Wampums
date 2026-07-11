/**
 * Shared organization meeting defaults.
 *
 * Single source of truth for the default meeting day, start time, duration and
 * location of an organization. Used by both the yearly planner (meeting
 * generation) and the meeting preparation endpoints so the two features can
 * never disagree on defaults again.
 *
 * Duration precedence: meeting_length.duration_minutes setting, then
 * organization_info.meeting_duration, then DEFAULT_MEETING_DURATION_MINUTES.
 *
 * @module utils/meeting-defaults
 */

const DEFAULT_MEETING_DAY = 'Wednesday';
const DEFAULT_MEETING_TIME = '19:00';
const DEFAULT_MEETING_DURATION_MINUTES = 90;

/**
 * Parse a raw organization_settings.setting_value (jsonb or string) to object.
 * @param {object|string|null} rawValue - Raw column value
 * @returns {object} Parsed object (empty object on failure)
 */
function parseSetting(rawValue) {
  if (!rawValue) {
    return {};
  }
  if (typeof rawValue === 'object') {
    return rawValue;
  }
  try {
    return JSON.parse(rawValue);
  } catch (err) {
    return {};
  }
}

/**
 * Load meeting defaults for an organization.
 * @param {Object} pool - Database connection pool
 * @param {number} organizationId - Organization identifier
 * @returns {Promise<{meetingDay: string, meetingTime: string, durationMinutes: number, location: string}>}
 */
async function getMeetingDefaults(pool, organizationId) {
  const result = await pool.query(
    `SELECT setting_key, setting_value FROM organization_settings
     WHERE organization_id = $1 AND setting_key IN ('organization_info', 'meeting_length')`,
    [organizationId]
  );

  let orgInfo = {};
  let meetingLength = {};
  for (const row of result.rows) {
    if (row.setting_key === 'organization_info') {
      orgInfo = parseSetting(row.setting_value);
    } else if (row.setting_key === 'meeting_length') {
      meetingLength = parseSetting(row.setting_value);
    }
  }

  const durationMinutes =
    parseInt(meetingLength.duration_minutes, 10) ||
    parseInt(orgInfo.meeting_duration, 10) ||
    DEFAULT_MEETING_DURATION_MINUTES;

  return {
    meetingDay: orgInfo.meeting_day || DEFAULT_MEETING_DAY,
    meetingTime: orgInfo.meeting_time || DEFAULT_MEETING_TIME,
    durationMinutes,
    location: orgInfo.endroit || ''
  };
}

/**
 * Compute the end time ("HH:MM") from a start time and a duration.
 * @param {string} startTime - Start time "HH:MM"
 * @param {number} durationMinutes - Duration in minutes
 * @returns {string} End time "HH:MM" (wraps past midnight)
 */
function computeEndTime(startTime, durationMinutes) {
  const MINUTES_PER_HOUR = 60;
  const HOURS_PER_DAY = 24;
  const [hours, minutes] = String(startTime).split(':').map(Number);
  const total = ((hours || 0) * MINUTES_PER_HOUR + (minutes || 0) + (durationMinutes || 0));
  const endHours = Math.floor(total / MINUTES_PER_HOUR) % HOURS_PER_DAY;
  const endMinutes = total % MINUTES_PER_HOUR;
  return `${String(endHours).padStart(2, '0')}:${String(endMinutes).padStart(2, '0')}`;
}

/**
 * Format a Date as a local YYYY-MM-DD string (timezone-safe, unlike toISOString).
 * @param {Date} date - Date instance
 * @returns {string} Local date string
 */
function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

module.exports = {
  getMeetingDefaults,
  computeEndTime,
  formatLocalDate,
  DEFAULT_MEETING_DURATION_MINUTES
};
