// api-helpers.js
// Helper utilities for API operations
import { CONFIG } from "../config.js";
import { debugLog, debugError, debugWarn } from "../utils/DebugUtils.js";
import { getOrganizationIdFromJWT } from "../jwt-helper.js";

/**
 * Get current organization ID from localStorage
 * Handles various storage formats
 */
export function getCurrentOrganizationId() {
    // Prefer organization ID from JWT when available (server-issued source of truth)
    const tokenOrgId = getOrganizationIdFromJWT();
    if (tokenOrgId) {
        return tokenOrgId;
    }

    // Try both storage keys
    let orgId = localStorage.getItem('organizationId') ||
                localStorage.getItem('currentOrganizationId');

    if (typeof orgId === 'object' && orgId !== null) {
        orgId = orgId.organization_id || orgId.organizationId || orgId.id || null;
    }

    // If it's stored as JSON object, parse and extract the ID
    if (orgId && orgId.startsWith('{')) {
        try {
            const parsed = JSON.parse(orgId);
            orgId = parsed.organization_id || parsed.organizationId || parsed.id || null;
        } catch (e) {
            debugWarn('Failed to parse organization ID from localStorage:', e);
            orgId = null;
        }
    }

    // Ensure it's a valid number/string, not "[object Object]"
    if (orgId && orgId !== '[object Object]' && orgId !== 'undefined') {
        return orgId;
    }

    if (orgId === null || orgId === '[object Object]' || orgId === 'undefined') {
        try {
            localStorage.removeItem('organizationId');
            localStorage.removeItem('currentOrganizationId');
        } catch (error) {
            debugWarn('Failed to clear invalid organization ID from storage:', error);
        }
    }

    return null;
}

/**
 * Get authorization headers for API requests
 */
export function getAuthHeader() {
    const token = localStorage.getItem("jwtToken");
    const organizationId = getCurrentOrganizationId();

    debugLog("=== GET AUTH HEADER DEBUG ===");
    debugLog("Token exists:", !!token);
    debugLog("Organization ID:", organizationId);
    debugLog("Token preview:", token ? token.substring(0, 50) + "..." : "NO TOKEN");

    const headers = {};

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    if (organizationId) {
        headers['x-organization-id'] = organizationId;
    }

    debugLog("Generated headers:", headers);
    debugLog("=== END AUTH HEADER DEBUG ===");

    return headers;
}

/**
 * Check if user is logged in
 */
export function checkLoginStatus() {
    return { isLoggedIn: !!localStorage.getItem('jwtToken') };
}

/**
 * Validate JWT token format and expiration (client-side)
 */
export async function validateCurrentToken() {
    const token = localStorage.getItem("jwtToken");

    if (!token) {
        debugLog("No token to validate");
        return { isValid: false, reason: "no_token" };
    }

    try {
        // Try to decode the token client-side first
        const parts = token.split('.');
        if (parts.length !== 3) {
            debugLog("Invalid token format");
            return { isValid: false, reason: "invalid_format" };
        }

        const payload = JSON.parse(atob(parts[1]));
        debugLog("Token payload:", payload);

        // Check if expired
        const now = Math.floor(Date.now() / 1000);
        if (payload.exp && payload.exp < now) {
            debugLog("Token is expired");
            return { isValid: false, reason: "expired" };
        }

        debugLog("Token appears valid client-side");
        return { isValid: true, payload };
    } catch (error) {
        debugError("Error validating token:", error);
        return { isValid: false, reason: "decode_error" };
    }
}

/**
 * Build public API URL (no /api prefix)
 */
export function buildPublicUrl(endpoint, params = {}) {
    const url = new URL(`/public/${endpoint}`, CONFIG.API_BASE_URL);

    Object.entries(params).forEach(([key, value]) => {
        if (value !== null && value !== undefined) {
            url.searchParams.append(key, value);
        }
    });

    return url.toString();
}

/**
 * Make request to public endpoint (no authentication)
 */
export async function fetchPublic(endpoint, options = {}) {
    const url = buildPublicUrl(endpoint);
    const organizationId = getCurrentOrganizationId();
    const response = await fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(organizationId ? { 'x-organization-id': organizationId } : {}),
            ...options.headers
        }
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    return response.json();
}
