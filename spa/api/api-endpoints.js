// api-endpoints.js
// All API endpoint functions organized by category
import { API, makeApiRequestWithCache } from "./api-core.js";
import { debugLog, debugError, debugWarn, debugInfo } from "../utils/DebugUtils.js";
import { CONFIG } from "../config.js";
import { fetchPublic, getCurrentOrganizationId, getAuthHeader } from "./api-helpers.js";
import { handleResponse } from "./api-core.js";
import {
    clearGroupRelatedCaches,
    clearBudgetCaches,
    clearFinanceRelatedCaches,
    clearExternalRevenueCaches,
    clearFundraiserRelatedCaches,
    clearBadgeRelatedCaches,
    clearPointsRelatedCaches
} from "../indexedDB.js";
import { buildApiCacheKey } from "../utils/OfflineCacheKeys.js";

async function invalidateMedicationCaches(extraKeys = []) {
    try {
        const { deleteCachedData } = await import('../indexedDB.js');
        const keys = [
            'medication_requirements',
            'participant_medications',
            'medication_distributions',
            'medication_distributions?upcoming_only=true',
            'fiche_medications',
            ...extraKeys
        ];

        await Promise.all(keys.map(async (key) => {
            try {
                await deleteCachedData(key);
            } catch (cacheError) {
                debugWarn('Failed to invalidate medication cache key', key, cacheError);
            }
        }));
    } catch (error) {
        debugError('Unable to invalidate medication caches', error);
    }
}

async function invalidateUserAssociationCaches() {
    try {
        const { deleteCachedData } = await import('../indexedDB.js');
        const cacheKeys = ['participants-with-users', 'parent-users'];

        await Promise.all(cacheKeys.map(async (cacheKey) => {
            try {
                await deleteCachedData(cacheKey);
            } catch (cacheError) {
                debugWarn('Failed to invalidate user association cache key', cacheKey, cacheError);
            }
        }));
    } catch (error) {
        debugError('Unable to invalidate user association caches', error);
    }
}

// ============================================================================
// PUBLIC ENDPOINTS (No Authentication Required)
// ============================================================================

/**
 * Test database connection
 */
export async function testConnection() {
    return API.get('v1/public/test-connection');
}

/**
 * Get organization ID based on hostname
 */
export async function getOrganizationId() {
    return API.get('v1/organizations/get_organization_id');
}

/**
 * Alias for backward compatibility
 */
export const getApiOrganizationId = getOrganizationId;

/**
 * Get public organization settings
 */
export async function getPublicOrganizationSettings() {
    return fetchPublic('settings');
}

/**
 * Get news for the organization
 */
export async function getPublicNews(lang = 'en') {
    return API.get('v1/public/news', { lang });
}

/**
 * Get initial data for frontend
 */
