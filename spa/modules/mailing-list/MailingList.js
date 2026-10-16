import { getMailingList, getAnnouncements, createAnnouncement, getGroups } from '../../ajax-functions.js';
import { sendAnnouncementTest } from '../../api/api-endpoints.js';
import { aiGenerateText } from '../AI.js';
import { debugError } from '../../utils/DebugUtils.js';
import { translate } from '../../app.js';
import { escapeHTML, sanitizeHTML } from '../../utils/SecurityUtils.js';
import { CONFIG } from '../../config.js';
import { canSendCommunications } from '../../utils/PermissionUtils.js';
import { roleLabel } from '../../utils/RoleLabelUtils.js';
import { setContent } from '../../utils/DOMUtils.js';
import { setButtonLoading } from '../../utils/SkeletonUtils.js';

import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';
import {
  attachRichTextEditor,
  getRichTextValue,
  richTextEditorHTML,
  setRichTextDisabled,
  setRichTextValue,
} from '../rich-text/RichTextEditor.js';
import { plainTextToRichText, richTextToPlainText } from '../../utils/RichTextUtils.js';
import { getUnitVocabulary } from '../../utils/UnitVocabularyUtils.js';

/**
 * The text the writing assistant answered with. The API wraps the model's
 * answer: `{ success, data: { data: { text }, usage, budget } }`.
 *
 * @param {Object} response - aiGenerateText response
 * @returns {string} The text, or '' when the answer holds none
 */
function aiTextResult(response) {
  const text = response?.data?.data?.text;
  return typeof text === 'string' ? text.trim() : '';
}

export class MailingList {
  constructor(app) {
    this.app = app;
    this.mailingList = {};
    this.groups = [];
    this.templates = [];
    this.unitRoles = [];
    this.isSubmitting = false;
  }

  async init() {
    if (!canSendCommunications()) {
      this.app.router.navigate('/');
      return;
    }

    try {
      await this.fetchData();
      this.render();
      this.attachEventListeners();
    } catch (error) {
      debugError('Error initializing mailing list:', error);
      this.renderError();
    }
  }

  async fetchData() {
    const [mailingResponse, groupsResponse, announcementResponse] = await Promise.all([
      getMailingList(),
      getGroups(),
      getAnnouncements(),
    ]);

    if (!mailingResponse?.success || !mailingResponse.emails_by_role) {
      throw new Error(mailingResponse?.message || 'Invalid mailing list response');
    }

    this.mailingList = mailingResponse;
    this.groups = groupsResponse?.data || groupsResponse?.groups || [];
    this.templates = announcementResponse?.templates || [];
    this.unitRoles = announcementResponse?.roles || [];
  }

  render() {
    const content = `
                        <a href="/dashboard" class="button button--ghost">← ${translate('back')}</a>
                        <h1>${translate('mailing_list')}</h1>
                        <div class="announcement-composer card">
                                ${this.renderAnnouncementComposer()}
                        </div>
    <p><a href="/communication-history" class="button button--secondary">${translate('communication_history_title')}</a></p>
                        <div id="mailing-list">
                                ${this.renderMailingList()}
                        </div>
                `;
    setContent(document.getElementById('app'), content);
  }

