// ActivityFormModal.js
// The one form for creating and editing an activity (outing, weekend, camp).
// Every screen that creates or edits an activity opens this modal, so the
// fields, the validation and the permission-slip authorization text stay the
// same wherever an activity is managed.
import { authorizationFieldsHTML, attachAuthorizationComposer } from './ActivityAuthorizationComposer.js';
import { sendActivityAuthorizations, getActivityAuthorizations } from '../../api/api-activity-authorizations.js';
import { authorizationResultHTML } from './AuthorizationResult.js';
import { setContent } from '../../utils/DOMUtils.js';
import { canFollowPermissionSlips, hasPermission } from '../../utils/PermissionUtils.js';
import { translate } from '../../app.js';
import { createActivity, getActivity, updateActivity } from '../../api/api-activities.js';
import { clearActivityPermissionSlipCaches, clearActivityRelatedCaches } from '../../indexedDB.js';
import { debugError } from '../../utils/DebugUtils.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { setButtonLoading } from '../../utils/SkeletonUtils.js';
import { openModal } from '../../utils/ModalUtils.js';
import { getActivityEndDate, getActivityStartDate } from '../../utils/ActivityDateUtils.js';
import { aiGenerateText } from '../../api/api-ai.js';
import { attachInviteesPicker, buildInviteesFieldsetHTML } from './ActivityInviteesPicker.js';
import {
  attachRichTextEditor,
  getRichTextValue,
  richTextEditorHTML,
  setRichTextValue,
} from '../rich-text/RichTextEditor.js';
import { plainTextToRichText, richTextOrPlain, richTextToPlainText } from '../../utils/RichTextUtils.js';

