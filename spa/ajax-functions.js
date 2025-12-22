// ajax-functions.js
// Main AJAX/API utilities for the Wampums application
// This file now re-exports from modular API files for better organization
//
// Phase 2 Refactoring: Consolidated from 1,200+ lines into modular structure
// - api/api-core.js: Core API infrastructure
// - api/api-helpers.js: Helper utilities
// - api/api-endpoints.js: All endpoint functions

import { CONFIG } from "./config.js";
import { debugError } from "./utils/DebugUtils.js";
import { getAuthHeader, getCurrentOrganizationId } from "./api/api-helpers.js";
import { handleResponse, makeApiRequest } from "./api/api-core.js";

// Re-export core API functionality
export {
    API,
    buildApiUrl,
    makeApiRequestWithCache,
    batchApiRequests,
    withErrorHandling,
    syncOfflineData
} from "./api/api-core.js";

// Re-export helper utilities
export {
    getCurrentOrganizationId,
    getAuthHeader,
    checkLoginStatus,
    validateCurrentToken,
    buildPublicUrl,
    fetchPublic
} from "./api/api-helpers.js";

/**
 * Compatibility wrapper for legacy ajax usage
 *
 * While the codebase transitions to the modular API helpers, some modules still
 * call a generic `ajax` helper with a full URL. This wrapper maps those calls to
 * the new `makeApiRequest` infrastructure when possible so existing modules keep
 * working without duplicating networking logic.
 *
 * @param {Object} options - Request configuration
 * @param {string} options.url - Absolute or relative API URL
 * @param {string} [options.method='GET'] - HTTP method
 * @param {Object|string|null} [options.body=null] - Request body (object or JSON string)
 * @param {Object} [options.headers={}] - Additional request headers
 * @returns {Promise<Object>} API response JSON
 */
