// api-endpoints.js
// All API endpoint functions organized by category
import { API } from "./api-core.js";
import { CONFIG } from "../config.js";
import { fetchPublic, getCurrentOrganizationId, getAuthHeader } from "./api-helpers.js";
import { handleResponse } from "./api-core.js";

// ============================================================================
// PUBLIC ENDPOINTS (No Authentication Required)
// ============================================================================

/**
 * Test database connection
 */
export async function testConnection() {
    return fetchPublic('test-connection');
}

/**
 * Get organization ID based on hostname
 */
export async function getOrganizationId() {
    return fetchPublic('get_organization_id');
}

/**
 * Get public organization settings
 */
export async function getPublicOrganizationSettings() {
    return fetchPublic('organization-settings');
}

/**
 * Get news for the organization
 */
export async function getPublicNews() {
    return fetchPublic('get_news');
}

/**
 * Get initial data for frontend
 */
export async function getPublicInitialData() {
    return fetchPublic('initial-data');
}

/**
 * Authenticate with API key
 */
export async function authenticate(apiKey) {
    const url = new URL('/public/authenticate', CONFIG.API_BASE_URL);
    const response = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey })
    });
    return handleResponse(response);
}

// ============================================================================
// AUTHENTICATION & USER MANAGEMENT
// ============================================================================

/**
 * Login user (uses public endpoint)
 */
export async function login(email, password, organization_id) {
    try {
        const orgId = organization_id || getCurrentOrganizationId();

        if (!orgId) {
            throw new Error('Organization ID is required for login');
        }

        const requestBody = {
            email: email,
            password: password
        };

        console.log('Sending login request via api-endpoints.js...', email);

        const url = new URL('/public/login', CONFIG.API_BASE_URL);
        const response = await fetch(url.toString(), {
            method: "POST",
            headers: {
                'Content-Type': 'application/json',
                'x-organization-id': String(orgId)
            },
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();
        return data;
    } catch (error) {
        console.error("Error during login:", error);
        throw error;
    }
}

/**
 * Register new user (uses public endpoint)
 */
export async function register(userData) {
    const url = new URL('/public/register', CONFIG.API_BASE_URL);

    const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...getAuthHeader()
        },
        body: JSON.stringify(userData)
    });

    return handleResponse(response);
}

/**
 * Verify email with token
 */
export async function verifyEmail(token) {
    return API.post('verify-email', { token });
}

/**
 * Request password reset
 */
export async function requestPasswordReset(email) {
    return API.post('request-reset', { email });
}

/**
 * Reset password with token
 */
export async function resetPassword(token, newPassword) {
    return API.post('reset-password', { token, new_password: newPassword });
}

/**
 * Refresh JWT token
 */
export async function refreshToken() {
    return API.post('refresh-token');
}

/**
 * Logout user
 */
export async function logout() {
    const result = await API.post('logout');

    // Clear user-specific data but keep organization JWT
    localStorage.removeItem("userRole");
    localStorage.removeItem("userFullName");
    localStorage.removeItem("userId");

    return result;
}

/**
 * Get all users for organization
 */
export async function getUsers(organizationId) {
    return API.get('users', { organization_id: organizationId });
}

/**
 * Get pending users awaiting approval
 */
export async function getPendingUsers() {
    return API.getNoCache('pending-users');
}

/**
 * Check user permission
 */
export async function checkPermission(permission) {
    return API.post('check-permission', { permission });
}

/**
 * Approve user (admin only)
 */
export async function approveUser(userId) {
    return API.post('approve-user', { user_id: userId });
}

/**
 * Update user role (admin only)
 */
export async function updateUserRole(userId, role) {
    return API.post('update-user-role', { user_id: userId, role });
}

// ============================================================================
// PARTICIPANTS
// ============================================================================

/**
 * Get all participants
 */
export async function getParticipants() {
    return API.get('participants', {}, {
        cacheKey: 'participants',
        cacheDuration: CONFIG.CACHE_DURATION.MEDIUM
    });
}

/**
 * Get participant by ID
 */
export async function getParticipant(id) {
    return API.get(`participant/${id}`);
}

/**
 * Fetch participant (alias for getParticipant)
 */
export async function fetchParticipant(participantId) {
    return API.get(`participant/${participantId}`);
}

/**
 * Get detailed participant information
 */
