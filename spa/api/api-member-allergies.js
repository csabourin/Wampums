/**
 * Adults' allergies (#1319): what a member declares about their own allergies. Reads are always
 * fresh; writes need a connection and are never queued (CONFIG.ONLINE_REQUIRED_MUTATION_RESOURCES).
 *
 * @module spa/api/api-member-allergies
 */
import { API } from './api-core.js';

/** @returns {Promise<Object>} One's declaration, or null data when none */
export function getMyAllergies() {
  return API.getNoCache('v1/member-allergies/me');
}

/**
 * @param {{allergies: string, carries_epipen: boolean, person_to_notify: string|null}} declaration
 * @returns {Promise<Object>} The declaration as recorded
 */
export function saveMyAllergies(declaration) {
  return API.put('v1/member-allergies/me', declaration);
}

/** @returns {Promise<Object>} Confirmation that one's declaration is withdrawn */
export function removeMyAllergies() {
  return API.delete('v1/member-allergies/me');
}
