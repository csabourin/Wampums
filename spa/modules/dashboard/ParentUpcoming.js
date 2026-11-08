/**
 * "Coming up" on the parent dashboard: the next meeting and the unit's next
 * outings and camps, so a family sees when and where without opening a page.
 *
 * `buildUpcomingEvents` is pure; the dashboard loads the next meeting
 * (`GET /v1/meetings/next`) and the activities (`GET /v1/activities`), both
 * readable with `activities.view`, and passes what it got.
 *
 * @module spa/modules/dashboard/ParentUpcoming
 */
import { translate } from '../../app.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import {
  formatActivityDateRange,
  getActivityEndDate,
  getActivityStartDate,
} from '../../utils/ActivityDateUtils.js';
import { isoToDateString } from '../../utils/DateUtils.js';
import { MINUTES_PER_DAY, MINUTES_PER_HOUR } from '../../utils/TimeUnits.js';

/** How many events the block shows: enough to plan the coming weeks, no more. */
export const UPCOMING_EVENT_LIMIT = 3;

/** Digits of each part of an "HH:MM" clock time. */
const CLOCK_DIGITS = 2;

/** Kinds of event, for the label above each title. */
export const UPCOMING_KIND = Object.freeze({
  MEETING: 'meeting',
  ACTIVITY: 'activity',
  CAMP: 'camp',
});

/**
 * @param {string} value - "HH:MM" or "HH:MM:SS"
 * @returns {number|null} Minutes since midnight, or null when unreadable
 */
function toMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value || ''));
  return match ? Number(match[1]) * MINUTES_PER_HOUR + Number(match[2]) : null;
}

/**
 * @param {number} minutes - Minutes since midnight
 * @returns {string} "HH:MM"
 */
function toClock(minutes) {
  const within = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const twoDigits = (value) => String(value).padStart(CLOCK_DIGITS, '0');
  return `${twoDigits(Math.floor(within / MINUTES_PER_HOUR))}:${twoDigits(within % MINUTES_PER_HOUR)}`;
}

/**
 * When a meeting starts and ends, as families will live it. The evening's
 * schedule is what the leaders prepared, so its first and last activities win;
 * the meeting's stored hours were copied from the unit's settings when the
 * year was planned and are not updated when those settings change.
 *
 * @param {Object} meeting - As `/v1/meetings/next` returns it, with its `activities`
 * @returns {{activity_start_time: string, activity_end_time: string}} Hours, "HH:MM" or empty
 */
export function meetingHours(meeting) {
  const timed = (Array.isArray(meeting?.activities) ? meeting.activities : [])
    .map((activity) => ({ start: toMinutes(activity.time), length: toMinutes(activity.duration) || 0 }))
    .filter((activity) => activity.start !== null);
  if (!timed.length) {
    return { activity_start_time: meeting?.start_time || '', activity_end_time: meeting?.end_time || '' };
  }
  const start = Math.min(...timed.map((activity) => activity.start));
  const end = Math.max(...timed.map((activity) => activity.start + activity.length));
  return { activity_start_time: toClock(start), activity_end_time: end > start ? toClock(end) : '' };
}

/**
 * The family's next events, soonest first.
 *
 * @param {Object} data - What the dashboard loaded
 * @param {Object|null} [data.nextMeeting] - Next meeting, as `/v1/meetings/next` returns it
 * @param {Array<Object>} [data.activities] - Activities, as `/v1/activities` returns them
 * @param {string} data.today - Today, YYYY-MM-DD; an activity under way still counts
 * @param {number} [limit=UPCOMING_EVENT_LIMIT] - How many to keep
 * @returns {Array<Object>} Events: { key, kind, title, date, when, place }
 */
export function buildUpcomingEvents({ nextMeeting = null, activities = [], today }, limit = UPCOMING_EVENT_LIMIT) {
  const events = [];
  const meetingDate = isoToDateString(nextMeeting?.date || nextMeeting?.meeting_date || '');
  const activityList = Array.isArray(activities) ? activities : [];
  // A planned day linked to a camp or outing is that activity, listed once under its own name.
  const linkedActivity = nextMeeting?.activity_id
    && activityList.some((activity) => Number(activity.id) === Number(nextMeeting.activity_id));
  if (meetingDate && meetingDate >= today && !nextMeeting.is_cancelled && !linkedActivity) {
    events.push({
      key: `meeting:${meetingDate}`,
      meetingId: Number(nextMeeting.id) || null,
      kind: UPCOMING_KIND.MEETING,
      title: translate('parent_upcoming_meeting'),
      date: meetingDate,
      source: {
        activity_start_date: meetingDate,
        activity_end_date: meetingDate,
        ...meetingHours(nextMeeting),
      },
      place: nextMeeting.location || nextMeeting.endroit || '',
    });
  }

  activityList
    .filter((activity) => activity && activity.is_active !== false)
    .filter((activity) => getActivityEndDate(activity) >= today)
    .forEach((activity) => events.push({
      key: `activity:${Number(activity.id)}`,
      activityId: Number(activity.id),
      kind: activity.is_camp ? UPCOMING_KIND.CAMP : UPCOMING_KIND.ACTIVITY,
      title: activity.name || '',
      date: getActivityStartDate(activity),
      source: activity,
      place: activity.meeting_location_going || '',
    }));

  return events
    .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title))
    .slice(0, limit);
}

