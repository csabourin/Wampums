/**
 * Offline Preparation Page
 * Allows users to prepare the app for multi-day offline operation (camp mode)
 */
import offlinePrepStylesheetUrl from '../../../css/offline-prep.css?url';
import { translate } from '../../app.js';
import { campPreparation } from './CampPreparation.js';
import { renderCampReadiness } from './CampReadiness.js';
import { offlineManager } from '../OfflineManager.js';
import { debugLog, debugError } from '../../utils/DebugUtils.js';
import { setContent, loadStylesheet, withFormBusy } from '../../utils/DOMUtils.js';
import { escapeAttribute, escapeHTML } from '../../utils/SecurityUtils.js';
import { formatDate } from '../../utils/DateUtils.js';
import { confirmDestructive } from '../../utils/DialogUtils.js';
import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';
import { renderBackLink } from '../../utils/BackLinkUtils.js';
import { showPageLoading } from '../../utils/PageStateUtils.js';

/** The longest stretch the app can prepare for at once. */
const MAX_PREPARED_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const PERCENT = 100;

export class OfflinePreparation {
  constructor(app) {
    this.app = app;
    this.activities = [];
    this.isLoading = true;
    this.campsFailed = false;
    this.preparingActivityId = null;
    this.destroyed = false;
    this.boundPreparationProgress = (event) => this.updateProgressUI(event.detail);
    this.boundCampModeChanged = () => this.refresh();
    this.boundReadinessChanged = () => { if (!this.preparingActivityId) { this.refresh(); } };
  }

  async init() {
    showPageLoading(document.getElementById('app'), {
      title: translate('prepare_for_offline'),
      className: 'offline-prep-page',
    });
    // Load page-specific CSS
    await loadStylesheet(offlinePrepStylesheetUrl);
    await this.loadUpcomingCamps();
    this.isLoading = false;
    this.refresh();
  }

  /** Draw the page and wire its controls (the markup is replaced, so nothing stacks). */
  refresh() {
    if (this.destroyed || this.isLoading) {
      return;
    }
    this.render();
    this.attachEventListeners();
  }

  async loadUpcomingCamps() {
    try {
      const camps = await offlineManager.getUpcomingCamps();
      this.activities = Array.isArray(camps) ? camps : [];
      this.campsFailed = false;
      debugLog('OfflinePreparation: Loaded camps', this.activities.length);
    } catch (error) {
      debugError('OfflinePreparation: Failed to load camps', error);
      // The date range below still works: only the list says it failed.
      this.activities = [];
      this.campsFailed = true;
    }
  }

  async retryCamps() {
    const button = document.getElementById('offline-prep-retry');
    if (button) {
      button.disabled = true;
    }
    await this.loadUpcomingCamps();
    this.refresh();
  }

  render() {
    const container = document.getElementById('app');

    setContent(container, `
            <section class="page offline-prep-page">
                <header class="page__header">
                    ${renderBackLink()}
                    <h1>${translate('prepare_for_offline')}</h1>
                </header>

                <p class="page__description">${translate('prepare_offline_description')}</p>

                ${this.renderCampModeStatus()}

                <div class="offline-prep__section">
                    <h2>${translate('upcoming_multi_day_activities')}</h2>
                    ${this.renderActivityList()}
                </div>

                <div id="preparation-progress" class="preparation-progress ${this.preparingActivityId ? '' : 'hidden'}">
                    <div class="progress-bar" role="progressbar" aria-label="${escapeAttribute(translate('preparing'))}"
                         aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
                        <div class="progress-fill" style="width: 0%"></div>
                    </div>
                    <p class="progress-message" role="status"></p>
                </div>

                <div class="offline-prep__section">
                    <h2>${translate('manual_date_range')}</h2>
                    <form id="manual-prep-form" class="manual-prep-form" novalidate>
                        <div class="form-row">
                            <label class="form-field">
                                <span class="form-field__label">${translate('start_date')}</span>
                                <input type="date" name="start_date" required class="form-field__input" aria-describedby="manual-prep-error">
                            </label>
                            <label class="form-field">
                                <span class="form-field__label">${translate('end_date')}</span>
                                <input type="date" name="end_date" required class="form-field__input" aria-describedby="manual-prep-error">
                            </label>
                        </div>
                        <p class="status-message error" role="alert" id="manual-prep-error"></p>
                        <button type="submit" class="button button--primary">
                            ${translate('prepare_date_range')}
                        </button>
                    </form>
                </div>

                ${this.renderPreparedActivities()}
            </section>
        `);
  }

