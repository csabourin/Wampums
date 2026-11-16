/**
 * Letter to parents drawn from the camp (#1321), `/camp-letter/:meetingId`.
 *
 * Wampums writes the letter from the camp (meeting points and times from its activity, the
 * emergency number from its site and on-site lead) in French and in English. The team edits
 * both versions, saves a draft, then sends it: each family of the camp gets the version of its
 * language. What the camp still lacks is listed with where to complete it, and the letter says
 * "to be confirmed" there rather than leaving a gap. Every sent version says how many addresses it
 * reached, and one that failed can be sent again where it failed.
 *
 * Reading takes `meetings.view` (unit-wide); editing `meetings.manage`; sending
 * `communications.send` as well. A demo account reads only.
 *
 * @module spa/modules/camp-plan/CampLetter
 */
import { translate } from '../../app.js';
import { setContent, loadStylesheet, withFormBusy } from '../../utils/DOMUtils.js';
import { escapeHTML, escapeAttribute } from '../../utils/SecurityUtils.js';
import { renderBackLink } from '../../utils/BackLinkUtils.js';
import { pageLoadingMarkup, pageErrorMarkup } from '../../utils/PageStateUtils.js';
import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { formatDate, formatDateRange } from '../../utils/DateUtils.js';
import { translatePlural } from '../../utils/PluralUtils.js';
import { hasPermission, isDemoUser } from '../../utils/PermissionUtils.js';
import { confirm } from '../../utils/DialogUtils.js';
import {
  richTextEditorHTML, attachRichTextEditor, getRichTextValue, setRichTextValue, setRichTextDisabled,
} from '../rich-text/RichTextEditor.js';
import { getCampLetter, saveCampLetterDraft, sendCampLetter, retryCampLetter } from '../../api/api-camp-plans.js';
import styles from '../../../css/camp-plan.css?url';

/** Both versions of the letter, in the order they are shown. */
const LANGUAGES = Object.freeze(['fr', 'en']);
/** A missing fact, and the screen that completes it. */
const FACT_SCREENS = Object.freeze({
  activity: 'activities', going_place: 'activities', going_time: 'activities',
  return_place: 'activities', return_time: 'activities', emergency_phone: 'site',
});
/** A field the server refuses, and the control that shows it. */
const FIELD_CONTROLS = Object.freeze({
  subject_fr: 'camp-letter-subject-fr', body_fr_html: 'camp-letter-body-fr',
  subject_en: 'camp-letter-subject-en', body_en_html: 'camp-letter-body-en',
});

export class CampLetter {
  /**
   * @param {Object} app - Application instance
   * @param {{meetingId: number}} options - The planned camp
   */
  constructor(app, { meetingId }) {
    this.app = app;
    this.meetingId = Number(meetingId);
    this.data = null;
    this.destroyed = false;
    this.request = 0;
    this.canEdit = hasPermission('meetings.manage') && !isDemoUser();
    this.canSend = this.canEdit && hasPermission('communications.send');
  }

  destroy() {
    this.destroyed = true;
    this.request += 1;
  }

  /** @returns {HTMLElement|null} */
  root() {
    return document.getElementById('app');
  }

  /** @returns {string} */
  lang() {
    return this.app.lang || 'fr';
  }

  /** @returns {string} Where the back link and the loading states lead */
  backHref() {
    return `/camp-permit/${this.meetingId}`;
  }

  async init() {
    const request = ++this.request;
    loadStylesheet(styles).catch((err) => debugError('Camp plan stylesheet failed', err));
    const options = { title: translate('camp_letter_title'), backHref: this.backHref() };
    setContent(this.root(), pageLoadingMarkup(options));
    try {
      const response = await getCampLetter(this.meetingId);
      if (this.destroyed || request !== this.request) {
        return;
      }
      if (!response?.data?.camp || !response.data.draft) {
        throw new Error('Missing camp letter');
      }
      this.data = response.data;
      this.render();
    } catch (err) {
      if (this.destroyed || request !== this.request) {
        return;
      }
      debugError('Failed to load the camp letter:', err);
      setContent(this.root(), pageErrorMarkup({ ...options, message: apiErrorMessage(err, 'camp_letter_load_failed'), retryId: 'camp-letter-retry' }));
      this.root().querySelector('#camp-letter-retry')?.addEventListener('click', () => this.init());
    }
  }

