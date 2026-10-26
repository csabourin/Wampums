/**
 * API calls for equipment loans: who took which equipment home (tents and
 * tarps to dry after a camp) and recording what came back.
 *
 * Reads are cached so the handout still opens at the end of a camp without a
 * network. Handouts and returns may be queued offline: the server records a
 * replayed handout once (Idempotency-Key) and a return is a count, not an
 * increment.
 *
 * @module spa/api/api-equipment-loans
 */

import { API } from './api-core.js';
import { CONFIG } from '../config.js';

/**
 * The unit's loans.
 *
 * @param {{status?: 'open'|'returned'|'all', activity_id?: number}} [params]
 * @param {{forceRefresh?: boolean}} [options]
 * @returns {Promise<Object>} API response: `data.loans`
 */
export function getEquipmentLoans(params = {}, options = {}) {
  return API.get('v1/equipment-loans', params, { cacheDuration: CONFIG.CACHE_DURATION.SHORT, ...options });
}

/**
 * What the handout screen offers: activities around today, the equipment to
 * hand out, and the youths and leaders who may take it.
 *
 * @param {number|null} activityId - Activity whose reservations to hand out; none for all equipment
 * @param {{forceRefresh?: boolean}} [options]
 * @returns {Promise<Object>} API response: `data.activities`, `data.items`, `data.holders`
 */
export function getEquipmentHandout(activityId = null, options = {}) {
  const params = activityId ? { activity_id: activityId } : {};
  return API.get('v1/equipment-loans/handout', params, { cacheDuration: CONFIG.CACHE_DURATION.MEDIUM, ...options });
}

/**
 * Record a handout: loans of one or more items to youths or adults.
 *
 * @param {{activity_id?: number|null, reason: string, due_date?: string|null, loans: Array<Object>}} handout
 * @returns {Promise<Object>} API response, or `{ queued: true }` offline
 */
export function createEquipmentLoans(handout) {
  return API.post('v1/equipment-loans', handout);
}

/**
 * Record what came back of a loan, a note on its state, or a new due date.
 *
 * @param {number} loanId - Loan
 * @param {{returned_quantity?: number, return_note?: string|null, due_date?: string|null}} changes
 * @returns {Promise<Object>} API response, or `{ queued: true }` offline
 */
export function updateEquipmentLoan(loanId, changes) {
  return API.patch(`v1/equipment-loans/${encodeURIComponent(loanId)}`, changes);
}

/**
 * Remove a loan recorded by mistake.
 *
 * @param {number} loanId - Loan
 * @returns {Promise<Object>} API response
 */
export function deleteEquipmentLoan(loanId) {
  return API.delete(`v1/equipment-loans/${encodeURIComponent(loanId)}`);
}
