// api-alumni.js
// API client for the alumni audience: who may still be asked to stay in touch,
// and asking them.
//
// The two links in the invitation email are deliberately absent from this file.
// They are answered without a session by `spa/modules/alumni/AlumniLink.js`,
// which calls the public endpoints directly rather than through the
// authenticated client.
import { API } from './api-core.js';

/**
 * Departed families that have not yet been invited.
 *
 * @returns {Promise<Array<Object>>} Candidate memberships
 */
export async function getAlumniCandidates() {
  const response = await API.getNoCache('v1/alumni/candidates');
  return response.data || [];
}

/**
 * Families who accepted.
 *
 * @returns {Promise<Array<Object>>} Alumni memberships
 */
export async function getAlumni() {
  const response = await API.getNoCache('v1/alumni');
  return response.data || [];
}

/**
 * Send the opt-in email.
 *
 * @param {Array<number>} [membershipIds] - Restrict to these memberships; omit
 *   to invite every eligible candidate
 * @returns {Promise<{invited: number, failed: number, skipped: number}>} Outcome
 */
export async function sendAlumniInvitations(membershipIds) {
  const response = await API.post('v1/alumni/invitations', {
    membership_ids: Array.isArray(membershipIds) ? membershipIds : undefined
  });
  return response.data;
}
