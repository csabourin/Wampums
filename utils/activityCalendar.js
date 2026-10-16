'use strict';

/**
 * The unit's activities as an iCalendar (RFC 5545) document: downloaded once
 * (GET /api/v1/activities/calendar.ics) or subscribed to by a calendar app
 * (GET /api/v1/calendar-feeds/:token.ics). Both read the same events.
 *
 * @module utils/activityCalendar
 */

const ICAL_PROD_ID = '-//Wampums//Activities Calendar//EN';
const ICAL_MAX_LINE_OCTETS = 75;

/**
 * How often a subscribed calendar app is asked to fetch again. Outings are
 * planned days ahead; a few hours keeps a change visible the same day without
 * every phone polling the server.
 */
const SUBSCRIPTION_REFRESH = 'PT6H';

/** Digits of each date-time field (month, day, hour…) in an iCalendar value. */
const ICAL_FIELD_DIGITS = 2;

/** "YYYY-MM-DD", the date part of an ISO timestamp, used in file names. */
const ISO_DATE_LENGTH = 10;

/**
 * Escape iCalendar text values according to RFC 5545.
 * @param {string} value
 * @returns {string}
 */
const escapeICalText = (value = '') => String(value)
  .replace(/\\/g, '\\\\')
  .replace(/\n/g, '\\n')
  .replace(/\r/g, '')
  .replace(/,/g, '\\,')
  .replace(/;/g, '\\;');

/**
 * Format local date and time values to a floating iCalendar date-time value.
 *
 * We intentionally do not append a timezone suffix (e.g., "Z") because
 * activities currently do not store timezone context. Floating values preserve
 * the originally entered local wall time for calendar clients.
 *
 * @param {string} dateValue
 * @param {string} timeValue
 * @returns {string|null}
 */
const formatICalUtcDateTimeFromParts = (dateValue, timeValue) => {
  if (!dateValue || !timeValue) {
    return null;
  }

  const dateMatch = String(dateValue).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = String(timeValue).trim().match(/^(\d{2}):(\d{2})(?::(\d{2}))?/);

  if (!dateMatch || !timeMatch) {
    return null;
  }

  const [, year, month, day] = dateMatch;
  const [, hours, minutes, seconds = '00'] = timeMatch;

  return `${year}${month}${day}T${hours}${minutes}${seconds}`;
};

/**
 * Fold iCalendar content lines at RFC 5545 recommended 75-octet boundaries.
 * @param {string} line
 * @returns {string[]}
 */
const foldICalLine = (line) => {
  if (!line) {
    return [''];
  }

  const foldedLines = [];
  let remaining = String(line);
  let isFirstLine = true;

  while (Buffer.byteLength(remaining, 'utf8') > (isFirstLine ? ICAL_MAX_LINE_OCTETS : ICAL_MAX_LINE_OCTETS - 1)) {
    const maxOctets = isFirstLine ? ICAL_MAX_LINE_OCTETS : ICAL_MAX_LINE_OCTETS - 1;
    let splitIndex = 0;
    let currentOctets = 0;

    for (const char of remaining) {
      const charOctets = Buffer.byteLength(char, 'utf8');
      if ((currentOctets + charOctets) > maxOctets) {
        break;
      }
      currentOctets += charOctets;
      splitIndex += char.length;
    }

    const segment = remaining.slice(0, splitIndex);
    foldedLines.push(isFirstLine ? segment : ` ${segment}`);
    remaining = remaining.slice(splitIndex);
    isFirstLine = false;
  }

  foldedLines.push(isFirstLine ? remaining : ` ${remaining}`);
  return foldedLines;
};

/**
 * Format a Date object into UTC iCalendar date-time format.
 * @param {Date} value
 * @returns {string}
 */
const formatICalUtcDateTime = (value) => {
  const year = String(value.getUTCFullYear());
  const month = String(value.getUTCMonth() + 1).padStart(ICAL_FIELD_DIGITS, '0');
  const day = String(value.getUTCDate()).padStart(ICAL_FIELD_DIGITS, '0');
  const hours = String(value.getUTCHours()).padStart(ICAL_FIELD_DIGITS, '0');
  const minutes = String(value.getUTCMinutes()).padStart(ICAL_FIELD_DIGITS, '0');
  const seconds = String(value.getUTCSeconds()).padStart(ICAL_FIELD_DIGITS, '0');

  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
};

