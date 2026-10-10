/**
 * Membership of people in the current unit.
 *
 * @module api/api-members
 */

import { API } from './api-core.js';

/**
 * Deactivate or reactivate a member of the current unit, such as a leader who
 * stepped down. Their account, roles and history are kept.
 *
 * @param {string} userId - Member UUID
 * @param {'active'|'inactive'} status - New membership status
 * @param {string} [reason] - Optional reason, kept with a deactivation
 * @returns {Promise<Object>} API response
 */
export function setUserMembershipStatus(userId, status, reason) {
  const payload = reason ? { status, reason } : { status };
  return API.patch(`v1/users/${userId}/membership`, payload);
}
