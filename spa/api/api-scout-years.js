// api-scout-years.js
// API client for scout year management and the end-of-year transition
import { API } from './api-core.js';

/**
 * List the organization's scout years, most recent first.
 *
 * @param {Object} [options] - Cache options forwarded to API.get
 * @returns {Promise<Array<Object>>} Scout years with enrollment counts
 */
export async function getScoutYears(options = {}) {
  const response = await API.get('v1/scout-years', {}, options);
  return response.data || [];
}

/**
 * Get the active scout year.
 *
 * @returns {Promise<Object>} Active scout year
 */
export async function getActiveScoutYear() {
  const response = await API.getNoCache('v1/scout-years/active');
  return response.data;
}

/**
 * Preview the next transition. Changes nothing on the server.
 *
 * @param {Array<number>} [graduatingIds] - Override the age rule, so the list of
 *   affected parent accounts reflects the choices the leader actually made
 * @returns {Promise<Object>} Proposed dispositions, affected memberships and counts
 */
export async function getTransitionPreview(graduatingIds) {
  const params = Array.isArray(graduatingIds)
    ? { graduating_ids: graduatingIds.join(',') }
    : {};
  const response = await API.getNoCache('v1/scout-years/transition/preview', params);
  return response.data;
}

/**
 * Execute the year transition.
 *
 * @param {Object} payload - Confirmed choices
 * @param {Array<number>} payload.graduating_participant_ids - Participants leaving the section
 * @param {Array<number>} payload.deactivate_membership_ids - Memberships to deactivate
 * @param {Array<{participant_id: number, note: string}>} [payload.exceptions] - Notes for participants kept despite the age rule
 * @returns {Promise<Object>} Transition summary
 */
export async function executeTransition(payload) {
  const response = await API.post('v1/scout-years/transition', payload);
  return response.data;
}

/**
 * List active memberships that no longer have an enrolled child.
 *
 * @returns {Promise<Array<Object>>} Candidate memberships
 */
export async function getMembershipsWithoutChild() {
  const response = await API.getNoCache('v1/scout-years/memberships/without-child');
  return response.data || [];
}

/**
 * Change a membership status.
 *
 * Deactivating keeps the account, its links and its history; the user simply
 * loses access to the unit.
 *
 * @param {number} membershipId - Membership ID
 * @param {string} status - 'active', 'inactive' or 'alumni'
 * @param {string} [reason] - Optional reason recorded with the change
 * @returns {Promise<Object>} Updated membership
 */
export async function setMembershipStatus(membershipId, status, reason) {
  const response = await API.patch(
    `v1/scout-years/memberships/${membershipId}/status`,
    { status, reason }
  );
  return response.data;
}
