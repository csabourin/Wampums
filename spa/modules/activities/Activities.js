// Activities.js
// Activity (outings/events) calendar module. Rewritten in the standard module
// style: BaseModule cleanup, permission-gated UI, shared modal utility.
import { translate } from '../../app.js';
import { getActivities, deleteActivity } from '../../api/api-activities.js';
import { clearActivityRelatedCaches } from '../../indexedDB.js';
import { canViewActivities, hasPermission } from '../../utils/PermissionUtils.js';
import { skeletonActivityList, setButtonLoading } from '../../utils/SkeletonUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { setContent } from '../../utils/DOMUtils.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { parseDate } from '../../utils/DateUtils.js';
import { debounce } from '../../utils/PerformanceUtils.js';
import { confirmDestructive } from '../../utils/DialogUtils.js';
import { BaseModule } from '../../utils/BaseModule.js';
import { openActivityFormModal } from './ActivityFormModal.js';
import {
  formatActivityDateRange,
  getActivityEndDateObj,
  getActivityStartDate
} from '../../utils/ActivityDateUtils.js';
import { offlineManager } from '../OfflineManager.js';

import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';
const SEARCH_DEBOUNCE_MS = 300;

export class Activities extends BaseModule {
  constructor(app) {
    super(app);
    this.activities = [];
    this.isLoading = true;
    this.searchTerm = '';
    this.canCreate = hasPermission('activities.create');
    this.canEdit = hasPermission('activities.edit');
    this.canDelete = hasPermission('activities.delete');
  }

  async init() {
    if (!canViewActivities()) {
      this.app.router.navigate('/dashboard');
      return;
    }

    this.isLoading = true;
    this.render();

    await this.loadActivities();

    this.isLoading = false;
    this.render();
    this.attachEventListeners();
  }

  async loadActivities(forceRefresh = false) {
    try {
      this.activities = await getActivities({ forceRefresh });
    } catch (err) {
      debugError('Error loading activities:', err);
      this.app.showMessage(translate('error_loading_activities'), 'error');
      this.activities = [];
    }
  }

  // ==========================================================================
  // RENDERING
  // ==========================================================================

