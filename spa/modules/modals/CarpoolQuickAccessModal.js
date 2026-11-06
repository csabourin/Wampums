/**
 * CarpoolQuickAccessModal
 * Handles the carpool quick access modal display and interactions
 *
 * Built on the shared `openModal()` dialog.
 */

import { getActivities } from '../../api/api-activities.js';
import { translate } from '../../app.js';
import { debugError } from '../../utils/DebugUtils.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { openModal } from '../../utils/ModalUtils.js';
import { hasPermission } from '../../utils/PermissionUtils.js';
import {
  formatActivityDateRange,
  getActivityEndDateObj
} from '../../utils/ActivityDateUtils.js';
import { QuickCreateActivityModal } from './QuickCreateActivityModal.js';

const MODAL_ID = 'carpool-quick-access-modal';

/**
 * Activities that have not ended yet (today's included).
 * @param {Array<Object>} activities - Activities returned by the API
 * @returns {Array<Object>} Upcoming activities, in the API's order
 */
export function upcomingCarpoolActivities(activities) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return (Array.isArray(activities) ? activities : []).filter((activity) => {
    const activityEndDate = getActivityEndDateObj(activity);
    return activityEndDate && activityEndDate >= today;
  });
}

/**
 * One upcoming activity as a link to its carpool page.
 * @param {Object} activity - Activity returned by the API
 * @param {string} lang - Interface language, for the dates
 * @returns {string} HTML for the list item
 */
export function renderCarpoolActivityItem(activity, lang) {
  const location = activity.meeting_location_going
    ? `<span class="carpool-quick-access__location">${escapeHTML(activity.meeting_location_going)}</span>`
    : '';

  return `
    <li>
      <a href="/carpool/${encodeURIComponent(activity.id)}" class="carpool-quick-access__activity">
        <span class="carpool-quick-access__details">
          <span class="carpool-quick-access__name">${escapeHTML(activity.name)}</span>
          <span class="carpool-quick-access__date">${escapeHTML(formatActivityDateRange(activity, lang || 'fr'))}</span>
          ${location}
        </span>
        <span class="carpool-quick-access__counts">
          <span class="carpool-quick-access__badge">${Number(activity.carpool_offer_count) || 0} ${translate('vehicles')}</span>
          <span>${Number(activity.assigned_participant_count) || 0} ${translate('assigned')}</span>
        </span>
      </a>
    </li>
  `;
}

export class CarpoolQuickAccessModal {
  /**
   * @param {Object} app - Application
   * @param {Object} [options]
   * @param {boolean} [options.allowCreate] - Offer to create an activity; by
   *   default only to someone allowed to create one
   */
  constructor(app, { allowCreate = hasPermission('activities.create') } = {}) {
    this.app = app;
    this.allowCreate = allowCreate;
    this.modal = null;
  }

  /**
   * Show the carpool quick access modal
   */
  async show() {
    try {
      const upcomingActivities = upcomingCarpoolActivities(await getActivities());
      this.render(upcomingActivities);
      this.attachListeners();
    } catch (error) {
      debugError('Error loading carpool activities:', error);
      this.app.showMessage(translate('error_loading_activities'), 'error');
    }
  }

  /**
   * Render the modal
   * @param {Array<Object>} activities - Upcoming activities
   */
  render(activities) {
    const body = activities.length > 0
      ? `
        <p class="carpool-quick-access__intro">${translate('select_activity_for_carpool')}</p>
        <ul class="carpool-quick-access__list">
          ${activities.map((activity) => renderCarpoolActivityItem(activity, this.app.lang)).join('')}
        </ul>
      `
      : `<p class="carpool-quick-access__empty">${translate('no_upcoming_activities')}</p>`;

    this.modal = openModal({
      id: MODAL_ID,
      title: escapeHTML(translate('carpool_coordination')),
      body,
      footer: this.allowCreate ? `
        <button type="button" class="button button--primary carpool-quick-access__create" data-action="quick-create">
          ${translate('quick_create_activity')}
        </button>
      ` : '',
      className: 'carpool-quick-access',
      onClose: () => { this.modal = null; },
    });
  }

  /**
   * Attach event listeners
   */
  attachListeners() {
    const { overlay } = this.modal;
    overlay.addEventListener('click', (event) => {
      if (event.target.closest('a.carpool-quick-access__activity')) {
        this.close();
      }
    });

    overlay.querySelector('[data-action="quick-create"]')?.addEventListener('click', () => {
      this.close();
      this.showQuickCreateModal();
    });
  }

  /**
   * Show quick create activity modal
   */
  showQuickCreateModal() {
    const modal = new QuickCreateActivityModal(this.app, {
      redirectPath: '/carpool/{id}'
    });
    modal.show();
  }

  /**
   * Close the modal
   */
  close() {
    this.modal?.close(true);
  }
}