export async function getParticipantDetails(participantId) {
    return API.get('participant-details', { participant_id: participantId });
}

/**
 * Save or update participant
 */
export async function saveParticipant(participantData) {
    return API.post('save-participant', participantData);
}

/**
 * Get participant age report
 */
export async function getParticipantAge() {
    return API.get('participant-age', {}, {
        cacheKey: 'participant_age',
        cacheDuration: CONFIG.CACHE_DURATION.MEDIUM
    });
}

/**
 * Get participants with linked users
 */
export async function getParticipantsWithUsers() {
    return API.get('participants-with-users');
}

/**
 * Link participant to organization
 */
export async function linkParticipantToOrganization(participantId, organizationId) {
    return API.post('link-participant-to-organization', {
        participant_id: participantId,
        organization_id: organizationId
    });
}

/**
 * Remove participant from organization (admin only)
 */
export async function removeParticipantFromOrganization(participantId, organizationId) {
    return API.post('remove-participant-from-organization', {
        participant_id: participantId,
        organization_id: organizationId
    });
}

/**
 * Associate user to participant
 */
export async function associateUser(participantId, userId) {
    return API.post('associate-user', {
        participant_id: participantId,
        user_id: userId
    });
}

/**
 * Link user to participants
 */
export async function linkUserParticipants(userIdOrData, participantIds) {
    // Support both signatures:
    // 1. linkUserParticipants({participant_ids: [...]}) - self-linking
    // 2. linkUserParticipants(userId, participantIds) - admin linking another user
    if (typeof userIdOrData === 'object' && userIdOrData !== null) {
        return API.post('link-user-participants', {
            participant_ids: userIdOrData.participant_ids
        });
    } else {
        return API.post('link-user-participants', {
            user_id: userIdOrData,
            participant_ids: participantIds
        });
    }
}

/**
 * Fetch participants for parent dashboard
 */
export async function fetchParticipants(organizationId) {
    return API.get('parent-dashboard-data', { organization_id: organizationId });
}

// ============================================================================
// GUARDIANS / PARENTS
// ============================================================================

/**
 * Get all guardians
 */
export async function getGuardians() {
    return API.get('guardians');
}

/**
 * Fetch guardians for a participant
 */
export async function fetchGuardians(participantId) {
    return API.get('guardians', { participant_id: participantId });
}

/**
 * Get guardian info by ID
 */
export async function getGuardianInfo(guardianId) {
    return API.get('guardian-info', { guardian_id: guardianId });
}

/**
 * Get guardian core info (alias)
 */
export async function getGuardianCoreInfo(guardianId) {
    return getGuardianInfo(guardianId);
}

/**
 * Get guardians for specific participant
 */
export async function getGuardiansForParticipant(participantId) {
    return API.get('guardians-for-participant', { participant_id: participantId });
}

/**
 * Save parent/guardian
 */
export async function saveParent(parentData) {
    return API.post('save-parent', parentData);
}

/**
 * Save guardian (alias for saveParent)
 */
export async function saveGuardian(guardianData) {
    return saveParent(guardianData);
}

/**
 * Save guardian form submission
 */
export async function saveGuardianFormSubmission(formData) {
    return API.post('save-guardian-form-submission', formData);
}

/**
 * Link parent to participant
 */
export async function linkParentToParticipant(parentId, participantId) {
    return API.post('link-parent-to-participant', {
        parent_id: parentId,
        participant_id: participantId
    });
}

/**
 * Link guardian to participant (alias)
 */
export async function linkGuardianToParticipant(participantId, guardianId) {
    return API.post('link-parent-to-participant', {
        participant_id: participantId,
        guardian_id: guardianId
    });
}

/**
 * Remove guardians from participant
 */
export async function removeGuardians(participantId, guardianIds) {
    return API.post('remove-guardians', {
        participant_id: participantId,
        guardian_ids: guardianIds
    });
}

/**
 * Fetch parents (alias for fetchGuardians)
 */
export async function fetchParents(participantId) {
    return fetchGuardians(participantId);
}

/**
 * Get parent users
 */
export async function getParentUsers() {
    return API.get('parent-users');
}

/**
 * Get parent dashboard data
 */
export async function getParentDashboard() {
    return API.getNoCache('parent-dashboard');
}

