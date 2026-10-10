/**
 * CarpoolQuickAccessModal
 * Handles the carpool quick access modal display and interactions
 *
 * Built on the shared `.modal-overlay` / `.modal-content` markup, so
 * `setContent()` gives it dialog semantics, a focus trap, Escape to close and
 * focus return through `enhanceModalAccessibility()`.
 */

import { getActivities } from '../../api/api-activities.js';
import { translate } from '../../app.js';
import { debugError } from '../../utils/DebugUtils.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { setContent } from '../../utils/DOMUtils.js';
import {
  formatActivityDateRange,
  getActivityEndDateObj
} from '../../utils/ActivityDateUtils.js';
import { QuickCreateActivityModal } from './QuickCreateActivityModal.js';

const MODAL_ID = 'carpool-quick-access-modal';

export class CarpoolQuickAccessModal {
  constructor(app) {
    this.app = app;
    this.modal = null;
  }

  /**
   * Show the carpool quick access modal
   */
  async show() {
    try {
      const activities = await getActivities();
      const now = new Date();
      now.setHours(0, 0, 0, 0);

      const upcomingActivities = activities.filter((activity) => {
        const activityEndDate = getActivityEndDateObj(activity);
        return activityEndDate && activityEndDate >= now;
      });

      this.render(upcomingActivities);
      this.attachListeners();
    } catch (error) {
      debugError('Error loading carpool activities:', error);
      this.app.showMessage(translate('error_loading_activities'), 'error');
    }
  }

  /**
   * Render one upcoming activity as a link to its carpool page.
   * @param {Object} activity - Activity returned by the API
   * @returns {string} HTML for the list item
   */
  renderActivity(activity) {
    const location = activity.meeting_location_going
      ? `<span class="carpool-quick-access__location">${escapeHTML(activity.meeting_location_going)}</span>`
      : '';

    return `
      <li>
        <a href="/carpool/${encodeURIComponent(activity.id)}" class="carpool-quick-access__activity">
          <span class="carpool-quick-access__details">
            <span class="carpool-quick-access__name">${escapeHTML(activity.name)}</span>
            <span class="carpool-quick-access__date">${escapeHTML(formatActivityDateRange(activity, this.app.lang || 'fr'))}</span>
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

  /**
   * Render the modal
   * @param {Array<Object>} activities - Upcoming activities
   */
  render(activities) {
    document.getElementById(MODAL_ID)?.remove();

    this.modal = document.createElement('div');
    this.modal.className = 'modal-overlay';
    this.modal.id = MODAL_ID;

    const body = activities.length > 0
      ? `
        <p class="carpool-quick-access__intro">${translate('select_activity_for_carpool')}</p>
        <ul class="carpool-quick-access__list">
          ${activities.map((activity) => this.renderActivity(activity)).join('')}
        </ul>
      `
      : `<p class="carpool-quick-access__empty">${translate('no_upcoming_activities')}</p>`;

    setContent(this.modal, `
      <div class="modal-content carpool-quick-access">
        <div class="modal-header">
          <h2>${translate('carpool_coordination')}</h2>
          <button type="button" class="modal-close" aria-label="${escapeHTML(translate('close'))}">
            <span aria-hidden="true">&times;</span>
          </button>
        </div>
        <div class="modal-body">
          ${body}
        </div>
        <div class="modal-footer">
          <button type="button" class="button button--primary carpool-quick-access__create" data-action="quick-create">
            ${translate('quick_create_activity')}
          </button>
        </div>
      </div>
    `);
    document.body.appendChild(this.modal);
  }

  /**
   * Attach event listeners
   */
  attachListeners() {
    this.modal.querySelector('.modal-close')?.addEventListener('click', () => this.close());

    this.modal.addEventListener('click', (event) => {
      if (event.target === this.modal) {
        this.close();
        return;
      }
      if (event.target.closest('a.carpool-quick-access__activity')) {
        this.close();
      }
    });

    this.modal.querySelector('[data-action="quick-create"]')?.addEventListener('click', () => {
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
    if (this.modal) {
      this.modal.remove();
      this.modal = null;
    }
  }
}
