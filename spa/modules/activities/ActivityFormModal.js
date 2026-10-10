// ActivityFormModal.js
// The one form for creating and editing an activity (outing, weekend, camp).
// Every screen that creates or edits an activity opens this modal, so the
// fields, the validation and the permission-slip authorization text stay the
// same wherever an activity is managed.
import { translate } from '../../app.js';
import { createActivity, getActivity, updateActivity } from '../../api/api-activities.js';
import { clearActivityRelatedCaches } from '../../indexedDB.js';
import { debugError } from '../../utils/DebugUtils.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { setButtonLoading } from '../../utils/SkeletonUtils.js';
import { openModal } from '../../utils/ModalUtils.js';
import { getActivityEndDate, getActivityStartDate } from '../../utils/ActivityDateUtils.js';
import { aiGenerateText } from '../AI.js';
import { attachInviteesPicker, buildInviteesFieldsetHTML } from './ActivityInviteesPicker.js';

import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';
const DEFAULT_AI_DURATION_MINUTES = 120;
const DEFAULT_AI_PARTICIPANT_COUNT = 12;
const ACTIVITY_NAME_MAX_LENGTH = 255;
const AUTHORIZATION_TEXT_MAX_LENGTH = 10000;
const TIME_INPUT_LENGTH = 5;

// Defaults offered when creating an activity from scratch
const NEW_ACTIVITY_DEFAULTS = {
  activity_start_time: '09:00',
  activity_end_time: '12:00',
  meeting_time_going: '09:00',
  departure_time_going: '09:15'
};

/**
 * Format a database time (HH:MM:SS) for a time input (HH:MM).
 * @param {string|null|undefined} value
 * @returns {string}
 */
function timeInputValue(value) {
  return value ? String(value).slice(0, TIME_INPUT_LENGTH) : '';
}

/**
 * Tomorrow's local date as YYYY-MM-DD.
 * @returns {string}
 */
function tomorrowDate() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  // Local date, not toISOString(): UTC would skip a day in the evening
  return tomorrow.toLocaleDateString('en-CA');
}

/**
 * Build the activity form markup.
 * @param {Object|null} activity - Activity being edited, or null to create
 * @returns {string} Form HTML
 */
function buildFormHTML(activity) {
  const isEdit = Boolean(activity);
  const defaults = isEdit ? {} : NEW_ACTIVITY_DEFAULTS;
  const startDate = isEdit ? getActivityStartDate(activity) : tomorrowDate();
  const endDate = isEdit ? getActivityEndDate(activity) : startDate;
  const value = (field) => escapeHTML(activity?.[field] ?? '');
  const time = (field) => escapeHTML(timeInputValue(activity?.[field]) || defaults[field] || '');
  const required = '<span class="required">*</span>';

  return `
    <form id="activity-form" novalidate>
      <div class="form-group">
        <label for="activity-name">${translate('activity_name')} ${required}</label>
        <input type="text" id="activity-name" name="activity_name" value="${value('name')}"
               required class="form-control" maxlength="${ACTIVITY_NAME_MAX_LENGTH}">
      </div>

      <div class="form-group">
        <label for="activity-description">${translate('description')}</label>
        <textarea id="activity-description" name="description"
                  class="form-control" rows="3">${value('description')}</textarea>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label for="activity-start-date">${translate('activity_start_date')} ${required}</label>
          <input type="date" id="activity-start-date" name="activity_start_date"
                 value="${escapeHTML(startDate || '')}" required class="form-control">
        </div>
        <div class="form-group">
          <label for="activity-start-time">${translate('activity_start_time')} ${required}</label>
          <input type="time" id="activity-start-time" name="activity_start_time"
                 value="${time('activity_start_time')}" required class="form-control">
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label for="activity-end-date">${translate('activity_end_date')} ${required}</label>
          <input type="date" id="activity-end-date" name="activity_end_date"
                 value="${escapeHTML(endDate || '')}" required class="form-control">
        </div>
        <div class="form-group">
          <label for="activity-end-time">${translate('activity_end_time')} ${required}</label>
          <input type="time" id="activity-end-time" name="activity_end_time"
                 value="${time('activity_end_time')}" required class="form-control">
        </div>
      </div>

      ${buildInviteesFieldsetHTML(activity)}

      <fieldset class="form-fieldset">
        <legend>${translate('going_to_activity')}</legend>

        <div class="form-group">
          <label for="meeting-location-going">${translate('meeting_location')} ${required}</label>
          <input type="text" id="meeting-location-going" name="meeting_location_going"
                 value="${value('meeting_location_going')}" required
                 class="form-control" placeholder="${escapeHTML(translate('meeting_location_placeholder'))}">
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="meeting-time-going">${translate('meeting_time')} ${required}</label>
            <input type="time" id="meeting-time-going" name="meeting_time_going"
                   value="${time('meeting_time_going')}" required class="form-control">
          </div>
          <div class="form-group">
            <label for="departure-time-going">${translate('departure_time')} ${required}</label>
            <input type="time" id="departure-time-going" name="departure_time_going"
                   value="${time('departure_time_going')}" required class="form-control">
          </div>
        </div>
      </fieldset>

      <fieldset class="form-fieldset">
        <legend>${translate('returning_from_activity')}</legend>

        <div class="form-group">
          <label for="meeting-location-return">${translate('meeting_location')}</label>
          <input type="text" id="meeting-location-return" name="meeting_location_return"
                 value="${value('meeting_location_return')}"
                 class="form-control" placeholder="${escapeHTML(translate('meeting_location_placeholder'))}">
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="meeting-time-return">${translate('meeting_time')}</label>
            <input type="time" id="meeting-time-return" name="meeting_time_return"
                   value="${time('meeting_time_return')}" class="form-control">
          </div>
          <div class="form-group">
            <label for="departure-time-return">${translate('departure_time')}</label>
            <input type="time" id="departure-time-return" name="departure_time_return"
                   value="${time('departure_time_return')}" class="form-control">
          </div>
        </div>
      </fieldset>

      <fieldset class="form-fieldset">
        <legend>${translate('activity_permission_slip_section')}</legend>
        <div class="form-group">
          <label for="activity-authorization-text">${translate('activity_authorization_text_label')}</label>
          <textarea id="activity-authorization-text" name="authorization_text" class="form-control" rows="5"
                    maxlength="${AUTHORIZATION_TEXT_MAX_LENGTH}"
                    aria-describedby="activity-authorization-text-help"
                    placeholder="${escapeHTML(translate('activity_authorization_text_placeholder'))}">${value('authorization_text')}</textarea>
          <small class="form-help" id="activity-authorization-text-help">${translate('activity_authorization_text_help')}</small>
        </div>
      </fieldset>

      ${isEdit ? `
        <div class="form-group">
          <label>
            <input type="checkbox" name="notify_participants">
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
}

