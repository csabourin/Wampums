/**
 * API calls for walk-in children: a child entered at a meeting before their
 * family has an account, and the invitation that brings the parent in.
 *
 * Read without the offline cache: the list shrinks as parents accept, which
 * happens elsewhere, and a cached copy would show a child still waiting.
 *
 * @module spa/api/api-walk-in
 */

import { API } from './api-core.js';
import {
  clearBadgeRelatedCaches,
  clearCachedApiPaths,
  clearGroupRelatedCaches,
} from '../indexedDB.js';

/**
 * This year's children no account can see, with the invitation each is waiting on.
 *
 * @returns {Promise<Object>} API response
 */
export function getWalkInChildren() {
  return API.getNoCache('v1/walk-in-children');
}

/**
 * Enter a walk-in child and invite their parent.
 *
 * The child joins the roster at once, so every cached roster -- attendance,
 * points, badges, the participant lists -- is dropped; otherwise the leader
 * turns to attendance and the child is not there.
 *
 * @param {Object} child - `first_name`, `last_name`, `date_naissance`, `parent_email`,
 *   `language`, and `confirm_reactivation` / `reactivation_reason` when reinstating
 * @returns {Promise<Object>} API response
 */
export async function addWalkInChild(child) {
  const result = await API.post('v1/walk-in-children', child);
  await Promise.all([
    clearGroupRelatedCaches(),
    clearBadgeRelatedCaches(),
    clearCachedApiPaths(['v1/participants', 'v1/attendance']),
  ]);
  return result;
}

/**
 * Invite a parent for a child already on the roster, or correct the address.
 *
 * @param {number} participantId - Child
 * @param {Object} parent - `parent_email`, `language`, and the reinstatement fields
 * @returns {Promise<Object>} API response
 */
export function inviteParentForChild(participantId, parent) {
  return API.post(`v1/walk-in-children/${participantId}/invite`, parent);
}

/**
 * Send a fresh link for an invitation sent for a child.
 *
 * @param {string} invitationId - Invitation UUID
 * @returns {Promise<Object>} API response
 */
export function resendWalkInInvitation(invitationId) {
  return API.post(`v1/walk-in-children/invitations/${invitationId}/resend`, {});
}