export async function ajax({ url, method = 'GET', body = null, headers = {} }) {
    // Try to convert absolute URLs (e.g., `${CONFIG.API_BASE_URL}/api/...`) to
    // endpoint + params for makeApiRequest to ensure consistent auth handling.
    try {
        const base = new URL(url, typeof window !== 'undefined' ? window.location.origin : undefined);
        const apiBase = new URL(CONFIG.API_BASE_URL);

        if (base.origin === apiBase.origin && base.pathname.startsWith('/api/')) {
            const endpoint = base.pathname.replace(/^\/api\//, '');
            const params = Object.fromEntries(base.searchParams.entries());

            let parsedBody = body;
            if (typeof body === 'string' && body.trim()) {
                try {
                    parsedBody = JSON.parse(body);
                } catch (parseError) {
                    // Fall back to raw string if parsing fails
                    parsedBody = body;
                }
            }

            return makeApiRequest(endpoint, {
                method,
                params,
                body: parsedBody,
                headers
            });
        }
    } catch (error) {
        // If URL parsing fails, fall through to fetch implementation below
        debugError('ajax URL parse failed, using fetch fallback:', error);
    }

    // Fallback: use fetch directly for non-standard URLs while keeping auth
    // headers consistent with the new API helpers.
    const requestConfig = {
        method,
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            ...getAuthHeader(),
            ...headers
        }
    };

    if (body && method !== 'GET') {
        requestConfig.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    const response = await fetch(url, requestConfig);
    return handleResponse(response);
}

// Re-export all endpoint functions
export {
    // Public Endpoints
    testConnection,
    getOrganizationId,
    fetchOrganizationId,
    getPublicOrganizationSettings,
    getPublicNews,
    getPublicInitialData,
    authenticate,

    // Authentication & Users
    login,
    verify2FA,
    register,
    verifyEmail,
    requestPasswordReset,
    resetPassword,
    refreshToken,
    logout,
    getUsers,
    getRoleCatalog,
    getRoleBundles,
    getRolePermissions,
    getUserOrganizations,
    getUserRoleAssignments,
    getRoleAuditLog,
    updateUserRolesV1,
    updateUserRoleBundles,
    getPendingUsers,
    checkPermission,
    approveUser,
    updateUserRole,
    clearUserCaches,

    // Participants
    getParticipants,
    getParticipant,
    fetchParticipant,
    getParticipantDetails,
    saveParticipant,
    getParticipantAge,
    getParticipantAgeReport,
    getParticipantsWithUsers,
    linkParticipantToOrganization,
    removeParticipantFromOrganization,
    associateUser,
    linkUserParticipants,
    fetchParticipants,

    // Guardians / Parents
    getGuardians,
    fetchGuardians,
    getGuardianInfo,
    getGuardianCoreInfo,
    getGuardiansForParticipant,
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
    getFinanceReport,
    getParticipantStatement,

    // Groups
    getGroups,
    addGroup,
    removeGroup,
    updateGroupName,
    updateParticipantGroup,
    updatePoints,
    getPointsReport,
    getParticipantProgressReport,
    getPointsLeaderboard,

    // Forms & Documents
    getFormTypes,
    getFormStructure,
    getFormSubmission,
    getFormSubmissions,
    saveFormSubmission,
    getOrganizationFormFormats,
    fetchFicheSante,
    saveFicheSante,
    fetchAcceptationRisque,
    saveAcceptationRisque,
    getParticipantsWithDocuments,

    // Badges
    getBadgeProgress,
    saveBadgeProgress,
    getPendingBadges,
    getCurrentStars,
    approveBadge,
    rejectBadge,
    getBadgeSummary,
    getBadgeHistory,
    updateBadgeStatus,
    updateBadgeProgress,
    getBadgeSystemSettings,

    // Honors
    getHonors,
    getHonorsAndParticipants,
    getRecentHonors,
    awardHonor,
    getHonorsReport,
    getHonorsHistory,
    getAvailableDates,

    // Attendance
    getAttendance,
    updateAttendance,
    getAttendanceDates,
    getAttendanceReport,
    saveGuest,
    getGuestsByDate,

    // Calendar
    getCalendars,
    updateCalendar,
    updateCalendarPaid,
    updateCalendarAmountPaid,
    getParticipantCalendar,

    // Fundraisers
    getFundraisers,
    getFundraiser,
    createFundraiser,
    updateFundraiser,
    archiveFundraiser,
    getCalendarsForFundraiser,
    updateCalendarEntry,
    updateCalendarPayment,

    // Reunions / Meetings
    getReunionPreparation,
    saveReunionPreparation,
    getReunionDates,
    getActivitesRencontre,
    saveReminder,
    getReminder,
    getNextMeetingInfo,
    getAnimateurs,

    // Reports
    getHealthContactReport,
    getHealthReport,
    getAllergiesReport,
    getMedicationReport,
    getMedicationRequirements,
    saveMedicationRequirement,
    getParticipantMedications,
    getMedicationDistributions,
    recordMedicationDistribution,
    markMedicationDistributionAsGiven,
    getVaccineReport,
    getLeaveAloneReport,
    getMediaAuthorizationReport,
    getMissingDocumentsReport,
    getMailingList,
    getAnnouncements,
    createAnnouncement,
    getReports,

    // Organization
    getApiOrganizationId,
    createOrganization,
    switchOrganization,
    getOrganizationSettings,
    getNews,
    registerForOrganization,
    fetchOrganizationJwt,

    // Admin / Import
    importSISC,

    // Utility
    testApiConnection,
    getInitialData,
    getSubscribers,
    validateToken,
    checkAuthStatus
} from "./api/api-endpoints.js";

// Re-export CONFIG for backward compatibility
export { CONFIG } from "./config.js";

// Re-export debug utilities for backward compatibility
export { debugLog, debugError } from "./utils/DebugUtils.js";

// Backwards compatibility aliases
import { API, buildApiUrl, batchApiRequests, withErrorHandling } from "./api/api-core.js";
import { getParticipants, saveParticipant } from "./api/api-endpoints.js";

export const fetchFromApi = API.get;
export const getApiUrl = buildApiUrl;

// Error handling wrappers for backward compatibility
export const getParticipantsWithErrorHandling = withErrorHandling(getParticipants);
export const saveParticipantWithErrorHandling = withErrorHandling(saveParticipant);

// Default export for backward compatibility
export default {
    API,
    getCurrentOrganizationId,
    getAuthHeader,
    buildApiUrl,
    batchApiRequests,
    withErrorHandling
};
