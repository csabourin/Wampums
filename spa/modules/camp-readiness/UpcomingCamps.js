/**
 * The camps under way or starting soon, each linking to its team overview ("Prêt pour le camp").
 * Shown on the dashboard to members who may open that overview; nothing is shown when no camp is near.
 *
 * @module spa/modules/camp-readiness/UpcomingCamps
 */
import { translate } from '../../app.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { formatDateRange } from '../../utils/DateUtils.js';
import { hasPermission, hasOrganizationScope } from '../../utils/PermissionUtils.js';
import { getUpcomingCamps } from '../../api/api-camp-readiness.js';
import { debugError } from '../../utils/DebugUtils.js';

/** @returns {boolean} Whether this person may open the team overview, as its route guard requires */
export function canSeeTeamReadiness() {
  return hasPermission('meetings.view') && hasOrganizationScope();
}

/**
 * A camp's team overview: by its planned camp, or by its activity when the year plan does not schedule it.
 * @param {{id?: number|null, activity_id?: number|null}} camp
 * @returns {string} Path
 */
export function campReadinessHref(camp) {
  return Number(camp?.id) > 0 ? `/camp-readiness/${Number(camp.id)}` : `/camp-readiness/activity-${Number(camp?.activity_id)}`;
}

/** @returns {Promise<Array<Object>>} The camps, or none when they cannot be read */
export async function loadUpcomingCamps() {
  try {
    if (!canSeeTeamReadiness()) { return []; }
    const response = await getUpcomingCamps();
    return Array.isArray(response?.data) ? response.data : [];
  } catch (error) {
    debugError('Upcoming camps could not be loaded', error);
    return [];
  }
}

/**
 * @param {Array<{id: number|null, activity_id: number|null, theme: string, date_from: string, date_to: string}>} camps
 * @param {string} lang
 * @returns {string} HTML, empty when there is no camp to show
 */
export function upcomingCampsMarkup(camps, lang) {
  if (!camps?.length) { return ''; }
  const items = camps.map((camp) => {
    const dates = formatDateRange(camp.date_from, camp.date_to, lang);
    return `<li><a class="button button--secondary" href="${campReadinessHref(camp)}">
      ${escapeHTML(translate('camp_readiness_title'))} : ${escapeHTML(camp.theme || translate('camp_readiness_camp'))}</a>
      <span>${escapeHTML(dates)}</span></li>`;
  }).join('');
  // A card of "This week" on the dashboard (#1430), under the section's own heading.
  return `<div class="dashboard-v2__card dashboard-team-camps" role="group" aria-labelledby="dashboard-team-camps-title">
    <h3 id="dashboard-team-camps-title" class="dashboard-v2__card-title">${escapeHTML(translate('camp_readiness_upcoming_title'))}</h3>
    <ul class="dashboard-team-camps__list">${items}</ul></div>`;
}
