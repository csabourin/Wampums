/**
 * API Endpoints for Wampums React Native App
 *
 * Mirrors spa/api/api-endpoints.js functionality
 * Provides wrapper functions for all backend API endpoints
 * All functions follow the pattern: async function(params) => Promise<Response>
 *
 * Response format: { success: boolean, message?: string, data?: any, timestamp?: string }
 */

import API from './api-core';
import CONFIG from '../config';

/**
 * ============================================================================
 * AUTHENTICATION & SESSION
 * ============================================================================
 */

/**
 * Login with email and password
 */
export const login = async (email, password, organizationId) => {
  return API.public(CONFIG.ENDPOINTS.LOGIN, {
    email,
    password,
    organizationId,
  }, 'POST');
};

/**
 * Verify 2FA code
 */
export const verify2FA = async (email, code, trustDevice = false) => {
  return API.public(CONFIG.ENDPOINTS.VERIFY_2FA, {
    email,
    code,
    trustDevice,
  }, 'POST');
};

/**
 * Logout
 */
export const logout = async () => {
  return API.post(CONFIG.ENDPOINTS.LOGOUT);
};

/**
 * Register new account
 */
export const register = async (userData) => {
  return API.public(CONFIG.ENDPOINTS.REGISTER, userData, 'POST');
};

/**
 * Request password reset
 */
export const requestPasswordReset = async (email) => {
  return API.public(CONFIG.ENDPOINTS.REQUEST_RESET, { email }, 'POST');
};

/**
 * Reset password with token
 */
export const resetPassword = async (token, newPassword) => {
  return API.public(CONFIG.ENDPOINTS.RESET_PASSWORD, {
    token,
    newPassword,
  }, 'POST');
};

/**
 * Verify session
 */
export const verifySession = async () => {
  return API.post(CONFIG.ENDPOINTS.VERIFY_SESSION);
};

/**
 * Refresh token
 */
export const refreshToken = async () => {
  return API.post(CONFIG.ENDPOINTS.REFRESH_TOKEN);
};

/**
 * ============================================================================
 * ORGANIZATION
 * ============================================================================
 */

/**
 * Get organization ID by hostname or slug
 */
export const getOrganizationId = async (hostname) => {
  return API.public(CONFIG.ENDPOINTS.GET_ORGANIZATION_ID, { hostname });
};

/**
 * Get organization settings
 */
export const getOrganizationSettings = async () => {
  return API.get(CONFIG.ENDPOINTS.ORGANIZATION_SETTINGS);
};

/**
 * Switch organization
 */
export const switchOrganization = async (organizationId) => {
  return API.post(CONFIG.ENDPOINTS.SWITCH_ORGANIZATION, { organizationId });
};

/**
 * ============================================================================
 * ACTIVITIES (V1)
 * ============================================================================
 */

/**
 * Get all activities
 */
export const getActivities = async () => {
  return API.get(`${CONFIG.ENDPOINTS.ACTIVITIES}`);
};

/**
 * Get activity by ID
 */
export const getActivity = async (id) => {
  return API.get(`${CONFIG.ENDPOINTS.ACTIVITIES}/${id}`);
};

/**
 * Create activity
 */
export const createActivity = async (activityData) => {
  return API.post(CONFIG.ENDPOINTS.ACTIVITIES, activityData);
};

/**
 * Update activity
 */
export const updateActivity = async (id, activityData) => {
  return API.put(`${CONFIG.ENDPOINTS.ACTIVITIES}/${id}`, activityData);
};

/**
 * Delete activity
 */
export const deleteActivity = async (id) => {
  return API.delete(`${CONFIG.ENDPOINTS.ACTIVITIES}/${id}`);
};

/**
 * Get activity participants
 */
export const getActivityParticipants = async (id) => {
  return API.get(`${CONFIG.ENDPOINTS.ACTIVITIES}/${id}/participants`);
};

/**
 * ============================================================================
 * PARTICIPANTS (V1)
 * ============================================================================
 */