  /** @returns {string} What the camp still lacks, each with the screen that completes it */
  missingMarkup() {
    const { missing } = this.data;
    if (!missing.length) {
      return '';
    }
    const links = {
      activities: hasPermission('activities.edit') ? '/activities' : null,
      site: hasPermission('meetings.manage') ? `/camp-site/${this.meetingId}` : null,
    };
    const items = missing.map((fact) => {
      const href = links[FACT_SCREENS[fact]];
      const fix = FACT_SCREENS[fact] === 'site' ? 'camp_letter_fix_site' : 'camp_letter_fix_activity';
      return `<li>${escapeHTML(translate(`camp_letter_missing_${fact}`))}
        ${href ? ` <a href="${escapeAttribute(href)}">${escapeHTML(translate(fix))}</a>` : ''}</li>`;
    }).join('');
    return `<section class="camp-letter__missing" aria-labelledby="camp-letter-missing-title">
        <h2 id="camp-letter-missing-title">${escapeHTML(translate('camp_letter_missing_title'))}</h2>
        <p>${escapeHTML(translate('camp_letter_missing_intro'))}</p>
        <ul>${items}</ul>
      </section>`;
  }

  /** @returns {string} Who the letter reaches, and the youth whose family it cannot */
  audienceMarkup() {
    const { audience } = this.data;
    const without = audience.without_address;
    const withoutCount = Array.isArray(without) ? without.length : Number(without) || 0;
    const names = Array.isArray(without) && without.length
      ? `<ul class="camp-letter__names">${without.map((child) => `<li>${escapeHTML(`${child.first_name} ${child.last_name}`)}</li>`).join('')}</ul>`
      : '';
    return `<section aria-labelledby="camp-letter-audience-title">
        <h2 id="camp-letter-audience-title">${escapeHTML(translate('camp_letter_audience_title'))}</h2>
        <p>${escapeHTML(translatePlural('camp_letter_audience', audience.families, this.lang()).replace('{count}', String(audience.families)))}</p>
        ${withoutCount ? `<p>${escapeHTML(translatePlural('camp_letter_without_address', withoutCount, this.lang()).replace('{count}', String(withoutCount)))}</p>${names}` : ''}
      </section>`;
  }

  /** @returns {string} One language's subject and letter */
  versionMarkup(language) {
    const version = this.data.draft[language] || { subject: '', body_html: '' };
    const disabled = this.canEdit ? '' : ' disabled';
    return `<fieldset class="camp-letter__version">
        <legend>${escapeHTML(translate(`camp_letter_version_${language}`))}</legend>
        <label for="camp-letter-subject-${language}">${escapeHTML(translate('camp_letter_subject_label'))}</label>
        <input type="text" id="camp-letter-subject-${language}" class="form-control" maxlength="200" required
          value="${escapeAttribute(version.subject || '')}"${disabled}>
        <p id="camp-letter-body-${language}-label" class="camp-letter__label">${escapeHTML(translate('camp_letter_body_label'))}</p>
        ${richTextEditorHTML({ id: `camp-letter-body-${language}`, labelId: `camp-letter-body-${language}-label`, html: version.body_html || '', required: true })}
      </fieldset>`;
  }

  /** @returns {string} Every version sent, with how many addresses it reached */
  sentMarkup() {
    const { sent } = this.data;
    if (!sent.length) {
      return `<p class="camp-plan__empty">${escapeHTML(translate('camp_letter_sent_none'))}</p>`;
    }
    return `<ul class="camp-letter__sent">${sent.map((version) => {
      const title = translate('camp_letter_sent_version')
        .replace('{version}', String(version.version_number))
        .replace('{date}', formatDate(version.sent_at, this.lang()))
        .replace('{name}', version.sent_by_name || translate('tasks_member'));
      const counts = translate('camp_letter_sent_counts')
        .replace('{sent}', String(version.sent)).replace('{failed}', String(version.failed))
        .replace('{unknown}', String(version.unknown)).replace('{unreached}', String(version.unreached || 0));
      // A refused address, a family added since, or a send interrupted: never one already reached or uncertain.
      const retry = this.canSend && (version.failed > 0 || version.unreached > 0)
        ? `<button type="button" class="button button--secondary button--small" data-retry="${Number(version.version_number)}">
            ${escapeHTML(translate('camp_letter_retry'))}<span class="visually-hidden"> — ${escapeHTML(translate('camp_letter_retry_version').replace('{version}', String(version.version_number)))}</span>
          </button>`
        : '';
      return `<li><p><strong>${escapeHTML(title)}</strong></p><p>${escapeHTML(counts)}</p>${retry}</li>`;
    }).join('')}</ul>`;
  }