/**
 * Get parent contact list
 */
export async function getParentContactList() {
    return API.get('parent-contact-list', {}, {
        cacheKey: 'parent_contact_list',
        cacheDuration: CONFIG.CACHE_DURATION.LONG
    });
}

/**
 * Get user children
 */
export async function getUserChildren(userId) {
    return API.get('user-children', { user_id: userId });
}

// ============================================================================
// GROUPS
// ============================================================================

/**
 * Get all groups
 */
export async function getGroups() {
    return API.get('get_groups', {}, {
        cacheKey: 'groups',
        cacheDuration: CONFIG.CACHE_DURATION.MEDIUM
    });
}

/**
 * Add new group
 */
export async function addGroup(groupName) {
    return API.post('add-group', { group_name: groupName });
}

/**
 * Remove group
 */
export async function removeGroup(groupId) {
    return API.post('remove-group', { group_id: groupId });
}

/**
 * Update group name
 */
export async function updateGroupName(groupId, newName) {
    return API.post('update-group-name', {
        group_id: groupId,
        group_name: newName
    });
}

/**
 * Update participant's group
 */
export async function updateParticipantGroup(participantId, groupId, isLeader = false, isSecondLeader = false) {
    return API.post('update-participant-group', {
        participant_id: participantId,
        group_id: groupId,
        is_leader: isLeader,
        is_second_leader: isSecondLeader
    });
}

/**
 * Update points for participants/groups
 */
export async function updatePoints(updates) {
    return API.post('update-points', updates);
}

/**
 * Get points report
 */
export async function getPointsReport() {
    return API.get('points-report', {}, {
        cacheKey: 'points_report',
        cacheDuration: CONFIG.CACHE_DURATION.SHORT
    });
}

/**
 * Get points leaderboard
 */
export async function getPointsLeaderboard(type = 'individuals', limit = 10) {
    return API.get('points-leaderboard', { type, limit });
}

// ============================================================================
// FORMS & DOCUMENTS
// ============================================================================

/**
 * Get available form types
 */
export async function getFormTypes() {
    return API.get('form-types', {}, {
        cacheKey: 'form_types',
        cacheDuration: CONFIG.CACHE_DURATION.LONG
    });
}

/**
 * Get form structure
 */
export async function getFormStructure() {
    return API.get('organization-form-formats', {}, {
        cacheKey: 'form_structure',
        cacheDuration: CONFIG.CACHE_DURATION.LONG
    });
}

/**
 * Get form submission
 */
export async function getFormSubmission(participantId, formType) {
    return API.get('form-submission', {
        participant_id: participantId,
        form_type: formType
    });
}

/**
 * Get all form submissions
 */
export async function getFormSubmissions(participantId = null, formType) {
    const params = { form_type: formType };
    if (participantId) params.participant_id = participantId;
    return API.get('form-submissions', params);
}

/**
 * Save form submission
 */
export async function saveFormSubmission(formTypeOrData, participantId, submissionData) {
    // Support both signatures:
    // 1. saveFormSubmission({ form_type, participant_id, submission_data })
    // 2. saveFormSubmission(formType, participantId, submissionData)
    if (typeof formTypeOrData === 'object' && formTypeOrData !== null && participantId === undefined) {
        return API.post('save-form-submission', formTypeOrData);
    } else {
        return API.post('save-form-submission', {
            form_type: formTypeOrData,
            participant_id: participantId,
            submission_data: submissionData
        });
    }
}

/**
 * Get organization form formats
 */
export async function getOrganizationFormFormats(organizationId = null) {
    const params = organizationId ? { organization_id: organizationId } : {};
    const response = await API.get('organization-form-formats', params, {
        cacheKey: `org_form_formats_${organizationId || 'current'}`,
        cacheDuration: CONFIG.CACHE_DURATION.LONG
    });

    if (!response.success || !response.data) {
        return null;
    }

    const formFormats = {};
    for (const format of response.data) {
        formFormats[format.form_type] = format.form_structure;
    }
    return formFormats;
}

/**
 * Get health form (fiche santé)
 */
export async function fetchFicheSante(participantId) {
    return API.get('fiche-sante', { participant_id: participantId });
}

/**
 * Save health form
 */
export async function saveFicheSante(ficheSanteData) {
    return API.post('save-fiche-sante', ficheSanteData);
}

