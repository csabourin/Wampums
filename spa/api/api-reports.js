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