  /** @returns {string} Whether the shown letter is the proposed one or a saved draft */
  draftStateText() {
    const { draft } = this.data;
    return draft.saved
      ? translate('camp_letter_draft_saved').replace('{date}', formatDate(draft.updated_at, this.lang()))
      : translate('camp_letter_draft_proposed');
  }

  render() {
    if (this.destroyed) {
      return;
    }
    const { camp } = this.data;
    const actions = this.canEdit ? `<div class="camp-letter__actions">
        ${this.canSend ? `<button type="submit" class="button button--primary" form="camp-letter-form">${escapeHTML(translate('camp_letter_send'))}</button>` : ''}
        <button type="button" class="button button--secondary" id="camp-letter-save">${escapeHTML(translate('camp_letter_save'))}</button>
        <button type="button" class="button button--ghost" id="camp-letter-reset">${escapeHTML(translate('camp_letter_reset'))}</button>
      </div>` : '';
    setContent(this.root(), `<section class="page camp-plan camp-letter">
        ${renderBackLink(this.backHref())}
        <h1>${escapeHTML(translate('camp_letter_title'))}</h1>
        <p class="camp-plan__subtitle">${escapeHTML(camp.name)} · ${escapeHTML(formatDateRange(camp.date_from, camp.date_to, this.lang()))}</p>
        <p>${escapeHTML(translate('camp_letter_intro_screen'))}</p>
        ${this.missingMarkup()}
        ${this.audienceMarkup()}
        <form id="camp-letter-form" class="camp-letter__form" novalidate>
          <p id="camp-letter-state" class="form-help">${escapeHTML(this.draftStateText())}</p>
          ${LANGUAGES.map((language) => this.versionMarkup(language)).join('')}
          <p id="camp-letter-error" class="status-message error" role="alert" tabindex="-1" hidden></p>
          ${actions}
        </form>
        <section aria-labelledby="camp-letter-sent-title">
          <h2 id="camp-letter-sent-title">${escapeHTML(translate('camp_letter_sent_title'))}</h2>
          <div id="camp-letter-sent">${this.sentMarkup()}</div>
        </section>
      </section>`);
    this.bind();
  }

