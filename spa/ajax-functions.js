// ajax-functions-optimized.js
import {
    saveOfflineData,
    getOfflineData,
    setCachedData,
    getCachedData,
    clearOfflineData
} from "./indexedDB.js";

// Configuration
const CONFIG = {
    // Use Vite environment variables if available, otherwise use window.location.origin
    debugMode: import.meta.env?.VITE_DEBUG_MODE === 'true' ||
               import.meta.env?.DEV ||
               window.location.hostname === "localhost" ||
               window.location.hostname.includes("replit.dev"),

    // API_BASE_URL comes from environment or defaults to current origin
    API_BASE_URL: import.meta.env?.VITE_API_URL || window.location.origin,

    CACHE_DURATION: {
        SHORT: 5 * 60 * 1000,      // 5 minutes
        MEDIUM: 30 * 60 * 1000,    // 30 minutes
        LONG: 24 * 60 * 60 * 1000  // 24 hours
    }
};

console.log('API_BASE_URL:', CONFIG.API_BASE_URL);
console.log('Debug Mode:', CONFIG.debugMode);

// Utility Functions
// Fix the getCurrentOrganizationId function to handle object returns
export function getCurrentOrganizationId() {
    // Try both storage keys
    let orgId = localStorage.getItem('organizationId') || 
                localStorage.getItem('currentOrganizationId');
    
    // If it's stored as JSON object, parse and extract the ID
    if (orgId && orgId.startsWith('{')) {
        try {
            const parsed = JSON.parse(orgId);
            orgId = parsed.organizationId || parsed.id || parsed;
        } catch (e) {
            console.warn('Failed to parse organization ID from localStorage:', e);
        }
    }
    
    // Ensure it's a valid number/string, not "[object Object]"
    if (orgId && orgId !== '[object Object]' && orgId !== 'undefined') {
        return orgId;
    }
    
    return null;
}

export function getAuthHeader() {
  const token = localStorage.getItem("jwtToken");
  const organizationId = getCurrentOrganizationId(); // This function should return the right org ID
  
  console.log("=== GET AUTH HEADER DEBUG ===");
  console.log("Token exists:", !!token);
  console.log("Organization ID:", organizationId);
  console.log("Token preview:", token ? token.substring(0, 50) + "..." : "NO TOKEN");
  
  const headers = {};

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (organizationId) {
    headers['x-organization-id'] = organizationId;
  }

  console.log("Generated headers:", headers);
  console.log("=== END AUTH HEADER DEBUG ===");
  
  return headers;
}

