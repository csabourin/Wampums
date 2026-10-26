/**
 * Create a unit — the organization_info form, from the template unit's formats,
 * then the unit's branch, its address and who will administer it. Once it
 * exists, the person may open it or stay in the unit they are in.
 *
 * @module spa/modules/organizations/CreateOrganization
 */
import { DynamicFormHandler } from '../../dynamicFormHandler.js';
import { translate } from '../../app.js';
import { CONFIG } from '../../config.js';
import {
  createOrganization,
  getOrganizationFormFormats,
} from '../../ajax-functions.js';
import { canCreateOrganization, canSwitchUnits } from '../../utils/PermissionUtils.js';
import { setContent, withFormBusy } from '../../utils/DOMUtils.js';
import { escapeHTML, escapeAttribute, sanitizeURL } from '../../utils/SecurityUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';
import { renderBackLink } from '../../utils/BackLinkUtils.js';
import { showPageLoading, showPageError } from '../../utils/PageStateUtils.js';
import {
  SUBDOMAIN_MAX_LENGTH,
  UNIT_BASE_DOMAIN,
  subdomainProblem,
  suggestSubdomain,
} from '../../utils/UnitSubdomainUtils.js';
import { switchActiveUnit } from '../session/UnitSwitch.js';

/** Where this page is reached from, and returns to. */
const BACK_HREF = '/district?tab=outils';
/** Where the new unit opens. */
const NEW_UNIT_HREF = '/dashboard';
/** Longest address the server accepts. */
const EMAIL_MAX_LENGTH = 255;
/** Enough of an address to send an invitation to; the server checks the rest. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Field errors the server names by key, and what this screen says for each. */
const SERVER_FIELD_MESSAGES = Object.freeze({
  subdomain_required: 'subdomain_required',
  subdomain_invalid: 'subdomain_invalid',
  subdomain_reserved: 'subdomain_reserved',
  subdomain_taken: 'subdomain_taken',
  program_section_required: 'create_unit_branch_required',
  leader_email_invalid: 'leader_email_invalid',
});
/** The unit whose form formats serve as the template for a new unit. */
const TEMPLATE_ORGANIZATION_ID = 0;
/**
 * Server keys drawn under another field name. DOMPurify strips a control's
 * `name` when it is a property of a form (`name`, `action`…), so the unit's
 * name field reached the server without one and every creation was refused.
 */
const FIELD_ALIASES = Object.freeze({ name: 'organization_name' });
/** What the server accepts as a logo: an HTTP(S) URL or an absolute site path. */
const LOGO_PATTERN = /^(?:https?:\/\/|\/(?!\/))/i;
/** An older template asked for the logo as a file, which nothing uploads. */
const LOGO_FIELD = Object.freeze({ type: 'url', label: 'unit_settings_logo_url' });

/**
 * The field name a server key is drawn under.
 *
 * @param {string} key - Key of the organization_info setting
 * @returns {string} Field name in the form
 */
function fieldNameFor(key) {
  return FIELD_ALIASES[key] || key;
}

/**
 * The server key a field name stands for.
 *
 * @param {string} fieldName - Field name in the form
 * @returns {string} Key of the organization_info setting
 */
function serverKeyFor(fieldName) {
  return Object.keys(FIELD_ALIASES).find((key) => FIELD_ALIASES[key] === fieldName) || fieldName;
}

/**
 * The template's organization_info format, adapted so every field can be sent.
 *
 * @param {Object} structure - Stored form structure
 * @returns {Object} Structure to draw
 */
function creationStructure(structure) {
  const fields = Array.isArray(structure?.fields) ? structure.fields : [];
  return {
    ...structure,
    fields: fields.map((field) => {
      const adapted = { ...field, name: fieldNameFor(field.name) };
      return field.name === 'logo' ? { ...adapted, ...LOGO_FIELD } : adapted;
    }),
  };
}

export class CreateOrganization {
  constructor(app) {
    this.app = app;
    this.formHandler = null;
    this.structure = null;
    this.templateOrganizationId = TEMPLATE_ORGANIZATION_ID;
    this.destroyed = false;
    // The subdomain follows the unit's name until the person types one of their own.
    this.subdomainEdited = false;
    this.created = null;
  }

  /** Called by the router when the person leaves: nothing draws after that. */
  destroy() {
    this.destroyed = true;
  }

  /** @returns {Object} Shared page-state options */
  pageOptions() {
    return { title: translate('create_new_unit'), className: 'create-organization-page', backHref: BACK_HREF };
  }