/**
 * Get risk acceptance form
 */
export async function fetchAcceptationRisque(participantId) {
    return API.get('acceptation-risque', { participant_id: participantId });
}

/**
 * Save risk acceptance form
 */
export async function saveAcceptationRisque(data) {
    return API.post('save-acceptation-risque', data);
}

/**
 * Get participants with documents info
 */
export async function getParticipantsWithDocuments() {
    const data = await API.get('participant-details');
    const settings = await getOrganizationSettings();
    const formTypes = Object.keys(settings)
        .filter(key => key.endsWith('_structure'))
        .map(key => key.replace('_structure', ''));
    data.participants = data.participants.map(p => {
        formTypes.forEach(ft => { p[`has_${ft}`] = !!p[`has_${ft}`]; });
        return p;
    });
    return data;
}

// ============================================================================
// BADGES
// ============================================================================

/**
 * Get badge progress for participant
 */
export async function getBadgeProgress(participantId) {
    return API.get('badge-progress', { participant_id: participantId });
}

/**
 * Save badge progress
 */
export async function saveBadgeProgress(progressData) {
    return API.post('save-badge-progress', progressData);
}

/**
 * Get pending badges for approval
 */
export async function getPendingBadges() {
    return API.getNoCache('pending-badges');
}

/**
 * Get current stars for participant
 */
export async function getCurrentStars(participantId, territoire) {
    return API.get('current-stars', { participant_id: participantId, territoire });
}

/**
 * Approve badge
 */
export async function approveBadge(badgeId) {
    return API.post('approve-badge', { badge_id: badgeId });
}

/**
 * Reject badge
 */
export async function rejectBadge(badgeId) {
    return API.post('reject-badge', { badge_id: badgeId });
}

/**
 * Get badge summary
 */
export async function getBadgeSummary() {
    return API.get('badge-summary', {}, {
        cacheKey: 'badge_summary',
        cacheDuration: CONFIG.CACHE_DURATION.MEDIUM
    });
}

/**
 * Get badge history for participant
 */
export async function getBadgeHistory(participantId) {
    return API.get('badge-history', { participant_id: participantId }, {
        cacheKey: `badge_history_${participantId}`,
        cacheDuration: CONFIG.CACHE_DURATION.LONG
    });
}

/**
 * Update badge status (approve or reject)
 */
export async function updateBadgeStatus(badgeId, status) {
    if (status === 'approved') {
        return approveBadge(badgeId);
    } else if (status === 'rejected') {
        return rejectBadge(badgeId);
    } else {
        throw new Error(`Invalid badge status: ${status}`);
    }
}

/**
 * Get badge system settings
 */
export async function getBadgeSystemSettings() {
    return API.get('badge-system-settings', {}, {
        cacheKey: 'badge_system_settings',
        cacheDuration: CONFIG.CACHE_DURATION.LONG
    });
}

// ============================================================================
// HONORS
// ============================================================================

/**
 * Get honors for a date
 */
export async function getHonors(date = null) {
    const params = date ? { date } : {};
    return API.get('honors', params);
}

/**
 * Get honors and participants (alias)
 */
export async function getHonorsAndParticipants(date = null) {
    return getHonors(date);
}

/**
 * Get recent honors
 */
export async function getRecentHonors() {
    return API.get('recent-honors', {}, {
        cacheKey: 'recent_honors',
        cacheDuration: CONFIG.CACHE_DURATION.SHORT
    });
}

/**
 * Award honor to participant
 */
export async function awardHonor(honorData) {
    return API.post('award-honor', honorData);
}

/**
 * Get honors report
 */
export async function getHonorsReport() {
    return API.get('honors-report', {}, {
        cacheKey: 'honors_report',
        cacheDuration: CONFIG.CACHE_DURATION.SHORT
    });
}

/**
 * Get honors history
 */
export async function getHonorsHistory(options = {}) {
    const params = {};
    if (options.startDate) params.start_date = options.startDate;
    if (options.endDate) params.end_date = options.endDate;
    if (options.participantId) params.participant_id = options.participantId;
    return API.get('honors-history', params);
}

/**
 * Get available dates for honors
 */
export async function getAvailableDates() {
    return API.get('available-dates');
}

// ============================================================================
// ATTENDANCE
// ============================================================================

/**
 * Get attendance for a date
 */
