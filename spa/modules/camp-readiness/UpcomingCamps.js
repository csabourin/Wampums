/**
 * The camps under way or starting soon, each linking to its team overview ("Prêt pour le camp").
 * Shown on the dashboard to members who may open that overview; nothing is shown when no camp is near.
 *
 * @module spa/modules/camp-readiness/UpcomingCamps
 */
import { translate } from '../../app.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { formatDate } from '../../utils/DateUtils.js';
import { hasPermission, hasOrganizationScope } from '../../utils/PermissionUtils.js';
import { getUpcomingCamps } from '../../api/api-camp-readiness.js';
import { debugError } from '../../utils/DebugUtils.js';

/** @returns {boolean} Whether this person may open the team overview, as its route guard requires */
export function canSeeTeamReadiness() {
  return hasPermission('meetings.view') && hasOrganizationScope();
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
 * @param {Array<{id: number, theme: string, date_from: string, date_to: string}>} camps
 * @param {string} lang
 * @returns {string} HTML, empty when there is no camp to show
 */
export function upcomingCampsMarkup(camps, lang) {
  if (!camps?.length) { return ''; }
  const items = camps.map((camp) => {
    const dates = translate('camp_readiness_upcoming_dates')
      .replace('{from}', formatDate(camp.date_from, lang)).replace('{to}', formatDate(camp.date_to, lang));
    return `<li><a class="button button--secondary" href="/camp-readiness/${Number(camp.id)}">
      ${escapeHTML(translate('camp_readiness_title'))} : ${escapeHTML(camp.theme || translate('camp_readiness_camp'))}</a>
      <span>${escapeHTML(dates)}</span></li>`;
  }).join('');
  return `<section class="dashboard-section dashboard-team-camps" aria-labelledby="dashboard-team-camps-title">
    <h2 id="dashboard-team-camps-title">${escapeHTML(translate('camp_readiness_upcoming_title'))}</h2>
    <ul class="dashboard-team-camps__list">${items}</ul></section>`;
}