/**
 * Read the form into the payload the activities API expects.
 * Every field is sent: on an edit, an emptied optional field clears it.
 * @param {HTMLFormElement} form
 * @param {boolean} isEdit
 * @returns {Object} Activity payload
 */
function readForm(form, isEdit) {
  const formData = new FormData(form);
  const data = {};
  formData.forEach((fieldValue, key) => {
    data[key] = typeof fieldValue === 'string' ? fieldValue.trim() : fieldValue;
  });
  data.activity_date = data.activity_start_date;
  if (isEdit) {
    data.notify_participants = formData.get('notify_participants') === 'on';
  }
  return data;
}

/**
 * Validate what the browser cannot: required fields and the schedule order.
 * @param {Object} data - Payload from readForm
 * @returns {string|null} Translation key of the first problem, or null
 */
function validate(data) {
  const requiredFields = [
    'activity_name',
    'activity_start_date',
    'activity_start_time',
    'activity_end_date',
    'activity_end_time',
    'meeting_location_going',
    'meeting_time_going',
    'departure_time_going'
  ];
  if (requiredFields.some((field) => !data[field])) {
    return 'activity_form_missing_required';
  }
  if (`${data.activity_end_date}T${data.activity_end_time}` < `${data.activity_start_date}T${data.activity_start_time}`) {
    return 'activity_form_end_before_start';
  }
  if (data.meeting_time_going >= data.departure_time_going) {
    return 'activity_form_departure_before_meeting';
  }
  if (data.meeting_time_return && data.departure_time_return
    && data.meeting_time_return >= data.departure_time_return) {
    return 'activity_form_departure_before_meeting';
  }
  return null;
}

/**
 * Fill the name and description from an AI-generated meeting plan.
 * @param {Object} app - App instance (for messages)
 * @param {HTMLElement} formOverlay - The activity form's modal overlay
 */
