/**
 * The form a camp site is added or edited with (#1317), in a dialog: where the
 * site is and who owns it, how one sleeps and keeps warm there, whether the
 * site's insurance covers the unit, and how to reach help from it.
 *
 * Opened from the unit's sites (`/camp-sites`) and from a camp's site
 * (`/camp-site/:id`). Choosing a province suggests its poison centre when the
 * field is still empty (Health Canada's 1-844-POISON-X, or Quebec's own line).
 *
 * @module spa/modules/camp-sites/SiteForm
 */
import { translate } from '../../app.js';
import rules from '../../../config/camp_sites.json';
import { withFormBusy } from '../../utils/DOMUtils.js';
import { escapeHTML, escapeAttribute } from '../../utils/SecurityUtils.js';
import { openModal } from '../../utils/ModalUtils.js';
import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { createCampSite, updateCampSite } from '../../api/api-camp-sites.js';

const FORM_ID = 'camp-site-form';
const URL_PATTERN = /^https?:\/\/\S+$/i;

/** Text fields: [field, label key, kind, max length]. */
const IDENTITY_FIELDS = [
  ['owner_name', 'camp_site_owner', 'text', rules.TEXT_MAX],
  ['address', 'camp_site_address', 'textarea', rules.LONG_TEXT_MAX],
  ['phone', 'camp_site_phone', 'tel', rules.PHONE_MAX],
  ['site_type', 'camp_site_type', 'text', rules.TEXT_MAX],
  ['description', 'camp_site_description', 'textarea', rules.LONG_TEXT_MAX],
];
/** Owner and address come before the province; the rest after it. */
const ADDRESS_FIELDS = 2;
const EMERGENCY_FIELDS = [
  ['hospital_name', 'camp_site_hospital_name', 'text', rules.TEXT_MAX],
  ['hospital_address', 'camp_site_hospital_address', 'textarea', rules.LONG_TEXT_MAX],
  ['hospital_phone', 'camp_site_hospital_phone', 'tel', rules.PHONE_MAX],
  ['hospital_travel_minutes', 'camp_site_hospital_minutes', 'minutes', null],
  ['hospital_distance_km', 'camp_site_hospital_km', 'km', null],
  ['poison_centre_phone', 'camp_site_poison_centre', 'tel', rules.PHONE_MAX],
  ['other_emergency_numbers', 'camp_site_other_numbers', 'textarea', rules.LONG_TEXT_MAX],
];
const DIRECTION_FIELDS = [
  ['directions_url', 'camp_site_directions', 'url', rules.URL_MAX],
  ['hospital_directions_url', 'camp_site_hospital_directions', 'url', rules.URL_MAX],
];

/** @returns {string} The id of a form field */
const fieldId = (field) => `camp-site-${field.replace(/_/g, '-')}`;

/** @returns {string} A field's form name, prefixed: a bare `name` would shadow the form's own property. */
const nameOf = (field) => `site_${field}`;

/** @returns {Element|null} The control of an API field */
const fieldOf = (form, field) => form.elements.namedItem(nameOf(field));

/**
 * The poison centre suggested for a province: Quebec's own line, none for
 * Nunavut (its local health centre), the national number elsewhere.
 *
 * @param {string} province
 * @returns {string} The number, or '' when there is none to suggest
 */
export function suggestedPoisonCentre(province) {
  if (Object.prototype.hasOwnProperty.call(rules.POISON_CENTRES, province)) {
    return rules.POISON_CENTRES[province] || '';
  }
  return province ? rules.POISON_CENTRE_NATIONAL : '';
}

/** @returns {string} A labelled control, with the place its error goes */
function control([field, labelKey, kind, max], site) {
  const id = fieldId(field);
  const value = site[field] ?? '';
  const described = `aria-describedby="${id}-error"`;
  let input;
  if (kind === 'textarea') {
    input = `<textarea id="${id}" name="${nameOf(field)}" rows="2" maxlength="${max}" ${described}>${escapeHTML(value)}</textarea>`;
  } else if (kind === 'minutes') {
    input = `<input type="number" id="${id}" name="${nameOf(field)}" min="0" max="${rules.TRAVEL_MINUTES_MAX}" step="1" inputmode="numeric"
      value="${escapeAttribute(String(value))}" ${described}>`;
  } else if (kind === 'km') {
    input = `<input type="number" id="${id}" name="${nameOf(field)}" min="0" max="${rules.DISTANCE_KM_MAX}" step="0.1" inputmode="decimal"
      value="${escapeAttribute(String(value))}" ${described}>`;
  } else {
    const type = kind === 'tel' ? 'tel' : kind === 'url' ? 'url' : 'text';
    input = `<input type="${type}" id="${id}" name="${nameOf(field)}" maxlength="${max}" value="${escapeAttribute(String(value))}"
      ${kind === 'url' ? 'inputmode="url" placeholder="https://"' : ''} ${described}>`;
  }
  return `<div class="form-group">
      <label for="${id}">${escapeHTML(translate(labelKey))}</label>
      ${input}
      <p class="field-error" id="${id}-error" hidden></p>
    </div>`;
}

