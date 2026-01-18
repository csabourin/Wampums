// activities.js
// Activity calendar management for leaders and administrators
import { translate } from './app.js';
import {
  getActivities,
  getActivity,
  createActivity,
  updateActivity,
  deleteActivity
} from './api/api-activities.js';
import { clearActivityRelatedCaches } from './indexedDB.js';
import { canViewActivities } from './utils/PermissionUtils.js';
import { skeletonActivityList, setButtonLoading } from './utils/SkeletonUtils.js';
import { debugError, debugLog } from './utils/DebugUtils.js';
import { setContent } from './utils/DOMUtils.js';
import { escapeHTML } from './utils/SecurityUtils.js';
import { formatDateShort, isoToDateString, parseDate } from './utils/DateUtils.js';

export class Activities {
  constructor(app) {
    this.app = app;
    this.activities = [];
    this.selectedActivity = null;
    this.isLoading = true;
  }

  async init() {
    // Check permission
    if (!canViewActivities()) {
      this.app.router.navigate("/dashboard");
      return;
    }

    // Show loading skeleton
    this.isLoading = true;
    this.render();

    await this.loadActivities();

    // Show actual content
    this.isLoading = false;
    this.render();
    this.attachEventListeners();
  }

  async loadActivities() {
    try {
      this.activities = await getActivities();
    } catch (error) {
      debugError('Error loading activities:', error);
      this.app.showToast(translate('error_loading_activities'), 'error');
      this.activities = [];
    }
  }

  render() {
    const container = document.getElementById('app');

    // Show loading skeleton while data is being fetched
    if (this.isLoading) {
      setContent(container, skeletonActivityList());
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const upcomingActivities = this.activities.filter((activity) => {
      const activityDate = parseDate(isoToDateString(activity.activity_date));
      return activityDate && activityDate >= today;
    });
    const pastActivities = this.activities.filter((activity) => {
      const activityDate = parseDate(isoToDateString(activity.activity_date));
      return activityDate && activityDate < today;
    });

    setContent(container, `
      <section class="page activities-page">
        <header class="page__header">
          <div class="page__header-top">
            <a href="/dashboard" class="button button--ghost">← ${translate('back')}</a>
            <h1>${translate('activities_calendar')}</h1>
            <button class="button button--primary" id="add-activity-btn">
              ${translate('add_activity')}
            </button>
          </div>
        </header>

        <div class="activities-container">
          <!-- Upcoming Activities -->
          <div class="activity-section">
            <h2 class="activity-section__title">${translate('upcoming_activities')}</h2>
            ${upcomingActivities.length > 0 ? `
              <div class="activity-list">
                ${upcomingActivities.map(activity => this.renderActivityCard(activity)).join('')}
              </div>
            ` : `
              <p class="empty-state">${translate('no_upcoming_activities')}</p>
            `}
          </div>

          <!-- Past Activities -->
          ${pastActivities.length > 0 ? `
            <details class="activity-section activity-section--past">
              <summary class="activity-section__title">${translate('past_activities')} (${pastActivities.length})</summary>
              <div class="activity-list">
                ${pastActivities.map(activity => this.renderActivityCard(activity)).join('')}
              </div>
            </details>
          ` : ''}
        </div>
      </section>
    `);
  }

  renderActivityCard(activity) {
    const activityDateString = isoToDateString(activity.activity_date);
    const activityDate = parseDate(activityDateString);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const isPast = activityDate ? activityDate < today : false;
    const displayDate = formatDateShort(activityDateString, this.app.lang || 'fr');

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
              <span>${translate('meeting')}: ${escapeHTML(activity.meeting_time_going)} @ ${escapeHTML(activity.meeting_location_going)}</span>
              <span>${translate('departure')}: ${escapeHTML(activity.departure_time_going)}</span>
            </div>
          </div>

          ${activity.meeting_location_return ? `
            <div class="activity-detail">
              <strong>${translate('returning')}:</strong>
              <div class="activity-detail__content">
                <span>${translate('meeting')}: ${escapeHTML(activity.meeting_time_return)} @ ${escapeHTML(activity.meeting_location_return)}</span>
                <span>${translate('departure')}: ${escapeHTML(activity.departure_time_return)}</span>
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
          <button class="button button--small button--outline edit-activity-btn" data-activity-id="${activity.id}">
            ${translate('edit')}
          </button>
          <button class="button button--small button--danger delete-activity-btn" data-activity-id="${activity.id}">
            ${translate('delete')}
          </button>
        </div>
      </div>
    `;
  }

  attachEventListeners() {
    // Add activity button
    document.getElementById('add-activity-btn')?.addEventListener('click', () => {
      this.showActivityModal();
    });

    // Edit activity buttons
    document.querySelectorAll('.edit-activity-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const activityId = parseInt(e.target.dataset.activityId);
        const activity = this.activities.find(a => a.id === activityId);
        if (activity) {
          this.showActivityModal(activity);
        }
      });
    });