  renderAnnouncementComposer() {
    // The parent role also reaches guardians, as in the list below.
    const roles = this.unitRoles.map(({ role_name: key }) => ({
      key,
      label: key === 'parent' ? translate('parents') : this.roleLabel(key),
    }));

    const templateOptions = this.templates?.length
      ? `
                                <label class="input-group">
                                        <span>${translate('use_template')}</span>
                                        <select id="announcement-template">
                                                <option value="">${translate('choose_template')}</option>
                                                ${this.templates
    .map(
      (template, index) => `
                                                                        <option value="${index}">${escapeHTML(
  template.title || template.key || translate('template')
)}</option>
                                                                `
    )
    .join('')}
                                        </select>
                                </label>
                        `
      : '';
    const messageEditor = richTextEditorHTML({
      id: 'announcement-message',
      labelId: 'announcement-message-label',
      describedBy: 'announcement-message-error',
      required: true,
    });

    return `
                        <h2>${translate('compose_announcement')}</h2>
                        <p class="text-muted">${translate('announcement_roles_help')}</p>
                        <div id="announcement-feedback" class="status-message" role="status" aria-live="polite"></div>
                        <form id="announcement-form">
                                ${templateOptions}
                                <label class="input-group">
                                        <span>${translate('announcement_subject')}</span>
                                        <input type="text" id="announcement-subject" name="announcement-subject" maxlength="255" required />
                                </label>
                                <div class="input-group">
                                        <span id="announcement-message-label">${translate('announcement_message')}</span>
                                        ${messageEditor}
                                        <p id="announcement-message-error" class="field-error" hidden></p>
                                        <div class="ai-toolbar" style="margin-top: 5px; display: flex; gap: 10px;">
                                                <button type="button" class="button button--small button--secondary" id="ai-rewrite-btn">✨ ${translate('rewrite_professional')}</button>
                                                <button type="button" class="button button--small button--secondary" id="ai-translate-btn">🌐 ${translate('translate_en_fr')}</button>
                                        </div>
                                </div>
                                <div class="input-group">
                                        <span>${translate('alumni_audience')}</span>
                                        <label>
                                                <input type="radio" name="announcement-audience" value="members" checked />
                                                ${translate('alumni_audience_members')}
                                        </label>
                                        <label>
                                                <input type="radio" name="announcement-audience" value="alumni" />
                                                ${translate('alumni_audience_alumni')}
                                        </label>
                                        <p class="text-muted">${translate('alumni_audience_help')}</p>
                                </div>
                                <div class="input-group roles" id="announcement-member-filters">
                                        <span>${translate('recipient_roles')}</span>
                                        <div class="role-options">
                                                ${roles
    .map(
      (role) => `
                                                                        <label>
                                                                                <input type="checkbox" name="recipient-role" value="${escapeHTML(role.key)}" ${role.key === 'parent' ? 'checked' : ''} />
                                                                                ${escapeHTML(role.label)}
                                                                        </label>
                                                                `
    )
    .join('')}
                                        </div>
                                </div>
                                <div id="announcement-group-filters">${this.renderGroupFilters()}</div>
                                <label class="input-group">
                                        <span>${translate('schedule_send_time')}</span>
                                        <input type="datetime-local" id="announcement-scheduled-at" name="announcement-scheduled-at" />
                                </label>
                                <div class="form-actions">
                                        <button type="submit" id="send-announcement" class="primary" ${this.isSubmitting ? 'disabled' : ''}>${translate(
  'send_now'
)}</button>
                                        <button type="button" id="save-announcement-draft" ${this.isSubmitting ? 'disabled' : ''}>${translate(
  'save_draft'
)}</button>
                                        <button type="button" id="send-announcement-test" class="button--ghost" ${this.isSubmitting ? 'disabled' : ''}>${translate(
  'send_test_to_me'
)}</button>
                                </div>
                        </form>
                `;
  }

  renderGroupFilters() {
    if (!Array.isArray(this.groups) || !this.groups.length) {
      return '';
    }

    return `
                        <fieldset class="input-group" aria-describedby="announcement-groups-help">
                                <legend>${translate('select_groups')}</legend>
                                <p class="text-muted" id="announcement-groups-help">${translate('announcement_groups_help')}</p>
                                <div class="group-options">
                                        ${this.groups
    .map(
      (group) => `
                                                                <label>
                                                                        <input type="checkbox" name="recipient-group" value="${Number(group.id)}" />
                                                                        ${escapeHTML(group.name)}
                                                                </label>
                                                        `
    )
    .join('')}
                                </div>
                        </fieldset>
                `;
  }

