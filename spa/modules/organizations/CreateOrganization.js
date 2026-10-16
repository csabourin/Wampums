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

export class CreateOrganization {
  constructor(app) {
    this.app = app;
    this.formHandler = null;
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

    this.render();
    this.formHandler = new DynamicFormHandler(this.app);
    await this.formHandler.init(
      'organization_info',
      null,
      {},
      'organization-form-container',
      false,
      null,
      null,
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
  }

  async handleSubmit() {
    const formData = this.formHandler.getFormData();
    try {
      const response = await createOrganization(formData);
      if (!response?.success) {
        throw Object.assign(new Error('unit_not_created'), { status: response?.status });
      }
    } catch (error) {
      debugError('Error creating unit:', error);
      this.app.showMessage(apiErrorMessage(error, 'error_creating_unit'), 'error');
      return;
    }
    this.app.showMessage(translate('unit_created_successfully'), 'success');
    this.redirectTimer = setTimeout(() => this.app.router.navigate(BACK_HREF), REDIRECT_DELAY_MS);
  }
}