export async function getAttendance(date = null) {
    const params = date ? { date } : {};
    return API.get('attendance', params);
}

/**
 * Update attendance for participant
 */
export async function updateAttendance(participantId, status, date, previousStatus = null) {
    return API.post('update-attendance', {
        participant_id: participantId,
        status,
        date,
        previous_status: previousStatus
    });
}

/**
 * Get attendance dates
 */
export async function getAttendanceDates() {
    return API.get('attendance-dates', {}, {
        cacheKey: 'attendance_dates',
        cacheDuration: CONFIG.CACHE_DURATION.LONG
    });
}

/**
 * Get attendance report
 */
export async function getAttendanceReport(options = {}) {
    const params = {};
    if (options.startDate) params.start_date = options.startDate;
    if (options.endDate) params.end_date = options.endDate;
    if (options.groupId) params.group_id = options.groupId;
    if (options.format) params.format = options.format;
    return API.get('attendance-report', params);
}

/**
 * Save guest for attendance
 */
export async function saveGuest(guest) {
    return API.post('save-guest', guest);
}

/**
 * Get guests by date
 */
export async function getGuestsByDate(date) {
    return API.get('guests-by-date', { date });
}

// ============================================================================
// CALENDAR
// ============================================================================

/**
 * Get all calendars
 */
export async function getCalendars() {
    return API.get('calendars');
}

/**
 * Update calendar amount
 */
export async function updateCalendar(participantId, amount) {
    return API.post('update-calendar', {
        participant_id: participantId,
        amount
    });
}

/**
 * Update calendar paid status
 */
export async function updateCalendarPaid(participantId, isPaid) {
    return API.post('update-calendar-paid', {
        participant_id: participantId,
        paid: isPaid
    });
}

/**
 * Update calendar amount paid
 */
export async function updateCalendarAmountPaid(participantId, amountPaid) {
    return API.post('update-calendar-amount-paid', {
        participant_id: participantId,
        amount_paid: amountPaid
    });
}

/**
 * Get participant calendar
 */
export async function getParticipantCalendar(participantId) {
    return API.get('participant-calendar', { participant_id: participantId });
}

// ============================================================================
// REUNIONS / MEETINGS
// ============================================================================

/**
 * Get reunion preparation for a date
 */
export async function getReunionPreparation(date) {
    return API.get('reunion-preparation', { date });
}

/**
 * Save reunion preparation
 */
export async function saveReunionPreparation(data) {
    return API.post('save-reunion-preparation', data);
}

/**
 * Get reunion dates
 */
export async function getReunionDates() {
    return API.get('reunion-dates', {}, {
        cacheKey: 'reunion_dates',
        cacheDuration: CONFIG.CACHE_DURATION.MEDIUM
    });
}

/**
 * Get meeting activities
 */
export async function getActivitesRencontre() {
    return API.get('activites-rencontre');
}

/**
 * Save reminder
 */
export async function saveReminder(reminderData) {
    return API.post('save-reminder', reminderData);
}

/**
 * Get reminder for date
 */
export async function getReminder() {
    return API.get('reminder');
}

/**
 * Get next meeting info
 */
export async function getNextMeetingInfo() {
    return API.get('next-meeting-info');
}

/**
 * Get animators
 */
export async function getAnimateurs() {
    return API.get('animateurs');
}

// ============================================================================
// REPORTS
// ============================================================================

/**
 * Get health contact report
 */
export async function getHealthContactReport() {
    return API.get('health-contact-report', {}, {
        cacheKey: 'health_contact_report',
        cacheDuration: CONFIG.CACHE_DURATION.SHORT
    });
}

/**
 * Get health report
 */
export async function getHealthReport(groupId = null) {
    const params = groupId ? { group_id: groupId } : {};
    return API.get('health-report', params);
}

/**
 * Get allergies report
 */
export async function getAllergiesReport() {
    return API.get('allergies-report', {}, {
        cacheKey: 'allergies_report',
        cacheDuration: CONFIG.CACHE_DURATION.SHORT
    });
}

/**
 * Get medication report
 */
export async function getMedicationReport() {
    return API.get('medication-report', {}, {
        cacheKey: 'medication_report',
        cacheDuration: CONFIG.CACHE_DURATION.SHORT
    });
}