  renderMailingList() {
    let html = '';
    const emailsByRole = this.mailingList?.emails_by_role || {};
    const parentEmails = Array.isArray(emailsByRole.parent) ? emailsByRole.parent : [];

    if (!Object.keys(emailsByRole).length) {
      return `<p>${translate('no_data_available')}</p>`;
    }

    // Group parent emails by their children to avoid duplicate rows when siblings share guardians
    const families = parentEmails.reduce((acc, parent) => {
      const key = parent.participants || translate('unknown_child');
      if (!acc[key]) {
        acc[key] = new Set();
      }
      if (parent.email) {
        acc[key].add(parent.email);
      }
      return acc;
    }, {});

    const sortedFamilies = Object.keys(families).sort((a, b) => {
      const lastNameA = a.split(' ').slice(-1)[0].toLowerCase();
      const lastNameB = b.split(' ').slice(-1)[0].toLowerCase();
      return lastNameA.localeCompare(lastNameB);
    });

    html += `<div class="group">
                                                        <div class="group-header">${translate('parents')}</div>
                                                        <div class="group-content compact">`;

    sortedFamilies.forEach((family) => {
      const emailList = Array.from(families[family]);
      const familyLabel = family.includes(', ')
        ? family.replace(', ', ` ${translate('and')} `)
        : family;

      html += `
                                <div class="child-group">
                                        <strong>${escapeHTML(familyLabel)}:</strong>
                                        ${emailList.map((email) => `<span class="email-item">${escapeHTML(email)}</span>`).join(', ')}
                                </div>
                        `;
    });

    html += `</div>
                                                 <button class="copy-role-emails" data-role="parent">${translate('copy_emails_for')} ${translate('parents')}</button>
                                                 </div>`;

    // Render other groups (e.g., leaders, administrators, finance)
    Object.entries(emailsByRole).forEach(([role, emails]) => {
      if (role !== 'parent') {
        const roleLabel = escapeHTML(this.roleLabel(role));
        html += `
                                        <div class="group">
                                                <div class="group-header">${roleLabel}</div>
                                                <div class="group-content compact">
                                                        ${this.renderEmails(emails)}
                                                </div>
                                                <button class="copy-role-emails" data-role="${escapeHTML(role)}">${translate(
  'copy_emails_for'
)} ${roleLabel}</button>
                                        </div>
                                `;
      }
    });

    return html;
  }

  /**
         * Section heading for a role.
         *
         * translate() echoes an unknown key back verbatim, so a role with no
         * entry in lang/*.json — any role an organization adds itself — showed as
         * its raw role_name. The roles table's own display_name is the fallback.
         *
         * @param {string} role - The raw role_name
         * @returns {string} A label fit for a section heading
         */
  roleLabel(role) {
    const translated = [roleLabel(role), translate(role)].find((label) => label && label !== role);
    if (translated) {
      return translated;
    }
    const unitRole = this.unitRoles.find((entry) => entry.role_name === role);
    const displayNames = this.mailingList?.role_display_names || {};
    return unitRole?.display_name || displayNames[role] || role.replace(/_/g, ' ');
  }

  renderEmails(data) {
    if (!Array.isArray(data)) {
      data = [data];
    }

    return data
      .map((item, index) => {
        let emailHtml = '';
        let participantsHtml = '';

        if (typeof item === 'object' && item !== null) {
          emailHtml = `<span>${escapeHTML(item.email || '---')}</span>`;
          if (item.participants) {
            participantsHtml = `<span class="participants">  (${escapeHTML(item.participants)})</span>`;
          }
        } else if (typeof item === 'string') {
          emailHtml = `<span>${escapeHTML(item.trim())}</span>`;
        } else {
          debugError(`Unexpected data type for item ${index}:`, typeof item);
          emailHtml = `<span>${translate('no_data_available')}</span>`;
        }

        return `
                                                <div class="email">
                                                                ${emailHtml}
                                                                ${participantsHtml}
                                                </div>
                                `;
      })
      .join('');
  }

