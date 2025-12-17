// api-carpools.js
// API client for carpool management
import { API } from './api-core.js';

/**
 * Get all carpool offers for an activity
 * @param {number} activityId - Activity ID
 * @returns {Promise<Array>} List of carpool offers
 */
export async function getCarpoolOffers(activityId) {
  const response = await API.get(`v1/carpools/activity/${activityId}`);
  return response.data || [];
}

/**
 * Get current user's carpool offers
 * @returns {Promise<Array>} List of user's carpool offers
 */
export async function getMyOffers() {
  const response = await API.get('v1/carpools/my-offers');
  return response.data || [];
}

/**
 * Create a new carpool offer
 * @param {Object} offerData - Carpool offer data
 * @returns {Promise<Object>} Created offer
 */
export async function createCarpoolOffer(offerData) {
  const response = await API.post('v1/carpools/offers', offerData);
  return response.data;
}

/**
 * Update a carpool offer
 * @param {number} offerId - Offer ID
 * @param {Object} offerData - Updated offer data
 * @returns {Promise<Object>} Updated offer
 */
export async function updateCarpoolOffer(offerId, offerData) {
  const response = await API.put(`v1/carpools/offers/${offerId}`, offerData);
  return response.data;
}

/**
 * Cancel a carpool offer
 * @param {number} offerId - Offer ID
 * @param {string} reason - Cancellation reason
 * @returns {Promise<void>}
 */
export async function cancelCarpoolOffer(offerId, reason = '') {
  await API.delete(`v1/carpools/offers/${offerId}`, { reason });
}

/**
 * Assign a participant to a carpool
 * @param {Object} assignmentData - Assignment data
 * @returns {Promise<Object>} Created assignment
 */
export async function assignParticipantToCarpool(assignmentData) {
  const response = await API.post('v1/carpools/assignments', assignmentData);
  return response.data;
}

/**
 * Remove a participant from a carpool assignment
 * @param {number} assignmentId - Assignment ID
 * @returns {Promise<void>}
 */
export async function removeAssignment(assignmentId) {
  await API.delete(`v1/carpools/assignments/${assignmentId}`);
}

/**
 * Get carpool assignments for current user's children
 * @returns {Promise<Array>} List of assignments
 */
export async function getMyChildrenAssignments() {
  const response = await API.get('v1/carpools/my-children-assignments');
  return response.data || [];
}

/**
 * Get unassigned participants for an activity (animation only)
 * @param {number} activityId - Activity ID
 * @returns {Promise<Array>} List of unassigned participants
 */
export async function getUnassignedParticipants(activityId) {
  const response = await API.get(`v1/carpools/activity/${activityId}/unassigned`);
  return response.data || [];
}