/**
 * Get vaccine report
 */
export async function getVaccineReport() {
    return API.get('vaccine-report', {}, {
        cacheKey: 'vaccine_report',
        cacheDuration: CONFIG.CACHE_DURATION.SHORT
    });
}

/**
 * Get leave alone authorization report
 */
export async function getLeaveAloneReport() {
    return API.get('leave-alone-report', {}, {
        cacheKey: 'leave_alone_report',
        cacheDuration: CONFIG.CACHE_DURATION.SHORT
    });
}

/**
 * Get media authorization report
 */
export async function getMediaAuthorizationReport() {
    return API.get('media-authorization-report', {}, {
        cacheKey: 'media_authorization_report',
        cacheDuration: CONFIG.CACHE_DURATION.SHORT
    });
}

/**
 * Get missing documents report
 */
export async function getMissingDocumentsReport() {
    return API.get('missing-documents-report');
}

/**
 * Get mailing list
 */
export async function getMailingList() {
    return API.get('mailing-list', {}, {
        cacheKey: 'mailing_list',
        cacheDuration: CONFIG.CACHE_DURATION.MEDIUM
    });
}

/**
 * Generic reports function
 */
export async function getReports(reportType) {
    return API.get(`${reportType}-report`, {}, {
        cacheKey: `report_${reportType}`,
        cacheDuration: CONFIG.CACHE_DURATION.SHORT
    });
}

// ============================================================================
// ORGANIZATION
// ============================================================================

/**
 * Get organization ID (API endpoint)
 */
export async function getApiOrganizationId() {
    return API.get('get-organization-id');
}

/**
 * Create organization
 */
export async function createOrganization(name) {
    return API.post('create-organization', { name });
}

/**
 * Switch organization
 */
export async function switchOrganization(organizationId) {
    return API.post('switch-organization', { organization_id: organizationId });
}

/**
 * Get organization settings
 */
export async function getOrganizationSettings(orgId = null) {
    const params = orgId ? { organization_id: orgId } : {};
    return API.get('organization-settings', params, {
        cacheKey: `org_settings_${orgId || 'current'}`,
        cacheDuration: CONFIG.CACHE_DURATION.LONG
    });
}

/**
 * Get news (API endpoint)
 */
export async function getNews() {
    return API.get('news');
}

/**
 * Register for organization
 */
export async function registerForOrganization(registrationData) {
    return API.post('register-for-organization', registrationData);
}

/**
 * Fetch organization JWT token
 */
export async function fetchOrganizationJwt(organizationId) {
    try {
        // Ensure organizationId is a string/number, not an object
        const orgId = typeof organizationId === 'object' ?
            organizationId.organizationId || organizationId.id :
            organizationId;

        if (!orgId) {
            throw new Error('Organization ID is required');
        }

        const url = new URL(`/api/organization-jwt?organization_id=${orgId}`, CONFIG.API_BASE_URL);
        const response = await fetch(url.toString(), {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error fetching organization JWT:', error);
        throw error;
    }
}

// ============================================================================
// UTILITY
// ============================================================================

/**
 * Test API connection (API endpoint)
 */
export async function testApiConnection() {
    return API.get('test-connection');
}

/**
 * Get initial data (API endpoint)
 */
export async function getInitialData() {
    return API.get('initial-data');
}

/**
 * Get subscribers
 */
export async function getSubscribers(organizationId) {
    return API.get('subscribers', { organization_id: organizationId });
}

/**
 * Validate token (uses test-connection endpoint)
 */
export async function validateToken() {
    try {
        const result = await API.get('test-connection');
        return result.success || false;
    } catch (error) {
        if (error.message.includes('401')) {
            return false;
        }
        throw error;
    }
}

/**
 * Check authentication status
 */
export async function checkAuthStatus() {
    const token = localStorage.getItem("jwtToken");
    if (!token) {
        return { isValid: false, reason: 'no_token' };
    }

    try {
        const result = await API.get('check-auth');
        return { isValid: true, user: result.user };
    } catch (error) {
        return { isValid: false, reason: 'invalid_token' };
    }
}

// ============================================================================
// BACKWARDS COMPATIBILITY ALIASES
// ============================================================================

// Alias for backward compatibility
export const fetchOrganizationId = getOrganizationId;
export const getParticipantAgeReport = getParticipantAge;
