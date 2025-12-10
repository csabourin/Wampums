// api-endpoints.js
// All API endpoint functions organized by category
import { API } from "./api-core.js";
import { debugLog, debugError, debugWarn, debugInfo } from "../utils/DebugUtils.js";
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
        let orgId = organization_id || getCurrentOrganizationId();

        if (!orgId) {
            debugWarn('Organization ID missing from storage, fetching from server...');
            const orgResponse = await getOrganizationId();
            orgId = orgResponse?.organization_id || orgResponse?.organizationId || orgResponse?.id;

            if (orgId) {
                localStorage.setItem(CONFIG.STORAGE_KEYS.CURRENT_ORGANIZATION_ID, orgId);
                localStorage.setItem(CONFIG.STORAGE_KEYS.ORGANIZATION_ID, orgId);
            }
        }

        if (!orgId) {
            throw new Error('Organization ID is required for login');
        }

        const requestBody = {
            email: email,
            password: password
        };

        debugLog('Sending login request via api-endpoints.js...', email);

        const url = new URL('/public/login', CONFIG.API_BASE_URL);
        const response = await fetch(url.toString(), {
            method: "POST",
            headers: {
                'Content-Type': 'application/json',
                'x-organization-id': String(orgId)
            },
            body: JSON.stringify(requestBody)
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            return {
                success: false,
                status: response.status,
                message: data?.message || 'invalid_email_or_password'
            };
        }

        return data;
    } catch (error) {
        debugError("Error during login:", error);
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
    return API.post('auth/request-reset', { email });
}

/**
 * Reset password with token
 */