  bind() {
    const root = this.root();
    root.querySelectorAll('[data-rte]').forEach((editor) => {
      attachRichTextEditor(editor);
      if (!this.canEdit) {
        setRichTextDisabled(editor, true);
      }
    });
    const form = root.querySelector('#camp-letter-form');
    form.addEventListener('input', () => this.clearErrors());
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      // Sending is offered only with communications.send: no other way (Enter in a field) reaches it.
      if (this.canSend) {
        this.send(form);
      }
    });
    root.querySelector('#camp-letter-save')?.addEventListener('click', () => this.save(form));
    root.querySelector('#camp-letter-reset')?.addEventListener('click', () => this.reset());
    root.querySelector('#camp-letter-sent').addEventListener('click', (event) => {
      const button = event.target.closest('[data-retry]');
      if (button) {
        this.retry(button, Number(button.dataset.retry));
      }
    });
  }

  /** @returns {Object} Both versions, as the server takes them */
  payload() {
    const root = this.root();
    return Object.fromEntries(LANGUAGES.flatMap((language) => [
      [`subject_${language}`, root.querySelector(`#camp-letter-subject-${language}`).value.trim()],
      [`body_${language}_html`, getRichTextValue(root.querySelector(`#camp-letter-body-${language}`))],
    ]));
  }

  /** @returns {string[]} The fields that cannot be sent as they are */
  checkPayload(payload) {
    return Object.keys(FIELD_CONTROLS).filter((field) => !payload[field]);
  }

  clearErrors() {
    const root = this.root();
    Object.values(FIELD_CONTROLS).forEach((id) => {
      const control = root.querySelector(`#${id}`);
      control?.removeAttribute('aria-invalid');
      control?.removeAttribute('aria-describedby');
    });
    const problem = root.querySelector('#camp-letter-error');
    if (problem) {
      problem.hidden = true;
    }
  }

  /** Say what is wrong, point the fields at the message, and move focus to it. */
  showErrors(message, fields = []) {
    const root = this.root();
    const problem = root.querySelector('#camp-letter-error');
    problem.textContent = message;
    problem.hidden = false;
    fields.forEach((field) => {
      const control = root.querySelector(`#${FIELD_CONTROLS[field]}`);
      if (control) {
        control.setAttribute('aria-invalid', 'true');
        control.setAttribute('aria-describedby', 'camp-letter-error');
      }
    });
    problem.focus();
  }

  /** Keep the letter as the camp's draft. */
  async save(form) {
    const payload = this.payload();
    const wrong = this.checkPayload(payload);
    if (wrong.length) {
      this.showErrors(translate('camp_letter_body_invalid'), wrong);
      return;
    }
    await withFormBusy(form, async () => {
      try {
        const response = await saveCampLetterDraft(this.meetingId, payload);
        if (this.destroyed) {
          return;
        }
        this.data = response.data;
        this.render();
        this.app.showMessage(translate('camp_letter_saved'), 'success');
      } catch (err) {
        if (this.destroyed) {
          return;
        }
        debugError('Failed to save the camp letter:', err);
        this.showErrors(apiErrorMessage(err, 'camp_letter_save_failed'), (err.errors || []).map((field) => field.path));
      }
    });
  }

  /** Send to the camp's families, once the number of addresses is confirmed. */
  async send(form) {
    const payload = this.payload();
    const wrong = this.checkPayload(payload);
    if (wrong.length) {
      this.showErrors(translate('camp_letter_body_invalid'), wrong);
      return;
    }
    const count = this.data.audience.families;
    const confirmed = await confirm({
      title: translate('camp_letter_send_confirm_title'),
      message: translatePlural('camp_letter_send_confirm', count, this.lang()).replace('{count}', String(count)),
      confirmLabel: translate('camp_letter_send'),
    });
    if (!confirmed || this.destroyed) {
      return;
    }
    await withFormBusy(form, async () => {
      try {
        const response = await sendCampLetter(this.meetingId, payload);
        if (this.destroyed) {
          return;
        }
        this.data = response.data;
        this.render();
        const latest = this.data.sent[0];
        const reached = latest && !latest.failed && !latest.unknown;
        this.app.showMessage(translate(reached ? 'camp_letter_sent' : 'camp_letter_sent_with_problems'), reached ? 'success' : 'info');
      } catch (err) {
        if (this.destroyed) {
          return;
        }
        debugError('Failed to send the camp letter:', err);
        this.showErrors(apiErrorMessage(err, 'camp_letter_send_failed'), (err.errors || []).map((field) => field.path));
      }
    });
  }

  /**
   * Send one version to the addresses it has not reached. Only the list of versions is redrawn: the
   * letter being edited above is the team's work in progress, and stays as it is.
   */
  async retry(button, versionNumber) {
    button.disabled = true;
    try {
      const response = await retryCampLetter(this.meetingId, versionNumber);
      if (this.destroyed) {
        return;
      }
      this.data = { ...this.data, sent: response.data.sent, audience: response.data.audience };
      const list = this.root().querySelector('#camp-letter-sent');
      setContent(list, this.sentMarkup());
      // Focus was on the button just replaced: keep it in the list it belonged to.
      list.querySelector('[data-retry]')?.focus();
      this.app.showMessage(translate('camp_letter_retried'), 'success');
    } catch (err) {
      if (this.destroyed) {
        return;
      }
      debugError('Failed to send the camp letter again:', err);
      button.disabled = false;
      this.app.showMessage(apiErrorMessage(err, 'camp_letter_send_failed'), 'error');
    }
  }

  /** Replace both versions with the letter Wampums proposes from the camp as it is now. */
  async reset() {
    const confirmed = await confirm({
      title: translate('camp_letter_reset_confirm_title'),
      message: translate('camp_letter_reset_confirm'),
      confirmLabel: translate('camp_letter_reset'),
    });
    if (!confirmed || this.destroyed) {
      return;
    }
    const root = this.root();
    LANGUAGES.forEach((language) => {
      const proposed = this.data.proposed[language];
      root.querySelector(`#camp-letter-subject-${language}`).value = proposed.subject;
      setRichTextValue(root.querySelector(`#camp-letter-body-${language}`), proposed.body_html);
    });
    this.clearErrors();
    root.querySelector('#camp-letter-subject-fr').focus();
  }
}