/** @returns {string} A select of allowed values, with an empty first choice */
function choice(field, labelKey, values, prefix, current) {
  const id = fieldId(field);
  return `<div class="form-group">
      <label for="${id}">${escapeHTML(translate(labelKey))}</label>
      <select id="${id}" name="${nameOf(field)}" aria-describedby="${id}-error">
        <option value="">${escapeHTML(translate('camp_site_not_specified'))}</option>
        ${values.map((value) => `<option value="${value}" ${value === current ? 'selected' : ''}>${escapeHTML(translate(`${prefix}${value.toLowerCase()}`))}</option>`).join('')}
      </select>
      <p class="field-error" id="${id}-error" hidden></p>
    </div>`;
}

/** @returns {string} The insurance question: yes, no, or not known */
function insurance(site) {
  const current = site.has_own_insurance === true ? 'yes' : site.has_own_insurance === false ? 'no' : '';
  const option = (value, labelKey) => `<div class="radio-option">
      <input type="radio" id="camp-site-insurance-${value || 'unknown'}" name="${nameOf('has_own_insurance')}" value="${value}" ${current === value ? 'checked' : ''}>
      <label for="camp-site-insurance-${value || 'unknown'}">${escapeHTML(translate(labelKey))}</label>
    </div>`;
  return `<fieldset class="camp-site-form__insurance">
      <legend>${escapeHTML(translate('camp_site_own_insurance'))}</legend>
      <div class="radio-group">
        ${option('yes', 'yes')}${option('no', 'no')}${option('', 'camp_site_not_specified')}
      </div>
    </fieldset>`;
}

/** @returns {string} The whole form */
function formMarkup(site) {
  return `<form id="${FORM_ID}" class="camp-site-form" novalidate>
      <p class="field-hint">${escapeHTML(translate('camp_site_form_intro'))}</p>
      <p class="status-message error" id="camp-site-form-error" role="alert" hidden></p>
      <fieldset>
        <legend>${escapeHTML(translate('camp_site_section_place'))}</legend>
        <div class="form-group">
          <label for="camp-site-name">${escapeHTML(translate('camp_site_name'))} (${escapeHTML(translate('camp_site_required'))})</label>
          <input type="text" id="camp-site-name" name="${nameOf('name')}" maxlength="${rules.NAME_MAX}" required aria-required="true"
            value="${escapeAttribute(site.name || '')}" aria-describedby="camp-site-name-error">
          <p class="field-error" id="camp-site-name-error" hidden></p>
        </div>
        ${IDENTITY_FIELDS.slice(0, ADDRESS_FIELDS).map((field) => control(field, site)).join('')}
        ${choice('province', 'camp_site_province', rules.PROVINCES, 'camp_site_province_', site.province)}
        ${IDENTITY_FIELDS.slice(ADDRESS_FIELDS).map((field) => control(field, site)).join('')}
      </fieldset>
      <fieldset>
        <legend>${escapeHTML(translate('camp_site_section_stay'))}</legend>
        ${choice('accommodation', 'camp_site_accommodation', rules.ACCOMMODATIONS, 'camp_site_accommodation_', site.accommodation)}
        ${control(['accommodation_note', 'camp_site_accommodation_note', 'text', rules.TEXT_MAX], site)}
        ${choice('heating', 'camp_site_heating', rules.HEATING, 'camp_site_heating_', site.heating)}
        ${control(['heating_note', 'camp_site_heating_note', 'text', rules.TEXT_MAX], site)}
        ${insurance(site)}
        ${control(['insurance_note', 'camp_site_insurance_note', 'textarea', rules.LONG_TEXT_MAX], site)}
      </fieldset>
      <fieldset>
        <legend>${escapeHTML(translate('camp_site_section_emergency'))}</legend>
        ${EMERGENCY_FIELDS.map((field) => control(field, site)).join('')}
        <p class="field-hint" id="camp-site-poison-hint">${escapeHTML(translate('camp_site_poison_hint'))}</p>
      </fieldset>
      <fieldset>
        <legend>${escapeHTML(translate('camp_site_section_directions'))}</legend>
        ${DIRECTION_FIELDS.map((field) => control(field, site)).join('')}
      </fieldset>
    </form>`;
}

/**
 * Read the form into what the API takes, or show what is wrong next to it.
 *
 * @param {HTMLFormElement} form
 * @returns {Object|null} The site, or null when a field needs correcting
 */