    // Delete activity buttons
    document.querySelectorAll('.delete-activity-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const activityId = parseInt(e.target.dataset.activityId);
        if (confirm(translate('confirm_delete_activity'))) {
          const button = e.target;
          setButtonLoading(button, true);
          try {
            await this.deleteActivity(activityId);
          } finally {
            setButtonLoading(button, false);
          }
        }
      });
    });

    // View carpools buttons
    document.querySelectorAll('.view-carpools-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const activityId = parseInt(e.target.dataset.activityId);
        window.location.hash = `/carpool/${activityId}`;
      });
    });
  }

  showActivityModal(activity = null) {
    const isEdit = activity !== null;
    const modalId = 'activity-modal';

    const modalHTML = `
      <div class="modal__backdrop" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: -1;"></div>
      <div class="modal" style="display: block; position: relative; background: white; border-radius: 12px; max-width: 600px; width: 90%; max-height: 90vh; overflow-y: auto; box-shadow: 0 4px 6px rgba(0,0,0,0.1);" role="dialog" aria-modal="true" aria-labelledby="activity-modal-title">
        <header class="modal__header">
          <h2 id="activity-modal-title">
            ${isEdit ? translate('edit_activity') : translate('add_activity')}
          </h2>
          <div style="display:flex; gap:10px;">
             <button class="button button--small button--secondary" id="magic-generate-btn">✨ ${translate('magic_generate')}</button>
             <button class="ghost-button" id="close-activity-modal" aria-label="${translate('close')}">✕</button>
          </div>
        </header>

        <form class="modal__content" id="activity-form">
          <div class="form-group">
            <label for="activity-name">${translate('activity_name')} <span class="required">*</span></label>
            <input type="text" id="activity-name" name="name"
                   value="${escapeHTML(activity?.name || '')}" required
                   class="form-control" maxlength="255">
          </div>

          <div class="form-group">
            <label for="activity-description">${translate('description')}</label>
            <textarea id="activity-description" name="description"
                      class="form-control" rows="3">${escapeHTML(activity?.description || '')}</textarea>
          </div>

          <div class="form-group">
            <label for="activity-date">${translate('activity_date')} <span class="required">*</span></label>
            <input type="date" id="activity-date" name="activity_date"
                   value="${escapeHTML(isoToDateString(activity?.activity_date) || '')}" required
                   class="form-control">
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
                       value="${escapeHTML(activity?.meeting_time_going || '')}" required
                       class="form-control">
              </div>

              <div class="form-group">
                <label for="departure-time-going">${translate('departure_time')} <span class="required">*</span></label>
                <input type="time" id="departure-time-going" name="departure_time_going"
                       value="${escapeHTML(activity?.departure_time_going || '')}" required
                       class="form-control">
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
                       value="${escapeHTML(activity?.meeting_time_return || '')}"
                       class="form-control">
              </div>

              <div class="form-group">
                <label for="departure-time-return">${translate('departure_time')}</label>
                <input type="time" id="departure-time-return" name="departure_time_return"
                       value="${escapeHTML(activity?.departure_time_return || '')}"
                       class="form-control">
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

          <div class="modal__actions">
            <button type="button" class="button button--secondary" id="cancel-activity-btn">
              ${translate('cancel')}
            </button>
            <button type="submit" class="button button--primary">
              ${isEdit ? translate('save_changes') : translate('create_activity')}
            </button>
          </div>
        </form>
      </div>
    `;

    // Create modal container
    let modalContainer = document.getElementById(modalId);
    if (!modalContainer) {
      modalContainer = document.createElement('div');
      modalContainer.id = modalId;
      modalContainer.className = 'modal-container';
      modalContainer.style.position = 'fixed';
      modalContainer.style.top = '0';
      modalContainer.style.left = '0';
      modalContainer.style.width = '100%';
      modalContainer.style.height = '100%';
      modalContainer.style.display = 'flex';
      modalContainer.style.alignItems = 'center';
      modalContainer.style.justifyContent = 'center';
      modalContainer.style.zIndex = '10000';
      document.body.appendChild(modalContainer);
    }
    // Use innerHTML directly instead of setContent to avoid sanitization issues with forms
    modalContainer.innerHTML = modalHTML;
    modalContainer.classList.add('modal-container--visible');

    // Attach modal event listeners
    const closeModal = () => {
      modalContainer.remove();
    };

    document.getElementById('close-activity-modal')?.addEventListener('click', closeModal);
    document.getElementById('cancel-activity-btn')?.addEventListener('click', closeModal);
    modalContainer.querySelector('.modal__backdrop')?.addEventListener('click', closeModal);

    // Form submission
    // Magic Generate (AI)
    document.getElementById('magic-generate-btn')?.addEventListener('click', () => {
      this.showMagicGenerateModal();
    });

    // Form submission
    document.getElementById('activity-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitButton = e.target.querySelector('button[type="submit"]');
      const formData = new FormData(e.target);
      const data = Object.fromEntries(formData.entries());

      // Debug: Log collected form data
      debugLog('Form data collected:', data);
      debugLog('FormData entries:', Array.from(formData.entries()));

      // Convert empty strings to null for optional fields
      if (!data.description) data.description = null;
      if (!data.meeting_location_return) data.meeting_location_return = null;
      if (!data.meeting_time_return) data.meeting_time_return = null;
      if (!data.departure_time_return) data.departure_time_return = null;
      if (isEdit) {
        data.notify_participants = formData.get('notify_participants') === 'on';
      }

      // Debug: Log data being sent to API
      debugLog('Data being sent to API:', data);

      setButtonLoading(submitButton, true);

      try {
        if (isEdit) {
          await updateActivity(activity.id, data);
          this.app.showMessage(translate('activity_updated_success'), 'success');
        } else {
          await createActivity(data);
          this.app.showMessage(translate('activity_created_success'), 'success');
        }

        // Clear activity-related caches so changes appear immediately
        await clearActivityRelatedCaches();

        closeModal();
        await this.loadActivities();
        this.render();
        this.attachEventListeners();
      } catch (error) {
        debugError('Error saving activity:', error);
        this.app.showMessage(error.message || translate('error_saving_activity'), 'error');
      } finally {
        setButtonLoading(submitButton, false);
      }
    });

    // --- End attached event listeners ---
  }

  showMagicGenerateModal() {
    const modalId = 'magic-generate-modal';
    const content = `
      <div class="modal__backdrop"></div>
      <div class="modal">
        <header class="modal__header">
          <h2>✨ ${translate('magic_generate_meeting')}</h2>
          <button class="ghost-button close-magic">✕</button>
        </header>
        <form id="magic-form" class="modal__content">
          <div class="form-group">
            <label>${translate('duration_minutes')}</label>
            <input type="number" name="duration" value="120" class="form-control">
          </div>
          <div class="form-group">
            <label>${translate('badge_focus')}</label>
            <input type="text" name="badge" placeholder="e.g. Pioneer, First Aid" class="form-control">
          </div>
          <div class="form-group">
            <label>${translate('participants_count')}</label>
            <input type="number" name="count" value="12" class="form-control">
          </div>
          <div class="modal__actions">
            <button type="submit" class="button button--primary">✨ ${translate('generate')}</button>
          </div>
        </form>
      </div>
    `;

    // Create container
    let container = document.getElementById(modalId);
    if (!container) {
      container = document.createElement('div');
      container.id = modalId;
      container.className = 'modal-container modal-container--visible';
      document.body.appendChild(container);
    }
    container.innerHTML = content;

    // Events
    const close = () => container.remove();
    container.querySelector('.close-magic').onclick = close;
    container.querySelector('.modal__backdrop').onclick = close;

    container.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button');
      setButtonLoading(btn, true);

      try {
        const formData = new FormData(e.target);
        const payload = {
          durationMinutes: parseInt(formData.get('duration')) || 120,
          badgeFocus: formData.get('badge') || "General",
          participantsCount: parseInt(formData.get('count')) || 12
        };

        const response = await window.aiGenerateText("meeting_plan", payload);
        const plan = response.data; // The generated JSON

        // Fill the activity form
        const nameInput = document.getElementById('activity-name');
        const descInput = document.getElementById('activity-description');

        if (nameInput) nameInput.value = plan.title;
        if (descInput) {
          // Format the plan nicely
          let desc = plan.overview + "\n\n";
          desc += `Timeline:\n`;
          plan.timeline.forEach(t => {
            desc += `- ${t.minuteStart}-${t.minuteEnd}m: ${t.name} (${t.objective})\n`;
          });
          desc += `\nMaterials: ${plan.materialsMasterList.join(', ')}`;
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
    };
  }

  async deleteActivity(activityId) {
    try {
      await deleteActivity(activityId);

      // Clear activity-related caches so changes appear immediately
      await clearActivityRelatedCaches();

      this.app.showMessage(translate('activity_deleted_success'), 'success');
      await this.loadActivities();
      this.render();
      this.attachEventListeners();
    } catch (error) {
      debugError('Error deleting activity:', error);
      this.app.showMessage(error.message || translate('error_deleting_activity'), 'error');
    }
  }
}
