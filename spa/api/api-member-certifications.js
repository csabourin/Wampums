/**
 * Adult certifications (#1319): what a member declares for themselves, and what a manager of
 * volunteers reads before verifying it. Reads are always fresh; a declaration needs a connection
 * and is never queued (CONFIG.ONLINE_REQUIRED_MUTATION_RESOURCES).
 *
 * @module spa/api/api-member-certifications
 */
import { API } from './api-core.js';

/** @returns {Promise<Object>} Each certification with what one declared and what was verified */
export function getMyCertifications() {
  return API.getNoCache('v1/member-certifications/me');
}

/**
 * @param {Object<string, {obtained_on: string, valid_until: string|null}>} declared - The complete set
 * @returns {Promise<Object>} The certifications as they now are
 */
export function saveMyCertifications(declared) {
  return API.put('v1/member-certifications/me', { declared });
}

/**
 * @param {string} userId - UUID of a member of the unit
 * @returns {Promise<Object>} Their certifications, for the manager verifying them
 */
export function getMemberCertifications(userId) {
  return API.getNoCache(`v1/member-certifications/${encodeURIComponent(userId)}`);
}