function readForm(form) {
  const value = (field) => fieldOf(form, field)?.value.trim() ?? '';
  const site = { name: value('name') };
  [...IDENTITY_FIELDS, ...EMERGENCY_FIELDS, ...DIRECTION_FIELDS,
    ['accommodation_note'], ['heating_note'], ['insurance_note']].forEach(([field, , kind]) => {
    if (kind === 'minutes' || kind === 'km') {
      const raw = value(field);
      site[field] = raw === '' ? null : Number(raw);
    } else {
      site[field] = value(field) || null;
    }
  });
  ['province', 'accommodation', 'heating'].forEach((field) => { site[field] = value(field) || null; });
  const insured = form.querySelector(`input[name="${nameOf('has_own_insurance')}"]:checked`)?.value || '';
  site.has_own_insurance = insured === '' ? null : insured === 'yes';

  const errors = {};
  if (!site.name) {
    errors.name = 'camp_site_name_required';
  }
  DIRECTION_FIELDS.forEach(([field]) => {
    if (site[field] && !URL_PATTERN.test(site[field])) {
      errors[field] = 'camp_site_invalid_url';
    }
  });
  if (site.hospital_travel_minutes !== null && (!Number.isInteger(site.hospital_travel_minutes)
    || site.hospital_travel_minutes < 0 || site.hospital_travel_minutes > rules.TRAVEL_MINUTES_MAX)) {
    errors.hospital_travel_minutes = 'camp_site_invalid_number';
  }
  if (site.hospital_distance_km !== null && (!Number.isFinite(site.hospital_distance_km)
    || site.hospital_distance_km < 0 || site.hospital_distance_km > rules.DISTANCE_KM_MAX)) {
    errors.hospital_distance_km = 'camp_site_invalid_number';
  }
  const fields = Object.keys(errors);
  fields.forEach((field) => showFieldError(form, field, translate(errors[field])));
  if (fields.length) {
    fieldOf(form, fields[0])?.focus();
    return null;
  }
  return site;
}

/** Show a message next to its field and tie it to the field. */
function showFieldError(form, field, message) {
  const input = fieldOf(form, field);
  const error = form.querySelector(`#${fieldId(field)}-error`);
  if (!input || !error || typeof input.setAttribute !== 'function') {
    return false;
  }
  error.textContent = message;
  error.hidden = false;
  error.setAttribute('role', 'alert');
  input.setAttribute('aria-invalid', 'true');
  return true;
}

/** Clear a field's message as soon as it changes. */
function clearFieldError(form, input) {
  const field = input.name?.startsWith('site_') ? input.name.slice('site_'.length) : '';
  if (!field) {
    return;
  }
  const error = form.querySelector(`#${fieldId(field)}-error`);
  if (error) {
    error.hidden = true;
    error.textContent = '';
    error.removeAttribute('role');
  }
  input.removeAttribute('aria-invalid');
}

/**
 * Open the site form in a dialog.
 *
 * @param {Object} app - Application instance (for messages)
 * @param {{site?: Object|null, onSaved?: Function}} [options] - The site to edit, or none to add one
 * @returns {{overlay: HTMLElement, close: Function}} The dialog
 */
export function openSiteForm(app, { site = null, onSaved = null } = {}) {
  const editing = Boolean(site?.id);
  let saving = false;
  const modal = openModal({
    id: 'camp-site-dialog',
    title: escapeHTML(translate(editing ? 'camp_site_edit' : 'camp_site_add')),
    body: formMarkup(site || {}),
    footer: `
      <button type="button" class="button button--secondary" data-modal-close>${escapeHTML(translate('cancel'))}</button>
      <button type="submit" form="${FORM_ID}" class="button button--primary">${escapeHTML(translate('save'))}</button>`,
    closeOnBackdrop: false,
    canClose: () => !saving,
  });
  const form = modal.overlay.querySelector(`#${FORM_ID}`);
  const failure = form.querySelector('#camp-site-form-error');

  form.addEventListener('input', (event) => clearFieldError(form, event.target));
  form.addEventListener('change', (event) => clearFieldError(form, event.target));
  fieldOf(form, 'province').addEventListener('change', (event) => {
    const poison = fieldOf(form, 'poison_centre_phone');
    if (!poison.value.trim()) {
      poison.value = suggestedPoisonCentre(event.target.value);
    }
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    failure.hidden = true;
    const input = readForm(form);
    if (!input) {
      return;
    }
    withFormBusy(form, async () => {
      saving = true;
      try {
        const response = editing
          ? await updateCampSite(site.id, { ...input, expected_version: site.version })
          : await createCampSite(input);
        saving = false;
        modal.close();
        app.showMessage(translate('camp_site_saved'), 'success');
        onSaved?.(response?.data || null);
      } catch (err) {
        saving = false;
        debugError('Failed to save the camp site:', err);
        const fieldErrors = Array.isArray(err?.errors) ? err.errors : [];
        const shown = fieldErrors.filter((entry) => showFieldError(form, entry.path, apiErrorMessage({ message: entry.msg }, 'camp_site_save_failed')));
        if (shown.length) {
          fieldOf(form, shown[0].path)?.focus();
          return;
        }
        failure.textContent = apiErrorMessage(err, 'camp_site_save_failed');
        failure.hidden = false;
      }
    });
  });
  return modal;
}