export async function getPublicInitialData() {
    return API.get('v1/public/initial-data');
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

        // Get device token from localStorage (if previously trusted)
        const deviceToken = localStorage.getItem('device_token') || '';

        const url = new URL('/public/login', CONFIG.API_BASE_URL);
        const response = await fetch(url.toString(), {
            method: "POST",
            headers: {
                'Content-Type': 'application/json',
                'x-organization-id': String(orgId),
                'x-device-token': deviceToken
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
 * Verify 2FA code and complete login
 */
export async function verify2FA(email, code, organization_id) {
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
            throw new Error('Organization ID is required for 2FA verification');
        }

        const requestBody = {
            email: email,
            code: code
        };

        debugLog('Sending 2FA verification request...', email);

        const url = new URL('/public/verify-2fa', CONFIG.API_BASE_URL);
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
                message: data?.message || 'invalid_2fa_code'
            };
        }

        // Store device token if returned
        if (data.device_token) {
            localStorage.setItem('device_token', data.device_token);
            debugLog('Device token stored for future logins');
        }

        return data;
    } catch (error) {
        debugError("Error during 2FA verification:", error);
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
    return API.post('api/auth/request-reset', { email });
}

/**
 * Reset password with token
 */
export async function resetPassword(token, newPassword) {
    return API.post('api/auth/reset-password', { token, new_password: newPassword });
}

/**
 * Refresh JWT token
 */
export async function refreshToken() {
    return API.post('refresh-token');
}

/**
 * Refresh JWT token
 */
export async function verifySession() {
    await API.post('api/auth/verify-session');
}

/**
 * Logout user
 */
export async function logout() {
    const result = await API.post('auth/logout');

    // Clear user-specific data but keep organization JWT
    localStorage.removeItem("userId");
    window.location.href = '/login.html';
    return result;
}

/**
 * Create new organization
 */
export async function createOrganization(data) {
    return API.post('v1/organizations', data);
}

// ============================================================================
// RESOURCES & PERMISSION SLIPS
// ============================================================================

/**
 * Equipment inventory list
 * @param {Object} params - Query parameters
 * @param {Object} cacheOptions - Cache options (e.g., { forceRefresh: true })
 */
export async function getEquipmentInventory(params = {}, cacheOptions = {}) {
    return API.get('v1/resources/equipment', params, cacheOptions);
}

/**
 * Create or update equipment
 */
export async function saveEquipmentItem(payload) {
    return API.post('v1/resources/equipment', payload);
}

/**
 * Update existing equipment item
 */
export async function updateEquipmentItem(id, payload) {
    return API.put(`v1/resources/equipment/${id}`, payload);
}

/**
 * Upload photo for equipment item
 * @param {number} equipmentId - Equipment ID
 * @param {File} file - Image file to upload
 * @returns {Promise<Object>} Upload result with photo_url
 */
export async function uploadEquipmentPhoto(equipmentId, file) {
    const formData = new FormData();
    formData.append('photo', file);

    const url = new URL(`/api/v1/resources/equipment/${equipmentId}/photo`, CONFIG.API_BASE_URL);
    const response = await fetch(url.toString(), {
        method: 'POST',
        headers: getAuthHeader(),
        body: formData
    });

    return handleResponse(response);
}

/**
 * Delete photo for equipment item
 * @param {number} equipmentId - Equipment ID
 * @returns {Promise<Object>} Delete result
 */
export async function deleteEquipmentPhoto(equipmentId) {
    return API.delete(`v1/resources/equipment/${equipmentId}/photo`);
}

/**
 * Delete equipment item (soft delete)
 * @param {number} equipmentId - Equipment ID
 * @returns {Promise<Object>} Delete result
 */
export async function deleteEquipmentItem(equipmentId) {
    return API.delete(`v1/resources/equipment/${equipmentId}`);
}

/**
 * Get reservations for equipment by meeting date
 */
export async function getEquipmentReservations(params = {}) {
    return API.get('v1/resources/equipment/reservations', params);
}

/**
 * Save an equipment reservation
 */
export async function saveEquipmentReservation(payload) {
    return API.post('v1/resources/equipment/reservations', payload);
}

/**
 * Update an equipment reservation
 */
export async function updateEquipmentReservation(id, payload) {
    return API.patch(`v1/resources/equipment/reservations/${id}`, payload);
}

/**
 * Save bulk equipment reservations for an activity
 */
export async function saveBulkReservations(payload) {
    return API.post('v1/resources/equipment/reservations/bulk', payload);
}

/**
 * Permission slip statuses
 */
export async function getPermissionSlips(params = {}, cacheOptions = {}) {
    const cacheKey = buildApiCacheKey('v1/resources/permission-slips', params);
    return API.get('v1/resources/permission-slips', params, {
        cacheKey,
        cacheDuration: CONFIG.CACHE_DURATION.SHORT,
        forceRefresh: cacheOptions.forceRefresh
    });
}

/**
 * Create or update a permission slip
 */
export async function savePermissionSlip(payload) {
    return API.post('v1/resources/permission-slips', payload);
}

/**
 * Archive a permission slip
 */
export async function archivePermissionSlip(id) {
    return API.patch(`v1/resources/permission-slips/${id}/archive`, {});
}

/**
 * Delete a permission slip (only if not sent)
 */
export async function deletePermissionSlip(id) {
    return API.delete(`v1/resources/permission-slips/${id}`);
}

/**
 * Capture signature for a permission slip
 */
export async function signPermissionSlip(id, payload) {
    return API.patch(`v1/resources/permission-slips/${id}/sign`, payload);
}

/**
 * Send emails to parents for permission slips
 */
export async function sendPermissionSlipEmails(payload) {
    return API.post('v1/resources/permission-slips/send-emails', payload);
}

/**
 * Send reminder emails to parents for unsigned permission slips
 */
export async function sendPermissionSlipReminders(payload) {
    return API.post('v1/resources/permission-slips/send-reminders', payload);
}

/**
 * Get public permission slip by token (no auth required)
 */
export async function getPublicPermissionSlip(token) {
    return API.get(`v1/resources/permission-slips/v/${token}`);
}

/**
 * Sign public permission slip by token (no auth required)
 */
export async function signPublicPermissionSlip(token, payload) {
    return API.patch(`v1/resources/permission-slips/s/${token}`, payload);
}

/**
 * Dashboard snapshot for resources and approvals
 */
export async function getResourceDashboard(params = {}, cacheOptions = {}) {
    const cacheKey = buildApiCacheKey('v1/resources/status/dashboard', params);
    return API.get('v1/resources/status/dashboard', params, {
        cacheKey,
        cacheDuration: CONFIG.CACHE_DURATION.SHORT,
        forceRefresh: cacheOptions.forceRefresh
    });
}

/**
 * Get all users for organization
 */
export async function getUsers(organizationId, cacheOptions = {}) {
    const orgId = organizationId || getCurrentOrganizationId();
    const params = orgId ? { organization_id: orgId } : {};
    const cacheKey = buildApiCacheKey('v1/users', params);

    try {
        return await API.get('v1/users', params, {
            cacheKey,
            cacheDuration: CONFIG.CACHE_DURATION.MEDIUM,
            forceRefresh: cacheOptions.forceRefresh
        });
    } catch (error) {
        debugWarn('v1/users unavailable, falling back to legacy /users', error);
        const fallbackCacheKey = buildApiCacheKey('users', params);
        return API.get('users', params, {
            cacheKey: fallbackCacheKey,
            cacheDuration: CONFIG.CACHE_DURATION.MEDIUM,
            forceRefresh: cacheOptions.forceRefresh
        });
    }
}

/**
 * Get available role catalog for the current organization scope
 */
export async function getRoleCatalog(options = {}) {
    const { forceRefresh = false, organizationId } = options || {};
    const params = organizationId ? { organization_id: organizationId } : {};
    const cacheKey = buildApiCacheKey('v1/roles', params);
    try {
        return await API.get('v1/roles', params, {
            cacheKey,
            cacheDuration: CONFIG.CACHE_DURATION.MEDIUM,
            forceRefresh
        });
    } catch (error) {
        debugWarn('v1/roles unavailable, using legacy /roles', error);
        const fallbackCacheKey = buildApiCacheKey('role_catalog', params);
        return API.get('roles', params, {
            cacheKey: fallbackCacheKey,
            cacheDuration: CONFIG.CACHE_DURATION.MEDIUM,
            forceRefresh
        });
    }
}

/**
 * Retrieve role bundles (metadata-first) with graceful fallback to role catalog.
 */
export async function getRoleBundles(options = {}) {
    const { forceRefresh = false, organizationId } = options || {};
    const params = organizationId ? { organization_id: organizationId } : {};
    const cacheKey = buildApiCacheKey('v1/roles/bundles', params);

    try {
        return await API.get('v1/roles/bundles', params, {
            cacheKey,
            cacheDuration: CONFIG.CACHE_DURATION.MEDIUM,
            forceRefresh
        });
    } catch (error) {
        debugWarn('v1/roles/bundles unavailable, falling back to catalog', error);
        return getRoleCatalog({ forceRefresh, organizationId });
    }
}

/**
 * Get a user's assigned roles within the current organization
 */
export async function getUserRoleAssignments(userId, cacheOptions = {}) {
    const cacheKey = buildApiCacheKey(`v1/users/${userId}/roles`, { organization_id: getCurrentOrganizationId() });
    return API.get(`v1/users/${userId}/roles`, {}, {
        cacheKey,
        cacheDuration: CONFIG.CACHE_DURATION.SHORT,
        forceRefresh: cacheOptions.forceRefresh
    });
}

/**
 * Update a user's role assignments (multi-role aware)
 * Returns the standardized API response
 */
export async function updateUserRolesV1(userId, roleIds, metadata = {}) {
    const payload = { roleIds };

    if (metadata.audit_note) {
        payload.audit_note = metadata.audit_note;
    }

    if (Array.isArray(metadata.bundles)) {
        payload.bundles = metadata.bundles;
    }

    const params = metadata.organizationId ? { organization_id: metadata.organizationId } : {};

    return API.put(`v1/users/${userId}/roles`, payload, params);
}

/**
 * Update a user's role bundles using the dedicated v1 endpoint, with role assignment fallback.
 */
export async function updateUserRoleBundles(userId, bundlePayload = {}, metadata = {}) {
    const params = metadata.organizationId ? { organization_id: metadata.organizationId } : {};
    const bundleNames = bundlePayload.bundles || metadata.bundles || [];
    const payload = {
        bundleIds: bundlePayload.bundleIds || bundleNames || [],
        roleIds: bundlePayload.roleIds || metadata.roleIds || [],
        audit_note: bundlePayload.audit_note || metadata.audit_note || metadata.auditNote,
    };

    if (bundlePayload.bundles && !payload.bundleIds.length) {
        payload.bundleIds = bundlePayload.bundles;
    }

    try {
        return await API.put(`v1/users/${userId}/role-bundles`, payload, params);
    } catch (error) {
        debugWarn('role-bundles endpoint unavailable, falling back to role assignment', error);
        if (Array.isArray(payload.roleIds) && payload.roleIds.length) {
            return updateUserRolesV1(userId, payload.roleIds, {
                ...metadata,
                audit_note: payload.audit_note,
                bundles: bundleNames.length ? bundleNames : payload.bundleIds
            });
        }
        throw error;
    }
}

/**
 * Fetch recent role assignment audit logs for a user.
 */
export async function getRoleAuditLog(userId, options = {}) {
    const { limit = 10, organizationId, forceRefresh = false } = options || {};
    const params = {
        user_id: userId,
        limit,
        organization_id: organizationId || getCurrentOrganizationId()
    };
    const cacheKey = buildApiCacheKey('v1/audit/roles', params);

    try {
        return await API.get('v1/audit/roles', params, {
            cacheKey,
            cacheDuration: CONFIG.CACHE_DURATION.SHORT,
            forceRefresh
        });
    } catch (error) {
        debugWarn('Audit log endpoint unavailable', error);
        return { success: false, data: [] };
    }
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
 * Subscribe to push notifications
 */
export async function subscribeToPush(subscription) {
    return API.post('v1/notifications/subscription', subscription);
}

/**
 * Clear cached user lists to ensure admin updates surface immediately
 *
 * @param {string|number|null} organizationId - Organization identifier for scoped caches
 */
export async function clearUserCaches(organizationId) {
    const { deleteCachedData } = await import('../indexedDB.js');
    const orgId = organizationId || getCurrentOrganizationId();
    const cacheKeys = new Set(['users', 'role_catalog', 'v1/users', 'v1/roles', 'v1/roles/bundles']);

    if (orgId) {
        cacheKeys.add(buildApiCacheKey('users', { organization_id: orgId }));
        cacheKeys.add(buildApiCacheKey('role_catalog', { organization_id: orgId }));
        cacheKeys.add(buildApiCacheKey('v1/users', { organization_id: orgId }));
        cacheKeys.add(buildApiCacheKey('v1/roles', { organization_id: orgId }));
        cacheKeys.add(buildApiCacheKey('v1/roles/bundles', { organization_id: orgId }));
    }

    for (const key of cacheKeys) {
        try {
            await deleteCachedData(key);
        } catch (error) {
            debugWarn('Failed to clear user cache key', key, error);
        }
    }
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
    return API.post('users/update-role', { user_id: userId, role });
}

/**
 * Retrieve permissions for a specific role with organization scoping.
 */
export async function getRolePermissions(roleId, options = {}) {
    const { organizationId, forceRefresh = false } = options || {};
    const params = organizationId ? { organization_id: organizationId } : {};
    const cacheKey = buildApiCacheKey(`roles/${roleId}/permissions`, params);
    return API.get(`roles/${roleId}/permissions`, params, {
        cacheKey,
        cacheDuration: CONFIG.CACHE_DURATION.SHORT,
        forceRefresh
    });
}

/**
 * List organizations the current user belongs to.
 */
export async function getUserOrganizations(options = {}) {
    const { forceRefresh = false } = options || {};
    return API.get('user-organizations', {}, {
        cacheKey: 'user-organizations',
        cacheDuration: CONFIG.CACHE_DURATION.MEDIUM,
        forceRefresh
    });
}



/**
 * Link user to multiple participants
 */
export async function linkUserParticipants(userId, participantIds) {
    return API.post('v1/participants/link-users', {
        user_id: userId,
        participant_ids: participantIds
    });
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
 * Get participants with their associated user information
 */
export async function getParticipantsWithUsers() {
    return API.get('v1/participants/with-users');
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
    return API.get('v1/participants/details', { participant_id: participantId });
}

/**
 * Save or update participant
 */
export async function saveParticipant(participantData) {
    return API.post('v1/participants/save', participantData);
}

/**
 * Get participant age report
 */
export async function getParticipantAge() {
    return API.get('v1/participants/ages', {}, {
        cacheKey: 'participant_age',
        cacheDuration: CONFIG.CACHE_DURATION.MEDIUM
    });
}

/**
 * Get participants with linked users
 * @param {boolean} [forceRefresh=false] */
export async function fetchParticipantsWithUsers(forceRefresh = false) {
    return API.get('v1/participants/with-users', {}, { forceRefresh });
}

/**
 * Link participant to organization
 */
export async function linkParticipantToOrganization(participantId, organizationId, inscriptionDate = null) {
    const body = {
        participant_id: participantId,
        organization_id: organizationId
    };
    if (inscriptionDate) {
        body.inscription_date = inscriptionDate;
    }
    return API.post('v1/participants/link-organization', body);
}

/**
 * Remove participant from organization (admin only)
 */
export async function removeParticipantFromOrganization(participantId, organizationId) {
    const response = await API.delete(`v1/participants/${participantId}`);

    if (response?.success) {
        await invalidateUserAssociationCaches();
    }

    return response;
}

/**
 * Associate user to participant
 */
export async function associateUser(participantId, userId) {
    const response = await API.post('v1/participants/associate-user', {
        participant_id: participantId,
        user_id: userId
    });

    if (response?.success) {
        await invalidateUserAssociationCaches();
    }

    return response;
}

/**
 * Link user to participants
 */
export async function linkUserToParticipants(participantIds, userId = null) {
    try {
        if (userId) {
            return API.post('v1/participants/link-users', {
                user_id: userId,
                participant_ids: participantIds
            });
        }
        return API.post('v1/participants/link-users', {
            participant_ids: participantIds
        });
    } catch (error) {
        // Handle error if needed
        throw error;
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
    return API.get('v1/guardians');
}

/**
 * Fetch push notification subscribers
 */
export async function fetchPushSubscribers() {
    return API.get('v1/notifications/subscribers');
}

/**
 * Fetch guardians for a participant
 */
export async function fetchGuardians(participantId) {
    return API.get('v1/guardians', { participant_id: participantId });
}

/**
 * Get guardian info by ID
 */
export async function getGuardianInfo(guardianId) {
    return API.get('v1/guardians/info', { guardian_id: guardianId });
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
    return API.get('v1/guardians', { participant_id: participantId });
}

/**
 * Save parent/guardian
 */
export async function saveParent(parentData) {
    return API.post('v1/guardians', parentData);
}

/**
 * Save guardian (alias for saveParent)
 */
export async function saveGuardian(guardianData) {
    return API.post('v1/guardians', guardianData);
}

/**
 * Save guardian form submission
 */
export async function saveGuardianFormSubmission(formData) {
    return API.post('v1/guardians/form-submission', formData);
}

/**
 * Link parent to participant
 */
export async function linkParentToParticipant(parentId, participantId) {
    return API.post('v1/participants/link-parent', {
        parent_id: parentId,
        participant_id: participantId
    });
}

/**
 * Link guardian to participant (alias)
 */
export async function linkGuardianToParticipant(participantId, guardianId) {
    return API.post('v1/participants/link-parent', {
        participant_id: participantId,
        parent_id: guardianId
    });
}

/**
 * Remove guardians from participant
 */
export async function removeGuardians(participantId, guardianIds) {
    // Assuming backend might handle bulk or we iterate if needed
    // For now, mapping to updated path
    return API.post('v1/participants/remove-guardians', {
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
export async function getParentUsers(forceRefresh = false) {
    return API.get('v1/users/parents', {}, { forceRefresh });
}

/**
 * Get parent dashboard data
 */
export async function getParentDashboard() {
    return API.getNoCache('v1/dashboards/parent');
}

/**
 * Get parent contact list
 */
export async function getParentContactList() {
    return API.get('v1/reports/parent-contact-list', {}, {
        cacheKey: 'parent_contact_list',
        cacheDuration: CONFIG.CACHE_DURATION.LONG
    });
}

/**
 * Get user children
 */
export async function getUserChildren(userId) {
    return API.get('v1/users/children', { user_id: userId });
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
    const result = await API.post('v1/groups', { name: groupName });
    await clearGroupRelatedCaches();
    return result;
}

/**
 * Remove group
 */
export async function removeGroup(groupId) {
    const result = await API.delete(`v1/groups/${groupId}`);
    await clearGroupRelatedCaches();
    return result;
}

/**
 * Update group name
 */
export async function updateGroupName(groupId, newName) {
    const payload = {};

    if (newName !== undefined) {
        payload.name = newName;
    }

    const result = await API.put(`v1/groups/${groupId}`, payload);
    await clearGroupRelatedCaches();
    return result;
}

/**
 * Update participant's group membership (RESTful v1 endpoint)
 */
export async function updateParticipantGroup(
    participantId,
    groupId,
    firstLeader = false,
    secondLeader = false,
    roles = null
) {
    const result = await API.patch(`v1/participants/${participantId}/group-membership`, {
        group_id: groupId,
        first_leader: firstLeader,
        second_leader: secondLeader,
        roles
    });
    await clearGroupRelatedCaches();
    return result;
}

/**
 * Update points for participants/groups
 */
export async function updatePoints(updates) {
    const result = await API.post('v1/points', updates);
    await clearPointsRelatedCaches();
    return result;
}

/**
 * Get points report
 */
export async function getPointsReport() {
    return API.get('v1/points/report', {}, {
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
    return API.get('reports/participant-progress', params, {
        cacheKey,
        cacheDuration: CONFIG.CACHE_DURATION.SHORT
    });
}

/**
 * Get points leaderboard
 */
export async function getPointsLeaderboard(type = 'individuals', limit = 10) {
    return API.get('v1/points/leaderboard', { type, limit });
}

// ============================================================================
// FORMS & DOCUMENTS
// ============================================================================

/**
 * Get available form types
 */
export async function getFormTypes() {
    return API.get('v1/forms/types', {}, {
        cacheKey: 'form_types',
        cacheDuration: CONFIG.CACHE_DURATION.LONG
    });
}

/**
 * Get form structure
 */
export async function getFormStructure() {
    return API.get('v1/forms/structure', {}, {
        cacheKey: 'form_structure',
        cacheDuration: CONFIG.CACHE_DURATION.LONG
    });
}

/**
 * Get form submission
 */
export async function getFormSubmission(participantId, formType) {
    return API.get('v1/forms/submissions', {
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
    return API.get('v1/forms/submissions', params);
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
        // Use standardized endpoint
        const response = await API.post('v1/forms/submissions', {
            participant_id: pId || participantId,
            form_type: formType,
            submission_data: submissionData
        });

        // Clear cache for this specific form submission
        if (formType && pId) {
            await deleteCachedData(`form-submission-${formType}-${pId}`);
        }

        return response;
    }
}

/**
 * Get organization form formats
 *
 * @param {number|null} organizationId - Optional organization ID
 * @param {string|null} context - Optional display context filter (participant, organization, admin_panel, public, form_builder)
 * @returns {Promise<Object>} Form formats object
 */
export async function getOrganizationFormFormats(organizationId = null, context = null) {
    const params = {};

    if (organizationId) {
        params.organization_id = organizationId;
    }

    if (context) {
        params.context = context;
    }

    const cacheKey = `org_form_formats_${organizationId || 'current'}_${context || 'all'}`;

    const response = await API.get('v1/forms/formats', params, {
        cacheKey: cacheKey,
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
    return API.get('v1/forms/submissions', { participant_id: participantId, form_type: 'fiche_sante' }, {
        cacheKey: `fiche-sante-${participantId}`
    });
}

/**
 * Save health form
 */
export async function saveFicheSante(ficheSanteData) {
    const { deleteCachedData } = await import('../indexedDB.js');
    const result = await API.post('v1/forms/submissions', {
        ...ficheSanteData,
        form_type: 'fiche_sante'
    });

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
    return API.get('v1/forms/risk-acceptance', { participant_id: participantId }, {
        cacheKey: `acceptation-risque-${participantId}`
    });
}

/**
 * Save risk acceptance form
 */
export async function saveAcceptationRisque(data) {
    const { deleteCachedData } = await import('../indexedDB.js');
    const result = await API.post('v1/forms/risk-acceptance', data);

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
    const response = await API.get('v1/participants/details');
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

/**
 * Get risk acceptance form
 */
export async function getRiskAcceptance(participantId) {
    return API.get('v1/forms/risk-acceptance', { participant_id: participantId });
}

/**
 * Save risk acceptance form
 */
export async function saveRiskAcceptance(participantId, riskData) {
    return API.post('v1/forms/risk-acceptance', {
        participant_id: participantId,
        ...riskData
    });
}

// ============================================================================
// BADGES
// ============================================================================

/**
 * Get badge progress for participant
 */
export async function getBadgeProgress(participantId) {
    return API.get('v1/badges/progress', { participant_id: participantId });
}

/**
 * Save badge progress
 */
export async function saveBadgeProgress(progressData) {
    const result = await API.post('v1/badges/progress', progressData);
    await clearBadgeRelatedCaches();
    return result;
}

/**
 * Get pending badges for approval
 */
export async function getPendingBadges() {
    return API.getNoCache('v1/badges/pending');
}

/**
 * Get current stars for participant
 */
export async function getCurrentStars(participantId, templateId = null, territoire = null) {
    const params = { participant_id: participantId };
    if (templateId) params.badge_template_id = templateId;
    if (territoire) params.territoire = territoire;
    return API.get('v1/badges/stars', params);
}

/**
 * Approve badge
 */
export async function approveBadge(badgeId) {
    const result = await API.post('v1/badges/approve', { badge_id: badgeId });
    await clearBadgeRelatedCaches();
    return result;
}

/**
 * Reject badge
 */
export async function rejectBadge(badgeId) {
    const result = await API.post('v1/badges/reject', { badge_id: badgeId });
    await clearBadgeRelatedCaches();
    return result;
}

/**
 * Get badge summary
 */
export async function getBadgeSummary() {
    return API.get('v1/badges/summary');
}

/**
 * Get badge history for participant
 */
export async function getBadgeHistory(participantId) {
    return API.get('v1/badges/history', { participant_id: participantId });
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
    return API.put(`v1/badges/badge-progress/${badgeId}`, updates);
}

/**
 * Get badge system settings
 */
export async function getBadgeSystemSettings() {
    return API.get('v1/badges/settings', {}, {
        cacheKey: 'badge_system_settings',
        cacheDuration: CONFIG.CACHE_DURATION.LONG
    });
}

/**
 * Get badge system settings
 */
export async function fetchPublicOrganizationSettings() {
    return fetchPublic('settings');
}

/**
 * Get badges awaiting physical delivery
 */
export async function getBadgesAwaitingDelivery() {
    return API.getNoCache('v1/badges/badges-awaiting-delivery');
}

/**
 * Mark badge as physically delivered
 */
export async function markBadgeDelivered(badgeId) {
    const result = await API.post('v1/badges/mark-badge-delivered', { badge_id: badgeId });
    await clearBadgeRelatedCaches();
    return result;
}

/**
 * Mark multiple badges as delivered in bulk
 */
export async function markBadgesDeliveredBulk(badgeIds) {
    const result = await API.post('v1/badges/mark-badges-delivered-bulk', { badge_ids: badgeIds });
    await clearBadgeRelatedCaches();
    return result;
}

/**
 * Get comprehensive badge tracker summary
 */
export async function getBadgeTrackerSummary(cacheOptions = {}) {
    return API.get('v1/badges/badge-tracker-summary', {}, {
        cacheKey: 'badge_tracker_summary',
        cacheDuration: CONFIG.CACHE_DURATION.SHORT,
        forceRefresh: cacheOptions.forceRefresh
    });
}

// ============================================================================
// HONORS
// ============================================================================

/**
 * Get honors for a date (v1 - permission-based)
 */
export async function getHonors(date = null) {
    const params = date ? { date } : {};
    return API.get('v1/honors', params);
}

/**
 * Get meeting for parent dashboard
 */
export async function getMeetingParent(date = null) {
    const params = date ? { date } : {};
    return API.get('v1/meetings/preparation', params);
}

/**
 * Get honors and participants (alias)
 */
export async function getHonorsAndParticipants(date = null) {
    return getHonors(date);
}

/**
 * Get recent honors (legacy endpoint)
 */
export async function getRecentHonors() {
    return API.get('v1/honors/recent', {}, {
        cacheKey: 'recent_honors',
        cacheDuration: CONFIG.CACHE_DURATION.SHORT
    });
}

/**
 * Award honor to participant (v1 - permission-based)
 */
export async function awardHonor(honorData) {
    return API.post('v1/honors', honorData);
}

/**
 * Get honors report (legacy endpoint)
 */
export async function getHonorsReport() {
    return API.get('v1/reports/honors', {}, {
        cacheKey: 'honors_report',
        cacheDuration: CONFIG.CACHE_DURATION.SHORT
    });
}

/**
 * Get honors history (v1 - permission-based)
 */
export async function getHonorsHistory(options = {}) {
    const params = {};
    if (options.startDate) params.start_date = options.startDate;
    if (options.endDate) params.end_date = options.endDate;
    if (options.participantId) params.participant_id = options.participantId;
    return API.get('v1/honors/history', params);
}

/**
 * Get available dates for honors
 */
export async function getAvailableDates() {
    return API.get('v1/meetings/dates');
}

/**
 * Update honor (date or reason) - v1 permission-based
 * @param {number} honorId - Honor ID
 * @param {Object} updates - Fields to update { date?, reason? }
 * @returns {Promise}
 */
export async function updateHonor(honorId, updates) {
    return API.patch(`v1/honors/${honorId}`, updates);
}

/**
 * Delete honor and associated points - v1 permission-based
 * @param {number} honorId - Honor ID
 * @returns {Promise}
 */
export async function deleteHonor(honorId) {
    return API.delete(`v1/honors/${honorId}`);
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
    return API.get('v1/reports/attendance', params);
}

// ============================================================================
// CALENDAR
// ============================================================================

/**
 * Get all calendars
 */
export async function getCalendars() {
    return API.get('v1/calendars');
}

/**
 * Update calendar amount
 */
export async function updateCalendar(participantId, amount) {
    return API.post('v1/calendars/update-calendar', {
        participant_id: participantId,
        amount
    });
}

/**
 * Update calendar paid status
 */
export async function updateCalendarPaid(participantId, isPaid) {
    return API.post('v1/calendars/update-calendar-paid', {
        participant_id: participantId,
        paid: isPaid
    });
}

/**
 * Update calendar amount paid
 */
export async function updateCalendarAmountPaid(participantId, amountPaid) {
    return API.post('v1/calendars/update-calendar-amount-paid', {
        participant_id: participantId,
        amount_paid: amountPaid
    });
}


// ============================================================================
// FUNDRAISERS
// ============================================================================

/**
 * Get all fundraisers
 */
export async function getFundraisers(includeArchived = false) {
    return API.get('v1/fundraisers', { include_archived: includeArchived });
}

/**
 * Get fundraiser details
 */
export async function getFundraiserDetails(fundraiserId) {
    return API.get(`v1/fundraisers/${fundraiserId}`);
}

/**
 * Save fundraiser
 */
export async function saveFundraiser(fundraiserData) {
    return API.post('v1/fundraisers', fundraiserData);
}

/**
 * Archive/unarchive fundraiser
 */
export async function archiveFundraiser(fundraiserId, archived) {
    return API.put(`v1/fundraisers/${fundraiserId}/archive`, { archived });
}

/**
 * Get fundraiser entries (calendars)
 */
export async function getCalendarsForFundraiser(fundraiserId) {
    return API.get('v1/calendars', { fundraiser_id: fundraiserId });
}

/**
 * Update fundraiser entry
 */
export async function updateCalendarEntry(id, data) {
    return API.put(`v1/calendars/${id}`, data);
}

/**
 * Update payment for fundraiser entry
 */
export async function updateCalendarPayment(id, amountPaid) {
    return API.put(`v1/calendars/${id}/payment`, { amount_paid: amountPaid });
}

/**
 * Get participant fundraiser entries
 */
export async function getParticipantCalendar(participantId) {
    return API.get('v1/calendars/participant', { participant_id: participantId });
}

// ============================================================================
// REUNIONS / MEETINGS
// ============================================================================

/**
 * Get reunion preparation for a date
 */

/**
 * Get unprocessed achievements from past meetings
 */
export async function getUnprocessedAchievements() {
    return API.get('v1/meetings/achievements/unprocessed');
}

/**
 * Get reunion preparation for a date
 */
export async function getReunionPreparation(date) {
    return API.get('v1/meetings/preparation', { date }, {
        cacheKey: `reunion_preparation_${date}`,
        cacheDuration: CONFIG.CACHE_DURATION.MEDIUM
    });
}

/**
 * Save meeting (SISC)
 */
export async function saveReunionPreparation(preparationData) {
    return API.post('v1/meetings/preparation', preparationData);
}

/**
 * Get available meeting dates
 */
export async function getReunionDates() {
    return API.get('v1/meetings/dates');
}

/**
 * Get meeting activities
 */
export async function getActivitesRencontre() {
    return API.get('v1/meetings/activities');
}

/**
 * Get all activities for the organization
 * @param {Object} params - Query parameters (e.g., { upcoming_only: true })
 * @param {Object} cacheOptions - Cache options (e.g., { forceRefresh: true })
 * @returns {Promise<Object>} Response with activities array
 */
export async function getActivities(params = {}, cacheOptions = {}) {
    return API.get('v1/activities', params, cacheOptions);
}

/**
 * Save reminder
 */
export async function saveReminder(reminderData) {
    return API.post('v1/meetings/reminders', reminderData);
}

/**
 * Get reminder for date
 */
export async function getReminder() {
    return API.get('v1/meetings/reminders');
}

/**
 * Get next meeting info
 */
export async function getNextMeetingInfo() {
    return API.get('v1/meetings/next');
}

/**
 * Get guests for a date
 */
export async function getGuests(date = null) {
    const params = date ? { date } : {};
    return API.get('v1/meetings/guests', params);
}

/**
 * Save a guest
 */
export async function saveGuest(guestData) {
    return API.post('v1/meetings/guests', guestData);
}

/**
 * Get meeting reminder
 */
export async function getMeetingReminder() {
    return API.get('v1/meetings/reminder');
}

/**
 * Save meeting reminder
 */
export async function saveMeetingReminder(reminderData) {
    return API.post('v1/meetings/reminder', reminderData);
}

/**
 * Get meeting activity types
 */
export async function getMeetingActivities() {
    return API.get('v1/meetings/activities');
}

/**
 * Get meeting templates
 */
export async function getMeetingTemplates() {
    return API.get('v1/meetings/templates');
}

/**
 * Get animators
 */
export async function getAnimateurs() {
    return API.get('v1/users/animateurs');
}

// ============================================================================
// REPORTS
// ============================================================================

/**
 * Get health contact report
 */
export async function fetchHealthContactReport() {
    return API.get('v1/reports/health-contacts', {}, {
        cacheKey: 'health_contact_report',
        cacheDuration: CONFIG.CACHE_DURATION.SHORT
    });
}

/**
 * Fetch general health report with group filter
 */
export async function fetchHealthReport(params = {}) {
    return API.get('v1/reports/health', params);
}

/**
 * Fetch allergies report
 */
export async function fetchAllergiesReport() {
    return API.get('v1/reports/allergies', {}, {
        cacheKey: 'allergies_report',
        cacheDuration: CONFIG.CACHE_DURATION.SHORT
    });
}

/**
 * Fetch medication report
 */
export async function fetchMedicationReport() {
    return API.get('v1/reports/medication', {}, {
        cacheKey: 'medication_report',
        cacheDuration: CONFIG.CACHE_DURATION.SHORT
    });
}


// ============================================================================
// MEDICATION MANAGEMENT
// ============================================================================

/**
 * Get medication requirements for the organization
 */
export async function getMedicationRequirements(cacheOptions = {}) {
    return API.get('v1/medication/requirements', {}, {
        cacheKey: 'medication_requirements',
        cacheDuration: CONFIG.CACHE_DURATION.SHORT,
        ...cacheOptions
    });
}

/**
 * Get distinct medications from fiche_sante submissions
 */
export async function getFicheMedications(cacheOptions = {}) {
    return API.get('v1/medication/fiche-medications', {}, {
        cacheKey: 'fiche_medications',
        cacheDuration: CONFIG.CACHE_DURATION.SHORT,
        ...cacheOptions
    });
}

/**
 * Create or update a medication requirement
 */
export async function saveMedicationRequirement(payload) {
    const hasId = Boolean(payload?.id);
    const endpoint = hasId ? `v1/medication/requirements/${payload.id}` : 'v1/medication/requirements';
    const result = hasId ? await API.put(endpoint, payload) : await API.post(endpoint, payload);

    if (result?.success) {
        await invalidateMedicationCaches();
    }

    return result;
}

/**
 * Get participant-medication assignments
 */
export async function getParticipantMedications(params = {}, cacheOptions = {}) {
    const cacheKey = buildApiCacheKey('participant_medications', params);
    return API.get('v1/medication/participant-medications', params, {
        cacheKey,
        cacheDuration: CONFIG.CACHE_DURATION.SHORT,
        ...cacheOptions
    });
}

/**
 * Get medication distributions (scheduled and historical)
 */
export async function getMedicationDistributions(params = {}, cacheOptions = {}) {
    const cacheKey = buildApiCacheKey('medication_distributions', params);
    return API.get('v1/medication/distributions', params, {
        cacheKey,
        cacheDuration: CONFIG.CACHE_DURATION.SHORT,
        ...cacheOptions
    });
}

/**
 * Create medication distribution rows (single participant per call)
 */
export async function recordMedicationDistribution(payload) {
    const result = await API.post('v1/medication/distributions', payload);

    if (result?.success) {
        await invalidateMedicationCaches();
    }

    return result;
}

/**
 * Mark a medication distribution entry as given
 */
export async function markMedicationDistributionAsGiven(distributionId, payload) {
    const result = await API.patch(`v1/medication/distributions/${distributionId}`, payload);

    if (result?.success) {
        await invalidateMedicationCaches();
    }

    return result;
}

/**
 * Get medication receptions for an activity
 */
export async function getMedicationReceptions(params = {}, cacheOptions = {}) {
    const cacheKey = buildApiCacheKey('medication_receptions', params);
    return API.get('v1/medication/receptions', params, {
        cacheKey,
        cacheDuration: CONFIG.CACHE_DURATION.SHORT,
        ...cacheOptions
    });
}

/**
 * Create or update medication reception record
 */
export async function saveMedicationReception(payload) {
    const result = await API.post('v1/medication/receptions', payload);

    if (result?.success) {
        await invalidateMedicationCaches();
    }

    return result;
}

/**
 * Update medication reception record
 */
export async function updateMedicationReception(receptionId, payload) {
    const result = await API.patch(`v1/medication/receptions/${receptionId}`, payload);

    if (result?.success) {
        await invalidateMedicationCaches();
    }

    return result;
}

/**
 * Delete medication reception record
 */
export async function deleteMedicationReception(receptionId) {
    const result = await API.delete(`v1/medication/receptions/${receptionId}`);

    if (result?.success) {
        await invalidateMedicationCaches();
    }

    return result;
}

/**
 * Get first aid supplies for the organization
 */
export async function getFirstAidSupplies() {
    return API.get('v1/medication/first-aid-supplies', {}, {
        cacheKey: 'first_aid_supplies',
        cacheDuration: CONFIG.CACHE_DURATION.LONG
    });
}

/**
 * Get medication authorizations (treatment + administration) for a participant
 */
export async function getMedicationAuthorizations(participantId) {
    return API.get(`v1/medication/authorizations/${participantId}`);
}

/**
 * Save a PDF A treatment authorization
 */
export async function saveTreatmentAuthorization(payload) {
    return API.post('v1/medication/authorizations/treatment', payload);
}

/**
 * Save a PDF B administration authorization
 */
export async function saveAdministrationAuthorization(payload) {
    return API.post('v1/medication/authorizations/administration', payload);
}


/**
 * Get vaccine report
 */
export async function getVaccineReport() {
    return API.get('v1/reports/vaccines', {}, {
        cacheKey: 'vaccine_report',
        cacheDuration: CONFIG.CACHE_DURATION.SHORT
    });
}

/**
 * Get leave alone authorization report
 */
export async function getLeaveAloneReport() {
    return API.get('v1/reports/leave-alone', {}, {
        cacheKey: 'leave_alone_report',
        cacheDuration: CONFIG.CACHE_DURATION.SHORT
    });
}

/**
 * Get media authorization report
 */
export async function getMediaAuthorizationReport() {
    return API.get('v1/reports/media-authorization', {}, {
        cacheKey: 'media_authorization_report',
        cacheDuration: CONFIG.CACHE_DURATION.SHORT
    });
}

/**
 * Get missing documents report
 */
export async function getMissingDocumentsReport() {
    return API.get('v1/reports/missing-documents');
}

/**
 * Get mailing list
 */
export async function getMailingList() {
    return API.get('v1/reports/mailing-list', {}, {
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
    return API.get(`v1/reports/${reportType}`, {}, {
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
    const result = await API.post('v1/finance/fee-definitions', payload);
    await clearFinanceRelatedCaches();
    return result;
}

/**
 * Update a fee definition
 */
export async function updateFeeDefinition(id, payload) {
    const result = await API.put(`v1/finance/fee-definitions/${id}`, payload);
    await clearFinanceRelatedCaches();
    return result;
}

/**
 * Delete a fee definition
 */
export async function deleteFeeDefinition(id) {
    const result = await API.delete(`v1/finance/fee-definitions/${id}`);
    await clearFinanceRelatedCaches();
    return result;
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
    const result = await API.post('v1/finance/participant-fees', payload);
    await clearFinanceRelatedCaches();
    return result;
}

/**
 * Update participant fee
 */
export async function updateParticipantFee(id, payload) {
    const result = await API.put(`v1/finance/participant-fees/${id}`, payload);
    await clearFinanceRelatedCaches(id);
    return result;
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
    const result = await API.post(`v1/finance/participant-fees/${participantFeeId}/payments`, payload);
    await clearFinanceRelatedCaches(participantFeeId);
    return result;
}

/**
 * Update an existing payment
 */
export async function updatePayment(paymentId, payload) {
    const result = await API.put(`v1/finance/payments/${paymentId}`, payload);
    await clearFinanceRelatedCaches();
    return result;
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
// STRIPE PAYMENTS
// ============================================================================

/**
 * Create a Stripe payment intent for a participant fee
 */
export async function createStripePaymentIntent(participant_fee_id, amount) {
    return API.post('v1/stripe/create-payment-intent', {
        participant_fee_id,
        amount
    });
}

/**
 * Get the status of a Stripe payment intent
 */
export async function getStripePaymentStatus(paymentIntentId) {
    return API.get(`v1/stripe/payment-status/${paymentIntentId}`);
}

// ============================================================================
// BUDGET
// ============================================================================

/**
 * Get budget categories for the current organization
 */
export async function getBudgetCategories(params = {}, cacheOptions = {}) {
    return API.get('v1/budget/categories', params, {
        cacheKey: 'budget_categories',
        cacheDuration: CONFIG.CACHE_DURATION.MEDIUM,
        forceRefresh: cacheOptions.forceRefresh
    });
}

/**
 * Create a budget category
 */
export async function createBudgetCategory(payload) {
    const result = await API.post('v1/budget/categories', payload);
    await clearBudgetCaches();
    return result;
}

/**
 * Update a budget category
 */
export async function updateBudgetCategory(id, payload) {
    const result = await API.put(`v1/budget/categories/${id}`, payload);
    await clearBudgetCaches();
    return result;
}

/**
 * Delete a budget category (soft delete)
 */
export async function deleteBudgetCategory(id) {
    const result = await API.delete(`v1/budget/categories/${id}`);
    await clearBudgetCaches();
    return result;
}

/**
 * Get budget items, optionally filtered by category
 */
export async function getBudgetItems(categoryId = null, cacheOptions = {}) {
    const params = categoryId ? { category_id: categoryId } : {};
    return API.get('v1/budget/items', params, {
        cacheKey: categoryId ? `budget_items_cat_${categoryId}` : 'budget_items',
        cacheDuration: CONFIG.CACHE_DURATION.MEDIUM,
        forceRefresh: cacheOptions.forceRefresh
    });
}

/**
 * Create a budget item
 */
export async function createBudgetItem(payload) {
    const result = await API.post('v1/budget/items', payload);
    await clearBudgetCaches({ categoryId: payload.category_id });
    return result;
}

/**
 * Update a budget item
 */
export async function updateBudgetItem(id, payload) {
    const result = await API.put(`v1/budget/items/${id}`, payload);
    await clearBudgetCaches({ categoryId: payload.category_id });
    return result;
}

/**
 * Delete a budget item (soft delete)
 */
export async function deleteBudgetItem(id) {
    const result = await API.delete(`v1/budget/items/${id}`);
    await clearBudgetCaches();
    return result;
}

/**
 * Get budget expenses with optional filters
 */
export async function getBudgetExpenses(filters = {}, cacheOptions = {}) {
    return API.get('v1/budget/expenses', filters, {
        cacheKey: 'budget_expenses',
        cacheDuration: CONFIG.CACHE_DURATION.SHORT,
        forceRefresh: cacheOptions.forceRefresh
    });
}

/**
 * Create a budget expense
 */
export async function createBudgetExpense(payload) {
    const result = await API.post('v1/budget/expenses', payload);
    await clearBudgetCaches();
    return result;
}

/**
 * Update a budget expense
 */
export async function updateBudgetExpense(id, payload) {
    const result = await API.put(`v1/budget/expenses/${id}`, payload);
    await clearBudgetCaches();
    return result;
}

/**
 * Delete a budget expense
 */
export async function deleteBudgetExpense(id) {
    const result = await API.delete(`v1/budget/expenses/${id}`);
    await clearBudgetCaches();
    return result;
}

/**
 * Get comprehensive budget summary report
 */
export async function getBudgetSummaryReport(fiscalYearStart, fiscalYearEnd, cacheOptions = {}) {
    const params = {
        fiscal_year_start: fiscalYearStart,
        fiscal_year_end: fiscalYearEnd
    };
    return API.get('v1/budget/reports/summary', params, {
        cacheKey: `budget_summary_${fiscalYearStart}_${fiscalYearEnd}`,
        cacheDuration: CONFIG.CACHE_DURATION.SHORT,
        forceRefresh: cacheOptions.forceRefresh
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
export async function getBudgetPlans(fiscalYearStart = null, fiscalYearEnd = null, cacheOptions = {}) {
    const params = {};
    if (fiscalYearStart && fiscalYearEnd) {
        params.fiscal_year_start = fiscalYearStart;
        params.fiscal_year_end = fiscalYearEnd;
    }
    return API.get('v1/budget/plans', params, {
        cacheKey: fiscalYearStart ? `budget_plans_${fiscalYearStart}_${fiscalYearEnd}` : 'budget_plans',
        cacheDuration: CONFIG.CACHE_DURATION.SHORT,
        forceRefresh: cacheOptions.forceRefresh
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
export async function getExternalRevenue(filters = {}, cacheOptions = {}) {
    return API.get('v1/revenue/external', filters, {
        cacheKey: 'external_revenue',
        cacheDuration: CONFIG.CACHE_DURATION.SHORT,
        ...cacheOptions
    });
}

/**
 * Create external revenue entry
 */
export async function createExternalRevenue(payload) {
    const result = await API.post('v1/revenue/external', payload);
    await clearExternalRevenueCaches();
    return result;
}

/**
 * Update external revenue entry
 */
export async function updateExternalRevenue(id, payload) {
    const result = await API.put(`v1/revenue/external/${id}`, payload);
    await clearExternalRevenueCaches();
    return result;
}

/**
 * Delete external revenue entry
 */
export async function deleteExternalRevenue(id) {
    const result = await API.delete(`v1/revenue/external/${id}`);
    await clearExternalRevenueCaches();
    return result;
}

/**
 * Get external revenue summary
 */
export async function getExternalRevenueSummary(startDate = null, endDate = null, cacheOptions = {}) {
    const params = {};
    if (startDate) params.start_date = startDate;
    if (endDate) params.end_date = endDate;

    const cacheKey = `external_revenue_summary_${startDate || 'all'}_${endDate || 'all'}`;
    return API.get('v1/revenue/external/summary', params, {
        cacheKey,
        cacheDuration: CONFIG.CACHE_DURATION.SHORT,
        ...cacheOptions
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
 * Save organization
 */
export async function saveOrganization(organizationData) {
    return API.post('v1/organizations', organizationData);
}


/**
 * Switch active organization
 */
export async function switchOrganization(organizationId) {
    return API.post('v1/organizations/switch', { organization_id: organizationId });
}

export async function fetchUnprocessedAchievements() {
    return API.get('v1/meetings/unprocessed-achievements');
}

/**
 * Get organization settings
 */
export async function fetchOrganizationSettings(params = {}) {
    const token = localStorage.getItem('jwtToken');
    if (!token) {
        debugLog('No token found, using public organization settings endpoint');
        return fetchPublicOrganizationSettings();
    }

    try {
        return await API.get('v1/organizations/settings', params, {
            cacheKey: 'org_settings',
            cacheDuration: CONFIG.CACHE_DURATION.LONG
        });
    } catch (error) {
        if (error.message?.includes('401') || error.message?.includes('Unauthorized')) {
            debugWarn('Authenticated organization-settings failed (401), falling back to public endpoint');
            return fetchPublicOrganizationSettings();
        }
        throw error;
    }
}

/**
 * Backward compatibility alias
 */
export const getOrganizationSettings = fetchOrganizationSettings;

/**
 * Get news (API endpoint)
 */
export async function fetchNews() {
    return API.get('v1/public/news');
}

export const getNews = fetchNews;


/**
 * Import SISC CSV data (admin only)
 */
export async function importSISC(csvContent) {
    return API.post('v1/import/sisc', { csvContent });
}

/**
 * Register for organization
 */
export async function registerForOrganization(registrationData) {
    return API.post('v1/organizations/register', registrationData);
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

        return await API.get('v1/organizations/jwt', { organization_id: orgId });
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
    return API.get('v1/public/test-connection');
}

/**
 * Get initial data (API endpoint)
 */
export async function fetchInitialData() {
    return API.get('v1/dashboards/initial');
}

export const getInitialData = fetchInitialData;

/**
 * Get push notification subscribers
 */
export async function getSubscribers(organizationId) {
    try {
        return await API.get('v1/notifications/subscribers', {
            organization_id: organizationId
        });
    } catch (error) {
        debugWarn('Push subscriber endpoint unavailable, returning empty list', error);
        return { success: false, data: [] };
    }
}

/**
 * Send push notification to selected subscribers
 */
export async function sendPushNotification(title, body) {
    return API.post('v1/notifications/send', { title, body });
}

/**
 * Validate token (uses test-connection endpoint)
 */
export async function validateToken() {
    try {
        const result = await API.get('v1/auth/test');
        return result.success || false;
    } catch (error) {
        if (error.message?.includes('401')) {
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
        await API.post('api/auth/verify-session');
        return { isValid: true };
    } catch (error) {
        return { isValid: false, reason: 'invalid_token' };
    }
}

/**
 * Get current authenticated user profile
 */
export async function getCurrentUser() {
    return API.getNoCache('v1/users/me');
}

// ============================================================================
// BACKWARDS COMPATIBILITY ALIASES
// ============================================================================

// Alias for backward compatibility (returns primitive org ID for app init)
export async function fetchOrganizationId() {
    const response = await getOrganizationId();
    if (response && typeof response === 'object') {
        return response.organization_id || response.organizationId || response.id || response;
    }
    return response;
}
export const getParticipantAgeReport = getParticipantAge;

// ============================================================================
// AI FEATURES
// ============================================================================

/**
 * AI Text Generation
 * @param {string} mode - 'meeting_plan', 'rewrite', 'translate', 'risk_suggest'
 * @param {object} payload - Data required for the mode
 */
export async function aiGenerateText(mode, payload) {
    return API.post('v1/ai/text', { mode, payload });
}

/**
 * AI Receipt Parsing
 * @param {File} file - Receipt image/PDF
 */
export async function aiParseReceipt(file) {
    const formData = new FormData();
    formData.append('file', file);

    return API.post('v1/ai/receipt', formData);
}

// Expose to window for global access
window.aiGenerateText = aiGenerateText;
window.aiParseReceipt = aiParseReceipt;

export async function getProgramProgressStream(params = {}, cacheOptions = {}) {
    return makeApiRequestWithCache('v1/program-progress/stream', {
        params,
        cacheOptions,
    });
}

