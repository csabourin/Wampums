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
 * Save guest for attendance
 */
export const saveGuest = async (guestData) => {
  return API.post('/save-guest', guestData);
};

/**
 * Get guests by date
 */
export const getGuestsByDate = async (date) => {
  return API.get('/guests-by-date', { date });
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
 * POINTS (Legacy)
 * ============================================================================
 */

/**
 * Update points for participants or groups
 */
export const updatePoints = async (updates) => {
  return API.post(CONFIG.ENDPOINTS.UPDATE_POINTS, updates);
};

/**
 * Get points report
 */
export const getPointsReport = async () => {
  return API.get(CONFIG.ENDPOINTS.POINTS_REPORT);
};

/**
 * Get points leaderboard
 */
export const getPointsLeaderboard = async (type = 'individuals', limit = 10) => {
  return API.get(CONFIG.ENDPOINTS.POINTS_LEADERBOARD, { type, limit });
};

/**
 * ============================================================================
 * HONORS (Legacy)
 * ============================================================================
 */

/**
 * Get honors and participants for a date
 */
export const getHonors = async (date = null) => {
  const params = date ? { date } : {};
  return API.get(CONFIG.ENDPOINTS.HONORS, params);
};

/**
 * Award honor to participant(s)
 */
export const awardHonor = async (honorData) => {
  return API.post(CONFIG.ENDPOINTS.AWARD_HONOR, honorData);
};

/**
 * Get honors report
 */
export const getHonorsReport = async () => {
  return API.get(CONFIG.ENDPOINTS.HONORS_REPORT);
};

/**
 * Get honors history
 */
export const getHonorsHistory = async (options = {}) => {
  const params = {};
  if (options.startDate) params.start_date = options.startDate;
  if (options.endDate) params.end_date = options.endDate;
  if (options.participantId) params.participant_id = options.participantId;
  return API.get(CONFIG.ENDPOINTS.HONORS_HISTORY, params);
};

/**
 * ============================================================================
 * MEETINGS / REUNIONS (Legacy)
 * ============================================================================
 */

/**
 * Get meeting preparation for a date
 */
export const getReunionPreparation = async (date) => {
  return API.get(CONFIG.ENDPOINTS.REUNION_PREPARATION, { date });
};

/**
 * Save meeting preparation
 */
export const saveReunionPreparation = async (payload) => {
  return API.post(CONFIG.ENDPOINTS.SAVE_REUNION_PREPARATION, payload);
};

/**
 * Get meeting dates
 */
export const getReunionDates = async () => {
  return API.get(CONFIG.ENDPOINTS.REUNION_DATES);
};

/**
 * Get next meeting information
 */
export const getNextMeetingInfo = async () => {
  return API.get(CONFIG.ENDPOINTS.NEXT_MEETING_INFO);
};

/**
 * Get meeting activities templates
 */
export const getMeetingActivities = async () => {
  return API.get(CONFIG.ENDPOINTS.MEETING_ACTIVITIES);
};

/**
 * Get animators
 */
export const getAnimateurs = async () => {
  return API.get(CONFIG.ENDPOINTS.ANIMATEURS);
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
 * Get medication suggestions from fiche_sante submissions
 */
export const getFicheMedications = async () => {
  return API.get(`${CONFIG.ENDPOINTS.MEDICATION}/fiche-medications`);
};

/**
 * Create or update medication requirement
 */
export const saveMedicationRequirement = async (payload) => {
  if (payload?.id) {
    return API.put(`${CONFIG.ENDPOINTS.MEDICATION}/requirements/${payload.id}`, payload);
  }

  return API.post(`${CONFIG.ENDPOINTS.MEDICATION}/requirements`, payload);
};

/**
 * Record medication distributions
 */
export const recordMedicationDistribution = async (payload) => {
  return API.post(`${CONFIG.ENDPOINTS.MEDICATION}/distributions`, payload);
};

/**
 * Mark medication distribution as given
 */
export const markMedicationDistributionAsGiven = async (distributionId, payload) => {
  return API.patch(`${CONFIG.ENDPOINTS.MEDICATION}/distributions/${distributionId}`, payload);
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
  saveGuest,
  getGuestsByDate,
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
  // Points
  updatePoints,
  getPointsReport,
  getPointsLeaderboard,
  // Honors
  getHonors,
  awardHonor,
  getHonorsReport,
  getHonorsHistory,
  // Meetings
  getReunionPreparation,
  saveReunionPreparation,
  getReunionDates,
  getNextMeetingInfo,
  getMeetingActivities,
  getAnimateurs,
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
  getFicheMedications,
  saveMedicationRequirement,
  recordMedicationDistribution,
  markMedicationDistributionAsGiven,
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