  attachEventListeners() {
    document.querySelectorAll('.copy-role-emails').forEach((button) => {
      button.addEventListener('click', (e) => this.copyRoleEmailsToClipboard(e.target.dataset.role));
    });

    const announcementForm = document.getElementById('announcement-form');
    const messageEditor = announcementForm?.querySelector('[data-rte]');
    if (messageEditor) {
      attachRichTextEditor(messageEditor);
      messageEditor.querySelector('.rte__area').addEventListener('input', () => this.setMessageError(''));
    }
    if (announcementForm) {
      announcementForm.addEventListener('submit', (event) => {
        event.preventDefault();
        this.handleAnnouncementSubmit(false);
      });
    }

    // Role and den filters describe the unit's own roster, so they are
    // meaningless — and misleading — once the alumni audience is picked.
    document.querySelectorAll('input[name="announcement-audience"]').forEach((input) => {
      input.addEventListener('change', () => this.toggleMemberFilters());
    });
    this.toggleMemberFilters();

    const testButton = document.getElementById('send-announcement-test');
    if (testButton) {
      testButton.addEventListener('click', (event) => {
        event.preventDefault();
        this.handleSendTest(testButton);
      });
    }

    const draftButton = document.getElementById('save-announcement-draft');
    if (draftButton) {
      draftButton.addEventListener('click', (event) => {
        event.preventDefault();
        this.handleAnnouncementSubmit(true);
      });
    }

    const templateSelect = document.getElementById('announcement-template');
    if (templateSelect) {
      templateSelect.addEventListener('change', (event) => this.applyTemplate(event.target.value));
    }

    // AI Buttons
    const rewriteBtn = document.getElementById('ai-rewrite-btn');
    if (rewriteBtn) {
      rewriteBtn.addEventListener('click', async () => {
        const msgArea = document.getElementById('announcement-message');
        const text = richTextToPlainText(getRichTextValue(msgArea));
        if (!text) {return;}

        setButtonLoading(rewriteBtn, true);
        try {
          const res = await aiGenerateText('rewrite', { text, tone: 'professional' });
          const result = aiTextResult(res);
          if (!result) {
            this.showFeedback(translate('ai_text_empty_result'), 'error');
            return;
          }
          setRichTextValue(msgArea, plainTextToRichText(result));
          this.showFeedback(translate('rewrite_success'), 'success');
        } catch (err) {
          this.showFeedback(apiErrorMessage(err, 'error_occurred'), 'error');
        } finally {
          setButtonLoading(rewriteBtn, false);
        }
      });
    }

    const translateBtn = document.getElementById('ai-translate-btn');
    if (translateBtn) {
      translateBtn.addEventListener('click', async () => {
        const msgArea = document.getElementById('announcement-message');
        const text = richTextToPlainText(getRichTextValue(msgArea));
        if (!text) {return;}

        const currentLang = this.app.lang || CONFIG.DEFAULT_LANG;
        // Simple logic: if en -> fr, else -> en
        const from = currentLang === 'fr' ? 'fr' : 'en';
        const to = from === 'fr' ? 'en' : 'fr';

        setButtonLoading(translateBtn, true);
        try {
          // The unit's own words in each language, so "Louveteaux" becomes
          // the unit's English term rather than a literal translation.
          const settings = (await this.app.waitForOrganizationSettings?.()) || {};
          const res = await aiGenerateText('translate', {
            text,
            from,
            to,
            sourceVocabulary: getUnitVocabulary(settings, from),
            targetVocabulary: getUnitVocabulary(settings, to),
          });
          const result = aiTextResult(res);
          if (!result) {
            this.showFeedback(translate('ai_text_empty_result'), 'error');
            return;
          }
          setRichTextValue(msgArea, plainTextToRichText(result));
          this.showFeedback(translate('translate_success'), 'success');
        } catch (err) {
          this.showFeedback(apiErrorMessage(err, 'error_occurred'), 'error');
        } finally {
          setButtonLoading(translateBtn, false);
        }
      });
    }
  }

