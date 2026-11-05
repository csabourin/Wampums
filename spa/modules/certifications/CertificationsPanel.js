/**
 * "My certifications", a section of the account page (#1319): an adult declares the
 * certifications they hold (first aid, wilderness first aid, winter camping), with the day
 * obtained and their expiry. A manager of volunteers verifies them on /volunteers; only a
 * verified one counts in a camp's lists, so each line says where it stands.
 *
 * The panel keeps its state across the account page's redraws: mount() it in the page's
 * container after every render.
 *
 * @module spa/modules/certifications/CertificationsPanel
 */
import { translate } from '../../app.js';
import { setContent, withFormBusy } from '../../utils/DOMUtils.js';
import { escapeAttribute, escapeHTML } from '../../utils/SecurityUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';
import { formatDate, getTodayISO } from '../../utils/DateUtils.js';
import { isDemoUser } from '../../utils/PermissionUtils.js';
import { getMyCertifications, saveMyCertifications } from '../../api/api-member-certifications.js';
import rules from '../../../config/certifications.json';

/** The anchor of the section (`/account-info#certifications`). */
export const CERTIFICATIONS_ANCHOR = 'certifications';
const FORM_ID = 'certifications-form';

const STATE = Object.freeze({ IDLE: 'idle', LOADING: 'loading', READY: 'ready', ERROR: 'error' });

export class CertificationsPanel {
  /** @param {Object} app - Application instance */
  constructor(app) {
    this.app = app;
    this.state = STATE.IDLE;
    this.records = [];
    this.loadError = null;
    this.container = null;
    this.destroyed = false;
  }

  /** Called when the account page is left. */
  destroy() {
    this.destroyed = true;
  }

  /**
   * Draw the section into its container, loading the certifications the first time.
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
      const response = await getMyCertifications();
      this.records = Array.isArray(response?.data) ? response.data : [];
      this.state = STATE.READY;
    } catch (error) {
      debugError('Failed to load certifications:', error);
      this.loadError = error;
      this.state = STATE.ERROR;
    }
    this.render();
  }

  /** @returns {string} Formatted date in the interface language */
  date(value) {
    return formatDate(value, this.app?.lang || document.documentElement.lang || 'fr');
  }

  render() {
    if (this.destroyed || !this.container || !this.container.isConnected) {
      return;
    }
    setContent(this.container, `
      <h2 id="certifications-heading">${escapeHTML(translate('certifications_title'))}</h2>
      <p class="section-description">${escapeHTML(translate('certifications_intro'))}</p>
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
        <p class="status-message error" role="alert">${escapeHTML(apiErrorMessage(this.loadError, 'certifications_load_failed'))}</p>
        <button type="button" class="button button--secondary" id="certifications-retry">${escapeHTML(translate('retry'))}</button>
      `;
    }
    const demo = isDemoUser();
    const fieldsets = rules.certifications.map((key) => this.renderCertification(key, demo)).join('');
    return `
      <form id="${FORM_ID}" class="certifications" novalidate>
        ${fieldsets}
        <p class="status-message error" id="certifications-error" role="alert" tabindex="-1" hidden></p>
        ${demo
    ? `<p class="form-help">${escapeHTML(translate('certifications_demo'))}</p>`
    : `<button type="submit" class="button button--primary">${escapeHTML(translate('certifications_save'))}</button>`}
      </form>
    `;
  }

  /** @returns {Object} The record of one certification, empty when none was returned */
  record(key) {
    return this.records.find((entry) => entry.certification_key === key) || { certification_key: key, declared: null, verified: null };
  }

  /** @returns {string} Where a certification stands: verified, expired, waiting for verification, or not declared */
  statusText({ declared, verified }) {
    if (verified) {
      if (verified.valid_until && verified.valid_until < getTodayISO()) {
        return translate('certifications_status_expired').replace('{date}', this.date(verified.valid_until));
      }
      return verified.valid_until
        ? translate('certifications_status_verified_until').replace('{date}', this.date(verified.valid_until))
        : translate('certifications_status_verified');
    }
    return translate(declared ? 'certifications_status_declared' : 'certifications_status_none');
  }

