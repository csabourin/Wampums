import { translate } from '../../app.js';
import { campPreparation } from './CampPreparation.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { formatDate } from '../../utils/DateUtils.js';
import { OFFLINE_CAMPS } from '../../config/offline-camps.js';

/** Shared copy for a camp card, the dashboard and the verification screen. */
export function renderCampReadiness(id, language) {
  const { status, preparedAt } = campPreparation.getStatus(id);
  const label = status === 'ready' ? translate('camp_device_ready')
    : status === 'preparing' ? translate('camp_device_preparing') : translate('camp_device_incomplete');
  return `<p class="camp-device-status" role="status" data-camp-status="${Number(id)}">${escapeHTML(label)}${
    status === 'ready' && preparedAt
      ? ` <small>${escapeHTML(translate('camp_device_updated'))} ${escapeHTML(formatDate(new Date(preparedAt), language, {
        year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      }))}</small>` : ''}</p>`;
}

/** `HH:MM` at the start of a time string such as `09:30:00`. */
const CLOCK_PATTERN = /^\d{2}:\d{2}/;
const CLOCK_LENGTH = 'HH:MM'.length;

/**
 * The local moment an activity starts or ends. Without a time, the whole day
 * counts: from midnight, or until the end of the day.
 *
 * @param {string} date - YYYY-MM-DD
 * @param {string|undefined} time - HH:MM[:SS]
 * @param {string} wholeDayClock - HH:MM used when the time is missing
 * @returns {Date} The moment; invalid when the date is
 */
function activityMoment(date, time, wholeDayClock) {
  const clock = typeof time === 'string' && CLOCK_PATTERN.test(time) ? time.slice(0, CLOCK_LENGTH) : wholeDayClock;
  return new Date(`${date}T${clock}:00`);
}

/**
 * Whether the dashboard speaks of a camp: from a day before it starts until it
 * ends. Preparation itself starts earlier, in the background; a leader only
 * needs the reminder when leaving is near.
 *
 * @param {Object} activity - With activity_start_date/_time and activity_end_date/_time
 * @param {Date} [now=new Date()] - The moment to judge
 * @returns {boolean} True inside the window
 */
export function isCampReadinessDue(activity, now = new Date()) {
  const start = activityMoment(activity.activity_start_date, activity.activity_start_time, '00:00');
  const end = activityMoment(activity.activity_end_date, activity.activity_end_time, '23:59');
  const moment = now.getTime();
  return moment >= start.getTime() - OFFLINE_CAMPS.DASHBOARD_NOTICE_MS && moment <= end.getTime();
}

/**
 * Dashboard preview, from a day before a camp until its end; it stays available
 * offline, with an explicit route to retry or verify.
 *
 * @param {string} language - Interface language
 * @param {Date} [now=new Date()] - The moment to judge
 * @returns {string} HTML, empty when no camp is near
 */
export function renderCampReadinessSummary(language, now = new Date()) {
  if (!campPreparation.allowed()) { return ''; }
  const activities = campPreparation.activities.filter((activity) => isCampReadinessDue(activity, now));
  if (!activities.length) { return ''; }
  return `<section class="dashboard-section" aria-label="${escapeHTML(translate('camp_device_title'))}">
    <h2>${translate('camp_device_title')}</h2>
    ${activities.map((activity) => `<div><strong>${escapeHTML(activity.name)}</strong>${renderCampReadiness(activity.id, language)}</div>`).join('')}
    <a class="button button--secondary" href="/prepare-offline">${translate('camp_device_check')}</a>
  </section>`;
}
