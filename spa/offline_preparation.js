/**
 * Offline Preparation Page
 * Allows users to prepare the app for multi-day offline operation (camp mode)
 */
import { translate } from './app.js';
import { offlineManager } from './modules/OfflineManager.js';
import { debugLog, debugError } from './utils/DebugUtils.js';
import { setContent, loadStylesheet } from './utils/DOMUtils.js';
import { escapeHTML } from './utils/SecurityUtils.js';
import { formatDate } from './utils/DateUtils.js';
import { skeletonList } from './utils/SkeletonUtils.js';

export class OfflinePreparation {
    constructor(app) {
        this.app = app;
        this.activities = [];
        this.isLoading = true;
        this.preparingActivityId = null;
    }

    async init() {
        // Load page-specific CSS
        await loadStylesheet('/css/offline-prep.css');

        // Show loading state
        this.isLoading = true;
        this.render();

        // Load upcoming camps
        await this.loadUpcomingCamps();

        this.isLoading = false;
        this.render();
        this.attachEventListeners();
    }

    async loadUpcomingCamps() {
        try {
            this.activities = await offlineManager.getUpcomingCamps();
            debugLog('OfflinePreparation: Loaded camps', this.activities.length);
        } catch (error) {
            debugError('OfflinePreparation: Failed to load camps', error);
            this.activities = [];
        }
    }

    render() {
        const container = document.getElementById('app');

        if (this.isLoading) {
            setContent(container, `
                <section class="page offline-prep-page">
                    <header class="page__header">
                        <a href="/dashboard" class="button button--ghost">← ${translate('back')}</a>
                        <h1>${translate('prepare_for_offline')}</h1>
                    </header>
                    ${skeletonList(3)}
                </section>
            `);
            return;
        }

        setContent(container, `
            <section class="page offline-prep-page">
                <header class="page__header">
                    <a href="/dashboard" class="button button--ghost">← ${translate('back')}</a>
                    <h1>${translate('prepare_for_offline')}</h1>
                </header>

                <p class="page__description">${translate('prepare_offline_description')}</p>

                ${this.renderCampModeStatus()}

                <div class="offline-prep__section">
                    <h2>${translate('upcoming_multi_day_activities')}</h2>
                    ${this.renderActivityList()}
                </div>

                <div id="preparation-progress" class="preparation-progress ${this.preparingActivityId ? '' : 'hidden'}">
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: 0%"></div>
                    </div>
                    <p class="progress-message"></p>
                </div>

                <div class="offline-prep__section">
                    <h2>${translate('manual_date_range')}</h2>
                    <form id="manual-prep-form" class="manual-prep-form">
                        <div class="form-row">
                            <label class="form-field">
                                <span class="form-field__label">${translate('start_date')}</span>
                                <input type="date" name="start_date" required class="form-field__input">
                            </label>
                            <label class="form-field">
                                <span class="form-field__label">${translate('end_date')}</span>
                                <input type="date" name="end_date" required class="form-field__input">
                            </label>
                        </div>
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
                ? `${formatDate(activePrep.startDate, this.app.currentLanguage)} - ${formatDate(activePrep.endDate, this.app.currentLanguage)}`
                : '';

            return `
                <div class="camp-mode-banner camp-mode-banner--active">
                    <span class="camp-mode-banner__icon">⛺</span>
                    <div class="camp-mode-banner__content">
                        <strong>${translate('camp_mode_active')}</strong>
                        <p>${translate('camp_mode_description')}</p>
                        ${dateRange ? `<small>${dateRange}</small>` : ''}
                    </div>
                    <button id="disable-camp-mode" class="button button--ghost button--small">
                        ${translate('disable_camp_mode')}
                    </button>
                </div>
            `;
        }

        return `
            <div class="camp-mode-banner camp-mode-banner--inactive">
                <span class="camp-mode-banner__icon">📶</span>
                <p>${translate('camp_mode_inactive')}</p>
            </div>
        `;
    }

    renderActivityList() {
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
        const isPrepared = offlineManager.preparedActivities.has(activity.id);
        const isCurrentlyPreparing = this.preparingActivityId === activity.id;
        const dayCount = activity.day_count || this.getDayCount(activity.activity_start_date, activity.activity_end_date);

        return `
            <div class="activity-card ${isPrepared ? 'activity-card--prepared' : ''}" data-activity-id="${activity.id}">
                <div class="activity-card__header">
                    <h3>${escapeHTML(activity.name)}</h3>
                    ${isPrepared ? `<span class="badge badge--success">${translate('prepared')}</span>` : ''}
                </div>
                <div class="activity-card__dates">
                    <span>${formatDate(activity.activity_start_date, this.app.currentLanguage)}</span>
                    <span class="activity-card__arrow">→</span>
                    <span>${formatDate(activity.activity_end_date, this.app.currentLanguage)}</span>
                </div>
                <p class="activity-card__duration">${dayCount} ${translate('days')}</p>
                ${activity.meeting_location_going ? `<p class="activity-card__location">${escapeHTML(activity.meeting_location_going)}</p>` : ''}
                <button class="button button--primary prepare-btn ${isCurrentlyPreparing ? 'button--loading' : ''}"
                        data-activity-id="${activity.id}"
                        data-start="${activity.activity_start_date}"
                        data-end="${activity.activity_end_date}"
                        ${isPrepared || isCurrentlyPreparing ? 'disabled' : ''}>
                    ${isCurrentlyPreparing
                        ? translate('preparing')
                        : isPrepared
                            ? translate('already_prepared')
                            : translate('prepare_for_offline')}
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
                                <strong>${formatDate(prep.startDate, this.app.currentLanguage)} - ${formatDate(prep.endDate, this.app.currentLanguage)}</strong>
                                <small>${prep.dates?.length || 0} ${translate('days')} | ${translate('prepared_on')} ${formatDate(new Date(prep.preparedAt).toISOString().split('T')[0], this.app.currentLanguage)}</small>
                            </div>
                            <button class="button button--ghost button--small clear-prep-btn" data-activity-id="${id}">
                                ${translate('clear')}
                            </button>
                        </div>
                    `).join('')}
                </div>
                <button id="clear-all-prep" class="button button--ghost button--danger">
                    ${translate('clear_all_preparations')}
                </button>
            </div>
        `;
    }

    getDayCount(startDate, endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        return Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
    }

    attachEventListeners() {
        // Prepare buttons for activities
        document.querySelectorAll('.prepare-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.handlePrepare(e));
        });

        // Manual date range form
        const form = document.getElementById('manual-prep-form');
        if (form) {
            form.addEventListener('submit', (e) => this.handleManualPrepare(e));
        }

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
        window.addEventListener('preparationProgress', (e) => this.updateProgressUI(e.detail));
        window.addEventListener('campModeChanged', () => this.render());
    }

