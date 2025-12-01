// ajax-functions.js
// Main AJAX/API utilities for the Wampums application
// This file now re-exports from modular API files for better organization
//
// Phase 2 Refactoring: Consolidated from 1,200+ lines into modular structure
// - api/api-core.js: Core API infrastructure
// - api/api-helpers.js: Helper utilities
// - api/api-endpoints.js: All endpoint functions

// Re-export core API functionality
export {
    API,
    buildApiUrl,
    handleResponse,
    makeApiRequest,
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
    register,
    verifyEmail,
    requestPasswordReset,
    resetPassword,
    refreshToken,
    logout,
    getUsers,
    getPendingUsers,
    checkPermission,
    approveUser,
    updateUserRole,

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

    // Groups
    getGroups,
    addGroup,
    removeGroup,
    updateGroupName,
    updateParticipantGroup,
    updatePoints,
    getPointsReport,
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
    getVaccineReport,
    getLeaveAloneReport,
    getMediaAuthorizationReport,
    getMissingDocumentsReport,
    getMailingList,
    getReports,

    // Organization
    getApiOrganizationId,
    createOrganization,
    switchOrganization,
    getOrganizationSettings,
    getNews,
    registerForOrganization,
    fetchOrganizationJwt,

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
import { getCurrentOrganizationId, getAuthHeader } from "./api/api-helpers.js";
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
