// Activities.js
// Activity (outings/events) calendar module. Rewritten in the standard module
// style: BaseModule cleanup, permission-gated UI, shared modal utility.
import { translate } from '../../app.js';
import {
  getActivities,
  createActivity,
  updateActivity,
  deleteActivity
} from '../../api/api-activities.js';
import { clearActivityRelatedCaches } from '../../indexedDB.js';
import { canViewActivities, hasPermission } from '../../utils/PermissionUtils.js';
import { skeletonActivityList, setButtonLoading } from '../../utils/SkeletonUtils.js';
import { debugError, debugLog } from '../../utils/DebugUtils.js';
import { setContent } from '../../utils/DOMUtils.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { parseDate } from '../../utils/DateUtils.js';
import { debounce } from '../../utils/PerformanceUtils.js';
import { confirmDestructive } from '../../utils/DialogUtils.js';
import { openModal } from '../../utils/ModalUtils.js';
import { BaseModule } from '../../utils/BaseModule.js';
import { aiGenerateText } from '../AI.js';
import {
  formatActivityDateRange,
  getActivityEndDate,
  getActivityEndDateObj,
  getActivityStartDate
} from '../../utils/ActivityDateUtils.js';
import { offlineManager } from '../OfflineManager.js';

const SEARCH_DEBOUNCE_MS = 300;
const DEFAULT_AI_DURATION_MINUTES = 120;
const DEFAULT_AI_PARTICIPANT_COUNT = 12;

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
            <button class="button button--small button--outline edit-activity-btn" data-activity-id="${activity.id}">
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

    this.addEventListeners(document.querySelectorAll('.edit-activity-btn'), 'click', (e) => {
      const activityId = parseInt(e.target.dataset.activityId);
      const activity = this.activities.find(a => a.id === activityId);
      if (activity) {
        this.showActivityModal(activity);
      }
    });

    this.addEventListeners(document.querySelectorAll('.delete-activity-btn'), 'click', async (e) => {
      const activityId = parseInt(e.target.dataset.activityId);
      if (await confirmDestructive(translate('confirm_delete_activity'))) {
        const button = e.target;
        setButtonLoading(button, true);
        try {
          await this.deleteActivity(activityId);
        } finally {
          setButtonLoading(button, false);
        }
      }
    });

    this.addEventListeners(document.querySelectorAll('.view-carpools-btn'), 'click', (e) => {
      const activityId = parseInt(e.target.dataset.activityId);
      this.app.router.navigate(`/carpool/${activityId}`);
    });

    this.addEventListeners(document.querySelectorAll('.view-permission-slips-btn'), 'click', (e) => {
      const activityId = parseInt(e.target.dataset.activityId);
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
  // CREATE / EDIT MODAL
  // ==========================================================================

  showActivityModal(activity = null) {
    const isEdit = activity !== null;

    const body = `
      <form id="activity-form">
        <div class="form-group">
          <label for="activity-name">${translate('activity_name')} <span class="required">*</span></label>
          <input type="text" id="activity-name" name="activity_name"
                 value="${escapeHTML(activity?.name || '')}" required
                 class="form-control" maxlength="255">
        </div>

        <div class="form-group">
          <label for="activity-description">${translate('description')}</label>
          <textarea id="activity-description" name="description"
                    class="form-control" rows="3">${escapeHTML(activity?.description || '')}</textarea>
        </div>

        <div class="form-group">
          <label for="activity-start-date">${translate('activity_start_date')} <span class="required">*</span></label>
          <input type="date" id="activity-start-date" name="activity_start_date"
                 value="${escapeHTML(getActivityStartDate(activity) || '')}" required class="form-control">
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="activity-start-time">${translate('activity_start_time')} <span class="required">*</span></label>
            <input type="time" id="activity-start-time" name="activity_start_time"
                   value="${escapeHTML(activity?.activity_start_time || '')}" required class="form-control">
          </div>
          <div class="form-group">
            <label for="activity-end-time">${translate('activity_end_time')} <span class="required">*</span></label>
            <input type="time" id="activity-end-time" name="activity_end_time"
                   value="${escapeHTML(activity?.activity_end_time || '')}" required class="form-control">
          </div>
        </div>

        <div class="form-group">
          <label for="activity-end-date">${translate('activity_end_date')} <span class="required">*</span></label>
          <input type="date" id="activity-end-date" name="activity_end_date"
                 value="${escapeHTML(getActivityEndDate(activity) || '')}" required class="form-control">
        </div>

        <fieldset class="form-fieldset">
          <legend>${translate('going_to_activity')}</legend>

          <div class="form-group">
            <label for="meeting-location-going">${translate('meeting_location')} <span class="required">*</span></label>
            <input type="text" id="meeting-location-going" name="meeting_location_going"
                   value="${escapeHTML(activity?.meeting_location_going || '')}" required
                   class="form-control" placeholder="${translate('meeting_location_placeholder')}">
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="meeting-time-going">${translate('meeting_time')} <span class="required">*</span></label>
              <input type="time" id="meeting-time-going" name="meeting_time_going"
                     value="${escapeHTML(activity?.meeting_time_going || '')}" required class="form-control">
            </div>
            <div class="form-group">
              <label for="departure-time-going">${translate('departure_time')} <span class="required">*</span></label>
              <input type="time" id="departure-time-going" name="departure_time_going"
                     value="${escapeHTML(activity?.departure_time_going || '')}" required class="form-control">
            </div>
          </div>
        </fieldset>

        <fieldset class="form-fieldset">
          <legend>${translate('returning_from_activity')}</legend>

          <div class="form-group">
            <label for="meeting-location-return">${translate('meeting_location')}</label>
            <input type="text" id="meeting-location-return" name="meeting_location_return"
                   value="${escapeHTML(activity?.meeting_location_return || '')}"
                   class="form-control" placeholder="${translate('meeting_location_placeholder')}">
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="meeting-time-return">${translate('meeting_time')}</label>
              <input type="time" id="meeting-time-return" name="meeting_time_return"
                     value="${escapeHTML(activity?.meeting_time_return || '')}" class="form-control">
            </div>
            <div class="form-group">
              <label for="departure-time-return">${translate('departure_time')}</label>
              <input type="time" id="departure-time-return" name="departure_time_return"
                     value="${escapeHTML(activity?.departure_time_return || '')}" class="form-control">
            </div>
          </div>
        </fieldset>

        ${isEdit ? `
        <div class="form-group">
          <label>
            <input type="checkbox" name="notify_participants" checked>
            ${translate('activity_notify_updates_label')}
          </label>
          <small class="form-help">${translate('activity_notify_updates_help')}</small>
        </div>
        ` : ''}

        <div class="modal-actions">
          <button type="button" class="button button--secondary" id="magic-generate-btn">✨ ${translate('magic_generate')}</button>
          <button type="button" class="button button--secondary" data-modal-close>${translate('cancel')}</button>
          <button type="submit" class="button button--primary">
            ${isEdit ? translate('save_changes') : translate('create_activity')}
          </button>
        </div>
      </form>
    `;

    const { overlay, close } = openModal({
      id: 'activity-modal',
      title: isEdit ? translate('edit_activity') : translate('add_activity'),
      body
    });

    const startDateInput = overlay.querySelector('#activity-start-date');
    const endDateInput = overlay.querySelector('#activity-end-date');
    if (startDateInput && endDateInput && !endDateInput.value) {
      endDateInput.value = startDateInput.value;
    }
    startDateInput?.addEventListener('change', () => {
      if (endDateInput && !endDateInput.value) {
        endDateInput.value = startDateInput.value;
      }
    });

    overlay.querySelector('#magic-generate-btn')?.addEventListener('click', () => {
      this.showMagicGenerateModal();
    });

    overlay.querySelector('#activity-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.handleActivitySubmit(e, activity, isEdit, close);
    });
  }

  async handleActivitySubmit(e, activity, isEdit, close) {
    const submitButton = e.target.querySelector('button[type="submit"]');
    const submitButtonLabel = submitButton?.textContent || '';
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData.entries());

    debugLog('Activity form data:', data);

    // Convert empty strings to null for optional fields only
    if (!data.description) {
      data.description = null;
    }
    if (!data.meeting_location_return) {
      data.meeting_location_return = null;
    }
    if (!data.meeting_time_return) {
      data.meeting_time_return = null;
    }
    if (!data.departure_time_return) {
      data.departure_time_return = null;
    }

    // In edit mode, empty date/time fields mean "leave unchanged"
    if (isEdit) {
      ['activity_start_date', 'activity_start_time', 'activity_end_date', 'activity_end_time'].forEach(field => {
        if (!data[field]) {
          data[field] = null;
        }
      });
      data.notify_participants = formData.get('notify_participants') === 'on';
    }

    // Legacy compatibility field
    if (!data.activity_date && data.activity_start_date) {
      data.activity_date = data.activity_start_date;
    }

    setButtonLoading(submitButton, true);
    if (submitButton) {
      submitButton.textContent = isEdit ? `${translate('save_changes')}...` : `${translate('create_activity')}...`;
    }

    try {
      if (isEdit) {
        await updateActivity(activity.id, data);
        this.app.showMessage(translate('activity_updated_success'), 'success');
      } else {
        await createActivity(data);
        this.app.showMessage(translate('activity_created_success'), 'success');
      }

      await clearActivityRelatedCaches();
      close();
      await this.loadActivities(true);
      this.render();
      this.attachEventListeners();
    } catch (err) {
      debugError('Error saving activity:', err);
      this.app.showMessage(err.message || translate('error_saving_activity'), 'error');
    } finally {
      setButtonLoading(submitButton, false);
      if (submitButton) {
        submitButton.textContent = submitButtonLabel;
      }
    }
  }

  showMagicGenerateModal() {
    const body = `
      <form id="magic-form">
        <div class="form-group">
          <label>${translate('duration_minutes')}</label>
          <input type="number" name="duration" value="${DEFAULT_AI_DURATION_MINUTES}" class="form-control">
        </div>
        <div class="form-group">
          <label>${translate('badge_focus')}</label>
          <input type="text" name="badge" placeholder="e.g. Pioneer, First Aid" class="form-control">
        </div>
        <div class="form-group">
          <label>${translate('participants_count')}</label>
          <input type="number" name="count" value="${DEFAULT_AI_PARTICIPANT_COUNT}" class="form-control">
        </div>
        <div class="modal-actions">
          <button type="button" class="button button--secondary" data-modal-close>${translate('cancel')}</button>
          <button type="submit" class="button button--primary">✨ ${translate('generate')}</button>
        </div>
      </form>
    `;

    const { overlay, close } = openModal({
      id: 'magic-generate-modal',
      title: `✨ ${translate('magic_generate_meeting')}`,
      body
    });

    overlay.querySelector('#magic-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type="submit"]');
      setButtonLoading(btn, true);

      try {
        const formData = new FormData(e.target);
        const payload = {
          durationMinutes: parseInt(formData.get('duration')) || DEFAULT_AI_DURATION_MINUTES,
          badgeFocus: formData.get('badge') || 'General',
          participantsCount: parseInt(formData.get('count')) || DEFAULT_AI_PARTICIPANT_COUNT
        };

        const response = await aiGenerateText('meeting_plan', payload);
        const plan = response.data?.data || response.data;

        const nameInput = document.getElementById('activity-name');
        const descInput = document.getElementById('activity-description');

        if (nameInput) {
          nameInput.value = plan.title || '';
        }
        if (descInput) {
          let desc = `${plan.overview || ''}\n\nTimeline:\n`;
          (plan.timeline || []).forEach(t => {
            desc += `- ${t.minuteStart}-${t.minuteEnd}m: ${t.name} (${t.objective})\n`;
          });
          if (Array.isArray(plan.materialsMasterList)) {
            desc += `\nMaterials: ${plan.materialsMasterList.join(', ')}`;
          }
          descInput.value = desc;
        }

        this.app.showMessage(translate('magic_generated_success'), 'success');
        close();
      } catch (err) {
        let msg = translate('magic_generate_error');
        if (err.error?.code === 'AI_BUDGET_EXCEEDED') {
          msg = translate('ai_budget_exceeded');
        }
        this.app.showMessage(msg, 'error');
      } finally {
        setButtonLoading(btn, false);
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
      this.app.showMessage(err.message || translate('error_deleting_activity'), 'error');
    }
  }
}