/**
 * Get all participants
 */
export const getParticipants = async () => {
  return API.get(CONFIG.ENDPOINTS.PARTICIPANTS);
};

/**
 * Get participant by ID
 */
export const getParticipant = async (id) => {
  return API.get(`${CONFIG.ENDPOINTS.PARTICIPANTS}/${id}`);
};

/**
 * Create participant
 */
export const createParticipant = async (participantData) => {
  return API.post(CONFIG.ENDPOINTS.PARTICIPANTS, participantData);
};

/**
 * Update participant
 */
export const updateParticipant = async (id, participantData) => {
  return API.put(`${CONFIG.ENDPOINTS.PARTICIPANTS}/${id}`, participantData);
};

/**
 * Delete participant
 */
export const deleteParticipant = async (id) => {
  return API.delete(`${CONFIG.ENDPOINTS.PARTICIPANTS}/${id}`);
};

/**
 * ============================================================================
 * CARPOOLS (V1)
 * ============================================================================
 */

/**
 * Get carpool offers for activity
 */
export const getCarpoolOffers = async (activityId) => {
  return API.get(`${CONFIG.ENDPOINTS.CARPOOLS}/activity/${activityId}`);
};

/**
 * Get unassigned participants for carpool
 */
export const getUnassignedParticipants = async (activityId) => {
  return API.get(`${CONFIG.ENDPOINTS.CARPOOLS}/activity/${activityId}/unassigned`);
};

/**
 * Create carpool offer
 */
export const createCarpoolOffer = async (offerData) => {
  return API.post(`${CONFIG.ENDPOINTS.CARPOOLS}/offers`, offerData);
};

/**
 * Assign participant to carpool
 */
export const assignParticipantToCarpool = async (assignmentData) => {
  return API.post(`${CONFIG.ENDPOINTS.CARPOOLS}/assignments`, assignmentData);
};

/**
 * Get my carpool offers
 */
export const getMyCarpoolOffers = async () => {
  return API.get(`${CONFIG.ENDPOINTS.CARPOOLS}/my-offers`);
};

/**
 * Get my children's carpool assignments
 */
export const getMyChildrenAssignments = async () => {
  return API.get(`${CONFIG.ENDPOINTS.CARPOOLS}/my-children-assignments`);
};

/**
 * ============================================================================
 * ATTENDANCE (V1)
 * ============================================================================
 */

/**
 * Get attendance records
 */
export const getAttendance = async (params) => {
  return API.get(CONFIG.ENDPOINTS.ATTENDANCE, params);
};

/**
 * Create attendance record
 */
export const createAttendance = async (attendanceData) => {
  return API.post(CONFIG.ENDPOINTS.ATTENDANCE, attendanceData);
};

/**
 * Update attendance record
 */
export const updateAttendance = async (id, attendanceData) => {
  return API.put(`${CONFIG.ENDPOINTS.ATTENDANCE}/${id}`, attendanceData);
};

/**
 * Get attendance dates
 */
export const getAttendanceDates = async () => {
  return API.get(`${CONFIG.ENDPOINTS.ATTENDANCE}/dates`);
};

/**
 * ============================================================================
 * GROUPS (V1)
 * ============================================================================
 */

/**
 * Get all groups
 */
export const getGroups = async () => {
  return API.get(CONFIG.ENDPOINTS.GROUPS);
};

/**
 * Create group
 */
export const createGroup = async (groupData) => {
  return API.post(CONFIG.ENDPOINTS.GROUPS, groupData);
};

/**
 * Update group
 */
export const updateGroup = async (id, groupData) => {
  return API.put(`${CONFIG.ENDPOINTS.GROUPS}/${id}`, groupData);
};

/**
 * Delete group
 */
export const deleteGroup = async (id) => {
  return API.delete(`${CONFIG.ENDPOINTS.GROUPS}/${id}`);
};

/**
 * ============================================================================
 * FINANCE (V1)
 * ============================================================================
 */