  /**
         * Show or hide the unit-only recipient filters to match the chosen audience.
         *
         * @returns {void}
         */
  toggleMemberFilters() {
    const isAlumni = document.querySelector('input[name="announcement-audience"]:checked')?.value === 'alumni';
    ['announcement-member-filters', 'announcement-group-filters'].forEach((id) => {
      const element = document.getElementById(id);
      if (element) {
        element.hidden = isAlumni;
      }
    });
  }

  /**
   * Read the message being written; on an empty one, show the error on the
   * editor and return null.
   *
   * @returns {{subject: string, message: string, messageHtml: string, audience: string}|null}
   */
  readMessage() {
    const subject = document.getElementById('announcement-subject')?.value?.trim() || '';
    const messageArea = document.getElementById('announcement-message');
    const messageHtml = messageArea ? getRichTextValue(messageArea) : '';
    const message = richTextToPlainText(messageHtml);
    const audience = document.querySelector('input[name="announcement-audience"]:checked')?.value || 'members';
    if (!message) {
      this.setMessageError(translate('announcement_message_required'));
      messageArea?.focus();
      return null;
    }
    return { subject, message, messageHtml, audience };
  }

  /**
   * Email the signed-in member the message as families would receive it.
   * Nothing is saved and nobody else receives it.
   *
   * @param {HTMLButtonElement} button - The test button
   * @returns {Promise<void>}
   */
  async handleSendTest(button) {
    const draft = this.readMessage();
    if (!draft) {
      return;
    }
    if (!draft.subject) {
      document.getElementById('announcement-subject')?.reportValidity?.();
      return;
    }
    setButtonLoading(button, true);
    try {
      const response = await sendAnnouncementTest({
        subject: draft.subject,
        message: sanitizeHTML(draft.message, { stripAll: true }),
        message_html: draft.messageHtml,
        audience: draft.audience,
      });
      const email = response?.data?.email || '';
      this.showFeedback(translate('test_email_sent').replace('{email}', email), 'success');
    } catch (error) {
      debugError('Error sending test announcement:', error);
      this.showFeedback(apiErrorMessage(error, 'test_email_failed'), 'error');
    } finally {
      setButtonLoading(button, false);
    }
  }

  async handleAnnouncementSubmit(saveAsDraft = false) {
    if (this.isSubmitting) {return;}

    const draft = this.readMessage();
    if (!draft) {
      return;
    }
    const { subject, message, messageHtml, audience } = draft;
    const scheduledAt = document.getElementById('announcement-scheduled-at')?.value;
    const roleCheckboxes = Array.from(document.querySelectorAll('input[name="recipient-role"]:checked'));
    const groupCheckboxes = Array.from(document.querySelectorAll('input[name="recipient-group"]:checked'));

    // Roles and dens describe the unit. An alumni send has neither,
    // and sending them anyway would only invite the server to
    // reinterpret them.
    const isAlumni = audience === 'alumni';
    const recipientRoles = isAlumni ? [] : roleCheckboxes.map((input) => input.value);
    const recipientGroupIds = isAlumni ? [] : groupCheckboxes.map((input) => Number(input.value));

    if (!subject) {
      this.showFeedback(translate('error_loading_mailing_list'), 'error');
      return;
    }
    if (!isAlumni && !recipientRoles.length && !recipientGroupIds.length) {
      this.showFeedback(translate('announcement_recipients_required'), 'error');
      document.querySelector('input[name="recipient-role"]')?.focus();
      return;
    }

    this.isSubmitting = true;
    this.toggleFormDisabled(true);
    this.showFeedback(translate('announcement_sending'), 'info');

    try {
      const response = await createAnnouncement({
        subject,
        message: sanitizeHTML(message, { stripAll: true }),
        message_html: messageHtml,
        audience,
        recipient_roles: recipientRoles,
        recipient_group_ids: recipientGroupIds,
        scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        save_as_draft: saveAsDraft,
        send_now: !saveAsDraft && !scheduledAt,
      });

      if (!response?.success) {
        throw new Error(response?.message || 'Failed to send announcement');
      }

      this.render();
      this.attachEventListeners();
      const feedbackKeys = { draft: 'announcement_saved', scheduled: 'announcement_scheduled' };
      this.showFeedback(translate(feedbackKeys[response.data?.status] || 'announcement_sent'), 'success');
      this.clearForm();
    } catch (error) {
      debugError('Error sending announcement:', error);
      this.showFeedback(apiErrorMessage(error, 'announcement_send_failed'), 'error');
    } finally {
      this.isSubmitting = false;
      this.toggleFormDisabled(false);
    }
  }

