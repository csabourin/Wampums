/**
 * "My allergies", a section of the account page (#1319): an adult may declare their own
 * allergies, whether they carry an auto-injector, and whom to notify. Voluntary, and written only
 * by them. A camp's lists show it to the leaders allowed to read allergies, for the camps whose
 * team the adult is on. The adult may withdraw it at any time.
 *
 * The panel keeps its state across the account page's redraws: mount() it in the page's
 * container after every render.
 *
 * @module spa/modules/member-allergies/AllergyPanel
 */
import { translate } from '../../app.js';
import { setContent, withFormBusy } from '../../utils/DOMUtils.js';
import { escapeAttribute, escapeHTML } from '../../utils/SecurityUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';
import { formatDate } from '../../utils/DateUtils.js';
import { isDemoUser } from '../../utils/PermissionUtils.js';
import { confirmDestructive } from '../../utils/DialogUtils.js';
import { getMyAllergies, saveMyAllergies, removeMyAllergies } from '../../api/api-member-allergies.js';
import rules from '../../../config/member_allergies.json';

/** The anchor of the section (`/account-info#my-allergies`). */
export const ALLERGY_ANCHOR = 'my-allergies';
const FORM_ID = 'allergy-declaration-form';
/** Server field names, and the controls that show their errors. */
const FIELDS = {
  allergies: 'allergy-declaration-allergies',
  person_to_notify: 'allergy-declaration-person',
};

const STATE = Object.freeze({ IDLE: 'idle', LOADING: 'loading', READY: 'ready', ERROR: 'error' });

export class AllergyPanel {
  /** @param {Object} app - Application instance */
  constructor(app) {
    this.app = app;
    this.state = STATE.IDLE;
    this.declaration = null;
    this.loadError = null;
    this.container = null;
    this.destroyed = false;
  }

  /** Called when the account page is left. */
  destroy() {
    this.destroyed = true;
  }

  /**
   * Draw the section into its container, loading the declaration the first time.
   * @param {HTMLElement|null} container - The page's section element
   * @returns {Promise<void>}
   */
  async mount(container) {
    this.container = container;
    if (!container) {
      return;
    }
    if (this.state === STATE.IDLE) {
      await this.load();
      return;
    }
    this.render();
  }

  async load() {
    this.state = STATE.LOADING;
    this.render();
    try {
      const response = await getMyAllergies();
      this.declaration = response?.data && typeof response.data === 'object' ? response.data : null;
      this.state = STATE.READY;
    } catch (error) {
      debugError('Failed to load the allergy declaration:', error);
      this.loadError = error;
      this.state = STATE.ERROR;
    }
    this.render();
  }

  render() {
    if (this.destroyed || !this.container || !this.container.isConnected) {
      return;
    }
    setContent(this.container, `
      <h2 id="allergy-declaration-heading">${escapeHTML(translate('allergy_declaration_title'))}</h2>
      <p class="section-description">${escapeHTML(translate('allergy_declaration_intro'))}</p>
      ${this.renderBody()}
    `);
    this.attach();
  }

  /** @returns {string} Markup for the current state */
  renderBody() {
    if (this.state === STATE.LOADING || this.state === STATE.IDLE) {
      return `<p role="status">${escapeHTML(translate('loading'))}</p>`;
    }
    if (this.state === STATE.ERROR) {
      return `
        <p class="status-message error" role="alert">${escapeHTML(apiErrorMessage(this.loadError, 'allergy_declaration_load_failed'))}</p>
        <button type="button" class="button button--secondary" id="allergy-declaration-retry">${escapeHTML(translate('retry'))}</button>
      `;
    }
    const demo = isDemoUser();
    const declared = this.declaration;
    const disabled = demo ? ' disabled' : '';
    const status = declared
      ? translate('allergy_declaration_status_declared')
        .replace('{date}', formatDate(String(declared.declared_at || '').slice(0, 'YYYY-MM-DD'.length), this.app?.lang || 'fr'))
      : translate('allergy_declaration_status_none');
    const actions = demo
      ? `<p class="form-help">${escapeHTML(translate('allergy_declaration_demo'))}</p>`
      : `<div class="allergy-declaration__actions">
          <button type="submit" class="button button--primary">${escapeHTML(translate('allergy_declaration_save'))}</button>
          ${declared ? `<button type="button" class="button button--danger" id="allergy-declaration-remove">${escapeHTML(translate('allergy_declaration_remove'))}</button>` : ''}
        </div>`;
    return `
      <p id="allergy-declaration-status">${escapeHTML(status)}</p>
      <form id="${FORM_ID}" novalidate>
        <div class="form-group">
          <label for="${FIELDS.allergies}">${escapeHTML(translate('allergy_declaration_allergies'))}</label>
          <textarea id="${FIELDS.allergies}" name="allergies" rows="3" maxlength="${rules.allergies_max_length}" required
            aria-describedby="${FIELDS.allergies}-help ${FIELDS.allergies}-error"${disabled}>${escapeHTML(declared?.allergies || '')}</textarea>
          <p class="form-help" id="${FIELDS.allergies}-help">${escapeHTML(translate('allergy_declaration_allergies_help'))}</p>
          <p class="field-error" id="${FIELDS.allergies}-error" role="alert"></p>
        </div>
        <div class="checkbox-option">
          <input type="checkbox" id="allergy-declaration-epipen" name="carries_epipen" ${declared?.carries_epipen ? 'checked' : ''}${disabled}>
          <label for="allergy-declaration-epipen">${escapeHTML(translate('allergy_declaration_epipen'))}</label>
        </div>
        <div class="form-group">
          <label for="${FIELDS.person_to_notify}">${escapeHTML(translate('allergy_declaration_person'))}</label>
          <input type="text" id="${FIELDS.person_to_notify}" name="person_to_notify" maxlength="${rules.person_to_notify_max_length}"
            value="${escapeAttribute(declared?.person_to_notify || '')}" autocomplete="off"
            aria-describedby="${FIELDS.person_to_notify}-help ${FIELDS.person_to_notify}-error"${disabled}>
          <p class="form-help" id="${FIELDS.person_to_notify}-help">${escapeHTML(translate('allergy_declaration_person_help'))}</p>
          <p class="field-error" id="${FIELDS.person_to_notify}-error" role="alert"></p>
        </div>
        <p class="status-message error" id="allergy-declaration-error" role="alert" tabindex="-1" hidden></p>
        ${actions}
      </form>
    `;
  }

