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

/** How many events the block shows: enough to plan the coming weeks, no more. */
export const UPCOMING_EVENT_LIMIT = 3;

/** Kinds of event, for the label above each title. */
export const UPCOMING_KIND = Object.freeze({
  MEETING: 'meeting',
  ACTIVITY: 'activity',
  CAMP: 'camp',
});

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
  if (meetingDate && meetingDate >= today && !nextMeeting.is_cancelled) {
    events.push({
      key: `meeting:${meetingDate}`,
      kind: UPCOMING_KIND.MEETING,
      title: translate('parent_upcoming_meeting'),
      date: meetingDate,
      source: {
        activity_start_date: meetingDate,
        activity_end_date: meetingDate,
        activity_start_time: nextMeeting.start_time || '',
        activity_end_time: nextMeeting.end_time || '',
      },
      place: nextMeeting.location || nextMeeting.endroit || '',
    });
  }

  (Array.isArray(activities) ? activities : [])
    .filter((activity) => activity && activity.is_active !== false)
    .filter((activity) => getActivityEndDate(activity) >= today)
    .forEach((activity) => events.push({
      key: `activity:${Number(activity.id)}`,
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
 * Markup of the "Coming up" section. A failed load says so with a retry;
 * nothing planned says what would fill it.
 *
 * @param {Array<Object>} events - From buildUpcomingEvents
 * @param {Object} context - Rendering context
 * @param {string} context.lang - Interface language
 * @param {boolean} context.failed - The events could not be loaded
 * @param {boolean} context.calendarLink - Offer the calendar subscription
 * @returns {string} Markup
 */
export function renderUpcomingSection(events, { lang, failed, calendarLink }) {
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