function addCacheBuster(url) {
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}_=${Date.now()}`;
}

function debugLog(...args) {
    if (CONFIG.debugMode) {
        console.log(...args);
    }
}

function debugError(...args) {
    if (CONFIG.debugMode) {
        console.error(...args);
    }
}

// Enhanced URL builder
export function buildApiUrl(endpoint, params = {}) {
    const url = new URL(`/api/${endpoint}`, CONFIG.API_BASE_URL);
    
    // Add organization ID if not already present
    const organizationId = getCurrentOrganizationId();
    if (organizationId && !params.organization_id) {
        params.organization_id = organizationId;
    }

    // Add all parameters to URL
    Object.entries(params).forEach(([key, value]) => {
        if (value !== null && value !== undefined) {
            url.searchParams.append(key, value);
        }
    });

    return url.toString();
}

// Enhanced response handler with 401 handling
async function handleResponse(response) {
    const contentType = response.headers.get("content-type");
    
    if (!response.ok) {
        // Handle 401 Unauthorized specifically
        if (response.status === 401) {
            // Clear invalid auth data
            localStorage.removeItem("jwtToken");
            localStorage.removeItem("userRole");
            localStorage.removeItem("userFullName");
            localStorage.removeItem("userId");
            
            // Optionally redirect to login if not already there
            if (window.location.pathname !== '/login') {
                window.location.href = '/login';
            }
        }
        
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        
        try {
            if (contentType && contentType.includes("application/json")) {
                const errorData = await response.json();
                errorMessage = errorData.message || errorMessage;
            } else {
                const textError = await response.text();
                errorMessage = textError || errorMessage;
            }
        } catch (parseError) {
            debugError('Error parsing error response:', parseError);
        }
        
        throw new Error(errorMessage);
    }

    if (contentType && contentType.includes("application/json")) {
        return response.json();
    } else {
        throw new Error(`Unexpected response type: ${contentType}`);
    }
}

// Add this function to ajax-functions.js
export async function validateToken() {
    try {
        // Use a lightweight endpoint to check if token is valid
        const result = await API.get('test-connection');
        return result.success || false;
    } catch (error) {
        if (error.message.includes('401')) {
            return false;
        }
        throw error;
    }
}

// Or create a specific endpoint for token validation
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

// Core API request function
async function makeApiRequest(endpoint, options = {}) {
    const {
        method = 'GET',
        params = {},
        body = null,
        headers = {},
        cacheBuster = false,
        retries = 1
    } = options;

    let url = buildApiUrl(endpoint, params);
    if (cacheBuster) {
        url = addCacheBuster(url);
    }

    const requestConfig = {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...getAuthHeader(),
            ...headers
        }
    };

    if (body && method !== 'GET') {
        requestConfig.body = JSON.stringify(body);
    }

    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            debugLog(`API Request (attempt ${attempt + 1}):`, method, url);
            
            const response = await fetch(url, requestConfig);
            const result = await handleResponse(response);
            
            debugLog('API Response:', result);
            return result;
            
        } catch (error) {
            lastError = error;
            debugError(`API request failed (attempt ${attempt + 1}):`, error);
            
            if (attempt < retries) {
                // Wait before retry with exponential backoff
                await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
            }
        }
    }

    throw new Error(`Failed to complete API request after ${retries + 1} attempts: ${lastError.message}`);
}

// Enhanced caching function
async function makeApiRequestWithCache(endpoint, options = {}, cacheOptions = {}) {
    const {
        cacheKey = endpoint,
        cacheDuration = CONFIG.CACHE_DURATION.MEDIUM,
        forceRefresh = false
    } = cacheOptions;

    // Try cache first (unless force refresh)
    if (!forceRefresh) {
        try {
            const cachedData = await getCachedData(cacheKey);
            if (cachedData) {
                debugLog('Cache hit for:', cacheKey);
                return cachedData;
            }
        } catch (cacheError) {
            debugError('Cache retrieval failed:', cacheError);
        }
    }

    // Make API request
    const result = await makeApiRequest(endpoint, options);

    // Cache successful results
    if (result.success) {
        try {
            await setCachedData(cacheKey, result, cacheDuration);
            debugLog('Data cached for:', cacheKey);
        } catch (cacheError) {
            debugError('Failed to cache data:', cacheError);
        }
    }

    return result;
}

// Higher-level API functions
export const API = {
    // GET requests with optional caching
    async get(endpoint, params = {}, cacheOptions = {}) {
        return makeApiRequestWithCache(endpoint, { params }, cacheOptions);
    },

    // GET request without caching
    async getNoCache(endpoint, params = {}) {
        return makeApiRequest(endpoint, { params, cacheBuster: true });
    },

    // POST requests
    async post(endpoint, body = {}, params = {}) {
        return makeApiRequest(endpoint, { 
            method: 'POST', 
            body, 
            params 
        });
    },

    // PUT requests
    async put(endpoint, body = {}, params = {}) {
        return makeApiRequest(endpoint, { 
            method: 'PUT', 
            body, 
            params 
        });
    },

    // DELETE requests
    async delete(endpoint, params = {}) {
        return makeApiRequest(endpoint, { 
            method: 'DELETE', 
            params 
        });
    }
};

// Specific API endpoint functions - Examples of how to use the optimized API
export async function getParticipants() {
    return API.get('participants', {}, {
        cacheKey: 'participants',
        cacheDuration: CONFIG.CACHE_DURATION.MEDIUM
    });
}

export async function getParticipant(id) {
    return API.get(`participant/${id}`);
}

export async function saveParticipant(participantData) {
    return API.post('save-participant', participantData);
}

export async function getFormSubmission(participantId, formType) {
    return API.get('form-submission', { 
        participant_id: participantId, 
        form_type: formType 
    });
}

export async function saveFormSubmission(formData) {
    return API.post('save-form-submission', formData);
}

export async function getOrganizationFormFormats(organizationId = null) {
    const params = organizationId ? { organization_id: organizationId } : {};
    return API.get('organization-form-formats', params, {
        cacheKey: `org_form_formats_${organizationId || 'current'}`,
        cacheDuration: CONFIG.CACHE_DURATION.LONG
    });
}

export async function getParentContactList() {
    return API.get('parent-contact-list', {}, {
        cacheKey: 'parent_contact_list',
        cacheDuration: CONFIG.CACHE_DURATION.LONG
    });
}

export async function getPendingBadges() {
    return API.getNoCache('pending-badges');
}

export async function approveBadge(badgeId) {
    return API.post('approve-badge', { badge_id: badgeId });
}

export async function rejectBadge(badgeId) {
    return API.post('reject-badge', { badge_id: badgeId });
}

export async function getBadgeProgress(participantId) {
    return API.get('badge-progress', { participant_id: participantId });
}

export async function getBadgeSystemSettings() {
    return API.get('badge-system-settings', {}, {
        cacheKey: 'badge_system_settings',
        cacheDuration: CONFIG.CACHE_DURATION.LONG
    });
}

export async function saveBadgeProgress(progressData) {
    return API.post('save-badge-progress', progressData);
}

export async function getAttendance(date = null) {
    const params = date ? { date } : {};
    return API.get('attendance', params);
}

export async function updateAttendance(participantId, status, date, previousStatus = null) {
    return API.post('update-attendance', {
        participant_id: participantId,
        status,
        date,
        previous_status: previousStatus
    });
}

export async function getGroups() {
    return API.get('get_groups', {}, {
        cacheKey: 'groups',
        cacheDuration: CONFIG.CACHE_DURATION.MEDIUM
    });
}

export async function addGroup(groupName) {
    return API.post('add-group', { group_name: groupName });
}

export async function removeGroup(groupId) {
    return API.post('remove-group', { group_id: groupId });
}

export async function updateParticipantGroup(participantId, groupId, isLeader = false, isSecondLeader = false) {
    return API.post('update-participant-group', {
        participant_id: participantId,
        group_id: groupId,
        is_leader: isLeader,
        is_second_leader: isSecondLeader
    });
}

export async function updatePoints(updates) {
    return API.post('update-points', updates);
}

export async function getHonors(date = null) {
    const params = date ? { date } : {};
    return API.get('honors', params);
}

export async function awardHonor(honorData) {
    return API.post('award-honor', honorData);
}

export async function getRecentHonors() {
    return API.get('recent-honors', {}, {
        cacheKey: 'recent_honors',
        cacheDuration: CONFIG.CACHE_DURATION.SHORT
    });
}

// User Management Functions
export async function getPendingUsers() {
    return API.getNoCache('pending-users');
}

export async function approveUser(userId) {
    return API.post('approve-user', { user_id: userId });
}

export async function updateUserRole(userId, role) {
    return API.post('update-user-role', { user_id: userId, role });
}

export async function linkUserParticipants(userId, participantIds) {
    return API.post('link-user-participants', { 
        user_id: userId, 
        participant_ids: participantIds 
    });
}

// Reports Functions
export async function getHealthReport(groupId = null) {
    const params = groupId ? { group_id: groupId } : {};
    return API.get('health-report', params);
}

export async function getAttendanceReport(options = {}) {
    const params = {};
    if (options.startDate) params.start_date = options.startDate;
    if (options.endDate) params.end_date = options.endDate;
    if (options.groupId) params.group_id = options.groupId;
    if (options.format) params.format = options.format;
    return API.get('attendance-report', params);
}

export async function getMissingDocumentsReport() {
    return API.get('missing-documents-report');
}

export async function getPointsLeaderboard(type = 'individuals', limit = 10) {
    return API.get('points-leaderboard', { type, limit });
}

export async function getHonorsHistory(options = {}) {
    const params = {};
    if (options.startDate) params.start_date = options.startDate;
    if (options.endDate) params.end_date = options.endDate;
    if (options.participantId) params.participant_id = options.participantId;
    return API.get('honors-history', params);
}

// Parent Dashboard Function
export async function getParentDashboard() {
    return API.getNoCache('parent-dashboard');
}

export async function getCalendars() {
    return API.get('calendars');
}

export async function updateCalendar(participantId, amount) {
    return API.post('update-calendar', {
        participant_id: participantId,
        amount
    });
}

export async function getReports(reportType) {
    return API.get(`${reportType}-report`, {}, {
        cacheKey: `report_${reportType}`,
        cacheDuration: CONFIG.CACHE_DURATION.SHORT
    });
}

// Authentication functions
export async function login(email, password, organization_id) {
    try {
        // Get the organization ID properly
        const orgId = organization_id || getCurrentOrganizationId();
        
        if (!orgId) {
            throw new Error('Organization ID is required for login');
        }

        // Use JSON instead of FormData for consistency with your backend
        const requestBody = {
            email: email,
            password: password
        };

        console.log('Sending login request via ajax-functions.js...', email);
        
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

// Organization functions
export async function getOrganizationId() {
    const url = new URL('/public/get_organization_id', CONFIG.API_BASE_URL);
    
    const response = await fetch(url.toString(), {
        method: 'GET'
    });

    return handleResponse(response);
}

export async function fetchOrganizationId() {
    return getOrganizationId();
}

export async function createOrganization(name) {
    return API.post('create-organization', { name });
}

// Error handling wrapper for all functions
function withErrorHandling(fn) {
    return async function(...args) {
        try {
            return await fn.apply(this, args);
        } catch (error) {
            debugError(`Error in ${fn.name}:`, error);
            
            // Optionally show user-friendly error messages
            if (error.message.includes('401') || error.message.includes('Unauthorized')) {
                console.warn('Authentication required - redirecting to login');
                // Handle authentication errors
            }
            
            throw error;
        }
    };
}

// Apply error handling to key functions
export const getParticipantsWithErrorHandling = withErrorHandling(getParticipants);
export const saveParticipantWithErrorHandling = withErrorHandling(saveParticipant);

// Batch operations utility
export async function batchApiRequests(requests, concurrency = 3) {
    const results = [];
    
    for (let i = 0; i < requests.length; i += concurrency) {
        const batch = requests.slice(i, i + concurrency);
        const batchPromises = batch.map(request => {
            const { endpoint, options } = request;
            return makeApiRequest(endpoint, options);
        });
        
        const batchResults = await Promise.allSettled(batchPromises);
        results.push(...batchResults);
    }
    
    return results;
}

// Backwards compatibility aliases (to ease migration)
export const fetchFromApi = API.get;
export const getApiUrl = buildApiUrl;

// Export everything
export default {
    API,
    CONFIG,
    getCurrentOrganizationId,
    getAuthHeader,
    buildApiUrl,
    makeApiRequest,
    makeApiRequestWithCache,
    batchApiRequests,
    withErrorHandling
};

// Authentication & User Management
export async function logout() {
    const result = await API.post('logout');
    
    // Clear user-specific data but keep organization JWT
    localStorage.removeItem("userRole");
    localStorage.removeItem("userFullName");
    localStorage.removeItem("userId");
    
    return result;
}

export async function fetchParticipant(participantId) {
    return API.get(`participant/${participantId}`);
}

export async function getUsers(organizationId) {
    return API.get('users', { organization_id: organizationId });
}

export async function getSubscribers(organizationId) {
    return API.get('subscribers', { organization_id: organizationId });
}

// Guardian Management
export async function fetchGuardians(participantId) {
    return API.get('guardians', { participant_id: participantId });
}

export async function saveGuardian(guardianData) {
    return API.post('save-parent', guardianData);
}

export async function linkGuardianToParticipant(participantId, guardianId) {
    return API.post('link-guardian-to-participant', {
        participant_id: participantId,
        guardian_id: guardianId
    });
}

export async function fetchParents(participantId) {
    return API.get('parents-guardians', { participant_id: participantId });
}

export async function getGuardianCoreInfo(guardianId) {
    return API.get('guardian-info', { guardian_id: guardianId });
}

// Get guardians for a specific participant
export async function getGuardiansForParticipant(participantId) {
    return API.get('guardians-for-participant', { participant_id: participantId });
}

// Remove guardians from a participant
export async function removeGuardians(participantId, guardianIds) {
    return API.post('remove-guardians', {
        participant_id: participantId,
        guardian_ids: guardianIds
    });
}


// Forms & Documents

export async function getFormTypes() {
    return API.get('form-types', {}, {
        cacheKey: 'form_types',
        cacheDuration: CONFIG.CACHE_DURATION.LONG
    });
}

export async function getFormStructure() {
    return API.get('organization-form-formats', {}, {
        cacheKey: 'form_structure',
        cacheDuration: CONFIG.CACHE_DURATION.LONG
    });
}

// Calendar Functions
export async function updateCalendarPaid(participantId, isPaid) {
    return API.post('update-calendar-paid', {
        participant_id: participantId,
        paid: isPaid
    });
}

export async function updateCalendarAmountPaid(participantId, amountPaid) {
    return API.post('update-calendar-amount-paid', {
        participant_id: participantId,
        amount_paid: amountPaid
    });
}

export async function getParticipantCalendar(participantId) {
    return API.get('participant-calendar', { participant_id: participantId });
}

export async function getReunionDates() {
    return API.get('reunion-dates', {}, {
        cacheKey: 'reunion_dates',
        cacheDuration: CONFIG.CACHE_DURATION.MEDIUM
    });
}

export async function getAttendanceDates() {
    return API.get('attendance-dates', {}, {
        cacheKey: 'attendance_dates',
        cacheDuration: CONFIG.CACHE_DURATION.LONG
    });
}

export async function getAvailableDates() {
    return API.get('available-dates');
}

// Group Management
export async function updateGroupName(groupId, newName) {
    return API.post('update-group-name', {
        group_id: groupId,
        group_name: newName
    });
}

// User & Participant Management
export async function getParticipantsWithUsers() {
    return API.get('participants-with-users');
}

export async function getParentUsers() {
    return API.get('parent-users');
}

export async function associateUser(participantId, userId) {
    return API.post('associate-user', {
        participant_id: participantId,
        user_id: userId
    });
}

export async function getUserChildren(userId) {
    return API.get('user-children', { user_id: userId });
}

export async function registerForOrganization(registrationData) {
    return API.post('register-for-organization', registrationData);
}

// Reports
export async function getHonorsReport() {
    return API.get('honors-report', {}, {
        cacheKey: 'honors_report',
        cacheDuration: CONFIG.CACHE_DURATION.SHORT
    });
}

export async function getPointsReport() {
    return API.get('points-report', {}, {
        cacheKey: 'points_report',
        cacheDuration: CONFIG.CACHE_DURATION.SHORT
    });
}

export async function getParticipantAgeReport() {
    return API.get('participant-age-report', {}, {
        cacheKey: 'participant_age_report',
        cacheDuration: CONFIG.CACHE_DURATION.MEDIUM
    });
}

// Mailing & Communication
export async function getMailingList() {
    return API.get('mailing-list', {}, {
        cacheKey: 'mailing_list',
        cacheDuration: CONFIG.CACHE_DURATION.MEDIUM
    });
}

// Organization & Settings
export async function getOrganizationSettings(orgId = null) {
    const params = orgId ? { organization_id: orgId } : {};
    return API.get('organization-settings', params, {
        cacheKey: `org_settings_${orgId || 'current'}`,
        cacheDuration: CONFIG.CACHE_DURATION.LONG
    });
}

// Additional utility functions
export async function fetchParticipants(organizationId) {
    return API.get('parent-dashboard-data', { organization_id: organizationId });
}

export async function getHonorsAndParticipants(date = null) {
    const params = date ? { date } : {};
    return API.get('honors', params);
}

// Health & Document Reports
export async function getAllergiesReport() {
    return API.get('allergies-report', {}, {
        cacheKey: 'allergies_report',
        cacheDuration: CONFIG.CACHE_DURATION.SHORT
    });
}

export async function getMedicationReport() {
    return API.get('medication-report', {}, {
        cacheKey: 'medication_report',
        cacheDuration: CONFIG.CACHE_DURATION.SHORT
    });
}

export async function getVaccineReport() {
    return API.get('vaccine-report', {}, {
        cacheKey: 'vaccine_report',
        cacheDuration: CONFIG.CACHE_DURATION.SHORT
    });
}

export async function getLeaveAloneReport() {
    return API.get('leave-alone-report', {}, {
        cacheKey: 'leave_alone_report',
        cacheDuration: CONFIG.CACHE_DURATION.SHORT
    });
}

export async function getMediaAuthorizationReport() {
    return API.get('media-authorization-report', {}, {
        cacheKey: 'media_authorization_report',
        cacheDuration: CONFIG.CACHE_DURATION.SHORT
    });
}

export async function getHealthContactReport() {
    return API.get('health-contact-report', {}, {
        cacheKey: 'health_contact_report',
        cacheDuration: CONFIG.CACHE_DURATION.SHORT
    });
}

// Form Submissions & Document Tracking
export async function getFormSubmissions(participantId = null, formType) {
    const params = { form_type: formType };
    if (participantId) params.participant_id = participantId;
    return API.get('form-submissions', params);
}

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

// Health Forms
export async function fetchFicheSante(participantId) {
    return API.get('fiche-sante', { participant_id: participantId });
}

export async function saveFicheSante(ficheSanteData) {
    return API.post('save-fiche-sante', ficheSanteData);
}

// Risk Acceptance
export async function fetchAcceptationRisque(participantId) {
    return API.get('acceptation-risque', { participant_id: participantId });
}

export async function saveAcceptationRisque(data) {
    return API.post('save-acceptation-risque', data);
}

// Guest & Reunion Management
export async function getGuestsByDate(date) {
    return API.get('guests-by-date', { date });
}

export async function saveGuest(guest) {
    return API.post('save-guest', guest);
}

export async function getActivitesRencontre() {
    return API.get('activites-rencontre');
}

export async function getAnimateurs() {
    return API.get('animateurs');
}

export async function getReunionPreparation(date) {
    return API.get('reunion-preparation', { date });
}

export async function saveReunionPreparation(data) {
    return API.post('save-reunion-preparation', data);
}

// Utility & Miscellaneous
export async function getCurrentStars(participantId, territoire) {
    return API.get('current-stars', { participant_id: participantId, territoire });
}

export function checkLoginStatus() {
    return { isLoggedIn: !!localStorage.getItem('jwtToken') };
}

export async function linkParentToParticipant(participantId, guardianId) {
    return API.post('link-parent-to-participant', { participant_id: participantId, guardian_id: guardianId });
}

export async function saveParent(parentData) {
    return saveGuardian(parentData);
}

// Offline Sync
export async function syncOfflineData() {
    if (navigator.onLine) {
        const offlineData = await getOfflineData();
        for (const item of offlineData) {
            const { action, data } = item;
            switch (action) {
                case 'saveParticipant':
                    await saveParticipant(data);
                    break;
                case 'updateAttendance':
                    await updateAttendance(data.participantId, data.status, data.date, data.previousStatus);
                    break;
                case 'saveFormSubmission':
                    await saveFormSubmission(data);
                    break;
                // TODO: add other offline action cases as needed
            }
        }
        await clearOfflineData();
    }
}

// Authentication & Permissions
export async function refreshToken() {
    return API.post('refresh-token');
}

export async function checkPermission(permission) {
    return API.post('check-permission', { permission });
}

export async function verifyEmail(token) {
    return API.post('verify-email', { token });
}

export async function requestPasswordReset(email) {
    return API.post('request-reset', { email });
}

export async function resetPassword(token, newPassword) {
    return API.post('reset-password', { token, new_password: newPassword });
}

// User / Participant Management
export async function getParticipantDetails(participantId) {
    return API.get('participant-details', { participant_id: participantId });
}

export async function linkParticipantToOrganization(participantId, organizationId) {
    return API.post('link-participant-to-organization', { participant_id: participantId, organization_id: organizationId });
}

export async function removeParticipantFromOrganization(participantId, organizationId) {
    return API.post('remove-participant-from-organization', { participant_id: participantId, organization_id: organizationId });
}

// Guardian & Parent
export async function saveGuardianFormSubmission(formData) {
    return API.post('save-guardian-form-submission', formData);
}

// Badge
export async function getBadgeSummary() {
    return API.get('badge-summary', {}, {
        cacheKey: 'badge_summary',
        cacheDuration: CONFIG.CACHE_DURATION.MEDIUM
    });
}

export async function getBadgeHistory(participantId) {
    return API.get('badge-history', { participant_id: participantId }, {
        cacheKey: `badge_history_${participantId}`,
        cacheDuration: CONFIG.CACHE_DURATION.LONG
    });
}

export async function updateBadgeStatus(badgeId, status) {
    if (status === 'approved') {
        return approveBadge(badgeId);
    } else if (status === 'rejected') {
        return rejectBadge(badgeId);
    } else {
        throw new Error(`Invalid badge status: ${status}`);
    }
}

// Reunion & Utilities
export async function saveReminder(reminderData) {
    return API.post('save-reminder', reminderData);
}

export async function getReminder() {
    return API.get('reminder');
}

export async function getNextMeetingInfo() {
    return API.get('next-meeting-info');
}

export async function switchOrganization(organizationId) {
    return API.post('switch-organization', { organization_id: organizationId });
}

// Public Endpoints (no auth)
const PUBLIC_BASE = `${CONFIG.API_BASE_URL}public`;

async function fetchPublic(path, options = {}) {
    const url = new URL(path, PUBLIC_BASE);
    const res = await fetch(url.toString(), options);
    return handleResponse(res);
}

export async function testConnection() {
    return fetchPublic('/test-connection');
}

export async function getPublicOrganizationSettings() {
    return fetchPublic('/get_organization_settings');
}

export async function getNews() {
    return fetchPublic('/get_news');
}

export async function getInitialData() {
    return fetchPublic('/initial-data');
}

export async function authenticate(apiKey) {
    return fetchPublic('/authenticate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey })
    });
}

/**
 * Fetch organization JWT token
 * @param {string|number} organizationId - The organization ID
 * @returns {Promise<Object>} Response object with success, token, etc.
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

export async function validateCurrentToken() {
  const token = localStorage.getItem("jwtToken");
  
  if (!token) {
    console.log("No token to validate");
    return { isValid: false, reason: "no_token" };
  }
  
  try {
    // Try to decode the token client-side first
    const parts = token.split('.');
    if (parts.length !== 3) {
      console.log("Invalid token format");
      return { isValid: false, reason: "invalid_format" };
    }
    
    const payload = JSON.parse(atob(parts[1]));
    console.log("Token payload:", payload);
    
    // Check if expired
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      console.log("Token is expired");
      return { isValid: false, reason: "expired" };
    }
    
    console.log("Token appears valid client-side");
    return { isValid: true, payload };
  } catch (error) {
    console.error("Error validating token:", error);
    return { isValid: false, reason: "decode_error" };
  }
}