  async init() {
    if (!canCreateOrganization()) {
      this.app.router.navigate('/dashboard');
      return;
    }

    showPageLoading(document.getElementById('app'), this.pageOptions());
    let formFormats;
    try {
      formFormats = await getOrganizationFormFormats(this.templateOrganizationId);
    } catch (error) {
      debugError('Error loading the unit form:', error);
    }
    if (this.destroyed) {
      return;
    }
    // Without the form there is nothing to fill: the page says so instead of a lone button.
    if (!formFormats?.organization_info) {
      showPageError(document.getElementById('app'), {
        ...this.pageOptions(),
        message: translate('error_loading_form'),
      }, () => this.init());
      return;
    }

    this.structure = creationStructure(formFormats.organization_info);
    this.render();
    this.formHandler = new DynamicFormHandler(this.app);
    await this.formHandler.init(
      'organization_info',
      null,
      {},
      'organization-form-container',
      false,
      null,
      this.structure,
      this.templateOrganizationId,
    );
    this.attachEventListeners();
  }

  render() {
    setContent(document.getElementById('app'), `
      <section class="page create-organization-page">
        ${renderBackLink(BACK_HREF)}
        <h1>${translate('create_new_unit')}</h1>
        <form id="create-organization-form" novalidate>
          <div id="organization-form-container"></div>
          ${this.renderAccessFields()}
          <button type="submit" class="button button--primary" id="submit-organization">${translate('create_unit')}</button>
        </form>
      </section>
    `);
  }

  /**
   * The branch, the address and the administrator: what the template form does not ask.
   *
   * @returns {string} HTML
   */
  renderAccessFields() {
    const branches = CONFIG.PROGRAM_SECTIONS.DEFAULT.map(({ key, labelKey }) => `
      <div class="radio-option">
        <input type="radio" id="create-unit-branch-${escapeAttribute(key)}" name="program_section" value="${escapeAttribute(key)}" required>
        <label for="create-unit-branch-${escapeAttribute(key)}">${escapeHTML(translate(labelKey))}</label>
      </div>`).join('');
    return `
      <fieldset class="create-unit-access">
        <legend>${translate('create_unit_access_legend')}</legend>
        <p class="field-hint">${translate('create_unit_access_required')}</p>
        <fieldset class="create-unit-branch" id="create-unit-branch" role="radiogroup" aria-required="true">
          <legend>${translate('create_unit_branch_label')}</legend>
          <div class="radio-group">${branches}</div>
        </fieldset>
        <div class="form-group">
          <label for="create-unit-subdomain">${translate('create_unit_subdomain_label')}</label>
          <div class="create-unit-subdomain" data-error-anchor>
            <input type="text" id="create-unit-subdomain" name="subdomain" required
              maxlength="${SUBDOMAIN_MAX_LENGTH}" autocomplete="off" autocapitalize="none" spellcheck="false"
              aria-describedby="create-unit-subdomain-hint">
            <span class="create-unit-subdomain__suffix" aria-hidden="true">.${escapeHTML(UNIT_BASE_DOMAIN)}</span>
          </div>
          <p class="field-hint" id="create-unit-subdomain-hint">${escapeHTML(translate('create_unit_subdomain_hint').replace('{domain}', UNIT_BASE_DOMAIN))}</p>
        </div>
        <div class="form-group">
          <label for="create-unit-leader-email">${translate('create_unit_leader_email_label')}</label>
          <input type="email" id="create-unit-leader-email" name="leader_email" required
            maxlength="${EMAIL_MAX_LENGTH}" autocomplete="off" aria-describedby="create-unit-leader-email-hint">
          <p class="field-hint" id="create-unit-leader-email-hint">${translate('create_unit_leader_email_hint')}</p>
        </div>
      </fieldset>
    `;
  }

  attachEventListeners() {
    const form = document.getElementById('create-organization-form');
    form?.addEventListener('submit', (event) => {
      event.preventDefault();
      withFormBusy(form, () => this.handleSubmit());
    });
    // A message goes as soon as its field changes.
    form?.addEventListener('input', (event) => {
      this.clearFieldError(event.target);
      this.followUnitName(event.target);
    });
    form?.addEventListener('change', (event) => this.clearFieldError(event.target));
  }

  /**
   * Keep the suggested subdomain in step with the unit's name, until the
   * person writes a subdomain themselves. Emptying it hands it back.
   *
   * @param {EventTarget} target - The field that changed
   */
  followUnitName(target) {
    const subdomain = this.control('subdomain');
    if (target === subdomain) {
      this.subdomainEdited = subdomain.value.trim() !== '';
      return;
    }
    if (target === this.control('name') && subdomain && !this.subdomainEdited) {
      subdomain.value = suggestSubdomain(target.value);
      this.clearFieldError(subdomain);
    }
  }