export async function resetPassword(token, newPassword) {
    return API.post('auth/reset-password', { token, new_password: newPassword });
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
    const result = await API.post('auth/logout');

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
 * Uses RESTful v1 endpoint
 */
export async function getParticipants() {
    return API.get('v1/participants', {}, {
        cacheKey: 'participants_v2', // v2: includes roles field from participant_groups
        cacheDuration: CONFIG.CACHE_DURATION.MEDIUM
    });
}

/**
 * Get participant by ID
 * Uses RESTful endpoint with role-based access control
 */
export async function getParticipant(id) {
    const response = await API.get(`v1/participants/${id}`);
    // Transform response to match expected format
    return {
        success: response.success,
        participant: response.data
    };
}

/**
 * Fetch participant (alias for getParticipant)
 * Uses RESTful endpoint with role-based access control
 */
export async function fetchParticipant(participantId) {
    const response = await API.get(`v1/participants/${participantId}`);
    // Transform response to match expected format
    return {
        success: response.success,
        participant: response.data
    };
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
 * Uses RESTful endpoint with role-based access control
 */
export async function fetchParticipants(organizationId) {
    const response = await API.get('v1/participants', {
        organization_id: organizationId,
        limit: 1000 // High limit to get all participants
    });

    // Extract data array from paginated response
    return response.data || [];
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
    return API.post('save-guardian', parentData);
}

/**
 * Save guardian (alias for saveParent)
 */
export async function saveGuardian(guardianData) {
    return API.post('save-guardian', guardianData);
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
    return API.get('v1/groups', {}, {
        cacheKey: 'groups',
        cacheDuration: CONFIG.CACHE_DURATION.MEDIUM
    });
}

/**
 * Add new group
 */
export async function addGroup(groupName) {
    return API.post('v1/groups', { name: groupName });
}

/**
 * Remove group
 */
export async function removeGroup(groupId) {
    return API.delete(`v1/groups/${groupId}`);
}

/**
 * Update group name
 */
export async function updateGroupName(groupId, newName) {
    return API.put(`v1/groups/${groupId}`, { name: newName });
}

/**
 * Update participant's group membership (RESTful v1 endpoint)
 */
export async function updateParticipantGroup(participantId, groupId, isLeader = false, isSecondLeader = false, roles = null) {
    return API.patch(`v1/participants/${participantId}/group-membership`, {
        group_id: groupId,
        is_leader: isLeader,
        is_second_leader: isSecondLeader,
        roles: roles
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
 * Get participant progress timeline and participants list
 */
export async function getParticipantProgressReport(participantId = null) {
    const params = participantId ? { participant_id: participantId } : {};
    const cacheKey = participantId ? `participant_progress_${participantId}` : 'participant_progress_participants';
    return API.get('participant-progress', params, {
        cacheKey,
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
    }, {
        cacheKey: `form-submission-${formType}-${participantId}`
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
    // Import deleteCachedData dynamically to avoid circular dependencies
    const { deleteCachedData } = await import('../indexedDB.js');

    let formType, pId;

    // Support both signatures:
    // 1. saveFormSubmission({ form_type, participant_id, submission_data })
    // 2. saveFormSubmission(formType, participantId, submissionData)
    if (typeof formTypeOrData === 'object' && formTypeOrData !== null && participantId === undefined) {
        formType = formTypeOrData.form_type;
        pId = formTypeOrData.participant_id;
        const result = await API.post('save-form-submission', formTypeOrData);

        // Clear cache for this specific form submission
        if (formType && pId) {
            await deleteCachedData(`form-submission-${formType}-${pId}`);
        }

        return result;
    } else {
        formType = formTypeOrData;
        pId = participantId;
        const result = await API.post('save-form-submission', {
            form_type: formType,
            participant_id: pId,
            submission_data: submissionData
        });

        // Clear cache for this specific form submission
        if (formType && pId) {
            await deleteCachedData(`form-submission-${formType}-${pId}`);
        }

        return result;
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

    // Check if response.data is an array
    if (Array.isArray(response.data)) {
        // Transform array format to object format
        for (const format of response.data) {
            formFormats[format.form_type] = format.form_structure;
        }
    } else {
        // response.data is an object, extract form_structure from each form type
        for (const [formType, formatData] of Object.entries(response.data)) {
            // If formatData has a form_structure property, use it; otherwise use formatData directly
            formFormats[formType] = formatData.form_structure || formatData;
        }
    }

    return formFormats;
}

/**
 * Get health form (fiche santé)
 */
export async function fetchFicheSante(participantId) {
    return API.get('fiche-sante', { participant_id: participantId }, {
        cacheKey: `fiche-sante-${participantId}`
    });
}

/**
 * Save health form
 */
export async function saveFicheSante(ficheSanteData) {
    const { deleteCachedData } = await import('../indexedDB.js');
    const result = await API.post('save-fiche-sante', ficheSanteData);

    // Clear cache for this participant's fiche sante
    if (ficheSanteData.participant_id) {
        await deleteCachedData(`fiche-sante-${ficheSanteData.participant_id}`);
        await deleteCachedData(`form-submission-fiche_sante-${ficheSanteData.participant_id}`);
    }

    return result;
}

/**
 * Get risk acceptance form
 */
export async function fetchAcceptationRisque(participantId) {
    return API.get('acceptation-risque', { participant_id: participantId }, {
        cacheKey: `acceptation-risque-${participantId}`
    });
}

/**
 * Save risk acceptance form
 */
export async function saveAcceptationRisque(data) {
    const { deleteCachedData } = await import('../indexedDB.js');
    const result = await API.post('save-acceptation-risque', data);

    // Clear cache for this participant's risk acceptance form
    if (data.participant_id) {
        await deleteCachedData(`acceptation-risque-${data.participant_id}`);
        await deleteCachedData(`form-submission-acceptation_risque-${data.participant_id}`);
    }

    return result;
}

/**
 * Get participants with documents info
 */
export async function getParticipantsWithDocuments() {
    const response = await API.get('participant-details');
    const settingsResponse = await getOrganizationSettings();

    const settings = settingsResponse?.data || {};
    const formTypes = Object.keys(settings)
        .filter(key => key.endsWith('_structure'))
        .map(key => key.replace('_structure', ''));

    const participants = (response?.data?.participants || response?.participants || []).map(participant => {
        formTypes.forEach(formType => {
            participant[`has_${formType}`] = Boolean(participant[`has_${formType}`]);
        });
        return participant;
    });

    return {
        ...response,
        participants,
        data: {
            ...(response?.data || {}),
            participants
        }
    };
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
 * Update badge progress fields (stars, description, status, etc.)
 */
export async function updateBadgeProgress(badgeId, updates) {
    return API.put(`badge-progress/${badgeId}`, updates, {
        cacheKey: `badge_progress_${badgeId}`,
        invalidate: ['badge_summary']
    });
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
 * Uses RESTful v1 endpoint
 */
export async function getAttendance(date = null) {
    const params = date ? { date } : {};
    const cacheKey = date ? `attendance_api_${date}` : 'attendance_api';
    return API.get('v1/attendance', params, {
        cacheKey,
        cacheDuration: CONFIG.CACHE_DURATION.SHORT
    });
}

/**
 * Update attendance for participant
 * Uses RESTful v1 endpoint
 */
export async function updateAttendance(participantId, status, date, previousStatus = null) {
    return API.post('v1/attendance', {
        participant_id: participantId,
        status,
        date,
        previous_status: previousStatus
    });
}

/**
 * Get attendance dates
 * Uses RESTful v1 endpoint
 */
export async function getAttendanceDates() {
    return API.get('v1/attendance/dates', {}, {
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
// FUNDRAISERS
// ============================================================================

/**
 * Get all fundraisers
 */
export async function getFundraisers(includeArchived = false) {
    const cacheKey = `fundraisers_${includeArchived ? 'all' : 'active'}_${getCurrentOrganizationId() || 'org'}`;

    return API.get('fundraisers', { include_archived: includeArchived }, {
        cacheKey,
        cacheDuration: CONFIG.CACHE_DURATION.MEDIUM
    });
}

/**
 * Get single fundraiser details
 */
export async function getFundraiser(fundraiserId) {
    return API.get(`fundraisers/${fundraiserId}`);
}

/**
 * Create a new fundraiser
 */
export async function createFundraiser(data) {
    return API.post('fundraisers', data);
}

/**
 * Update fundraiser
 */
export async function updateFundraiser(fundraiserId, data) {
    return API.put(`fundraisers/${fundraiserId}`, data);
}

/**
 * Archive/unarchive a fundraiser
 */
export async function archiveFundraiser(fundraiserId, archived) {
    return API.put(`fundraisers/${fundraiserId}/archive`, { archived });
}

/**
 * Get calendars for a specific fundraiser
 */
export async function getCalendarsForFundraiser(fundraiserId) {
    const cacheKey = `calendars_${fundraiserId}_${getCurrentOrganizationId() || 'org'}`;

    return API.get('calendars', { fundraiser_id: fundraiserId }, {
        cacheKey,
        cacheDuration: CONFIG.CACHE_DURATION.MEDIUM
    });
}

/**
 * Update calendar entry
 */
export async function updateCalendarEntry(calendarId, data) {
    return API.put(`calendars/${calendarId}`, data);
}

/**
 * Update calendar payment
 */
export async function updateCalendarPayment(calendarId, amountPaid) {
    return API.put(`calendars/${calendarId}/payment`, { amount_paid: amountPaid });
}

// ============================================================================
// REUNIONS / MEETINGS
// ============================================================================

/**
 * Get reunion preparation for a date
 */
export async function getReunionPreparation(date) {
    return API.get('reunion-preparation', { date }, {
        cacheKey: `reunion_preparation_${date}`,
        cacheDuration: CONFIG.CACHE_DURATION.MEDIUM
    });
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
export async function getReunionDates(forceRefresh = false) {
    return API.get('reunion-dates', {}, {
        cacheKey: 'reunion_dates',
        cacheDuration: CONFIG.CACHE_DURATION.MEDIUM,
        forceRefresh
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
 * Announcement endpoints
 */
export async function getAnnouncements() {
    return API.get('v1/announcements', {}, {
        cacheKey: 'announcements',
        cacheDuration: CONFIG.CACHE_DURATION.SHORT
    });
}

export async function createAnnouncement(payload) {
    return API.post('v1/announcements', payload);
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
// FINANCE
// ============================================================================

/**
 * Get fee definitions for the current organization
 */
export async function getFeeDefinitions() {
    return API.get('v1/finance/fee-definitions', {}, {
        cacheKey: 'fee_definitions',
        cacheDuration: CONFIG.CACHE_DURATION.MEDIUM
    });
}

/**
 * Create a fee definition
 */
export async function createFeeDefinition(payload) {
    return API.post('v1/finance/fee-definitions', payload);
}

/**
 * Update a fee definition
 */
export async function updateFeeDefinition(id, payload) {
    return API.put(`v1/finance/fee-definitions/${id}`, payload);
}

/**
 * Delete a fee definition
 */
export async function deleteFeeDefinition(id) {
    return API.delete(`v1/finance/fee-definitions/${id}`);
}

/**
 * Get participant fees
 */
export async function getParticipantFees() {
    return API.get('v1/finance/participant-fees', {}, {
        cacheKey: 'participant_fees',
        cacheDuration: CONFIG.CACHE_DURATION.SHORT
    });
}

/**
 * Create participant fee
 */
export async function createParticipantFee(payload) {
    return API.post('v1/finance/participant-fees', payload);
}

/**
 * Update participant fee
 */
export async function updateParticipantFee(id, payload) {
    return API.put(`v1/finance/participant-fees/${id}`, payload);
}

/**
 * Get payments for a participant fee
 */
export async function getParticipantPayments(participantFeeId) {
    return API.get(`v1/finance/participant-fees/${participantFeeId}/payments`, {}, {
        cacheKey: `participant_fee_payments_${participantFeeId}`,
        cacheDuration: CONFIG.CACHE_DURATION.SHORT
    });
}

/**
 * Create a payment for a participant fee
 */
export async function createParticipantPayment(participantFeeId, payload) {
    return API.post(`v1/finance/participant-fees/${participantFeeId}/payments`, payload);
}

/**
 * Update an existing payment
 */
export async function updatePayment(paymentId, payload) {
    return API.put(`v1/finance/payments/${paymentId}`, payload);
}

/**
 * Get payment plans for a participant fee
 */
export async function getPaymentPlans(participantFeeId) {
    return API.get(`v1/finance/participant-fees/${participantFeeId}/payment-plans`, {}, {
        cacheKey: `payment_plans_${participantFeeId}`,
        cacheDuration: CONFIG.CACHE_DURATION.SHORT
    });
}

/**
 * Create a payment plan for a participant fee
 */
export async function createPaymentPlan(participantFeeId, payload) {
    return API.post(`v1/finance/participant-fees/${participantFeeId}/payment-plans`, payload);
}

/**
 * Update an existing payment plan
 */
export async function updatePaymentPlan(planId, payload) {
    return API.put(`v1/finance/payment-plans/${planId}`, payload);
}

/**
 * Delete a payment plan
 */
export async function deletePaymentPlan(planId) {
    return API.delete(`v1/finance/payment-plans/${planId}`);
}

/**
 * Get finance summary report
 */
export async function getFinanceReport() {
    return API.get('v1/finance/reports/summary', {}, {
        cacheKey: 'finance_report',
        cacheDuration: CONFIG.CACHE_DURATION.SHORT
    });
}

/**
 * Get a participant-level finance statement (guardian or staff scope)
 */
export async function getParticipantStatement(participantId) {
    return API.get(`v1/finance/participants/${participantId}/statement`);
}

// ============================================================================
// BUDGET
// ============================================================================

/**
 * Get budget categories for the current organization
 */
export async function getBudgetCategories() {
    return API.get('v1/budget/categories', {}, {
        cacheKey: 'budget_categories',
        cacheDuration: CONFIG.CACHE_DURATION.MEDIUM
    });
}

/**
 * Create a budget category
 */
export async function createBudgetCategory(payload) {
    return API.post('v1/budget/categories', payload);
}

/**
 * Update a budget category
 */
export async function updateBudgetCategory(id, payload) {
    return API.put(`v1/budget/categories/${id}`, payload);
}

/**
 * Delete a budget category (soft delete)
 */
export async function deleteBudgetCategory(id) {
    return API.delete(`v1/budget/categories/${id}`);
}

/**
 * Get budget items, optionally filtered by category
 */
export async function getBudgetItems(categoryId = null) {
    const params = categoryId ? { category_id: categoryId } : {};
    return API.get('v1/budget/items', params, {
        cacheKey: categoryId ? `budget_items_cat_${categoryId}` : 'budget_items',
        cacheDuration: CONFIG.CACHE_DURATION.MEDIUM
    });
}

/**
 * Create a budget item
 */
export async function createBudgetItem(payload) {
    return API.post('v1/budget/items', payload);
}

/**
 * Update a budget item
 */
export async function updateBudgetItem(id, payload) {
    return API.put(`v1/budget/items/${id}`, payload);
}

/**
 * Delete a budget item (soft delete)
 */
export async function deleteBudgetItem(id) {
    return API.delete(`v1/budget/items/${id}`);
}

/**
 * Get budget expenses with optional filters
 */
export async function getBudgetExpenses(filters = {}) {
    return API.get('v1/budget/expenses', filters, {
        cacheKey: 'budget_expenses',
        cacheDuration: CONFIG.CACHE_DURATION.SHORT
    });
}

/**
 * Create a budget expense
 */
export async function createBudgetExpense(payload) {
    return API.post('v1/budget/expenses', payload);
}

/**
 * Update a budget expense
 */
export async function updateBudgetExpense(id, payload) {
    return API.put(`v1/budget/expenses/${id}`, payload);
}

/**
 * Delete a budget expense
 */
export async function deleteBudgetExpense(id) {
    return API.delete(`v1/budget/expenses/${id}`);
}

/**
 * Get comprehensive budget summary report
 */
export async function getBudgetSummaryReport(fiscalYearStart, fiscalYearEnd) {
    const params = {
        fiscal_year_start: fiscalYearStart,
        fiscal_year_end: fiscalYearEnd
    };
    return API.get('v1/budget/reports/summary', params, {
        cacheKey: `budget_summary_${fiscalYearStart}_${fiscalYearEnd}`,
        cacheDuration: CONFIG.CACHE_DURATION.SHORT
    });
}

/**
 * Get revenue breakdown by source with optional filters
 * @param {string} fiscalYearStart - Fiscal year start date
 * @param {string} fiscalYearEnd - Fiscal year end date
 * @param {number|null} categoryId - Optional category ID filter
 * @param {string|null} revenueSource - Optional revenue source filter (participant_fee, fundraiser, calendar_sale)
 * @param {string|null} startDate - Optional custom start date
 * @param {string|null} endDate - Optional custom end date
 */
export async function getBudgetRevenueBreakdown(fiscalYearStart, fiscalYearEnd, categoryId = null, revenueSource = null, startDate = null, endDate = null) {
    const params = {};
    
    // Use custom date range if provided, otherwise use fiscal year
    const dateStart = startDate || fiscalYearStart;
    const dateEnd = endDate || fiscalYearEnd;
    
    if (startDate && endDate) {
        params.start_date = startDate;
        params.end_date = endDate;
    } else if (fiscalYearStart && fiscalYearEnd) {
        params.fiscal_year_start = fiscalYearStart;
        params.fiscal_year_end = fiscalYearEnd;
    }
    
    if (categoryId) {
        params.category_id = categoryId;
    }
    
    if (revenueSource && revenueSource !== 'all') {
        params.revenue_source = revenueSource;
    }
    
    // Build cache key with actual date parameters used
    const cacheKey = `budget_revenue_${dateStart}_${dateEnd}_${categoryId || 'all'}_${revenueSource || 'all'}`;
    
    return API.get('v1/budget/reports/revenue-breakdown', params, {
        cacheKey,
        cacheDuration: CONFIG.CACHE_DURATION.SHORT
    });
}

/**
 * Get budget plans with optional fiscal year filter
 */
export async function getBudgetPlans(fiscalYearStart = null, fiscalYearEnd = null) {
    const params = {};
    if (fiscalYearStart && fiscalYearEnd) {
        params.fiscal_year_start = fiscalYearStart;
        params.fiscal_year_end = fiscalYearEnd;
    }
    return API.get('v1/budget/plans', params, {
        cacheKey: fiscalYearStart ? `budget_plans_${fiscalYearStart}_${fiscalYearEnd}` : 'budget_plans',
        cacheDuration: CONFIG.CACHE_DURATION.SHORT
    });
}

/**
 * Create a budget plan
 */
export async function createBudgetPlan(payload) {
    return API.post('v1/budget/plans', payload);
}

/**
 * Update a budget plan
 */
export async function updateBudgetPlan(id, payload) {
    return API.put(`v1/budget/plans/${id}`, payload);
}

/**
 * Delete a budget plan
 */
export async function deleteBudgetPlan(id) {
    return API.delete(`v1/budget/plans/${id}`);
}

/**
 * Get expense summary by category
 */
export async function getExpenseSummary(startDate = null, endDate = null, categoryId = null) {
    const params = {};
    if (startDate) params.start_date = startDate;
    if (endDate) params.end_date = endDate;
    if (categoryId) params.category_id = categoryId;
    
    const cacheKey = `expense_summary_${startDate || 'all'}_${endDate || 'all'}_${categoryId || 'all'}`;
    return API.get('v1/expenses/summary', params, {
        cacheKey,
        cacheDuration: CONFIG.CACHE_DURATION.SHORT
    });
}

/**
 * Get monthly expense breakdown
 */
export async function getExpensesMonthly(fiscalYearStart = null, fiscalYearEnd = null, categoryId = null) {
    const params = {};
    if (fiscalYearStart) params.fiscal_year_start = fiscalYearStart;
    if (fiscalYearEnd) params.fiscal_year_end = fiscalYearEnd;
    if (categoryId) params.category_id = categoryId;
    
    const cacheKey = `expenses_monthly_${fiscalYearStart || 'all'}_${fiscalYearEnd || 'all'}_${categoryId || 'all'}`;
    return API.get('v1/expenses/monthly', params, {
        cacheKey,
        cacheDuration: CONFIG.CACHE_DURATION.SHORT
    });
}

/**
 * Bulk create expenses
 */
export async function createExpensesBulk(expenses) {
    return API.post('v1/expenses/bulk', { expenses });
}

// ============================================================================
// EXTERNAL REVENUE (Donations, Sponsorships, Grants)
// ============================================================================

/**
 * Get external revenue entries with optional filters
 */
export async function getExternalRevenue(filters = {}) {
    return API.get('v1/revenue/external', filters, {
        cacheKey: 'external_revenue',
        cacheDuration: CONFIG.CACHE_DURATION.SHORT
    });
}

/**
 * Create external revenue entry
 */
export async function createExternalRevenue(payload) {
    return API.post('v1/revenue/external', payload);
}

/**
 * Update external revenue entry
 */
export async function updateExternalRevenue(id, payload) {
    return API.put(`v1/revenue/external/${id}`, payload);
}

/**
 * Delete external revenue entry
 */
export async function deleteExternalRevenue(id) {
    return API.delete(`v1/revenue/external/${id}`);
}

/**
 * Get external revenue summary
 */
export async function getExternalRevenueSummary(startDate = null, endDate = null) {
    const params = {};
    if (startDate) params.start_date = startDate;
    if (endDate) params.end_date = endDate;
    
    const cacheKey = `external_revenue_summary_${startDate || 'all'}_${endDate || 'all'}`;
    return API.get('v1/revenue/external/summary', params, {
        cacheKey,
        cacheDuration: CONFIG.CACHE_DURATION.SHORT
    });
}

// ============================================================================
// REVENUE DASHBOARD
// ============================================================================

/**
 * Get aggregated revenue dashboard data
 */
export async function getRevenueDashboard(fiscalYearStart = null, fiscalYearEnd = null) {
    const params = {};
    if (fiscalYearStart) params.fiscal_year_start = fiscalYearStart;
    if (fiscalYearEnd) params.fiscal_year_end = fiscalYearEnd;
    
    const cacheKey = `revenue_dashboard_${fiscalYearStart || 'all'}_${fiscalYearEnd || 'all'}`;
    return API.get('v1/revenue/dashboard', params, {
        cacheKey,
        cacheDuration: CONFIG.CACHE_DURATION.SHORT
    });
}

/**
 * Get revenue breakdown by source
 */
export async function getRevenueBySource(startDate = null, endDate = null) {
    const params = {};
    if (startDate) params.start_date = startDate;
    if (endDate) params.end_date = endDate;
    
    const cacheKey = `revenue_by_source_${startDate || 'all'}_${endDate || 'all'}`;
    return API.get('v1/revenue/by-source', params, {
        cacheKey,
        cacheDuration: CONFIG.CACHE_DURATION.SHORT
    });
}

/**
 * Get revenue breakdown by category
 */
export async function getRevenueByCategory(startDate = null, endDate = null) {
    const params = {};
    if (startDate) params.start_date = startDate;
    if (endDate) params.end_date = endDate;
    
    const cacheKey = `revenue_by_category_${startDate || 'all'}_${endDate || 'all'}`;
    return API.get('v1/revenue/by-category', params, {
        cacheKey,
        cacheDuration: CONFIG.CACHE_DURATION.SHORT
    });
}

/**
 * Get revenue comparison (actual vs budgeted)
 */
export async function getRevenueComparison(fiscalYearStart, fiscalYearEnd) {
    const params = {
        fiscal_year_start: fiscalYearStart,
        fiscal_year_end: fiscalYearEnd
    };
    
    const cacheKey = `revenue_comparison_${fiscalYearStart}_${fiscalYearEnd}`;
    return API.get('v1/revenue/comparison', params, {
        cacheKey,
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
 * Import SISC CSV data (admin only)
 */
export async function importSISC(csvContent) {
    return API.post('import-sisc', { csvContent });
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
        debugError('Error fetching organization JWT:', error);
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
 * Get push notification subscribers
 */
export async function getSubscribers(organizationId) {
    try {
        return await API.get('push-subscribers', {
            organization_id: organizationId
        });
    } catch (error) {
        debugWarn('Push subscriber endpoint unavailable, returning empty list', error);
        return { success: false, data: [] };
    }
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