  renderCampModeStatus() {
    if (offlineManager.campMode) {
      const activePrep = offlineManager.preparedActivities.get(offlineManager.activeActivityId);
      const dateRange = activePrep
        ? `${formatDate(activePrep.startDate, this.app.lang || this.app.currentLanguage)} - ${formatDate(activePrep.endDate, this.app.lang || this.app.currentLanguage)}`
        : '';

      return `
                <div class="camp-mode-banner camp-mode-banner--active">
                    <span class="camp-mode-banner__icon" aria-hidden="true">⛺</span>
                    <div class="camp-mode-banner__content">
                        <strong>${translate('camp_mode_active')}</strong>
                        <p>${translate('camp_mode_description')}</p>
                        ${dateRange ? `<small>${dateRange}</small>` : ''}
                    </div>
                    <button type="button" id="disable-camp-mode" class="button button--ghost button--small">
                        ${translate('disable_camp_mode')}
                    </button>
                </div>
            `;
    }

    return `
            <div class="camp-mode-banner camp-mode-banner--inactive">
                <span class="camp-mode-banner__icon" aria-hidden="true">📶</span>
                <p>${translate('camp_mode_inactive')}</p>
            </div>
        `;
  }

  renderActivityList() {
    // A list that did not load is not "no camps coming up".
    if (this.campsFailed) {
      return `
            <p class="status-message error" role="alert">${translate('error_loading_data')}</p>
            <button type="button" class="button button--secondary" id="offline-prep-retry" data-archive-safe>${translate('retry')}</button>
        `;
    }
    if (this.activities.length === 0) {
      return `<p class="empty-state">${translate('no_upcoming_camps')}</p>`;
    }

    return `
            <div class="activity-cards">
                ${this.activities.map(activity => this.renderActivityCard(activity)).join('')}
            </div>
        `;
  }

  renderActivityCard(activity) {
    const isPrepared = campPreparation.getStatus(activity.id).status === 'ready';
    const isCurrentlyPreparing = this.preparingActivityId === activity.id;
    const dayCount = activity.day_count || this.getDayCount(activity.activity_start_date, activity.activity_end_date);

    return `
            <div class="activity-card ${isPrepared ? 'activity-card--prepared' : ''}" data-activity-id="${Number(activity.id)}">
                <div class="activity-card__header">
                    <h3>${escapeHTML(activity.name)}</h3>
                    ${isPrepared ? `<span class="badge badge--success">${translate('prepared')}</span>` : ''}
                </div>
                <div class="activity-card__dates">
                    <span>${escapeHTML(formatDate(activity.activity_start_date, this.app.lang || this.app.currentLanguage))}</span>
                    <span class="activity-card__arrow" aria-hidden="true">→</span>
                    <span>${escapeHTML(formatDate(activity.activity_end_date, this.app.lang || this.app.currentLanguage))}</span>
                </div>
                <p class="activity-card__duration">${Number(dayCount)} ${translate('days')}</p>
                ${activity.meeting_location_going ? `<p class="activity-card__location">${escapeHTML(activity.meeting_location_going)}</p>` : ''}
                ${renderCampReadiness(activity.id, this.app.lang || this.app.currentLanguage)}
                <button type="button" class="button button--primary prepare-btn ${isCurrentlyPreparing ? 'button--loading' : ''}"
                        data-activity-id="${Number(activity.id)}"
                        data-start="${escapeAttribute(activity.activity_start_date)}"
                        data-end="${escapeAttribute(activity.activity_end_date)}"
                        ${isCurrentlyPreparing ? 'disabled' : ''}>
                    ${isCurrentlyPreparing
    ? translate('preparing')
    : translate('camp_device_check')}
                </button>
            </div>
        `;
  }