  /**
   * What the person entered, under the server's keys.
   *
   * @returns {Object} Request body
   */
  payload() {
    const formData = this.formHandler.getFormData();
    const body = {};
    Object.entries(formData).forEach(([fieldName, value]) => {
      if (!fieldName) {
        return;
      }
      body[serverKeyFor(fieldName)] = typeof value === 'string' ? value.trim() : value;
    });
    body.program_section = this.control('program_section', ':checked')?.value || '';
    body.subdomain = (this.control('subdomain')?.value || '').trim().toLowerCase();
    body.leader_email = (this.control('leader_email')?.value || '').trim();
    // The administrator's invitation is written in the creator's language.
    if (typeof this.app?.lang === 'string') {
      body.language = this.app.lang;
    }
    return body;
  }

  /**
   * Problems found before sending: required fields left empty, a logo that is not a web address.
   *
   * @param {Object} body - Request body
   * @returns {Array<{field: string, messageKey: string}>} Problems, in form order
   */
  localProblems(body) {
    const problems = [];
    (this.structure?.fields || []).forEach((field) => {
      const key = serverKeyFor(field.name);
      // A field whose dependsOn condition is unmet is disabled and hidden: nobody can fill it.
      if (this.control(key)?.disabled) {
        return;
      }
      if ((field.required || key === 'name') && !body[key]) {
        problems.push({ field: key, messageKey: 'field_required' });
      } else if (key === 'logo' && body.logo && !LOGO_PATTERN.test(body.logo)) {
        problems.push({ field: key, messageKey: 'create_unit_logo_invalid' });
      }
    });
    if (!body.program_section) {
      problems.push({ field: 'program_section', messageKey: 'create_unit_branch_required' });
    }
    const subdomain = subdomainProblem(body.subdomain);
    if (subdomain) {
      problems.push({ field: 'subdomain', messageKey: subdomain });
    }
    if (!EMAIL_PATTERN.test(body.leader_email) || body.leader_email.length > EMAIL_MAX_LENGTH) {
      problems.push({ field: 'leader_email', messageKey: 'leader_email_invalid' });
    }
    return problems;
  }

  async handleSubmit() {
    this.clearFieldErrors();
    const body = this.payload();
    const problems = this.localProblems(body);
    if (problems.length > 0) {
      this.showFieldErrors(problems);
      this.app.showMessage(translate('api_error_invalid'), 'error');
      return;
    }
    let created;
    try {
      const response = await createOrganization(body);
      created = response?.data;
      if (!response?.success || !created?.organization_id) {
        throw Object.assign(new Error('unit_not_created'), { status: response?.status });
      }
    } catch (error) {
      debugError('Error creating unit:', error);
      if (this.destroyed) {
        return;
      }
      const refused = Array.isArray(error?.errors) ? error.errors : [];
      this.showFieldErrors(refused.map((problem) => ({
        field: problem?.field,
        messageKey: this.serverFieldMessage(problem),
      })));
      this.app.showMessage(apiErrorMessage(error, 'error_creating_unit'), 'error');
      return;
    }
    if (this.destroyed) {
      return;
    }
    this.app.showMessage(translate('unit_created_successfully'), 'success');
    this.created = created;
    this.renderCreated();
  }

  /**
   * What to say on a field the server refused.
   *
   * @param {{field?: string, msg?: string}} problem - Entry of the response's `errors`
   * @returns {string} Translation key
   */
  serverFieldMessage(problem) {
    if (Object.prototype.hasOwnProperty.call(SERVER_FIELD_MESSAGES, problem?.msg)) {
      return SERVER_FIELD_MESSAGES[problem.msg];
    }
    return problem?.field === 'logo' ? 'create_unit_logo_invalid' : 'create_unit_field_invalid';
  }

  /**
   * What the invitation of the unit's administrator came to.
   *
   * @param {{email?: string, invited?: boolean, email_sent?: boolean}} invitation - From the response
   * @returns {string} Text to show
   */
  invitationSummary(invitation = {}) {
    if (!invitation.invited) {
      return translate('create_unit_done_creator_is_admin');
    }
    const key = invitation.email_sent ? 'create_unit_done_invitation_sent' : 'create_unit_done_invitation_not_sent';
    return translate(key).replace('{email}', invitation.email || '');
  }

