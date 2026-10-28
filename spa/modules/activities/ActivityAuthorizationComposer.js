const AUTHORIZATION_TEXT_MAX_LENGTH = 10000;
const PREVIEW_DELAY_MS = 250;
const ISO_DATE_LENGTH = 10;
import { translate } from '../../app.js';
import { CONFIG } from '../../config.js';
import { previewActivityAuthorizations } from '../../api/api-activity-authorizations.js';
import { hasPermission } from '../../utils/PermissionUtils.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { setContent } from '../../utils/DOMUtils.js';
import { openModal } from '../../utils/ModalUtils.js';
import { richTextOrPlain } from '../../utils/RichTextUtils.js';
import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';

/** Shared activity/permission form: one audience and an explicit sending action. */
export function authorizationFieldsHTML(activity, defaultAuthorization) {
  const enabled = activity?.authorization_required ?? (Boolean(activity?.authorization_text) || defaultAuthorization);
  return `<fieldset class="form-fieldset">
    <legend>${escapeHTML(translate('activity_permission_slip_section'))}</legend>
    <div class="checkbox-option">
      <input type="checkbox" id="activity-authorization-required" name="authorization_required" ${enabled ? 'checked' : ''} aria-controls="activity-authorization-fields">
      <label for="activity-authorization-required">${escapeHTML(translate('authorization_required_label'))}</label>
    </div>
    <div id="activity-authorization-fields" ${enabled ? '' : 'hidden'}>
      <div class="form-group">
        <label for="activity-authorization-text">${escapeHTML(translate('activity_authorization_text_label'))}</label>
        <textarea id="activity-authorization-text" name="authorization_text" class="form-control" rows="4" maxlength="${AUTHORIZATION_TEXT_MAX_LENGTH}">${escapeHTML(activity?.authorization_text || '')}</textarea>
      </div>
      <div class="form-group">
        <label for="activity-authorization-deadline">${escapeHTML(translate('authorization_optional_deadline'))}</label>
        <input type="date" id="activity-authorization-deadline" name="authorization_deadline_date" value="${escapeHTML(String(activity?.authorization_deadline_date || '').slice(0, ISO_DATE_LENGTH))}">
      </div>
      <div id="activity-authorization-audience" role="status"></div>
      <button type="button" class="button button--secondary" id="activity-authorization-preview">${escapeHTML(translate('authorization_preview'))}</button>
    </div>
  </fieldset>`;
}

/** Bind audience previews and keep stale responses from changing the form. */
export function attachAuthorizationComposer(overlay, readInvitation, isEdit = false) {
  let timer;
  let sequence = 0;
  let destroyed = false;
  const enabled = overlay.querySelector('#activity-authorization-required');
  const audience = overlay.querySelector('#activity-authorization-audience');
  const send = overlay.querySelector('[data-activity-send]');
  const saved = overlay.querySelector('[data-activity-save]');
  const canSend = hasPermission('activities.edit') && hasPermission('communications.send');

  const update = () => {
    overlay.querySelector('#activity-authorization-fields').hidden = !enabled.checked;
    send.hidden = !enabled.checked || !canSend;
    const notification = overlay.querySelector('[data-activity-notify]');
    if (notification) {notification.hidden = enabled.checked;}
    saved.textContent = translate(enabled.checked ? 'authorization_save_without_sending' : isEdit ? 'save_changes' : 'create_activity');
  };
  const preview = async () => {
    const version = ++sequence;
    update();
    if (!enabled.checked) {return;}
    setContent(audience, escapeHTML(translate('loading')));
    try {
      const result = await previewActivityAuthorizations(readInvitation());
      if (destroyed || version !== sequence || !overlay.isConnected) {return;}
      if (!result || !Number.isInteger(result.participants)) {throw new Error('authorization_preview_failed');}
      send.disabled = result.participants === 0;
      const text = translate('authorization_audience_count').replace('{participants}', result.participants).replace('{addresses}', result.addresses);
      setContent(audience, `<p>${escapeHTML(text)}</p>
        ${result.missing.length ? `<p>${escapeHTML(translate('authorization_missing_contacts').replace('{count}', result.missing.length))}</p>
          <ul>${result.missing.map((child) => `<li>${escapeHTML(`${child.first_name} ${child.last_name}`)}</li>`).join('')}</ul>` : ''}
        ${!canSend ? `<p>${escapeHTML(translate('authorization_sender_required'))}</p>` : ''}`);
    } catch (error) {
      if (destroyed || version !== sequence) {return;}
      setContent(audience, `<p role="alert">${escapeHTML(apiErrorMessage(error, 'authorization_preview_failed'))}</p><button type="button" class="button button--secondary" data-preview-retry>${escapeHTML(translate('retry'))}</button>`);
      audience.querySelector('[data-preview-retry]').addEventListener('click', preview);
    }
  };
  const schedule = () => {
    sequence++;
    send.disabled = true;
    update();
    clearTimeout(timer);
    timer = setTimeout(preview, CONFIG.AUTHORIZATION_FLOW?.PREVIEW_DELAY_MS || PREVIEW_DELAY_MS);
  };
  overlay.querySelector('#activity-form').addEventListener('change', (event) => {
    if (['invites_everyone', 'invited_participant_ids'].includes(event.target.name)
      || event.target.id === 'activity-invitees-keep-off-roster') {schedule();}
  });
  enabled.addEventListener('change', schedule);
  overlay.querySelector('#activity-authorization-preview').addEventListener('click', () => {
    const data = readInvitation();
    openModal({ id: 'activity-authorization-preview-modal', title: escapeHTML(translate('authorization_preview')),
      body: `<h3>${escapeHTML(translate('authorization_preview_email'))}</h3>
        <p><strong>${escapeHTML(data.activity_name || data.name || '')}</strong></p>
        <p>${escapeHTML(data.activity_start_date || '')} ${escapeHTML(data.activity_start_time || '')} — ${escapeHTML(data.meeting_location_going || '')}</p>
        <div class="rich-text">${richTextOrPlain(data.description_html, data.description)}</div>
        <p>${escapeHTML(translate('authorization_preview_link'))}</p>
        <h3>${escapeHTML(translate('authorization_preview_signing'))}</h3>
        <p class="permission-slip-authorization__text">${escapeHTML(data.authorization_text || translate('activity_authorization_text_empty'))}</p>
        <p>${escapeHTML(translate('authorization_preview_no_send'))}</p>`,
    });
  });
  update();
  if (enabled.checked) {schedule();}
  return {
    enabled: () => enabled.checked,
    destroy() {destroyed = true; sequence++; clearTimeout(timer);},
  };
}
