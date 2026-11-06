// dynamicFormHandler.js
import { translate } from './app.js';
import { debugLog, debugError, debugWarn } from './utils/DebugUtils.js';
import { shouldKeepSavedDependency, isControllerAnswerMatching, clearDependentValues, readControllingValue } from './utils/FormDependencyUtils.js';
import { JSONFormRenderer } from './JSONFormRenderer.js';
import {
  getOrganizationFormFormats,
  getFormSubmission,
  saveFormSubmission,
} from './ajax-functions.js';
import { setContent } from './utils/DOMUtils.js';
import { escapeHTML } from './utils/SecurityUtils.js';
import { renderBackLink } from './utils/BackLinkUtils.js';
import { apiErrorMessage } from './utils/ApiErrorUtils.js';

/**
 * Every form control carrying a field name within one form.
 *
 * Compares `name` directly rather than building a CSS selector, so a field name
 * never has to be escaped.
 *
 * @param {ParentNode} root - The form, container or document to search
 * @param {string} name - The field name
 * @returns {HTMLElement[]} Matching controls, in document order
 */
function getElementsByFieldName(root, name) {
  return Array.from(root.querySelectorAll('input, select, textarea'))
    .filter((element) => element.name === name);
}

export class DynamicFormHandler {
  constructor(app, customSaveHandler = null, _useUniqueIds = false, _formIndex = null) {
    this.app = app;
    this.customSaveHandler = customSaveHandler; 
    this.formFormats = {};
    this.formData = {};
    this.participantId = null;
    this.formType = null;
    this.formRenderer = null;
    this.container = document.getElementById('app'); // Default to #app
    this.useUniqueIds = false;
    this.uniqueIdPart = '';
    this.organizationId = null;
  }

  /**
   * @param {Object|null} [formStructure] - Drawn instead of the unit's stored format for this
   *   form type, for a screen that adapts the format before showing it
   */
  async init(formType, participantId = null, initialData = {}, container = null, useUniqueIds = false, formIndex = null, formStructure = null, organizationId = null) {
    debugLog('Initializing DynamicFormHandler', { formType, participantId, initialData, container,organizationId});
    this.formType = formType;
    this.participantId = participantId;

    // Merge URL query parameters with initialData
    const queryParams = this.getQueryParams();  // New function to get URL parameters
    this.formData = { ...initialData, ...queryParams };  // Merge URL parameters into formData
    this.useUniqueIds = useUniqueIds;
    this.formIndex = formIndex;
    this.uniqueIdPart = this.useUniqueIds && this.formIndex !== null ? `-${this.formIndex}` : ''; 
    this.organizationId = organizationId;
    this.container = container ? 
      (typeof container === 'string' ? document.getElementById(container) : container) 
      : document.getElementById('app'); // Use #app if container is not specified

    if (!this.container) {
      debugError('Container not found for rendering the form.');
      this.showError(translate('error_loading_form'));
      return;
    }

    try {
      if (formStructure) {
        this.formFormats = { [this.formType]: formStructure };
      } else {
        await this.fetchFormFormats();
      }
      if (this.participantId && Object.keys(this.formData).length === 0) {
        await this.fetchFormData();
      }
      this.formRenderer = new JSONFormRenderer(this.formFormats[this.formType], this.formData, this.formType, this.useUniqueIds, this.formIndex);
      this.render(); // Call render here to display the form
    } catch (error) {
      debugError('Error initializing dynamic form:', error);
      this.showError(translate('error_loading_form'));
    }
  }

  // Function to extract query parameters from the URL
  getQueryParams() {
    const queryString = window.location.search;
    const urlParams = new URLSearchParams(queryString);
    const params = {};
    urlParams.forEach((value, key) => {
      params[key] = value;
    });
    return params;
  }

  async fetchFormFormats() {
    this.formFormats = await getOrganizationFormFormats(this.organizationId);
    if (!this.formFormats || !this.formFormats[this.formType]) {
      throw new Error('Failed to fetch form formats or form type not found');
    }
  }

  async fetchFormData() {
    if (this.participantId) {
      try {
        const response = await getFormSubmission(this.participantId, this.formType);
        debugLog('Full response from API:', response);

        if (response.success && response.form_data) {
          this.formData = { ...response.form_data };
          debugLog('Fetched form data:', this.formData);
        } else {
          debugWarn(`No form data found for ${this.formType} and participant ${this.participantId}`);
          this.formData = {};
        }
      } catch (error) {
        debugError('Error fetching form data:', error);
        this.formData = {};
      }
    } else {
      this.formData = {};
    }

    // Add a check to ensure critical fields are present
    this.validateFormData();
  }

