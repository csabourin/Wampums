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
import * as ApiCore from "./api/api-core.js";
import * as ApiHelpers from "./api/api-helpers.js";
import { getParticipants, saveParticipant } from "./api/api-endpoints.js";

export const fetchFromApi = ApiCore.API.get;
export const getApiUrl = ApiCore.buildApiUrl;

// Error handling wrappers for backward compatibility
export const getParticipantsWithErrorHandling = ApiCore.withErrorHandling(getParticipants);
export const saveParticipantWithErrorHandling = ApiCore.withErrorHandling(saveParticipant);

// Default export for backward compatibility
export default {
    API: ApiCore.API,
    getCurrentOrganizationId: ApiHelpers.getCurrentOrganizationId,
    getAuthHeader: ApiHelpers.getAuthHeader,
    buildApiUrl: ApiCore.buildApiUrl,
    batchApiRequests: ApiCore.batchApiRequests,
    withErrorHandling: ApiCore.withErrorHandling
};
