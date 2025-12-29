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
import { debugLog, debugError } from '../utils/DebugUtils.js';

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
 *
 * IMPORTANT: This function must use the organization's URL directly,
 * not the default API base URL, because we're resolving the org BEFORE
 * we know which organization it is.
 *
 * @param {string} hostname - The organization's hostname (e.g., "meute6a.app")
 * @param {string} organizationUrl - The full organization URL to query (e.g., "https://meute6a.app")
 * @returns {Promise<Object>} Response with organization_id
 */
export const getOrganizationId = async (hostname, organizationUrl = null) => {
  // If organizationUrl is provided, make a direct request to that URL
  // This is necessary because we don't know the org ID yet
  if (organizationUrl) {
    const axios = require('axios');
    const { getApiUrl } = require('../config');

    try {
      // Build the full URL using the organization's base URL
      const endpoint = CONFIG.ENDPOINTS.GET_ORGANIZATION_ID;
      const url = getApiUrl(endpoint, organizationUrl);

      debugLog('[getOrganizationId] Requesting URL:', url);
      debugLog('[getOrganizationId] With params:', { hostname });
      debugLog('[getOrganizationId] Organization URL:', organizationUrl);

      const response = await axios.get(url, {
        params: { hostname },
        timeout: CONFIG.API.TIMEOUT,
      });

      debugLog('[getOrganizationId] Response received:', response.data);

      // Normalize response to match our API format
      // Backend returns: { success: true, organizationId: 123 }
      // We need: { success: true, data: { organization_id: 123 } }
      if (response.data && response.data.organizationId) {
        return {
          success: true,
          data: {
            organization_id: response.data.organizationId,
          },
          message: 'Organization resolved',
        };
      }

      return {
        success: false,
        message: 'Organization not found',
      };
    } catch (error) {
      debugError('[getOrganizationId] Error resolving organization:', error);
      debugError('[getOrganizationId] Error details:', {
        message: error.message,
        code: error.code,
        config: {
          url: error.config?.url,
          method: error.config?.method,
          params: error.config?.params,
        },
        response: error.response?.data,
      });
      return {
        success: false,
        message: error.response?.data?.message || error.message || 'Failed to resolve organization',
      };
    }
  }

  // Fallback to default API (for backward compatibility)
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
 * GUARDIANS / PARENTS
 * ============================================================================
 */

/**
 * Get all guardians
 */
export const getAllGuardians = async () => {
  return API.get('/guardians');
};

/**
 * Get guardians/parents for a participant
 * @param {number} participantId - Participant ID
 */
export const getGuardians = async (participantId) => {
  return API.get('/guardians', { participant_id: participantId });
};

/**
 * Fetch guardians for a participant (alias for getGuardians)
 * @param {number} participantId - Participant ID
 */
export const fetchGuardians = async (participantId) => {
  return getGuardians(participantId);
};

/**
 * Get guardians for specific participant
 * @param {number} participantId - Participant ID
 */
export const getGuardiansForParticipant = async (participantId) => {
  return API.get('/guardians-for-participant', { participant_id: participantId });
};

/**
 * Get guardian info by ID
 * @param {number} guardianId - Guardian ID
 */
export const getGuardianInfo = async (guardianId) => {
  return API.get('/guardian-info', { guardian_id: guardianId });
};

/**
 * Get guardian core info (alias for getGuardianInfo)
 * @param {number} guardianId - Guardian ID
 */
export const getGuardianCoreInfo = async (guardianId) => {
  return getGuardianInfo(guardianId);
};

/**
 * Save parent/guardian
 * @param {Object} parentData - Parent/guardian data
 */
export const saveParent = async (parentData) => {
  return API.post('/save-guardian', parentData);
};

/**
 * Save guardian (alias for saveParent)
 * @param {Object} guardianData - Guardian data
 */
export const saveGuardian = async (guardianData) => {
  return API.post('/save-guardian', guardianData);
};

/**
 * Save guardian form submission
 * @param {Object} formData - Guardian form data
 */
export const saveGuardianFormSubmission = async (formData) => {
  return API.post('/save-guardian-form-submission', formData);
};

/**
 * Link parent to participant
 * @param {number} parentId - Parent/guardian ID
 * @param {number} participantId - Participant ID
 */
export const linkParentToParticipant = async (parentId, participantId) => {
  return API.post('/link-parent-to-participant', {
    parent_id: parentId,
    participant_id: participantId,
  });
};

/**
 * Link guardian to participant (alias)
 * @param {number} participantId - Participant ID
 * @param {number} guardianId - Guardian ID
 */
export const linkGuardianToParticipant = async (participantId, guardianId) => {
  return API.post('/link-parent-to-participant', {
    participant_id: participantId,
    guardian_id: guardianId,
  });
};

/**
 * Remove guardians from participant
 * @param {number} participantId - Participant ID
 * @param {Array<number>} guardianIds - Array of guardian IDs to remove
 */
export const removeGuardians = async (participantId, guardianIds) => {
  return API.post('/remove-guardians', {
    participant_id: participantId,
    guardian_ids: guardianIds,
  });
};

/**
 * Fetch parents (alias for fetchGuardians)
 * @param {number} participantId - Participant ID
 */
export const fetchParents = async (participantId) => {
  return fetchGuardians(participantId);
};

/**
 * Get parent users
 * @param {boolean} forceRefresh - Force refresh from server
 */
export const getParentUsers = async (forceRefresh = false) => {
  return API.get('/parent-users', {}, { forceRefresh });
};

/**
 * Get parent dashboard data
 */
export const getParentDashboard = async () => {
  return API.get('/parent-dashboard');
};

/**
 * Get parent contact list
 */
export const getParentContactList = async () => {
  return API.get('/parent-contact-list');
};

/**
 * Get user children
 * @param {string} userId - User ID (UUID)
 */
export const getUserChildren = async (userId) => {
  return API.get('/user-children', { user_id: userId });
};

/**
 * Associate user to participant
 * @param {number} participantId - Participant ID
 * @param {string} userId - User ID (UUID)
 */
export const associateUser = async (participantId, userId) => {
  return API.post('/associate-user', {
    participant_id: participantId,
    user_id: userId,
  });
};

/**
 * Link user to participants
 * Supports two signatures:
 * 1. linkUserParticipants({participant_ids: [...]}) - self-linking
 * 2. linkUserParticipants(userId, participantIds) - admin linking another user
 *
 * @param {string|Object} userIdOrData - User ID or data object
 * @param {Array<number>} participantIds - Array of participant IDs (if first param is userId)
 */
export const linkUserParticipants = async (userIdOrData, participantIds) => {
  if (typeof userIdOrData === 'object' && userIdOrData !== null) {
    return API.post('/link-user-participants', {
      participant_ids: userIdOrData.participant_ids,
    });
  }
  return API.post('/link-user-participants', {
    user_id: userIdOrData,
    participant_ids: participantIds,
  });
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
 * @param {string|null} date - Optional date to filter by (YYYY-MM-DD format)
 * @returns {Promise} Attendance records
 */
export const getAttendance = async (date = null) => {
  const params = date ? { date } : {};
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
 * Update fee definition
 * @param {number} id - Fee definition ID
 * @param {Object} feeData - Updated fee definition data
 */
export const updateFeeDefinition = async (id, feeData) => {
  return API.put(`${CONFIG.ENDPOINTS.FINANCE}/fee-definitions/${id}`, feeData);
};

/**
 * Delete fee definition
 * @param {number} id - Fee definition ID
 */
export const deleteFeeDefinition = async (id) => {
  return API.delete(`${CONFIG.ENDPOINTS.FINANCE}/fee-definitions/${id}`);
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
 * Create participant fee
 * @param {Object} feeData - Participant fee data
 */
export const createParticipantFee = async (feeData) => {
  return API.post(`${CONFIG.ENDPOINTS.FINANCE}/participant-fees`, feeData);
};

/**
 * Update participant fee
 * @param {number} id - Participant fee ID
 * @param {Object} feeData - Updated participant fee data
 */
export const updateParticipantFee = async (id, feeData) => {
  return API.put(`${CONFIG.ENDPOINTS.FINANCE}/participant-fees/${id}`, feeData);
};

/**
 * Get payments for a participant fee
 * @param {number} participantFeeId - Participant fee ID
 */
export const getParticipantPayments = async (participantFeeId) => {
  return API.get(`${CONFIG.ENDPOINTS.FINANCE}/participant-fees/${participantFeeId}/payments`);
};

/**
 * Create a payment for a participant fee
 * @param {number} participantFeeId - Participant fee ID
 * @param {Object} paymentData - Payment data
 */
export const createParticipantPayment = async (participantFeeId, paymentData) => {
  return API.post(`${CONFIG.ENDPOINTS.FINANCE}/participant-fees/${participantFeeId}/payments`, paymentData);
};

/**
 * Update an existing payment
 * @param {number} paymentId - Payment ID
 * @param {Object} paymentData - Updated payment data
 */
export const updatePayment = async (paymentId, paymentData) => {
  return API.put(`${CONFIG.ENDPOINTS.FINANCE}/payments/${paymentId}`, paymentData);
};

/**
 * Get payment plans for a participant fee
 * @param {number} participantFeeId - Participant fee ID
 */
export const getPaymentPlans = async (participantFeeId) => {
  return API.get(`${CONFIG.ENDPOINTS.FINANCE}/participant-fees/${participantFeeId}/payment-plans`);
};

/**
 * Create a payment plan for a participant fee
 * @param {number} participantFeeId - Participant fee ID
 * @param {Object} planData - Payment plan data
 */
export const createPaymentPlan = async (participantFeeId, planData) => {
  return API.post(`${CONFIG.ENDPOINTS.FINANCE}/participant-fees/${participantFeeId}/payment-plans`, planData);
};

/**
 * Update an existing payment plan
 * @param {number} planId - Payment plan ID
 * @param {Object} planData - Updated payment plan data
 */
export const updatePaymentPlan = async (planId, planData) => {
  return API.put(`${CONFIG.ENDPOINTS.FINANCE}/payment-plans/${planId}`, planData);
};

/**
 * Delete a payment plan
 * @param {number} planId - Payment plan ID
 */
export const deletePaymentPlan = async (planId) => {
  return API.delete(`${CONFIG.ENDPOINTS.FINANCE}/payment-plans/${planId}`);
};

/**
 * Get finance summary report
 */
export const getFinanceSummary = async () => {
  return API.get(`${CONFIG.ENDPOINTS.FINANCE}/reports/summary`);
};

/**
 * Get a participant-level finance statement (guardian or staff scope)
 * @param {number} participantId - Participant ID
 * @returns {Promise} Participant finance statement with fees and payments
 */
export const getParticipantStatement = async (participantId) => {
  return API.get(`${CONFIG.ENDPOINTS.FINANCE}/participants/${participantId}/statement`);
};

/**
 * ============================================================================
 * STRIPE PAYMENTS
 * ============================================================================
 */

/**
 * Create a Stripe payment intent for a participant fee
 * @param {number} participantFeeId - Participant fee ID
 * @param {number} amount - Amount to charge
 * @returns {Promise} Payment intent with clientSecret
 */
export const createStripePaymentIntent = async (participantFeeId, amount) => {
  return API.post(`${CONFIG.ENDPOINTS.STRIPE}/create-payment-intent`, {
    participant_fee_id: participantFeeId,
    amount,
  });
};

/**
 * Get the status of a Stripe payment intent
 * @param {string} paymentIntentId - Stripe payment intent ID
 * @returns {Promise} Payment intent status
 */
export const getStripePaymentStatus = async (paymentIntentId) => {
  return API.get(`${CONFIG.ENDPOINTS.STRIPE}/payment-status/${paymentIntentId}`);
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
 * Delete medication requirement
 */
export const deleteMedicationRequirement = async (requirementId) => {
  return API.delete(`${CONFIG.ENDPOINTS.MEDICATION}/requirements/${requirementId}`);
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
 * Get current user profile
 */
export const getUserProfile = async () => {
  return API.get('/api/v1/users/me');
};

/**
 * Update current user profile
 */
export const updateUserProfile = async (profileData) => {
  return API.put('/api/v1/users/me', profileData);
};

/**
 * Change user password
 */
export const changePassword = async (passwordData) => {
  return API.post('/api/v1/users/me/password', passwordData);
};

/**
 * ============================================================================
 * BADGES
 * ============================================================================
 */

/**
 * Get pending badges for approval
 */
export const getPendingBadges = async ({ forceRefresh = false } = {}) => {
  return API.get('/api/pending-badges', {}, { forceRefresh });
};

/**
 * Get badge progress for participants
 * @param {number} participantId - Optional participant ID to filter progress
 * @param {Object} options - Request options
 * @param {boolean} options.forceRefresh - Force cache refresh
 */
export const getBadgeProgress = async (participantId = null, { forceRefresh = false } = {}) => {
  const endpoint = participantId 
    ? `/api/badge-progress?participant_id=${participantId}`
    : '/api/badge-progress';
  return API.get(endpoint, {}, { forceRefresh });
};

/**
 * Save badge progress (submit for approval)
 */
export const saveBadgeProgress = async (badgeData) => {
  return API.post('/api/save-badge-progress', badgeData);
};

/**
 * Approve a badge
 */
export const approveBadge = async (progressId) => {
  return API.post('/api/approve-badge', { progress_id: progressId });
};

/**
 * Reject a badge
 */
export const rejectBadge = async (progressId, reason = '') => {
  return API.post('/api/reject-badge', { progress_id: progressId, reason });
};

/**
 * Update badge status (approve or reject)
 */
export const updateBadgeStatus = async (progressId, status, reason = '') => {
  if (status === 'approved') {
    return approveBadge(progressId);
  } else if (status === 'rejected') {
    return rejectBadge(progressId, reason);
  }
  throw new Error('Invalid status: must be "approved" or "rejected"');
};

/**
 * Get badge summary for all participants
 */
export const getBadgeSummary = async ({ forceRefresh = false } = {}) => {
  return API.get('/api/badge-summary', {}, { forceRefresh });
};

/**
 * Get badge history for a participant
 */
export const getBadgeHistory = async (participantId, { forceRefresh = false } = {}) => {
  return API.get(`/api/badge-history?participant_id=${participantId}`, {}, { forceRefresh });
};

/**
 * Get current stars for participants
 */
export const getCurrentStars = async ({ forceRefresh = false } = {}) => {
  return API.get('/api/current-stars', {}, { forceRefresh });
};

/**
 * Get badge system settings
 */
export const getBadgeSystemSettings = async ({ forceRefresh = false } = {}) => {
  return API.get('/api/badge-system-settings', {}, { forceRefresh });
};

/**
 * Update badge progress entry
 */
export const updateBadgeProgress = async (progressId, badgeData) => {
  return API.put(`/api/badge-progress/${progressId}`, badgeData);
};

/**
 * ============================================================================
 * REPORTS & CONTACTS
 * ============================================================================
 */

/**
 * Get parent contact list
 */
export const getParentContactList = async ({ forceRefresh = false } = {}) => {
  return API.get('/api/parent-contact-list', {}, { forceRefresh });
};

/**
 * ============================================================================
 * DYNAMIC FORMS (V1)
 * ============================================================================
 */

/**
 * Get organization form formats
 * @param {string} context - Optional context filter (participant, organization, admin_panel, public, form_builder)
 */
export const getOrganizationFormFormats = async (context = null) => {
  const url = context 
    ? `${CONFIG.ENDPOINTS.FORMS}/organization-form-formats?context=${context}`
    : `${CONFIG.ENDPOINTS.FORMS}/organization-form-formats`;
  return API.get(url);
};

/**
 * Get form submission for a participant
 * @param {number} participantId - Participant ID
 * @param {string} formType - Form type (e.g., 'fiche_sante', 'registration')
 */
export const getFormSubmission = async (participantId, formType) => {
  return API.get(
    `${CONFIG.ENDPOINTS.FORMS}/form-submission?participant_id=${participantId}&form_type=${formType}`
  );
};

/**
 * Submit/save form data for a participant
 * @param {string} formType - Form type
 * @param {number} participantId - Participant ID
 * @param {Object} formData - Form data to save
 */
export const submitDynamicForm = async (formType, participantId, formData) => {
  return API.post(`${CONFIG.ENDPOINTS.FORMS}/form-submission`, {
    form_type: formType,
    participant_id: participantId,
    submission_data: formData,
  });
};

/**
 * Save form submission (alias for submitDynamicForm for backward compatibility)
 */
export const saveFormSubmission = async (formType, participantId, formData) => {
  return submitDynamicForm(formType, participantId, formData);
};

/**
 * Get risk acceptance data for a participant
 * @param {number} participantId - Participant ID
 */
export const getRiskAcceptance = async (participantId) => {
  return API.get(`/risk-acceptance?participant_id=${participantId}`);
};

/**
 * Save risk acceptance data for a participant
 * @param {Object} data - Risk acceptance data (must include participant_id)
 */
export const saveRiskAcceptance = async (data) => {
  return API.post('/risk-acceptance', data);
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
  // Guardians / Parents
  getAllGuardians,
  getGuardians,
  fetchGuardians,
  getGuardiansForParticipant,
  getGuardianInfo,
  getGuardianCoreInfo,
  saveParent,
  saveGuardian,
  saveGuardianFormSubmission,
  linkParentToParticipant,
  linkGuardianToParticipant,
  removeGuardians,
  fetchParents,
  getParentUsers,
  getParentDashboard,
  getParentContactList,
  getUserChildren,
  associateUser,
  linkUserParticipants,
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
  updateFeeDefinition,
  deleteFeeDefinition,
  getParticipantFees,
  createParticipantFee,
  updateParticipantFee,
  getParticipantPayments,
  createParticipantPayment,
  updatePayment,
  getPaymentPlans,
  createPaymentPlan,
  updatePaymentPlan,
  deletePaymentPlan,
  getFinanceSummary,
  getParticipantStatement,
  // Stripe Payments
  createStripePaymentIntent,
  getStripePaymentStatus,
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
  deleteMedicationRequirement,
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
