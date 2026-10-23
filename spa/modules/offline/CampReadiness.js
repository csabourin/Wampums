import { translate } from '../../app.js';
import { campPreparation } from './CampPreparation.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { formatDate } from '../../utils/DateUtils.js';

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

/** Dashboard preview stays available offline, with an explicit route to retry or verify. */
export function renderCampReadinessSummary(language) {
  if (!campPreparation.allowed()) { return ''; }
  const today = new Date().toLocaleDateString('en-CA');
  const activities = campPreparation.activities.filter((activity) => activity.activity_end_date >= today);
  if (!activities.length) { return ''; }
  return `<section class="dashboard-section" aria-label="${escapeHTML(translate('camp_device_title'))}">
    <h2>${translate('camp_device_title')}</h2>
    ${activities.map((activity) => `<div><strong>${escapeHTML(activity.name)}</strong>${renderCampReadiness(activity.id, language)}</div>`).join('')}
    <a class="button button--secondary" href="/prepare-offline">${translate('camp_device_check')}</a>
  </section>`;
}