  renderPreparedActivities() {
    if (offlineManager.preparedActivities.size === 0) {
      return '';
    }

    const items = Array.from(offlineManager.preparedActivities.entries());

    return `
            <div class="offline-prep__section">
                <h2>${translate('prepared_activities')}</h2>
                <div class="prepared-list">
                    ${items.map(([id, prep]) => `
                        <div class="prepared-item">
                            <div class="prepared-item__info">
                                <strong>${escapeHTML(formatDate(prep.startDate, this.app.lang || this.app.currentLanguage))} - ${escapeHTML(formatDate(prep.endDate, this.app.lang || this.app.currentLanguage))}</strong>
                                <small>${Number(prep.dates?.length) || 0} ${translate('days')} | ${translate('prepared_on')} ${escapeHTML(formatDate(new Date(prep.preparedAt), this.app.lang || this.app.currentLanguage))}</small>
                            </div>
                            <button type="button" class="button button--ghost button--small clear-prep-btn" data-activity-id="${escapeAttribute(String(id))}">
                                ${translate('clear')}
                            </button>
                        </div>
                    `).join('')}
                </div>
                <button type="button" id="clear-all-prep" class="button button--danger">
                    ${translate('clear_all_preparations')}
                </button>
            </div>
        `;
  }

  getDayCount(startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    return Math.ceil((end - start) / MS_PER_DAY) + 1;
  }