  /** @returns {string} One certification: whether it is held, when obtained, until when */
  renderCertification(key, demo) {
    const record = this.record(key);
    const held = Boolean(record.declared);
    const disabled = demo || !held ? ' disabled' : '';
    const id = `certification-${key}`;
    return `
      <fieldset class="certifications__item">
        <legend>${escapeHTML(translate(`volunteer_requirement_${key}`))}</legend>
        <p class="form-help" id="${id}-status">${escapeHTML(this.statusText(record))}</p>
        <div class="checkbox-option">
          <input type="checkbox" id="${id}-held" name="held_${key}" ${held ? 'checked' : ''}${demo ? ' disabled' : ''}
            aria-describedby="${id}-status">
          <label for="${id}-held">${escapeHTML(translate('certifications_held'))}</label>
        </div>
        <div class="form-group">
          <label for="${id}-obtained">${escapeHTML(translate('certifications_obtained_on'))}</label>
          <input type="date" id="${id}-obtained" name="obtained_${key}" max="${escapeAttribute(getTodayISO())}"
            value="${escapeAttribute(record.declared?.obtained_on || '')}" aria-describedby="${id}-obtained-error"${disabled}>
          <p class="field-error" id="${id}-obtained-error" role="alert"></p>
        </div>
        <div class="form-group">
          <label for="${id}-until">${escapeHTML(translate('certifications_valid_until'))}</label>
          <input type="date" id="${id}-until" name="until_${key}"
            value="${escapeAttribute(record.declared?.valid_until || '')}" aria-describedby="${id}-until-help ${id}-until-error"${disabled}>
          <p class="form-help" id="${id}-until-help">${escapeHTML(translate('certifications_valid_until_help'))}</p>
          <p class="field-error" id="${id}-until-error" role="alert"></p>
        </div>
      </fieldset>
    `;
  }

  attach() {
    this.container.querySelector('#certifications-retry')?.addEventListener('click', () => this.load());
    const form = this.container.querySelector(`#${FORM_ID}`);
    if (!form) {
      return;
    }
    rules.certifications.forEach((key) => {
      form.elements[`held_${key}`].addEventListener('change', (event) => {
        // The dates only mean something for a certification one holds.
        [`obtained_${key}`, `until_${key}`].forEach((name) => {
          form.elements[name].disabled = !event.target.checked;
          this.clearError(form.elements[name]);
        });
      });
    });
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
    if (!field?.id) {
      return;
    }
    field.removeAttribute('aria-invalid');
    const message = this.container?.querySelector(`#${field.id}-error`);
    if (message) {
      message.textContent = '';
    }
    const summary = this.container?.querySelector('#certifications-error');
    if (summary) {
      summary.hidden = true;
    }
  }

  /** Show a refusal next to its field. @returns {boolean} Whether the field was found */
  showError(field, message) {
    const target = field && this.container.querySelector(`#${field.id}-error`);
    if (!target) {
      return false;
    }
    field.setAttribute('aria-invalid', 'true');
    target.textContent = message;
    return true;
  }

  /**
   * Check what can be checked before sending.
   * @returns {{declared: Object, invalid: Array<HTMLElement>}}
   */
  readForm(form) {
    const declared = {};
    const invalid = [];
    const today = getTodayISO();
    rules.certifications.forEach((key) => {
      if (!form.elements[`held_${key}`].checked) {
        return;
      }
      const obtained = form.elements[`obtained_${key}`];
      const until = form.elements[`until_${key}`];
      if (!obtained.value || obtained.value > today) {
        this.showError(obtained, translate('certification_obtained_on_invalid'));
        invalid.push(obtained);
      } else if (until.value && until.value < obtained.value) {
        this.showError(until, translate('certification_valid_until_invalid'));
        invalid.push(until);
      }
      declared[key] = { obtained_on: obtained.value, valid_until: until.value || null };
    });
    return { declared, invalid };
  }

  async save(form) {
    const { declared, invalid } = this.readForm(form);
    if (invalid.length) {
      invalid[0].focus();
      return;
    }
    try {
      const response = await saveMyCertifications(declared);
      if (this.destroyed) {
        return;
      }
      if (Array.isArray(response?.data)) {
        this.records = response.data;
      }
      this.app.showMessage(translate('certifications_saved'), 'success');
      this.render();
    } catch (error) {
      if (this.destroyed) {
        return;
      }
      debugError('Failed to save certifications:', error);
      const message = apiErrorMessage(error, 'certifications_save_failed');
      // A server field path reads declared.<key>.obtained_on or declared.<key>.valid_until.
      const fieldError = Array.isArray(error?.errors)
        ? error.errors.find((entry) => /^declared\.[a-z_]+\.(obtained_on|valid_until)$/.test(entry?.path || ''))
        : null;
      if (fieldError) {
        const [, key, part] = fieldError.path.split('.');
        const field = form.elements[`${part === 'obtained_on' ? 'obtained' : 'until'}_${key}`];
        if (this.showError(field, message)) {
          field.focus();
          return;
        }
      }
      const summary = this.container.querySelector('#certifications-error');
      summary.textContent = message;
      summary.hidden = false;
      summary.focus();
    }
  }
}
