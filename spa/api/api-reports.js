/**
 * Report endpoints read by the report screens.
 *
 * @module spa/api/api-reports
 */
import { API } from './api-core.js';

/**
 * How long each youth has been with the unit.
 *
 * @param {{forceRefresh?: boolean}} [options] - Cache options
 * @returns {Promise<Object>} `{ success, data: [...] }`
 */
export function getTimeSinceRegistration(options = {}) {
  return API.get('v1/reports/time-since-registration', {}, options);
}

/**
 * Every submission of one form in the unit, with each youth's name.
 *
 * @param {string} formType - The form, e.g. `fiche_sante`
 * @returns {Promise<Object>} `{ success, data: [{ participant_id, first_name, last_name, submission_data }] }`
 */
export function getFormSubmissionsByType(formType) {
  return API.getNoCache('v1/forms/submissions/list', { form_type: formType });
}

/**
 * The unit's structure of one form: its fields, which are required, and
 * which depend on another answer.
 *
 * @param {string} formType - The form, e.g. `fiche_sante`
 * @returns {Promise<Object>} `{ success, data: { fields: [...] } }`
 */
export function getFormStructureByType(formType) {
  return API.get(`v1/forms/structure/${encodeURIComponent(formType)}`);
}
