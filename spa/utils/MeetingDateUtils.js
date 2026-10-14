// MeetingDateUtils.js
// Single home for "next/previous meeting date" arithmetic. The server-side
// calendar (year_plan_meetings) is authoritative; these helpers are used to
// pick within a known date list and as a fallback when no plan exists yet.
import { isoToDateString } from './DateUtils.js';

export const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const DAYS_IN_WEEK = 7;
const MINUTES_PER_HOUR = 60;
// Without a known start time, after this hour on meeting day "next meeting"
// rolls to the following week
const EVENING_CUTOFF_HOUR = 20;

/**
 * Whether tonight's meeting has begun: once it has, a leader planning a
 * meeting is planning the next one.
 * @param {string|null} meetingTime - Start time (HH:MM or HH:MM:SS)
 * @param {Date} [now] - Reference moment
 * @returns {boolean}
 */
export function hasMeetingStarted(meetingTime, now = new Date()) {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(meetingTime || ''));
  if (!match) {
    return now.getHours() >= EVENING_CUTOFF_HOUR;
  }
  const minutesNow = now.getHours() * MINUTES_PER_HOUR + now.getMinutes();
  return minutesNow >= Number(match[1]) * MINUTES_PER_HOUR + Number(match[2]);
}

/**
 * First meeting still to come in the calendar. Tonight's meeting counts only
 * until it starts; after that the next one is the one to plan.
 * @param {Array<{date: string, is_cancelled?: boolean}>} meetings - Calendar
 * @param {{meetingTime?: string|null, now?: Date}} [options]
 * @returns {string|null} Meeting date (YYYY-MM-DD)
 */
export function firstUpcomingMeetingDate(meetings, { meetingTime = null, now = new Date() } = {}) {
  const today = toLocalDateString(now);
  const tonightIsOver = hasMeetingStarted(meetingTime, now);
  return (meetings || [])
    .filter(meeting => !meeting.is_cancelled)
    .map(meeting => normalizeDateString(meeting.date))
    .filter(date => date > today || (date === today && !tonightIsOver))
    .sort((a, b) => a.localeCompare(b))[0] || null;
}

/**
 * Format a Date as a local YYYY-MM-DD string (never use toISOString for this —
 * it shifts the date across midnight in non-UTC timezones).
 * @param {Date} date - Date instance
 * @returns {string} Local date string
 */
export function toLocalDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Normalize any date-ish string to YYYY-MM-DD.
 * @param {string} value - Date string (possibly ISO with time part)
 * @returns {string} YYYY-MM-DD or ''
 */
export function normalizeDateString(value) {
  if (!value) {
    return '';
  }
  return String(value).includes('T') ? String(value).split('T')[0] : String(value);
}

/**
 * Compute the next occurrence of the organization's meeting day.
 * Fallback for organizations without a year plan.
 * @param {string} meetingDay - Day name (e.g., 'Tuesday')
 * @param {Date} [from] - Reference date (defaults to now)
 * @param {string} [meetingTime] - Start time (HH:MM); on meeting day, once it
 *   has passed, the following week is next
 * @returns {string} Next meeting date (YYYY-MM-DD)
 */
export function getNextWeekdayDate(meetingDay, from = new Date(), meetingTime = null) {
  const targetIndex = DAYS_OF_WEEK.indexOf(meetingDay);
  const reference = new Date(from);
  if (targetIndex === -1) {
    return toLocalDateString(reference);
  }

  let daysUntil = (targetIndex - reference.getDay() + DAYS_IN_WEEK) % DAYS_IN_WEEK;
  if (daysUntil === 0 && hasMeetingStarted(meetingTime, reference)) {
    daysUntil = DAYS_IN_WEEK;
  }

  const next = new Date(reference);
  next.setDate(reference.getDate() + daysUntil);
  return toLocalDateString(next);
}

/**
 * Find the first date in a list strictly after the given date.
 * @param {string[]} dates - Date strings
 * @param {string} date - Reference date
 * @returns {string|null}
 */
export function nextDateAfter(dates, date) {
  const reference = normalizeDateString(date);
  if (!reference) {
    return null;
  }
  return (dates || [])
    .map(normalizeDateString)
    .filter(Boolean)
    .filter(d => d > reference)
    .sort((a, b) => a.localeCompare(b))[0] || null;
}

/**
 * Find the last date in a list strictly before the given date.
 * @param {string[]} dates - Date strings
 * @param {string} date - Reference date
 * @returns {string|null}
 */
export function previousDateBefore(dates, date) {
  const reference = normalizeDateString(date);
  if (!reference) {
    return null;
  }
  const earlier = (dates || [])
    .map(normalizeDateString)
    .filter(Boolean)
    .filter(d => d < reference)
    .sort((a, b) => a.localeCompare(b));
  return earlier.length > 0 ? earlier[earlier.length - 1] : null;
}

/**
 * Add one week to a date string.
 * @param {string} date - Date (YYYY-MM-DD)
 * @returns {string|null} Date one week later
 */
export function addOneWeek(date) {
  const normalized = normalizeDateString(date);
  if (!normalized) {
    return null;
  }
  const parsed = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  parsed.setDate(parsed.getDate() + DAYS_IN_WEEK);
  return isoToDateString(parsed);
}