  applyTemplate(index) {
    if (!this.templates?.length || index === '') {
      return;
    }

    const template = this.templates[Number(index)];
    if (!template) {
      return;
    }

    const subjectField = document.getElementById('announcement-subject');
    const messageField = document.getElementById('announcement-message');

    if (subjectField) {subjectField.value = template.subject || '';}
    if (messageField) {setRichTextValue(messageField, plainTextToRichText(template.body || ''));}
  }

  /**
   * Show, or clear with an empty string, the message's error, tied to the
   * editor so screen readers announce it with the field.
   *
   * @param {string} text - Error text
   * @returns {void}
   */
  setMessageError(text) {
    const errorEl = document.getElementById('announcement-message-error');
    const area = document.getElementById('announcement-message');
    if (!errorEl || !area) {return;}
    errorEl.textContent = text;
    errorEl.hidden = !text;
    if (text) {
      area.setAttribute('aria-invalid', 'true');
    } else {
      area.removeAttribute('aria-invalid');
    }
  }

  toggleFormDisabled(disabled) {
    const form = document.getElementById('announcement-form');
    if (!form) {return;}

    Array.from(form.elements).forEach((element) => {
      element.disabled = disabled;
    });
    const editor = form.querySelector('[data-rte]');
    if (editor) {
      setRichTextDisabled(editor, disabled);
    }
  }

  clearForm() {
    const form = document.getElementById('announcement-form');
    if (!form) {return;}
    form.reset();
    const area = document.getElementById('announcement-message');
    if (area) {
      setRichTextValue(area, '');
    }
  }

  showFeedback(message, type = 'info') {
    const feedbackEl = document.getElementById('announcement-feedback');
    if (!feedbackEl) {return;}
    feedbackEl.textContent = message;
    feedbackEl.className = `status-message ${type}`;
  }

  copyRoleEmailsToClipboard(role) {
    const emailsByRole = this.mailingList?.emails_by_role || {};
    const emails = emailsByRole[role] || [];

    let emailString;
    if (role === 'parent') {
      const uniqueParentEmails = [...new Set(emails.map((entry) => entry.email))];
      emailString = uniqueParentEmails.join(', ');
    } else {
      const uniqueRoleEmails = [...new Set(emails)];
      emailString = uniqueRoleEmails.join(', ');
    }

    if (!emailString) {
      this.app.showMessage(translate('no_data_available'), 'error');
      return;
    }

    navigator.clipboard
      .writeText(emailString)
      .then(() => {
        this.app.showMessage(`${translate('emails_copied_to_clipboard_for')} ${translate(role)}`, 'success');
      })
      .catch((error) => {
        debugError('Failed to copy emails:', error);
      });
  }

  renderError() {
    const errorMessage = `
                                                <a href="/dashboard" class="button button--ghost">← ${translate('back')}</a>
                                                <h1>${translate('error')}</h1>
                                                <p>${translate('error_loading_mailing_list')}</p>
                                `;
    setContent(document.getElementById('app'), errorMessage);
  }
}
