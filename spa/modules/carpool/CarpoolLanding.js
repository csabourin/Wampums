import carpoolStylesheetUrl from '../../../css/carpool.css?url';
import { translate } from '../../app.js';
import { getActivities } from '../../api/api-activities.js';
import { debugError } from '../../utils/DebugUtils.js';
import { setContent, loadStylesheet } from '../../utils/DOMUtils.js';
import { hasPermission } from '../../utils/PermissionUtils.js';
import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import {
  upcomingCarpoolActivities,
  renderCarpoolActivityItem
} from '../modals/CarpoolQuickAccessModal.js';
import { QuickCreateActivityModal } from '../modals/QuickCreateActivityModal.js';
import { renderBackLink } from '../../utils/BackLinkUtils.js';

/**
 * Landing view for the /carpool route: the upcoming outings, each a link to
 * the page where a parent offers seats or asks for one. Choosing an outing is
 * the whole task, so the list is the page rather than a dialog to open first.
 */
export class CarpoolLanding {
  /**
   * @param {object} app - Main application instance for navigation and toasts.
   */
  constructor(app) {
    this.app = app;
    this.destroyed = false;
    this.abortController = new AbortController();
  }

  /**
   * Render the page, then load the upcoming activities into it.
   * @returns {Promise<void>}
   */
  async init() {
    await loadStylesheet(carpoolStylesheetUrl);
    if (this.destroyed) { return; }
    this.render();
    this.attachEventListeners();
    await this.loadActivities();
  }

  /** Stop listening and ignore any response that arrives after leaving. */
  destroy() {
    this.destroyed = true;
    this.abortController.abort();
  }

  /**
   * Render the page frame with the list in its loading state.
   */
  render() {
    const container = document.getElementById('app');

    if (!container) {
      debugError('Carpool landing container not found');
      return;
    }

    const canCreate = hasPermission('activities.create');

    setContent(container, `
      ${renderBackLink()}
      <section class="page carpool-page carpool-landing">
        <header class="page__header">
          <div class="page__header-top">
            <h1>${translate('carpool_coordination')}</h1>
          </div>
          <p class="page__subtitle">${translate('carpool_landing_intro')}</p>
        </header>

        <section class="carpool-landing__activities" aria-labelledby="carpool-landing-list-title">
          <h2 id="carpool-landing-list-title">${translate('carpool_landing_list_title')}</h2>
          <div id="carpool-landing-list">${this.renderLoading()}</div>
        </section>

        ${canCreate ? `
          <div class="carpool-landing__actions">
            <button type="button" class="button button--secondary" id="carpool-landing-create">
              ${translate('quick_create_activity')}
            </button>
          </div>
        ` : ''}
      </section>
    `);
  }

  /** @returns {string} HTML of the loading state */
  renderLoading() {
    return `<p class="carpool-landing__status" role="status">${translate('loading')}</p>`;
  }

  /**
   * @param {Error} error - What went wrong
   * @returns {string} HTML of the error state, with a retry button
   */
  renderError(error) {
    return `
      <div class="carpool-landing__error" role="alert">
        <p>${escapeHTML(apiErrorMessage(error, 'error_loading_activities'))}</p>
        <button type="button" class="button button--secondary" id="carpool-landing-retry">${translate('retry')}</button>
      </div>
    `;
  }

  /**
   * @param {Array<Object>} activities - Upcoming activities
   * @returns {string} HTML of the list, or of the empty state
   */
  renderList(activities) {
    if (activities.length === 0) {
      return `<p class="carpool-landing__empty">${translate('carpool_landing_empty')}</p>`;
    }
    return `
      <ul class="carpool-quick-access__list">
        ${activities.map((activity) => renderCarpoolActivityItem(activity, this.app?.lang)).join('')}
      </ul>
    `;
  }

  /**
   * Load the upcoming activities into the list.
   * @returns {Promise<void>}
   */
  async loadActivities() {
    const list = document.getElementById('carpool-landing-list');
    if (!list) { return; }
    setContent(list, this.renderLoading());
    try {
      const activities = upcomingCarpoolActivities(await getActivities());
      if (this.destroyed || !list.isConnected) { return; }
      setContent(list, this.renderList(activities));
    } catch (error) {
      debugError('Error loading carpool activities:', error);
      if (this.destroyed || !list.isConnected) { return; }
      setContent(list, this.renderError(error));
    }
  }

  /**
   * Wire the retry and create buttons. One delegated listener on the page,
   * released by destroy().
   */
  attachEventListeners() {
    const page = document.querySelector('#app .carpool-landing');
    if (!page) { return; }
    page.addEventListener('click', (event) => {
      if (event.target.closest('#carpool-landing-retry')) {
        this.loadActivities();
      } else if (event.target.closest('#carpool-landing-create')) {
        new QuickCreateActivityModal(this.app, { redirectPath: '/carpool/{id}' }).show();
      }
    }, { signal: this.abortController.signal });
  }
}