  attach() {
    this.container.querySelector('#allergy-declaration-retry')?.addEventListener('click', () => this.load());
    this.container.querySelector('#allergy-declaration-remove')?.addEventListener('click', () => this.remove());
    const form = this.container.querySelector(`#${FORM_ID}`);
    if (!form) {
      return;
    }
    form.addEventListener('input', (event) => this.clearError(event.target));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (isDemoUser()) {
        return;
      }
      withFormBusy(form, () => this.save(form));
    });
  }

  /** Clear the message tied to a field once the person changes it. */
  clearError(field) {
    if (field?.id) {
      field.removeAttribute('aria-invalid');
      const message = this.container?.querySelector(`#${field.id}-error`);
      if (message) {
        message.textContent = '';
      }
    }
    const summary = this.container?.querySelector('#allergy-declaration-error');
    if (summary) {
      summary.hidden = true;
    }
  }

  /** Show a message next to its field and move focus there. @returns {boolean} Whether the field was found */
  showFieldError(fieldId, message) {
    const field = this.container.querySelector(`#${fieldId}`);
    const target = this.container.querySelector(`#${fieldId}-error`);
    if (!field || !target) {
      return false;
    }
    field.setAttribute('aria-invalid', 'true');
    target.textContent = message;
    field.focus();
    return true;
  }

  /** Show a message for the whole section, never as saved. */
  showSummary(message) {
    const summary = this.container.querySelector('#allergy-declaration-error');
    summary.textContent = message;
    summary.hidden = false;
    summary.focus();
  }

  async save(form) {
    const allergies = form.elements.allergies.value.trim();
    if (!allergies) {
      this.showFieldError(FIELDS.allergies, translate('allergy_declaration_allergies_invalid'));
      return;
    }
    const payload = {
      allergies,
      carries_epipen: form.elements.carries_epipen.checked,
      person_to_notify: form.elements.person_to_notify.value.trim() || null,
    };
    try {
      const response = await saveMyAllergies(payload);
      if (this.destroyed) {
        return;
      }
      this.declaration = response?.data || { ...payload, declared_at: new Date().toISOString() };
      this.app.showMessage(translate('allergy_declaration_saved'), 'success');
      this.render();
    } catch (error) {
      if (this.destroyed) {
        return;
      }
      debugError('Failed to save the allergy declaration:', error);
      const message = apiErrorMessage(error, 'allergy_declaration_save_failed');
      const fieldError = Array.isArray(error?.errors) ? error.errors.find((entry) => FIELDS[entry?.path]) : null;
      if (!fieldError || !this.showFieldError(FIELDS[fieldError.path], message)) {
        this.showSummary(message);
      }
    }
  }

  /** Withdraw the declaration, once confirmed. Declining changes nothing. */
  async remove() {
    const confirmed = await confirmDestructive({
      title: translate('allergy_declaration_remove_title'),
      message: translate('allergy_declaration_remove_confirm'),
      confirmLabel: translate('allergy_declaration_remove'),
    });
    if (!confirmed || this.destroyed) {
      return;
    }
    try {
      await removeMyAllergies();
      if (this.destroyed) {
        return;
      }
      this.declaration = null;
      this.app.showMessage(translate('allergy_declaration_removed'), 'success');
      this.render();
      this.container.querySelector('#allergy-declaration-status')?.setAttribute('tabindex', '-1');
      this.container.querySelector('#allergy-declaration-status')?.focus();
    } catch (error) {
      if (this.destroyed) {
        return;
      }
      debugError('Failed to remove the allergy declaration:', error);
      this.showSummary(apiErrorMessage(error, 'allergy_declaration_remove_failed'));
    }
  }
}