  /**
   * The child the form is about, so a parent of several children knows whose
   * form is open. The submission answer carries the participant's first name.
   * @returns {string} First name, or an empty string when unknown
   */
  childName() {
    const name = this.formData?.first_name;
    return typeof name === 'string' ? name.trim() : '';
  }

  validateFormData() {
    const criticalFields = ['first_name', 'last_name', 'date_naissance'];
    for (const field of criticalFields) {
      if (this.formData[field] === undefined) {
        debugWarn(`Critical field '${field}' is missing from form data`);
      }
    }
  }

  async saveFormData(formData) {
    debugLog('Saving form data', { formType: this.formType, participantId: this.participantId, formData });

    try {
      let result;

      // If a custom save handler is provided, use that instead of the default logic
      if (this.customSaveHandler) {
        debugLog('Using custom save handler');
        result = await this.customSaveHandler(formData); // Use custom save handler
      } else {
        // Default save behavior
        debugLog('Using default save handler');
        result = await saveFormSubmission(this.formType, this.participantId, formData);
      }

      debugLog('Form save result:', result);
      if (result.success) {
        // The class has no showMessage of its own; the app shows toasts.
        this.app.showMessage(translate('form_saved_successfully'), 'success');
        return result;
      } else {
        throw new Error(result.message || translate('error_saving_form'));
      }
    } catch (error) {
      debugError('Error saving form:', error);
      this.showError(apiErrorMessage(error, 'error_saving_data'));
      throw error;
    }
  }

  render() {
    if (!this.container) {
      debugError('Container not found for rendering the form.');
      this.showError(translate('error_loading_form'));
      return;
    }

    const formStructure = this.formFormats[this.formType];
    if (!formStructure) {
      this.showError(translate('form_not_found'));
      return;
    }

    debugLog('Rendering form structure for type:', this.formType);
    debugLog('Form data:', this.formData);

    let fields = formStructure.fields;

    // If there's a custom form structure, add those fields
    if (this.formData.custom_form && Array.isArray(this.formData.custom_form.fields)) {
      // Merge formStructure fields and custom_form fields, removing duplicates
      fields = [
        ...fields,
        ...this.formData.custom_form.fields.filter(customField => 
          !fields.some(field => field.name === customField.name)
        )
      ];
    }

    const formRenderer = new JSONFormRenderer({ fields }, this.formData, this.formType, this.useUniqueIds, this.formIndex);

    const formContent = formRenderer.render();

    // Conditionally add formIndex if useUniqueIds is true
    const uniqueIdPart = this.useUniqueIds && this.formIndex !== null ? `-${this.formIndex}` : '';


    // Check if this handler is standalone or embedded within another form
    const content = this.isStandalone() 
      ? `
                    ${renderBackLink()}
                    <h1>${escapeHTML(translate(this.formType))}${this.childName() ? ` — ${escapeHTML(this.childName())}` : ''}</h1>
                    ${fields.some((field) => field.required) ? `<p class="form-required-note">${escapeHTML(translate('form_required_note'))}</p>` : ''}
                    <form id="dynamic-form-${this.formType}" novalidate>
                        <div class="form-error-summary" id="dynamic-form-errors" role="alert" tabindex="-1" hidden></div>
                        ${formContent}
                        <button type="submit" class="button button--primary">${translate('save')}</button>
                    </form>
                `
      : `
                   <fieldset id="dynamic-form-${this.formType}${uniqueIdPart}">
                    <legend>${translate(this.formType)}</legend>
                    ${formContent}
                </fieldset>`;

    setContent(this.container, content);

    // Attach event listeners for dependent fields
    this.attachDependencyListeners();

    // Attach event listeners only if it's standalone
    if (this.isStandalone()) {
      this.attachEventListeners(uniqueIdPart);
    }
  }