  attachEventListeners() {
    // Prepare buttons for activities
    document.querySelectorAll('.prepare-btn').forEach(btn => {
      btn.addEventListener('click', (e) => this.handlePrepare(e));
    });

    // Manual date range form
    const form = document.getElementById('manual-prep-form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        withFormBusy(form, () => this.handleManualPrepare(form));
      });
      // The message goes as soon as a date changes.
      form.addEventListener('input', () => this.setManualError(''));
    }

    document.getElementById('offline-prep-retry')?.addEventListener('click', () => this.retryCamps());

    // Disable camp mode button
    const disableBtn = document.getElementById('disable-camp-mode');
    if (disableBtn) {
      disableBtn.addEventListener('click', () => this.handleDisableCampMode());
    }

    // Clear individual preparation
    document.querySelectorAll('.clear-prep-btn').forEach(btn => {
      btn.addEventListener('click', (e) => this.handleClearPrep(e));
    });

    // Clear all preparations
    const clearAllBtn = document.getElementById('clear-all-prep');
    if (clearAllBtn) {
      clearAllBtn.addEventListener('click', () => this.handleClearAllPrep());
    }

    // Listen for preparation progress events
    window.removeEventListener('preparationProgress', this.boundPreparationProgress);
    window.removeEventListener('campModeChanged', this.boundCampModeChanged);
    window.removeEventListener('campReadinessChanged', this.boundReadinessChanged);
    window.addEventListener('campReadinessChanged', this.boundReadinessChanged);
    window.addEventListener('preparationProgress', this.boundPreparationProgress);
    window.addEventListener('campModeChanged', this.boundCampModeChanged);
  }

  async handlePrepare(event) {
    const btn = event.currentTarget;
    const { activityId, start, end } = btn.dataset;
    const id = Number(activityId);

    this.preparingActivityId = id;
    btn.disabled = true;
    btn.textContent = translate('preparing');
    btn.classList.add('button--loading');

    // Show progress container
    const progressContainer = document.getElementById('preparation-progress');
    if (progressContainer) {
      progressContainer.classList.remove('hidden');
    }

    try {
      const ready = await campPreparation.prepare(id, start, end);
      this.app.showMessage(translate(ready ? 'preparation_complete' : 'camp_device_incomplete'), ready ? 'success' : 'warning');
      this.preparingActivityId = null;
      this.refresh();
    } catch (error) {
      debugError('OfflinePreparation: Prepare failed', error);
      this.app.showMessage(apiErrorMessage(error, 'preparation_failed'), 'error');
      this.preparingActivityId = null;
      btn.disabled = false;
      btn.textContent = translate('prepare_for_offline');
      btn.classList.remove('button--loading');
    }
  }

  /**
   * Show (or clear) the message tied to the two dates.
   *
   * @param {string} message - Translated message; empty clears it
   * @returns {void}
   */
  setManualError(message) {
    const errorElement = document.getElementById('manual-prep-error');
    if (errorElement) {
      errorElement.textContent = message;
    }
    document.querySelectorAll('#manual-prep-form input[type="date"]').forEach((input) => {
      if (message) {
        input.setAttribute('aria-invalid', 'true');
      } else {
        input.removeAttribute('aria-invalid');
      }
    });
  }

  /**
   * Prepare the dates typed in the form.
   *
   * @param {HTMLFormElement} form - The date range form
   * @returns {Promise<void>}
   */
  async handleManualPrepare(form) {
    const startDate = form.elements.namedItem('start_date').value;
    const endDate = form.elements.namedItem('end_date').value;

    let problem = '';
    if (!startDate || !endDate) {
      problem = 'dates_required';
    } else if (new Date(endDate) < new Date(startDate)) {
      problem = 'end_date_after_start';
    } else if (this.getDayCount(startDate, endDate) > MAX_PREPARED_DAYS) {
      problem = 'max_14_days';
    }
    if (problem) {
      this.setManualError(translate(problem));
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.textContent = translate('preparing');
    submitBtn.classList.add('button--loading');

    // Show progress container
    document.getElementById('preparation-progress')?.classList.remove('hidden');

    try {
      const ready = await campPreparation.prepare(null, startDate, endDate);
      this.app.showMessage(translate(ready ? 'preparation_complete' : 'camp_device_incomplete'), ready ? 'success' : 'warning');
    } catch (error) {
      debugError('OfflinePreparation: Manual prepare failed', error);
      this.app.showMessage(apiErrorMessage(error, 'preparation_failed'), 'error');
      submitBtn.textContent = translate('prepare_date_range');
      submitBtn.classList.remove('button--loading');
      return;
    }
    this.refresh();
  }

  handleDisableCampMode() {
    offlineManager.disableCampMode();
    this.app.showMessage(translate('camp_mode_disabled'), 'success');
    this.refresh();
  }

  async handleClearPrep(event) {
    const id = event.currentTarget.dataset.activityId;
    const idParsed = isNaN(parseInt(id)) ? id : parseInt(id);

    if (await confirmDestructive(translate('confirm_clear_preparation'))) {
      offlineManager.preparedActivities.delete(idParsed);
      offlineManager.savePreparedActivities();
      campPreparation.forget(idParsed);

      // If this was the active camp mode activity, disable camp mode
      if (offlineManager.activeActivityId === idParsed) {
        offlineManager.disableCampMode();
      }

      this.refresh();
    }
  }

  async handleClearAllPrep() {
    if (await confirmDestructive(translate('confirm_clear_all_preparations'))) {
      offlineManager.clearPreparedActivities();
      campPreparation.forget();
      this.app.showMessage(translate('preparations_cleared'), 'success');
      this.refresh();
    }
  }

  updateProgressUI(progress) {
    const container = document.getElementById('preparation-progress');
    if (!container) {return;}

    container.classList.toggle('hidden', progress.status === 'idle' || progress.status === 'complete');

    const fill = container.querySelector('.progress-fill');
    const message = container.querySelector('.progress-message');

    if (fill) {
      const percent = progress.total ? Math.round((progress.current / progress.total) * PERCENT) : 0;
      fill.style.width = `${percent}%`;
      container.querySelector('[role="progressbar"]')?.setAttribute('aria-valuenow', String(percent));
    }

    if (message) {
      message.textContent = progress.message || '';
    }

    // Add error styling if failed
    if (progress.status === 'error') {
      container.classList.add('preparation-progress--error');
      // The failure carries the thrown error's English text: never show it.
      if (message) {
        message.textContent = translate('preparation_failed');
      }
    } else {
      container.classList.remove('preparation-progress--error');
    }
  }

  destroy() {
    this.destroyed = true;
    window.removeEventListener('campReadinessChanged', this.boundReadinessChanged);
    // Clean up event listeners
    window.removeEventListener('preparationProgress', this.boundPreparationProgress);
    window.removeEventListener('campModeChanged', this.boundCampModeChanged);
  }
}