function showMagicGenerateModal(app, formOverlay) {
  const body = `
    <form id="magic-form">
      <div class="form-group">
        <label for="magic-duration">${translate('duration_minutes')}</label>
        <input type="number" id="magic-duration" name="duration" value="${DEFAULT_AI_DURATION_MINUTES}" class="form-control">
      </div>
      <div class="form-group">
        <label for="magic-badge">${translate('badge_focus')}</label>
        <input type="text" id="magic-badge" name="badge" class="form-control">
      </div>
      <div class="form-group">
        <label for="magic-count">${translate('participants_count')}</label>
        <input type="number" id="magic-count" name="count" value="${DEFAULT_AI_PARTICIPANT_COUNT}" class="form-control">
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
        durationMinutes: parseInt(formData.get('duration'), 10) || DEFAULT_AI_DURATION_MINUTES,
        badgeFocus: formData.get('badge') || 'General',
        participantsCount: parseInt(formData.get('count'), 10) || DEFAULT_AI_PARTICIPANT_COUNT
      };

      const response = await aiGenerateText('meeting_plan', payload);
      const plan = response.data?.data || response.data;

      const nameInput = formOverlay.querySelector('#activity-name');
      const descInput = formOverlay.querySelector('#activity-description');

      if (nameInput) {
        nameInput.value = plan.title || '';
      }
      if (descInput) {
        const timeline = (plan.timeline || [])
          .map((t) => `- ${t.minuteStart}-${t.minuteEnd}m: ${t.name} (${t.objective})`)
          .join('\n');
        const materials = Array.isArray(plan.materialsMasterList)
          ? `\n\nMaterials: ${plan.materialsMasterList.join(', ')}`
          : '';
        descInput.value = `${plan.overview || ''}\n\nTimeline:\n${timeline}${materials}`;
      }

      app.showMessage(translate('magic_generated_success'), 'success');
      close();
    } catch (err) {
      debugError('Magic generate failed:', err);
      const msg = err.error?.code === 'AI_BUDGET_EXCEEDED'
        ? translate('ai_budget_exceeded')
        : translate('magic_generate_error');
      app.showMessage(msg, 'error');
    } finally {
      setButtonLoading(btn, false);
    }
  });
}

/**
 * Open the activity form to create a new activity or edit an existing one.
 *
 * @param {Object} app - App instance
 * @param {Object} [options]
 * @param {Object|null} [options.activity] - Activity to edit; omit to create one
 * @param {Function} [options.onSaved] - Called with the saved activity after the modal closes
 * @returns {{ close: Function }} Modal handle
 */
export function openActivityFormModal(app, { activity = null, onSaved = null } = {}) {
  const isEdit = Boolean(activity);
  let saving = false;

  const { overlay, close } = openModal({
    id: 'activity-modal',
    title: escapeHTML(isEdit ? translate('edit_activity') : translate('add_activity')),
    body: buildFormHTML(activity),
    canClose: () => !saving
  });

  const startDateInput = overlay.querySelector('#activity-start-date');
  const invitees = attachInviteesPicker(overlay, {
    activity,
    getStartDate: () => startDateInput?.value || '',
    // The activity list does not carry who is invited: its details do
    loadInvitedIds: async () => {
      if (!isEdit || activity.invites_everyone !== false) {
        return [];
      }
      if (Array.isArray(activity.invited_participant_ids)) {
        return activity.invited_participant_ids;
      }
      const details = await getActivity(activity.id);
      return details?.invited_participant_ids || [];
    }
  });
  const endDateInput = overlay.querySelector('#activity-end-date');
  // Keep a one-day activity one day long when only its start date moves
  let previousStartDate = startDateInput?.value || '';
  startDateInput?.addEventListener('change', () => {
    if (endDateInput && (!endDateInput.value || endDateInput.value === previousStartDate
      || endDateInput.value < startDateInput.value)) {
      endDateInput.value = startDateInput.value;
    }
    previousStartDate = startDateInput.value;
    invitees.refreshAges();
  });

  overlay.querySelector('#magic-generate-btn')?.addEventListener('click', () => {
    showMagicGenerateModal(app, overlay);
  });

  overlay.querySelector('#activity-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const data = invitees.readInto(readForm(form, isEdit));
    const problem = validate(data) || invitees.validate();
    if (problem) {
      app.showMessage(translate(problem), 'error');
      return;
    }

    const submitButton = form.querySelector('button[type="submit"]');
    saving = true;
    setButtonLoading(submitButton, true);

    try {
      const saved = isEdit
        ? await updateActivity(activity.id, data)
        : await createActivity(data);
      await clearActivityRelatedCaches();

      const updatedSlips = saved?.pending_permission_slips_updated || 0;
      const freedSeats = saved?.uninvited_carpool_assignments_removed || 0;
      const archivedSlips = saved?.uninvited_permission_slips_archived || 0;
      const message = [
        isEdit ? translate('activity_updated_success') : translate('activity_created_success'),
        updatedSlips > 0
          ? translate('activity_pending_slips_updated').replace('{count}', updatedSlips)
          : '',
        freedSeats > 0 || archivedSlips > 0
          ? translate('activity_invitees_removed_notice')
            .replace('{assignments}', freedSeats)
            .replace('{slips}', archivedSlips)
          : ''
      ].filter(Boolean).join(' ');
      app.showMessage(message, 'success');

      saving = false;
      close(true);
      if (typeof onSaved === 'function') {
        await onSaved(saved);
      }
    } catch (err) {
      debugError('Error saving activity:', err);
      app.showMessage(apiErrorMessage(err, 'error_saving_activity'), 'error');
    } finally {
      saving = false;
      setButtonLoading(submitButton, false);
    }
  });

  return { close };
}