/**
 * Get fee definitions
 */
export const getFeeDefinitions = async () => {
  return API.get(`${CONFIG.ENDPOINTS.FINANCE}/fee-definitions`);
};

/**
 * Create fee definition
 */
export const createFeeDefinition = async (feeData) => {
  return API.post(`${CONFIG.ENDPOINTS.FINANCE}/fee-definitions`, feeData);
};

/**
 * Get participant fees
 */
export const getParticipantFees = async (participantId = null) => {
  const endpoint = participantId
    ? `${CONFIG.ENDPOINTS.FINANCE}/participant-fees?participantId=${participantId}`
    : `${CONFIG.ENDPOINTS.FINANCE}/participant-fees`;
  return API.get(endpoint);
};

/**
 * Get finance summary report
 */
export const getFinanceSummary = async () => {
  return API.get(`${CONFIG.ENDPOINTS.FINANCE}/reports/summary`);
};

/**
 * ============================================================================
 * BUDGET (V1)
 * ============================================================================
 */

/**
 * Get budget categories
 */
export const getBudgetCategories = async () => {
  return API.get(`${CONFIG.ENDPOINTS.BUDGET}/categories`);
};

/**
 * Get budget items
 */
export const getBudgetItems = async () => {
  return API.get(`${CONFIG.ENDPOINTS.BUDGET}/items`);
};

/**
 * Get budget plans
 */
export const getBudgetPlans = async () => {
  return API.get(`${CONFIG.ENDPOINTS.BUDGET}/plans`);
};

/**
 * Get budget expenses
 */
export const getBudgetExpenses = async (params) => {
  return API.get(`${CONFIG.ENDPOINTS.BUDGET}/expenses`, params);
};

/**
 * ============================================================================
 * EXPENSES (V1)
 * ============================================================================
 */

/**
 * Get monthly expenses
 */
export const getMonthlyExpenses = async (year, month) => {
  return API.get(`${CONFIG.ENDPOINTS.EXPENSES}/monthly`, { year, month });
};

/**
 * Get expense summary
 */
export const getExpenseSummary = async () => {
  return API.get(`${CONFIG.ENDPOINTS.EXPENSES}/summary`);
};

/**
 * Create bulk expenses
 */
export const createBulkExpenses = async (expenses) => {
  return API.post(`${CONFIG.ENDPOINTS.EXPENSES}/bulk`, { expenses });
};

/**
 * ============================================================================
 * MEDICATION (V1)
 * ============================================================================
 */

/**
 * Get medication requirements
 */
export const getMedicationRequirements = async () => {
  return API.get(`${CONFIG.ENDPOINTS.MEDICATION}/requirements`);
};

/**
 * Get participant medications
 */
export const getParticipantMedications = async (participantId) => {
  return API.get(`${CONFIG.ENDPOINTS.MEDICATION}/participant-medications`, { participantId });
};

/**
 * Get medication distributions
 */
export const getMedicationDistributions = async (params) => {
  return API.get(`${CONFIG.ENDPOINTS.MEDICATION}/distributions`, params);
};

/**
 * ============================================================================
 * RESOURCES (V1)
 * ============================================================================
 */

/**
 * Get equipment list
 */
export const getEquipment = async () => {
  return API.get(`${CONFIG.ENDPOINTS.RESOURCES}/equipment`);
};

/**
 * Get equipment reservations
 */
export const getEquipmentReservations = async () => {
  return API.get(`${CONFIG.ENDPOINTS.RESOURCES}/equipment/reservations`);
};

/**
 * Create equipment reservation
 */
export const createEquipmentReservation = async (reservationData) => {
  return API.post(`${CONFIG.ENDPOINTS.RESOURCES}/equipment/reservations`, reservationData);
};

/**
 * Get permission slips
 */
export const getPermissionSlips = async () => {
  return API.get(`${CONFIG.ENDPOINTS.RESOURCES}/permission-slips`);
};