/**
 * Build a safe iCalendar filename for Content-Disposition.
 * @param {string} organizationName
 * @returns {string}
 */
const buildICalFilename = (organizationName = '') => {
  const normalizedOrganization = String(organizationName)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  const datePart = new Date().toISOString().slice(0, ISO_DATE_LENGTH);

  if (!normalizedOrganization) {
    return `activities-calendar-${datePart}.ics`;
  }

  return `${normalizedOrganization}-activities-${datePart}.ics`;
};

/**
 * The unit's active activities as an iCalendar document.
 *
 * @param {import('pg').Pool} pool - Database pool
 * @param {number} organizationId - Unit
 * @param {{subscription?: boolean}} [options] - `subscription`: name the
 *   calendar after the unit and tell calendar apps how often to fetch again
 * @returns {Promise<{body: string, organizationName: string}>} The document,
 *   with CRLF line endings, and the unit's name
 */
async function buildActivitiesCalendar(pool, organizationId, { subscription = false } = {}) {
  const organizationResult = await pool.query(
    'SELECT name FROM organizations WHERE id = $1',
    [organizationId]
  );

  const result = await pool.query(
    `SELECT
      id,
      name,
      description,
      activity_date::text as activity_date,
      activity_start_date::text as activity_start_date,
      activity_start_time::text as activity_start_time,
      activity_end_date::text as activity_end_date,
      activity_end_time::text as activity_end_time,
      meeting_location_going,
      meeting_time_going::text as meeting_time_going,
      departure_time_going::text as departure_time_going,
      departure_time_return::text as departure_time_return,
      created_at,
      updated_at
     FROM activities
     WHERE organization_id = $1 AND is_active = TRUE
     ORDER BY COALESCE(activity_start_date, activity_date) ASC, activity_start_time ASC, departure_time_going ASC`,
    [organizationId]
  );

  const organizationName = organizationResult.rows[0]?.name || '';
  const nowStamp = formatICalUtcDateTime(new Date());
  const events = result.rows
    .map((activity) => {
      const normalizedStartDate = activity.activity_start_date || activity.activity_date;
      const normalizedStartTime = activity.activity_start_time || activity.meeting_time_going;
      const normalizedEndDate = activity.activity_end_date || normalizedStartDate;
      const normalizedEndTime = activity.activity_end_time
        || activity.departure_time_return
        || activity.departure_time_going
        || normalizedStartTime;

      const dtStart = formatICalUtcDateTimeFromParts(normalizedStartDate, normalizedStartTime);
      const dtEnd = formatICalUtcDateTimeFromParts(normalizedEndDate, normalizedEndTime);

      if (!dtStart || !dtEnd) {
        return null;
      }

      const sourceStamp = activity.updated_at || activity.created_at;
      const dtStamp = sourceStamp
        ? formatICalUtcDateTime(new Date(sourceStamp))
        : nowStamp;

      return [
        'BEGIN:VEVENT',
        `UID:activity-${activity.id}-${organizationId}@wampums.local`,
        `DTSTAMP:${dtStamp}`,
        `SUMMARY:${escapeICalText(activity.name || 'Activity')}`,
        `DESCRIPTION:${escapeICalText(activity.description || '')}`,
        `LOCATION:${escapeICalText(activity.meeting_location_going || '')}`,
        `DTSTART:${dtStart}`,
        `DTEND:${dtEnd}`,
        'END:VEVENT'
      ];
    })
    .filter(Boolean)
    .flat();

  const subscriptionHeader = subscription
    ? [
      ...(organizationName ? [`X-WR-CALNAME:${escapeICalText(organizationName)}`] : []),
      `REFRESH-INTERVAL;VALUE=DURATION:${SUBSCRIPTION_REFRESH}`,
      `X-PUBLISHED-TTL:${SUBSCRIPTION_REFRESH}`,
    ]
    : [];

  const body = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${ICAL_PROD_ID}`,
    'CALSCALE:GREGORIAN',
    ...subscriptionHeader,
    ...events,
    'END:VCALENDAR',
    ''
  ]
    .flatMap(foldICalLine)
    .join('\r\n');

  return { body, organizationName };
}

module.exports = {
  ICAL_PROD_ID,
  SUBSCRIPTION_REFRESH,
  escapeICalText,
  formatICalUtcDateTimeFromParts,
  foldICalLine,
  formatICalUtcDateTime,
  buildICalFilename,
  buildActivitiesCalendar,
};