    async handlePrepare(event) {
        const btn = event.target;
        const { activityId, start, end } = btn.dataset;
        const id = parseInt(activityId);

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
            await offlineManager.prepareForActivity(id, start, end);
            this.app.showMessage(translate('preparation_complete'), 'success');
            this.preparingActivityId = null;
            this.render();
            this.attachEventListeners();
        } catch (error) {
            debugError('OfflinePreparation: Prepare failed', error);
            this.app.showMessage(translate('preparation_failed') + ': ' + error.message, 'error');
            this.preparingActivityId = null;
            btn.disabled = false;
            btn.textContent = translate('prepare_for_offline');
            btn.classList.remove('button--loading');
        }
    }

    async handleManualPrepare(event) {
        event.preventDefault();
        const form = event.target;
        const startDate = form.start_date.value;
        const endDate = form.end_date.value;

        if (!startDate || !endDate) {
            this.app.showMessage(translate('dates_required'), 'error');
            return;
        }

        if (new Date(endDate) < new Date(startDate)) {
            this.app.showMessage(translate('end_date_after_start'), 'error');
            return;
        }

        const dayCount = this.getDayCount(startDate, endDate);
        if (dayCount > 14) {
            this.app.showMessage(translate('max_14_days'), 'error');
            return;
        }

        const submitBtn = form.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.textContent = translate('preparing');
        submitBtn.classList.add('button--loading');

        // Show progress container
        const progressContainer = document.getElementById('preparation-progress');
        if (progressContainer) {
            progressContainer.classList.remove('hidden');
        }

        try {
            await offlineManager.prepareForActivity(null, startDate, endDate);
            this.app.showMessage(translate('preparation_complete'), 'success');
            form.reset();
            this.render();
            this.attachEventListeners();
        } catch (error) {
            debugError('OfflinePreparation: Manual prepare failed', error);
            this.app.showMessage(translate('preparation_failed') + ': ' + error.message, 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = translate('prepare_date_range');
            submitBtn.classList.remove('button--loading');
        }
    }

    handleDisableCampMode() {
        offlineManager.disableCampMode();
        this.app.showMessage(translate('camp_mode_disabled'), 'success');
        this.render();
        this.attachEventListeners();
    }

    handleClearPrep(event) {
        const id = event.target.dataset.activityId;
        const idParsed = isNaN(parseInt(id)) ? id : parseInt(id);

        if (confirm(translate('confirm_clear_preparation'))) {
            offlineManager.preparedActivities.delete(idParsed);
            offlineManager.savePreparedActivities();

            // If this was the active camp mode activity, disable camp mode
            if (offlineManager.activeActivityId === idParsed) {
                offlineManager.disableCampMode();
            }

            this.render();
            this.attachEventListeners();
        }
    }

    handleClearAllPrep() {
        if (confirm(translate('confirm_clear_all_preparations'))) {
            offlineManager.clearPreparedActivities();
            this.app.showMessage(translate('preparations_cleared'), 'success');
            this.render();
            this.attachEventListeners();
        }
    }

    updateProgressUI(progress) {
        const container = document.getElementById('preparation-progress');
        if (!container) return;

        container.classList.toggle('hidden', progress.status === 'idle' || progress.status === 'complete');

        const fill = container.querySelector('.progress-fill');
        const message = container.querySelector('.progress-message');

        if (fill) {
            const percent = (progress.current / progress.total) * 100;
            fill.style.width = `${percent}%`;
        }

        if (message) {
            message.textContent = progress.message || '';
        }

        // Add error styling if failed
        if (progress.status === 'error') {
            container.classList.add('preparation-progress--error');
            if (message) {
                message.textContent = progress.message || translate('preparation_failed');
            }
        } else {
            container.classList.remove('preparation-progress--error');
        }
    }

    destroy() {
        // Clean up event listeners
        window.removeEventListener('preparationProgress', this.updateProgressUI);
        window.removeEventListener('campModeChanged', this.render);
    }
}
