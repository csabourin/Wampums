// api-activities.js
// API client for activities and event calendar management
import { API } from './api-core.js';
import { clearActivityRelatedCaches } from '../indexedDB.js';

/**
 * Get all activities for the organization
 * @returns {Promise<Array>} List of activities
 */
export async function getActivities() {
  const response = await API.get('v1/activities');
  return response.data || [];
}

/**
 * Get a specific activity by ID
 * @param {number} activityId - Activity ID
 * @returns {Promise<Object>} Activity details
 */
export async function getActivity(activityId) {
  const response = await API.get(`v1/activities/${activityId}`);
  return response.data;
}

/**
 * Create a new activity
 * @param {Object} activityData - Activity data
 * @returns {Promise<Object>} Created activity
 */
export async function createActivity(activityData) {
  const response = await API.post('v1/activities', activityData);
  // Invalidate activity caches to ensure fresh data
  await clearActivityRelatedCaches();
  return response.data;
}

/**
 * Update an existing activity
 * @param {number} activityId - Activity ID
 * @param {Object} activityData - Updated activity data
 * @returns {Promise<Object>} Updated activity
 */
export async function updateActivity(activityId, activityData) {
  const response = await API.put(`v1/activities/${activityId}`, activityData);
  // Invalidate activity caches to ensure fresh data
  await clearActivityRelatedCaches();
  return response.data;
}

/**
 * Delete an activity
 * @param {number} activityId - Activity ID
 * @returns {Promise<void>}
 */
export async function deleteActivity(activityId) {
  await API.delete(`v1/activities/${activityId}`);
  // Invalidate activity caches to ensure fresh data
  await clearActivityRelatedCaches();
}

/**
 * Get all participants for an activity (for carpool assignment)
 * @param {number} activityId - Activity ID
 * @returns {Promise<Array>} List of participants with carpool status
 */
export async function getActivityParticipants(activityId) {
  const response = await API.get(`v1/activities/${activityId}/participants`);
  return response.data || [];
}
