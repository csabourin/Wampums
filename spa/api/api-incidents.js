// api-incidents.js
// API client for incident/accident reports and escalation contacts
import { API } from './api-core.js';
import { deleteCachedData } from '../indexedDB.js';

/**
 * Invalidate incident-related caches
 */
async function invalidateIncidentCaches() {
  try {
    await deleteCachedData('incident_reports');
  } catch (e) {
    // Ignore cache invalidation failures
  }
}

/**
 * Get all incident reports for the organization
 * @param {Object} options - Cache options forwarded to API.get
 * @param {boolean} options.forceRefresh - Force refresh from server
 * @param {string} options.status - Filter by status ('draft' or 'submitted')
 * @returns {Promise<Array>} List of incident reports
 */
export async function getIncidentReports(options = {}) {
  const params = {};
  if (options.status) {
    params.status = options.status;
  }
  const response = await API.get('v1/incidents', params, options);
  return response.data || [];
}

/**
 * Get a single incident report with full form data
 * @param {number} id - Incident report ID
 * @returns {Promise<Object>} Incident report details
 */
export async function getIncidentReport(id) {
  const response = await API.get(`v1/incidents/${id}`);
  return response.data;
}

/**
 * Create a new draft incident report
 * @param {Object} data - { victim_type, victim_participant_id, victim_user_id, victim_name, activity_id, form_data }
 * @returns {Promise<Object>} Created incident report
 */
export async function createIncidentReport(data) {
  const response = await API.post('v1/incidents', data);
  await invalidateIncidentCaches();
  return response.data;
}

/**
 * Update a draft incident report
 * @param {number} id - Incident report ID
 * @param {Object} data - Updated data
 * @returns {Promise<Object>} Updated incident report
 */
export async function updateIncidentReport(id, data) {
  const response = await API.patch(`v1/incidents/${id}`, data);
  await invalidateIncidentCaches();
  return response.data;
}

/**
 * Delete a draft incident report
 * @param {number} id - Incident report ID
 * @returns {Promise<void>}
 */
export async function deleteIncidentReport(id) {
  await API.delete(`v1/incidents/${id}`);
  await invalidateIncidentCaches();
}

/**
 * Submit a draft report (transitions to 'submitted' and triggers escalation)
 * @param {number} id - Incident report ID
 * @returns {Promise<Object>} { id, status, escalation_sent_to }
 */
export async function submitIncidentReport(id) {
  const response = await API.post(`v1/incidents/${id}/submit`);
  await invalidateIncidentCaches();
  return response.data;
}

/**
 * Get pre-fill data from a participant record
 * @param {number} participantId - Participant ID
 * @returns {Promise<Object>} Form field values to pre-fill
 */
export async function getIncidentPrefillParticipant(participantId) {
  const response = await API.get(`v1/incidents/prefill/participant/${participantId}`);
  return response.data;
}

/**
 * Get pre-fill data from a user record (for leader/parent victims)
 * @param {string} userId - User UUID
 * @returns {Promise<Object>} Form field values to pre-fill
 */
export async function getIncidentPrefillUser(userId) {
  const response = await API.get(`v1/incidents/prefill/user/${userId}`);
  return response.data;
}

/**
 * Get pre-fill data from an activity record
 * @param {number} activityId - Activity ID
 * @returns {Promise<Object>} Form field values to pre-fill
 */
export async function getIncidentPrefillActivity(activityId) {
  const response = await API.get(`v1/incidents/prefill/activity/${activityId}`);
  return response.data;
}

/**
 * Get escalation contacts for the organization
 * @returns {Promise<Array>} List of escalation contacts
 */
export async function getEscalationContacts() {
  const response = await API.get('v1/incidents/escalation-contacts');
  return response.data || [];
}

/**
 * Add a new escalation contact
 * @param {Object} data - { email, name, role_description }
 * @returns {Promise<Object>} Created contact
 */
export async function addEscalationContact(data) {
  const response = await API.post('v1/incidents/escalation-contacts', data);
  return response.data;
}

/**
 * Update an escalation contact
 * @param {number} id - Contact ID
 * @param {Object} data - Updated data
 * @returns {Promise<Object>} Updated contact
 */
export async function updateEscalationContact(id, data) {
  const response = await API.patch(`v1/incidents/escalation-contacts/${id}`, data);
  return response.data;
}

/**
 * Delete an escalation contact
 * @param {number} id - Contact ID
 * @returns {Promise<void>}
 */
export async function deleteEscalationContact(id) {
  await API.delete(`v1/incidents/escalation-contacts/${id}`);
}