/**
 * Get permission slip for viewing (public)
 */
export const viewPermissionSlip = async (id) => {
  return API.public(`${CONFIG.ENDPOINTS.RESOURCES}/permission-slips/${id}/view`);
};

/**
 * ============================================================================
 * USERS & ROLES (V1)
 * ============================================================================
 */

/**
 * Get all users
 */
export const getUsers = async () => {
  return API.get(CONFIG.ENDPOINTS.USERS);
};

/**
 * Get all roles
 */
export const getRoles = async () => {
  return API.get(CONFIG.ENDPOINTS.ROLES);
};

/**
 * Get role bundles
 */
export const getRoleBundles = async () => {
  return API.get(`${CONFIG.ENDPOINTS.ROLES}/bundles`);
};

/**
 * ============================================================================
 * PUSH NOTIFICATIONS (V1)
 * ============================================================================
 */

/**
 * Register push subscription
 */
export const registerPushSubscription = async (subscriptionData) => {
  return API.post(CONFIG.ENDPOINTS.PUSH_SUBSCRIPTION, subscriptionData);
};

/**
 * ============================================================================
 * STRIPE PAYMENTS (V1)
 * ============================================================================
 */

/**
 * Create payment intent
 */
export const createPaymentIntent = async (amount, currency = 'cad') => {
  return API.post(`${CONFIG.ENDPOINTS.STRIPE}/create-payment-intent`, {
    amount,
    currency,
  });
};

/**
 * ============================================================================
 * TRANSLATIONS
 * ============================================================================
 */

/**
 * Get translations
 */
export const getTranslations = async (lang = 'fr') => {
  return API.get(CONFIG.ENDPOINTS.TRANSLATIONS, { lang });
};

/**
 * Create or update translation
 */
export const saveTranslation = async (translationData) => {
  return API.post(CONFIG.ENDPOINTS.TRANSLATIONS, translationData);
};

/**
 * ============================================================================
 * INITIAL DATA
 * ============================================================================
 */

/**
 * Get initial data for app
 */
export const getInitialData = async () => {
  return API.get(CONFIG.ENDPOINTS.INITIAL_DATA);
};

export default {
  // Auth
  login,
  verify2FA,
  logout,
  register,
  requestPasswordReset,
  resetPassword,
  verifySession,
  refreshToken,
  // Organization
  getOrganizationId,
  getOrganizationSettings,
  switchOrganization,
  // Activities
  getActivities,
  getActivity,
  createActivity,
  updateActivity,
  deleteActivity,
  getActivityParticipants,
  // Participants
  getParticipants,
  getParticipant,
  createParticipant,
  updateParticipant,
  deleteParticipant,
  // Carpools
  getCarpoolOffers,
  getUnassignedParticipants,
  createCarpoolOffer,
  assignParticipantToCarpool,
  getMyCarpoolOffers,
  getMyChildrenAssignments,
  // Attendance
  getAttendance,
  createAttendance,
  updateAttendance,
  getAttendanceDates,
  // Groups
  getGroups,
  createGroup,
  updateGroup,
  deleteGroup,
  // Finance
  getFeeDefinitions,
  createFeeDefinition,
  getParticipantFees,
  getFinanceSummary,
  // Budget
  getBudgetCategories,
  getBudgetItems,
  getBudgetPlans,
  getBudgetExpenses,
  // Expenses
  getMonthlyExpenses,
  getExpenseSummary,
  createBulkExpenses,
  // Medication
  getMedicationRequirements,
  getParticipantMedications,
  getMedicationDistributions,
  // Resources
  getEquipment,
  getEquipmentReservations,
  createEquipmentReservation,
  getPermissionSlips,
  viewPermissionSlip,
  // Users & Roles
  getUsers,
  getRoles,
  getRoleBundles,
  // Push
  registerPushSubscription,
  // Payments
  createPaymentIntent,
  // Translations
  getTranslations,
  saveTranslation,
  // Initial Data
  getInitialData,
};
