/**
 * Which day the attendance screen opens on.
 *
 * Opened on a day with nothing planned (a Sunday after a Friday meeting), the
 * screen used to show an empty list for today, and the leader had to find the
 * meeting in the date picker. It now opens on today when today is a meeting,
 * an activity day or already has attendance, and otherwise on the most recent
 * such day of the past week: the meeting whose attendance is being completed.
 * Older days and days to come stay one choice away in the picker.
 *
 * @module spa/modules/attendance/AttendanceDefaultDate
 */

/** How far back, in days, a recent meeting is still the one being completed. */
export const RECENT_MEETING_WINDOW_DAYS = 6;

const MS_PER_DAY = 86400000;

/**
 * @param {string} isoDate - YYYY-MM-DD
 * @returns {number} Days since the epoch, in UTC
 */
function dayNumber(isoDate) {
  return Math.round(Date.parse(`${isoDate}T00:00:00Z`) / MS_PER_DAY);
}

/**
 * The day the screen should open on.
 *
 * @param {Array<string>} serverDates - Days the server lists (YYYY-MM-DD): attendance taken,
 *   meetings prepared, activity days
 * @param {string} today - Today, YYYY-MM-DD
 * @returns {string} The day to open, YYYY-MM-DD
 */
export function defaultAttendanceDate(serverDates, today) {
  const dates = Array.isArray(serverDates) ? serverDates : [];
  if (dates.includes(today)) {
    return today;
  }
  const todayNumber = dayNumber(today);
  const recent = dates
    .filter((date) => {
      const age = todayNumber - dayNumber(date);
      return age > 0 && age <= RECENT_MEETING_WINDOW_DAYS;
    })
    .sort()
    .pop();
  return recent || today;
}
