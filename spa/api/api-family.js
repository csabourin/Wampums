/**
 * Parent API calls: registering one's own children, and sharing a family with
 * another parent.
 *
 * Read without the offline cache. Both screens show state that changes
 * elsewhere -- the other parent accepts, an admin re-enrolls a child -- and a
 * cached answer would show a request as still waiting after it was accepted.
 *
 * @module spa/api/api-family
 */

import { API } from './api-core.js';

/**
 * Where this parent stands: unit, year, their family's children, and whether
 * onboarding is still waiting on them.
 *
 * @returns {Promise<Object>} API response
 */
export function getOnboardingContext() {
  return API.getNoCache('v1/parent-onboarding/context');
}

/**
 * Register a child for this parent's family.
 *
 * @param {Object} child - `first_name`, `last_name`, `date_naissance`, and
 *   `confirm_similar` once the parent has confirmed a same-name child is different
 * @returns {Promise<Object>} API response
 */
export function registerChild(child) {
  return API.post('v1/parent-onboarding/children', child);
}

/**
 * Stop sending this parent back to onboarding after they sign in.
 *
 * @returns {Promise<Object>} API response
 */
export function completeOnboarding() {
  return API.post('v1/parent-onboarding/complete', {});
}

/**
 * This parent's family links and the requests they sent.
 *
 * @returns {Promise<Object>} API response
 */
export function getFamilyLinks() {
  return API.getNoCache('v1/family-links');
}

/**
 * Ask another parent to share this family.
 *
 * @param {string} email - The other parent's address
 * @returns {Promise<Object>} API response
 */
export function requestFamilyLink(email) {
  return API.post('v1/family-link-requests', { email });
}

/**
 * Send a fresh link for a request still waiting.
 *
 * @param {string} requestId - Request UUID
 * @returns {Promise<Object>} API response
 */
export function resendFamilyLinkRequest(requestId) {
  return API.post(`v1/family-link-requests/${requestId}/resend`, {});
}

/**
 * Withdraw a request before it is answered.
 *
 * @param {string} requestId - Request UUID
 * @returns {Promise<Object>} API response
 */
export function withdrawFamilyLinkRequest(requestId) {
  return API.post(`v1/family-link-requests/${requestId}/revoke`, {});
}

/**
 * Stop sharing with another parent.
 *
 * @param {number} linkId - Family link id
 * @returns {Promise<Object>} API response
 */
export function endFamilyLink(linkId) {
  return API.delete(`v1/family-links/${linkId}`);
}