/**
 * The published packing list of an event, when the family has one for it:
 * a camp's planned day (by its meeting or its activity), or an outing's own list.
 *
 * @param {Object} event - From buildUpcomingEvents
 * @param {Array<Object>} packingLists - Rows of `/v1/personal-equipment/mine`, one per child
 * @returns {string|number|null} The list's id for `/personal-equipment/:id`, or null
 */
export function packingListFor(event, packingLists) {
  const row = (Array.isArray(packingLists) ? packingLists : []).find((candidate) => {
    if (event.activityId) {
      return candidate.meeting_id === `activity-${event.activityId}` || Number(candidate.activity_id) === event.activityId;
    }
    return Boolean(event.meetingId) && Number(candidate.meeting_id) === event.meetingId;
  });
  if (!row) {
    return null;
  }
  return /^activity-[1-9]\d*$/.test(String(row.meeting_id)) ? row.meeting_id : Number(row.meeting_id);
}

/**
 * Link to an event's packing list, named after the event for screen readers.
 *
 * @param {Object} event - From buildUpcomingEvents
 * @param {Array<Object>} packingLists - The family's packing lists
 * @returns {string} Markup, empty when the event has none
 */
function packingLink(event, packingLists) {
  const id = packingListFor(event, packingLists);
  if (id === null) {
    return '';
  }
  return `<a class="button button--secondary button--small parent-upcoming__packing" href="/personal-equipment/${encodeURIComponent(id)}">
    ${translate('parent_upcoming_packing')}<span class="visually-hidden"> — ${escapeHTML(event.title)}</span></a>`;
}

/**
 * Markup of the "Coming up" section. A failed load says so with a retry;
 * nothing planned says what would fill it.
 *
 * @param {Array<Object>} events - From buildUpcomingEvents
 * @param {Object} context - Rendering context
 * @param {string} context.lang - Interface language
 * @param {boolean} context.failed - The events could not be loaded
 * @param {boolean} context.calendarLink - Offer the calendar subscription
 * @param {Array<Object>} [context.packingLists] - The family's packing lists, linked beside their event
 * @returns {string} Markup
 */
export function renderUpcomingSection(events, { lang, failed, calendarLink, packingLists = [] }) {
  let body;
  if (failed) {
    body = `
      <div role="alert">
        <p>${translate('parent_upcoming_failed')}</p>
        <button type="button" class="button button--small button--secondary" id="parent-upcoming-retry">${translate('retry')}</button>
      </div>`;
  } else if (!events.length) {
    body = `<p class="parent-upcoming__empty">${translate('parent_upcoming_empty')}</p>`;
  } else {
    body = `
      <ul class="parent-upcoming__list">
        ${events.map((event) => `
          <li class="parent-upcoming__item parent-upcoming__item--${event.kind}">
            <p class="parent-upcoming__kind">${translate(`parent_upcoming_kind_${event.kind}`)}</p>
            <h3 class="parent-upcoming__title">${escapeHTML(event.title)}</h3>
            <p class="parent-upcoming__when">${escapeHTML(formatActivityDateRange(event.source, lang))}</p>
            ${event.place ? `<p class="parent-upcoming__place"><span class="visually-hidden">${translate('parent_upcoming_place')} </span>${escapeHTML(event.place)}</p>` : ''}
            ${packingLink(event, packingLists)}
          </li>`).join('')}
      </ul>`;
  }
  return `
    <section class="parent-dashboard__upcoming parent-upcoming" aria-labelledby="parent-upcoming-title">
      <h2 class="parent-upcoming__heading" id="parent-upcoming-title" tabindex="-1">${translate('parent_upcoming_title')}</h2>
      ${body}
      ${calendarLink && !failed ? `<a class="button button--ghost button--small" href="/account-info#calendar-feed">${translate('parent_upcoming_calendar')}</a>` : ''}
    </section>`;
}
