/**
 * Create a unit — the organization_info form, from the template unit's formats.
 *
 * @module spa/modules/organizations/CreateOrganization
 */
import { DynamicFormHandler } from '../../dynamicFormHandler.js';
import { translate } from '../../app.js';
import {
  createOrganization,
  getOrganizationFormFormats,
} from '../../ajax-functions.js';
import { canCreateOrganization } from '../../utils/PermissionUtils.js';
import { setContent, withFormBusy } from '../../utils/DOMUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';
import { renderBackLink } from '../../utils/BackLinkUtils.js';
import { showPageLoading, showPageError } from '../../utils/PageStateUtils.js';

/** Where this page is reached from, and returns to. */
const BACK_HREF = '/district?tab=outils';
/** How long the success message stays before returning to the district tools. */
const REDIRECT_DELAY_MS = 2000;
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
    this.redirectTimer = null;
  }

  /** Called by the router when the person leaves: nothing draws or redirects after that. */
  destroy() {
    this.destroyed = true;
    clearTimeout(this.redirectTimer);
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
          <button type="submit" class="button button--primary" id="submit-organization">${translate('create_unit')}</button>
        </form>
      </section>
    `);
  }

  attachEventListeners() {
    const form = document.getElementById('create-organization-form');
    form?.addEventListener('submit', (event) => {
      event.preventDefault();
      withFormBusy(form, () => this.handleSubmit());
    });
    // A message goes as soon as its field changes.
    form?.addEventListener('input', (event) => this.clearFieldError(event.target));
    form?.addEventListener('change', (event) => this.clearFieldError(event.target));
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
    try {
      const response = await createOrganization(body);
      if (!response?.success) {
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
        messageKey: problem?.field === 'logo' ? 'create_unit_logo_invalid' : 'create_unit_field_invalid',
      })));
      this.app.showMessage(apiErrorMessage(error, 'error_creating_unit'), 'error');
      return;
    }
    this.app.showMessage(translate('unit_created_successfully'), 'success');
    this.redirectTimer = setTimeout(() => this.app.router.navigate(BACK_HREF), REDIRECT_DELAY_MS);
  }

  /**
   * The control drawn for a server key.
   *
   * @param {string} key - Server key
   * @returns {HTMLElement|null} The control
   */
  control(key) {
    const form = document.getElementById('create-organization-form');
    if (!form || typeof key !== 'string') {
      return null;
    }
    return Array.from(form.querySelectorAll('input, select, textarea'))
      .find((element) => element.name === fieldNameFor(key)) || null;
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
      if (!control || control.getAttribute('aria-invalid') === 'true') {
        return;
      }
      const message = document.createElement('p');
      message.className = 'field-error';
      message.id = `create-unit-error-${control.name}`;
      message.textContent = translate(messageKey);
      control.insertAdjacentElement('afterend', message);
      control.setAttribute('aria-invalid', 'true');
      control.setAttribute('aria-describedby', message.id);
      first = first || control;
    });
    first?.focus();
  }

  /** @param {EventTarget} control - The field that changed */
  clearFieldError(control) {
    if (!(control instanceof HTMLElement) || control.getAttribute('aria-invalid') !== 'true') {
      return;
    }
    document.getElementById(control.getAttribute('aria-describedby'))?.remove();
    control.removeAttribute('aria-invalid');
    control.removeAttribute('aria-describedby');
  }

  clearFieldErrors() {
    document.querySelectorAll('#create-organization-form [aria-invalid="true"]')
      .forEach((control) => this.clearFieldError(control));
  }
}
