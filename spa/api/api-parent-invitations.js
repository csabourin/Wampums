/**
 * Administrator API calls for parent invitations and duplicate review.
 *
 * Lists are read without the offline cache: an invitation's state changes
 * outside this screen (a parent accepts, a link expires), and a cached list
 * would show a sent invitation as still waiting.
 *
 * @module spa/api/api-parent-invitations
 */

import { API } from './api-core.js';

/**
 * Every invitation this unit has issued.
 *
 * @returns {Promise<Object>} API response
 */
export function getParentInvitations() {
  return API.getNoCache('v1/parent-invitations');
}

/**
 * Invite a parent.
 *
 * @param {Object} invitation - Address, optional prefill, and the language to write in
 * @returns {Promise<Object>} API response
 */
export function createParentInvitation(invitation) {
  return API.post('v1/parent-invitations', invitation);
}

/**
 * Send a fresh link; the previous one stops working.
 *
 * @param {string} invitationId - Invitation UUID
 * @returns {Promise<Object>} API response
 */
export function resendParentInvitation(invitationId) {
  return API.post(`v1/parent-invitations/${invitationId}/resend`, {});
}

/**
 * Withdraw an invitation.
 *
 * @param {string} invitationId - Invitation UUID
 * @returns {Promise<Object>} API response
 */
export function revokeParentInvitation(invitationId) {
  return API.post(`v1/parent-invitations/${invitationId}/revoke`, {});
}

/**
 * Pairs of records that may be one child.
 *
 * @param {Object} [options] - Options
 * @param {boolean} [options.all] - Include pairs already decided
 * @returns {Promise<Object>} API response
 */
export function getParticipantDuplicates({ all = false } = {}) {
  return API.getNoCache('v1/participant-duplicates', all ? { all: 'true' } : {});
}

/**
 * Record whether a pair is one child or two.
 *
 * @param {number} candidateId - Candidate id
 * @param {string} decision - `same_person` or `different`
 * @param {string|null} [note] - Why
 * @returns {Promise<Object>} API response
 */
export function resolveParticipantDuplicate(candidateId, decision, note = null) {
  return API.post(`v1/participant-duplicates/${candidateId}/resolve`, { decision, note });
}