  /**
     * Attach listeners to controlling fields after rendering, then bring every
     * dependent field in line with what its controlling field shows right now.
     *
     * The initial sync matters for a select: without a saved answer it still
     * displays its first option, so a field waiting on that option must start
     * visible even though nothing has been saved yet.
     *
     * @returns {void}
     */
  attachDependencyListeners() {
    const fields = this.formFormats[this.formType].fields;
    // Participant registration mounts one handler per guardian, each in its
    // own container and all sharing field names. Looking fields up across
    // the whole document let one guardian's answer hide — and clear — the
    // matching field of every other guardian.
    const root = this.container || document;
    // Same unwrapping as JSONFormRenderer.render()
    const savedAnswers = this.formData?.form_data || this.formData || {};

    fields.forEach((field) => {
      if (field.dependsOn) {
        const controller = fields.find((candidate) => candidate.name === field.dependsOn.field);
        const controllingElements = getElementsByFieldName(root, field.dependsOn.field);
        const sync = () => {
          const controllingValue = readControllingValue(controllingElements, controller);
          this.toggleDependentFields(field, controllingValue, root, controller);
        };

        controllingElements.forEach((element) => {
          element.addEventListener(this.getEventType(element.type), sync);
        });

        // On load, the saved answers outrank the screen (see
        // shouldKeepSavedDependency).
        const keepAsRendered = shouldKeepSavedDependency(
          controller,
          savedAnswers[field.dependsOn.field],
          readControllingValue(controllingElements, controller),
          field.dependsOn.value
        );
        if (controllingElements.length > 0 && !keepAsRendered) {
          sync();
        }
      }
    });
  }

  // Get the appropriate event type based on the input type
  getEventType(type) {
    switch (type) {
      case 'text':
      case 'textarea':
        return 'input';
      case 'select-one':
      case 'checkbox':
      case 'radio':
        return 'change';
      default:
        return 'input';
    }
  }

  // Get the current value of a field based on its type
  getFieldValue(field) {
    switch (field.type) {
      case 'checkbox':
        return field.checked ? 'yes' : 'no'; // Normalizing value for checkboxes
      case 'radio':
        return field.checked ? field.value : '';
      default:
        return field.value;
    }
  }

  /**
     * Show, enable and require a dependent field once its controlling question
     * is answered the way the form format asks for — and hide and clear it again
     * otherwise.
     *
     * @param {Object} dependentField - The dependent field's definition
     * @param {*} controllingValue - The controlling field's current answer
     * @param {ParentNode} [root=document] - The form the dependent field belongs to
     * @param {Object} [controller] - The controlling field's definition, so that
     *   its own option values are compared exactly
     * @returns {void}
     */
  toggleDependentFields(dependentField, controllingValue, root = document, controller = undefined) {
    // Every element carrying the name, not just the first: a dependent field
    // rendered as a group of radios was otherwise half-toggled.
    const dependentElements = getElementsByFieldName(root, dependentField.name);
    if (dependentElements.length === 0) {
      return;
    }

    const isMet = isControllerAnswerMatching(controller, controllingValue, dependentField.dependsOn.value);

    dependentElements.forEach((element) => {
      element.disabled = !isMet;
      if (isMet && dependentField.required) {
        element.setAttribute('required', 'true');
      } else {
        element.removeAttribute('required');
      }
    });

    // A hidden field must not keep an answer the form no longer shows.
    if (!isMet) {
      clearDependentValues(dependentElements);
    }

    // Hide the whole group rather than leaving a greyed-out box on screen.
    const group = dependentElements[0].closest('.form-group');
    if (group) {
      group.classList.toggle('form-group--hidden', !isMet);
    }
  }
    
    
    
  attachEventListeners() {
    const formElement = this.container.querySelector(`#dynamic-form-${this.formType}${this.uniqueIdPart}`);
    if (formElement) {
      formElement.addEventListener('submit', (e) => this.handleSubmit(e));
      debugLog(`Event listener attached for form: ${this.formType}`);
    } else {
      debugError(`Form element for ${this.formType}${this.uniqueIdPart} not found.`);
    }
  }