  /** The unit exists: where it answers, what became of the invitation, and the way in. */
  renderCreated() {
    if (this.destroyed) {
      return;
    }
    const { domain, leader_invitation: invitation } = this.created;
    const address = sanitizeURL(`https://${domain}`);
    const failed = invitation?.invited && !invitation.email_sent;
    setContent(document.getElementById('app'), `
      <section class="page create-organization-page">
        ${renderBackLink(BACK_HREF)}
        <h1 id="create-unit-done-title" tabindex="-1">${translate('create_unit_done_title')}</h1>
        <p>${translate('create_unit_done_address')}
          <a href="${escapeAttribute(address)}" rel="noopener">${escapeHTML(domain)}</a></p>
        <p class="${failed ? 'create-unit-notice' : ''}">${escapeHTML(this.invitationSummary(invitation))}</p>
        <div class="create-unit-done__actions">
          ${canSwitchUnits() ? `<button type="button" class="button button--primary" id="create-unit-open">${translate('create_unit_open_new_unit')}</button>` : ''}
          <a href="${BACK_HREF}" class="button button--secondary">${translate('create_unit_stay_here')}</a>
        </div>
      </section>
    `);
    document.getElementById('create-unit-open')?.addEventListener('click', (event) => this.openNewUnit(event.currentTarget));
    // The form the person was in is gone: they are told where they now are.
    document.getElementById('create-unit-done-title')?.focus();
  }

  /**
   * Make the new unit the active one and go to its dashboard.
   *
   * @param {HTMLButtonElement} button - The button that asked
   */
  async openNewUnit(button) {
    button.disabled = true;
    try {
      await switchActiveUnit(this.app, this.created.organization_id);
    } catch (error) {
      debugError('Error opening the new unit:', error);
      if (!this.destroyed) {
        button.disabled = false;
        this.app.showMessage(apiErrorMessage(error, 'create_unit_open_failed'), 'error');
      }
      return;
    }
    if (!this.destroyed) {
      this.app.router.navigate(NEW_UNIT_HREF);
    }
  }

  /**
   * The control drawn for a server key (the first, for a group of options).
   *
   * @param {string} key - Server key
   * @param {string} [state] - Pseudo-class the control must match, e.g. ':checked'
   * @returns {HTMLElement|null} The control
   */
  control(key, state = '') {
    const form = document.getElementById('create-organization-form');
    if (!form || typeof key !== 'string') {
      return null;
    }
    return Array.from(form.querySelectorAll(`input${state}, select${state}, textarea${state}`))
      .find((element) => element.name === fieldNameFor(key)) || null;
  }

  /**
   * The element that carries a field's error: the control, or the group a set of options sits in.
   *
   * @param {HTMLElement|null} control - A control of the field
   * @returns {HTMLElement|null} The element marked invalid
   */
  errorHost(control) {
    if (!(control instanceof HTMLElement)) {
      return null;
    }
    return control.type === 'radio' ? control.closest('[role="radiogroup"]') : control;
  }

  /**
   * Tie each problem to its field, then move focus to the first one.
   *
   * @param {Array<{field: string, messageKey: string}>} problems - Problems to show
   */
  showFieldErrors(problems) {
    let first = null;
    problems.forEach(({ field, messageKey }) => {
      const control = this.control(field);
      const host = this.errorHost(control);
      if (!host || host.getAttribute('aria-invalid') === 'true') {
        return;
      }
      const message = document.createElement('p');
      message.className = 'field-error';
      message.id = `create-unit-error-${control.name}`;
      message.textContent = translate(messageKey);
      if (host === control) {
        (control.closest('[data-error-anchor]') || control).insertAdjacentElement('afterend', message);
      } else {
        host.append(message);
      }
      // A hint the field already points to stays read along with the error.
      const hint = host.getAttribute('aria-describedby') || '';
      host.dataset.hintIds = hint;
      host.dataset.errorId = message.id;
      host.setAttribute('aria-invalid', 'true');
      host.setAttribute('aria-describedby', `${hint} ${message.id}`.trim());
      first = first || control;
    });
    first?.focus();
  }

  /** @param {EventTarget} control - The field that changed */
  clearFieldError(control) {
    const host = this.errorHost(control);
    if (!host || host.getAttribute('aria-invalid') !== 'true') {
      return;
    }
    document.getElementById(host.dataset.errorId)?.remove();
    host.removeAttribute('aria-invalid');
    if (host.dataset.hintIds) {
      host.setAttribute('aria-describedby', host.dataset.hintIds);
    } else {
      host.removeAttribute('aria-describedby');
    }
    delete host.dataset.hintIds;
    delete host.dataset.errorId;
  }

  clearFieldErrors() {
    document.querySelectorAll('#create-organization-form [aria-invalid="true"]')
      .forEach((control) => this.clearFieldError(control));
  }
}