import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';
import { formatEquipmentQuantity } from '../../utils/EquipmentUnitUtils.js';
const DEFAULT_AI_DURATION_MINUTES = 120;
const DEFAULT_AI_PARTICIPANT_COUNT = 12;
const ACTIVITY_NAME_MAX_LENGTH = 255;
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
function buildFormHTML(activity, defaultAuthorization) {
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
        <span class="form-label" id="activity-description-label">${translate('description')}</span>
        ${richTextEditorHTML({
    id: 'activity-description',
    labelId: 'activity-description-label',
    describedBy: 'activity-description-help',
    html: richTextOrPlain(activity?.description_html, activity?.description),
  })}
        <small class="form-help" id="activity-description-help">${translate('activity_description_help')}</small>
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

        <div class="form-group">
          <label for="meeting-location-going">${translate('meeting_location')} ${required}</label>
          <input type="text" id="meeting-location-going" name="meeting_location_going"
                 value="${value('meeting_location_going')}" required
                 class="form-control" placeholder="${escapeHTML(translate('meeting_location_placeholder'))}">
        </div>

      <div class="checkbox-option">
        <input type="checkbox" id="activity-transport-required" name="transport_required" ${activity?.transport_required !== false && activity ? 'checked' : ''} aria-controls="activity-transport-fields">
        <label for="activity-transport-required">${translate('authorization_transport_required')}</label>
      </div>
      <div id="activity-transport-fields" ${activity?.transport_required !== false && activity ? '' : 'hidden'}>
      <details class="activity-transport-details" open>
      <summary>${translate('authorization_transport_details')}</summary>
      <fieldset class="form-fieldset">
        <legend>${translate('going_to_activity')}</legend>

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

      </details></div>
      ${authorizationFieldsHTML(activity, defaultAuthorization)}

      ${isEdit ? `
        <div class="form-group" data-activity-notify>
          <label>
            <input type="checkbox" name="notify_participants">
            ${translate('activity_notify_updates_label')}
          </label>
          <small class="form-help">${translate('activity_notify_updates_help')}</small>
        </div>
      ` : ''}

      <div id="activity-save-result" role="status" tabindex="-1"></div>
      <div class="modal-actions">
        <button type="button" class="button button--secondary" id="magic-generate-btn">✨ ${translate('magic_generate')}</button>
        <button type="button" class="button button--secondary" data-modal-close>${translate('cancel')}</button>
        <button type="submit" name="intent" value="save" class="button button--secondary" data-activity-save>
          ${isEdit ? translate('save_changes') : translate('authorization_save_without_sending')}
        </button>
        <button type="submit" name="intent" value="send" class="button button--primary" data-activity-send hidden>
          ${translate(isEdit ? 'authorization_save_send' : 'authorization_create_activity_send')}
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
  data.authorization_required = formData.get('authorization_required') === 'on';
  data.transport_required = formData.get('transport_required') === 'on';
  if (!data.transport_required) {
    data.meeting_time_going = data.activity_start_time;
    data.departure_time_going = data.activity_start_time;
    data.meeting_location_return = '';
    data.meeting_time_return = '';
    data.departure_time_return = '';
  }
  // Both versions travel; the server keeps the plain text it derives from
  // the formatted one.
  const descriptionArea = form.querySelector('#activity-description');
  if (descriptionArea) {
    data.description_html = getRichTextValue(descriptionArea);
    data.description = richTextToPlainText(data.description_html);
  }
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
  if (data.transport_required && data.meeting_time_going >= data.departure_time_going) {
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
 * @param {Object} app - App instance (page language and messages)
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
        locale: app.lang,
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
        // The unit's own material, chosen by the server's list; a unit with
        // nothing recorded keeps the assistant's free-text list.
        const materialLines = Array.isArray(plan.material_items)
          ? plan.material_items.map((item) => `${formatEquipmentQuantity(item.quantity, item.unit_of_measure, app.lang)} · ${item.name}`)
          : (Array.isArray(plan.materialsMasterList) ? plan.materialsMasterList : []);
        const materials = materialLines.length
          ? `\n\n${translate('activity_plan_materials_heading')}\n${materialLines.map((line) => `- ${line}`).join('\n')}`
          : '';
        setRichTextValue(descInput, plainTextToRichText(
          `${plan.overview || ''}\n\n${translate('activity_plan_timeline_heading')}\n${timeline}${materials}`,
        ));
      }

      app.showMessage(translate('magic_generated_success'), 'success');
      close();
    } catch (err) {
      debugError('Magic generate failed:', err);
      app.showMessage(apiErrorMessage(err, 'magic_generate_error'), 'error');
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
export function openActivityFormModal(app, { activity = null, onSaved = null, defaultAuthorization = false } = {}) {
  const isEdit = Boolean(activity);
  let saving = false;
  let persistedActivity = activity;
  let notifySavedOnClose = false;
  const creationKey = crypto.randomUUID();
  const canViewDashboard = canFollowPermissionSlips();

  const { overlay, close } = openModal({
    id: 'activity-modal',
    title: escapeHTML(isEdit ? translate('edit_activity') : translate('add_activity')),
    body: buildFormHTML(activity, defaultAuthorization),
    canClose: () => !saving,
    onClose: () => {
      composer?.destroy();
      if (notifySavedOnClose && typeof onSaved === 'function') {
        Promise.resolve(onSaved(persistedActivity)).catch((error) => debugError('Activity list refresh failed', error));
      }
    }
  });

  const resultLink = (id) => canViewDashboard
    ? `<a href="/permission-slips/${id}" class="button button--secondary">${escapeHTML(translate('authorization_view_result'))}</a>`
    : '';
  const presentResult = (result, id) => {
    if (!overlay.isConnected) {return;}
    const feedback = overlay.querySelector('#activity-save-result');
    setContent(feedback, `${authorizationResultHTML(result, app.lang)}${resultLink(id)}`);
    feedback.querySelector('a')?.addEventListener('click', (event) => {
      event.preventDefault(); saving = false; close(true); app.router.navigate(`/permission-slips/${id}`);
    });
    feedback.focus(); feedback.scrollIntoView?.({ block: 'center' });
  };
  if (activity?.id && activity.authorization_required && !canViewDashboard && hasPermission('activities.edit')) {
    getActivityAuthorizations(activity.id).then((result) => {
      if (!saving) {presentResult(result, activity.id);}
    }).catch((error) => {debugError('Unable to load the stored authorization result', error);});
  }

  const descriptionEditor = overlay.querySelector('#activity-form [data-rte]');
  if (descriptionEditor) {
    attachRichTextEditor(descriptionEditor);
  }

  overlay.querySelector('#activity-transport-required').addEventListener('change', (event) => {
    overlay.querySelector('#activity-transport-fields').hidden = !event.target.checked;
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
  const composer = attachAuthorizationComposer(overlay, () => invitees.readInto(readForm(overlay.querySelector('#activity-form'), Boolean(persistedActivity))), isEdit);
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

    if (saving) {return;}
    const intent = e.submitter?.value || 'save';
    if (composer.enabled()) {data.notify_participants = false;}
    const submitButton = e.submitter || form.querySelector('[data-activity-save]');
    saving = true;
    form.setAttribute('aria-busy', 'true');
    const controls = Array.from(form.querySelectorAll('input, textarea, select, button'));
    const previouslyDisabled = controls.map((control) => control.disabled);
    controls.forEach((control) => {control.disabled = true;});
    setButtonLoading(submitButton, true);

    try {
      const saved = persistedActivity
        ? await updateActivity(persistedActivity.id, data)
        : await createActivity({ ...data, creation_key: creationKey });
      if (!saved?.id) {throw new Error('authorization_unconfirmed');}
      persistedActivity = saved;
      notifySavedOnClose = !canViewDashboard && data.authorization_required;
      overlay.querySelector('#activity-form [data-modal-close]').textContent = translate('close');
      overlay.querySelector('[data-activity-send]').textContent = translate('authorization_save_send');
      if (!overlay.isConnected) {return;}
      let result = null;
      if (composer.enabled() && intent === 'send') {
        setContent(overlay.querySelector('#activity-save-result'), escapeHTML(translate('authorization_sending')));
        result = await sendActivityAuthorizations(saved.id, data.authorization_deadline_date);
        if (!overlay.isConnected) {return;}
        if (result.state !== 'sent') {
          presentResult(result, saved.id);
          return;
        }
      }
      if (data.authorization_required && !canViewDashboard) {
        if (result || hasPermission('activities.edit')) {
          presentResult(result || await getActivityAuthorizations(saved.id), saved.id);
        } else {
          setContent(overlay.querySelector('#activity-save-result'), escapeHTML(translate('authorization_saved_not_sent')));
        }
        app.showMessage(result ? translate('authorization_state_sent') : translate('authorization_saved_not_sent'), 'success');
        return;
      }
      await clearActivityRelatedCaches();

      const updatedSlips = saved?.pending_permission_slips_updated || 0;
      const freedSeats = saved?.uninvited_carpool_assignments_removed || 0;
      const archivedSlips = saved?.uninvited_permission_slips_archived || 0;
      if (archivedSlips > 0) {
        await clearActivityPermissionSlipCaches(activity.id);
      }
      const message = [
        result ? translate('authorization_state_sent') : data.notify_participants ? translate('activity_updated_success') : translate('authorization_saved_not_sent'),
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
      if (data.authorization_required && canViewDashboard) {app.router?.navigate(`/permission-slips/${saved.id}`);}
    } catch (err) {
      debugError('Error saving activity:', err);
      if (!overlay.isConnected) {return;}
      const feedback = overlay.querySelector('#activity-save-result');
      const message = persistedActivity ? 'authorization_saved_send_unconfirmed' : 'authorization_unconfirmed';
      setContent(feedback, `${escapeHTML(err.code === 'operation_unconfirmed' ? translate(message) : apiErrorMessage(err, message))}${persistedActivity
        ? `<p>${resultLink(persistedActivity.id)}</p><button type="button" class="button button--secondary" data-check-authorization>${escapeHTML(translate('authorization_check_status'))}</button>` : ''}`);
      feedback.querySelector('[data-check-authorization]')?.addEventListener('click', async () => {
        try {presentResult(await getActivityAuthorizations(persistedActivity.id), persistedActivity.id);}
        catch (error) {app.showMessage(apiErrorMessage(error, 'authorization_result_failed'), 'error');}
      });
      feedback.querySelector('a')?.addEventListener('click', (event) => {
        event.preventDefault(); saving = false; close(true); app.router.navigate(`/permission-slips/${persistedActivity.id}`);
      });
      feedback.focus(); feedback.scrollIntoView?.({ block: 'center' });
    } finally {
      saving = false;
      form.removeAttribute('aria-busy');
      controls.forEach((control, index) => {control.disabled = previouslyDisabled[index];});
      setButtonLoading(submitButton, false);
    }
  });

  return { close };
}