  /**
   * Check the form before sending, the way a person can follow: every question
   * left unanswered gets a message under it, tied to its controls, and a
   * summary at the top names them, takes the focus, and leads to each one.
   * A message goes away as soon as its question is answered.
   * @param {HTMLFormElement} form - The standalone form
   * @returns {boolean} True when every required question is answered
   */
  showMissingAnswers(form) {
    const summary = form.querySelector('#dynamic-form-errors');
    form.querySelectorAll('.dynamic-form-field-error').forEach((message) => message.remove());
    form.querySelectorAll('[aria-invalid="true"]').forEach((control) => {
      control.removeAttribute('aria-invalid');
      control.removeAttribute('aria-describedby');
    });

    const missing = new Map();
    form.querySelectorAll('input, select, textarea').forEach((control) => {
      if (!control.disabled && control.name && control.willValidate && !control.checkValidity()
          && !missing.has(control.name)) {
        missing.set(control.name, control.closest('.form-group'));
      }
    });
    if (!summary) {
      return missing.size === 0;
    }
    if (missing.size === 0) {
      summary.hidden = true;
      setContent(summary, '');
      return true;
    }

    const items = [];
    missing.forEach((group, name) => {
      const messageId = `dynamic-form-error-${name}`;
      const label = group?.querySelector('label');
      const message = document.createElement('p');
      message.className = 'error-text dynamic-form-field-error';
      message.id = messageId;
      message.textContent = translate('field_required');
      label?.after(message);
      [...form.querySelectorAll('input, select, textarea')]
        .filter((control) => control.name === name)
        .forEach((control) => {
          control.setAttribute('aria-invalid', 'true');
          control.setAttribute('aria-describedby', messageId);
        });
      items.push(`<li><button type="button" class="button button--ghost button--small" data-focus-field="${escapeHTML(name)}">${escapeHTML(label?.textContent.trim() || name)}</button></li>`);
    });
    setContent(summary, `<p>${escapeHTML(translate(missing.size === 1 ? 'form_missing_answers_one' : 'form_missing_answers').replace('{count}', String(missing.size)))}</p><ul>${items.join('')}</ul>`);
    summary.hidden = false;
    summary.focus();

    if (!form.dataset.missingAnswersBound) {
      form.dataset.missingAnswersBound = 'true';
      summary.addEventListener('click', (event) => {
        const target = event.target.closest('[data-focus-field]');
        const control = target && [...form.querySelectorAll('input, select, textarea')]
          .find((candidate) => candidate.name === target.dataset.focusField);
        control?.focus();
      });
      const clear = (event) => {
        const { name } = event.target;
        if (!name || !event.target.checkValidity()) {
          return;
        }
        document.getElementById(`dynamic-form-error-${name}`)?.remove();
        [...form.querySelectorAll('input, select, textarea')]
          .filter((control) => control.name === name)
          .forEach((control) => {
            control.removeAttribute('aria-invalid');
            control.removeAttribute('aria-describedby');
          });
      };
      form.addEventListener('input', clear);
      form.addEventListener('change', clear);
    }
    return false;
  }

  async handleSubmit(e) {
    e.preventDefault();
    if (!this.showMissingAnswers(e.target)) {
      return;
    }
    const formData = new FormData(e.target);
    const submissionData = Object.fromEntries(formData.entries());

    try {
      const result = await saveFormSubmission(this.formType, this.participantId, submissionData);
      if (result.success) {
        this.app.showMessage(translate('form_saved_successfully'), 'success');
        this.app.router.navigate('/parent-dashboard');
      } else {
        throw new Error(result.message || translate('error_saving_form'));
      }
    } catch (error) {
      debugError('Error saving form:', error);
      this.showError(apiErrorMessage(error, 'error_saving_form'));
    }
  }

  showError(message) {
    this.app.showMessage(message, 'error');
  }
  getFormData() {
    // Select the fieldset (or form) inside the container for this specific formType and formIndex
    const formElement = this.container.querySelector(`#dynamic-form-${this.formType}${this.uniqueIdPart}`);

    // Check if the form element exists
    if (!formElement) {
      debugError(`Form element for ${this.formType}${this.uniqueIdPart} not found or is not a valid form.`);
      return {}; // Return an empty object if the form element is not found
    }

    // Collect data directly from input, select, and textarea elements within this specific formElement
    const filteredData = {};
    formElement.querySelectorAll('input, select, textarea').forEach(field => {
      if (field.type === 'checkbox') {
        filteredData[field.name] = field.checked;
      } else if (field.type === 'radio') {
        // Only add the value of the selected radio button
        if (field.checked) {
          filteredData[field.name] = field.value;
        }
      } else {
        filteredData[field.name] = field.value;
      }
    });

    return filteredData; // Return all the form data as an object
  }




  // Utility method to determine if this instance is standalone
  isStandalone() {
    return this.container === document.getElementById('app');
  }
}