  render() {
    const container = document.getElementById('app');
    if (!container) {
      return;
    }

    if (this.isLoading) {
      setContent(container, skeletonActivityList());
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const term = this.searchTerm.toLowerCase();

    const filtered = this.activities.filter(activity => {
      if (!term) {
        return true;
      }
      return activity.name.toLowerCase().includes(term) ||
        (activity.description && activity.description.toLowerCase().includes(term));
    });

    const upcoming = filtered.filter(activity => {
      const endDate = getActivityEndDateObj(activity);
      return endDate && endDate >= today;
    });
    const past = filtered.filter(activity => {
      const endDate = getActivityEndDateObj(activity);
      return endDate && endDate < today;
    });

    setContent(container, `
      <section class="page activities-page">
        <header class="page__header">
          <div class="page__header-top">
            <a href="/dashboard" class="button button--ghost">← ${translate('back')}</a>
            <h1>${translate('activities_calendar')}</h1>
            ${this.canCreate ? `
              <button class="button button--primary" id="add-activity-btn">
                ${translate('add_activity')}
              </button>
            ` : ''}
          </div>

          <div class="search-container">
            <input type="search" id="activities-search" class="search-input"
              placeholder="${translate('search')}..." value="${escapeHTML(this.searchTerm)}">
          </div>
        </header>

        <div class="activities-container">
          <div class="activity-section">
            <h2 class="activity-section__title">${translate('upcoming_activities')}</h2>
            ${upcoming.length > 0 ? `
              <div class="activity-list">
                ${upcoming.map(activity => this.renderActivityCard(activity)).join('')}
              </div>
            ` : `
              <p class="empty-state">${translate('no_upcoming_activities')}</p>
            `}
          </div>

          ${past.length > 0 ? `
            <details class="activity-section activity-section--past">
              <summary class="activity-section__title">${translate('past_activities')} (${past.length})</summary>
              <div class="activity-list">
                ${past.map(activity => this.renderActivityCard(activity)).join('')}
              </div>
            </details>
          ` : ''}
        </div>
      </section>
    `);
  }

  renderActivityCard(activity) {
    const activityDateString = getActivityStartDate(activity);
    const activityDate = getActivityEndDateObj(activity) || parseDate(activityDateString);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const isPast = activityDate ? activityDate < today : false;
    const displayDate = formatActivityDateRange(activity, this.app.lang || 'fr');

    const startDate = activity.activity_start_date || activity.start_date;
    const endDate = activity.activity_end_date || activity.end_date;
    const isMultiDay = startDate && endDate && startDate !== endDate;

    return `
      <div class="activity-card ${isPast ? 'activity-card--past' : ''}" data-activity-id="${activity.id}">
        <div class="activity-card__header">
          <h3 class="activity-card__title">${escapeHTML(activity.name)}</h3>
          <span class="activity-card__date">${escapeHTML(displayDate)}</span>
        </div>

        ${activity.description ? `
          <p class="activity-card__description">${escapeHTML(activity.description)}</p>
        ` : ''}

        ${activity.linked_year_plan_meeting_id && activity.linked_year_plan_id ? `
          <p class="activity-card__planner-link">
            ${escapeHTML(translate('yearly_planner_planned_on'))}
            ${escapeHTML(formatActivityDateRange({
              activity_start_date: activity.linked_year_plan_meeting_date,
              activity_end_date: activity.linked_year_plan_meeting_date
            }, this.app.lang || 'fr'))}
            · <a href="/yearly-planner/${activity.linked_year_plan_id}">${escapeHTML(translate('yearly_planner_view_in_planner'))}</a>
          </p>
        ` : ''}

        <div class="activity-card__details">
          <div class="activity-detail">
            <strong>${translate('going')}:</strong>
            <div class="activity-detail__content">
              <span>${translate('meeting')}: ${escapeHTML(activity.meeting_time_going || '-')} @ ${escapeHTML(activity.meeting_location_going || '-')}</span>
              <span>${translate('departure')}: ${escapeHTML(activity.departure_time_going || '-')}</span>
            </div>
          </div>

          ${activity.meeting_location_return ? `
            <div class="activity-detail">
              <strong>${translate('returning')}:</strong>
              <div class="activity-detail__content">
                <span>${translate('meeting')}: ${escapeHTML(activity.meeting_time_return || '-')} @ ${escapeHTML(activity.meeting_location_return)}</span>
                <span>${translate('departure')}: ${escapeHTML(activity.departure_time_return || '-')}</span>
              </div>
            </div>
          ` : ''}
        </div>

        <div class="activity-card__stats">
          ${activity.invites_everyone === false ? `
            <span class="stat stat--invited">
              ${escapeHTML(translate('activity_invited_count').replace('{count}', String(Number(activity.invited_count) || 0)))}
            </span>
          ` : ''}
          <span class="stat">
            <svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
              <circle cx="9" cy="7" r="4"></circle>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
            </svg>
            ${activity.assigned_participant_count || 0} ${translate('assigned')}
          </span>
          <span class="stat">
            <svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="1" y="3" width="15" height="13"></rect>
              <path d="M16 8h2"></path>
              <circle cx="18.5" cy="15.5" r="2.5"></circle>
              <circle cx="5.5" cy="15.5" r="2.5"></circle>
            </svg>
            ${activity.carpool_offer_count || 0} ${translate('vehicles')}
          </span>
        </div>

        <div class="activity-card__actions">
          <button class="button button--small button--secondary view-carpools-btn" data-activity-id="${activity.id}">
            ${translate('view_carpools')}
          </button>
          <button class="button button--small button--secondary view-permission-slips-btn" data-activity-id="${activity.id}">
            ${translate('manage_permission_slips')}
          </button>
          ${isMultiDay && !isPast ? `
            <button class="button button--small button--secondary prepare-offline-btn"
                    data-activity-id="${activity.id}"
                    data-start-date="${startDate}"
                    data-end-date="${endDate}">
              <i class="fa-solid fa-cloud-arrow-down"></i> ${translate('prepare_for_offline')}
            </button>
          ` : ''}
          ${this.canEdit ? `
            <button class="button button--small button--outline activity-edit-btn" data-activity-id="${activity.id}">
              ${translate('edit')}
            </button>
          ` : ''}
          ${this.canDelete ? `
            <button class="button button--small button--danger delete-activity-btn" data-activity-id="${activity.id}">
              ${translate('delete')}
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }

  // ==========================================================================
  // EVENT LISTENERS
  // ==========================================================================

  attachEventListeners() {
    this.addEventListener(document.getElementById('add-activity-btn'), 'click', () => {
      this.showActivityModal();
    });

    this.addEventListeners(document.querySelectorAll('.activity-edit-btn'), 'click', (e) => {
      const activityId = parseInt(e.currentTarget.dataset.activityId, 10);
      const activity = this.activities.find(a => a.id === activityId);
      if (activity) {
        this.showActivityModal(activity);
      }
    });

    this.addEventListeners(document.querySelectorAll('.delete-activity-btn'), 'click', async (e) => {
      // Captured before the dialog: currentTarget is cleared once dispatch ends
      const button = e.currentTarget;
      const activityId = parseInt(button.dataset.activityId, 10);
      if (await confirmDestructive(translate('confirm_delete_activity'))) {
        setButtonLoading(button, true);
        try {
          await this.deleteActivity(activityId);
        } finally {
          setButtonLoading(button, false);
        }
      }
    });

    this.addEventListeners(document.querySelectorAll('.view-carpools-btn'), 'click', (e) => {
      const activityId = parseInt(e.currentTarget.dataset.activityId, 10);
      this.app.router.navigate(`/carpool/${activityId}`);
    });

    this.addEventListeners(document.querySelectorAll('.view-permission-slips-btn'), 'click', (e) => {
      const activityId = parseInt(e.currentTarget.dataset.activityId, 10);
      this.app.router.navigate(`/permission-slips/${activityId}`);
    });

    this.addEventListeners(document.querySelectorAll('.prepare-offline-btn'), 'click', async (e) => {
      const button = e.target.closest('.prepare-offline-btn');
      const activityId = parseInt(button.dataset.activityId);
      const startDate = button.dataset.startDate;
      const endDate = button.dataset.endDate;

      setButtonLoading(button, true);
      try {
        await offlineManager.prepareForActivity(activityId, startDate, endDate);
        this.app.showMessage(translate('preparation_complete'), 'success');
      } catch (err) {
        debugError('Failed to prepare for offline:', err);
        this.app.showMessage(translate('preparation_failed'), 'error');
      } finally {
        setButtonLoading(button, false);
      }
    });

    const searchInput = document.getElementById('activities-search');
    if (searchInput) {
      this.addEventListener(searchInput, 'input', debounce((e) => {
        this.searchTerm = e.target.value;
        this.render();
        this.attachEventListeners();
        const newInput = document.getElementById('activities-search');
        if (newInput) {
          newInput.focus();
          newInput.setSelectionRange(newInput.value.length, newInput.value.length);
        }
      }, SEARCH_DEBOUNCE_MS));
    }
  }

  // ==========================================================================
  // CREATE / EDIT
  // ==========================================================================

  showActivityModal(activity = null) {
    openActivityFormModal(this.app, {
      activity,
      onSaved: async () => {
        await this.loadActivities(true);
        this.render();
        this.attachEventListeners();
      }
    });
  }

  async deleteActivity(activityId) {
    try {
      await deleteActivity(activityId);
      await clearActivityRelatedCaches();
      this.app.showMessage(translate('activity_deleted_success'), 'success');
      await this.loadActivities(true);
      this.render();
      this.attachEventListeners();
    } catch (err) {
      debugError('Error deleting activity:', err);
      this.app.showMessage(apiErrorMessage(err, 'error_deleting_activity'), 'error');
    }
  }
}
