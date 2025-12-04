import { debugLog, debugError, debugWarn, debugInfo } from "./utils/DebugUtils.js";

// jwt-helper.js - Functions for JWT management in the client


/**
 * Updates the JWT with user information after login
 * @param {string} userJWT - The JWT returned from the server after login
 * @returns {void}
 */
export function setUserJWT(userJWT) {
	// Store the user JWT
	localStorage.setItem("jwtToken", userJWT);

	// Remove the anonymous JWT if it exists
	localStorage.removeItem("anonymousJWT");
}

/**
 * Gets the current valid JWT - either user JWT if logged in, or anonymous JWT
 * @returns {string|null} The current JWT string or null if not available
 */
export function getCurrentJWT() {
	// First try to get the user JWT
	const userJWT = localStorage.getItem("jwtToken");
	if (userJWT) {
		return userJWT;
	}

	// Fall back to anonymous JWT if available
	return localStorage.getItem("anonymousJWT");
}

/**
 * Decodes a JWT and returns its payload
 * @param {string} jwt - The JWT to decode
 * @returns {object|null} The decoded payload or null if invalid
 */
export function decodeJWT(jwt) {
	try {
		if (!jwt) return null;

		// Split the JWT into parts
		const parts = jwt.split('.');
		if (parts.length !== 3) return null;

		// Decode the payload (middle part)
		const payload = atob(parts[1]);
		return JSON.parse(payload);
	} catch (error) {
		debugError('Error decoding JWT:', error);
		return null;
	}
}

/**
 * Checks if the current JWT is expired
 * @returns {boolean} True if expired or invalid, false otherwise
 */
export function isJWTExpired() {
	const jwt = getCurrentJWT();
	if (!jwt) return true;

	const payload = decodeJWT(jwt);
	if (!payload || !payload.exp) return true;

	const currentTime = Math.floor(Date.now() / 1000);
	return payload.exp < currentTime;
}

/**
 * Removes all JWT tokens from storage
 * @returns {void}
 */
export function clearJWTs() {
	localStorage.removeItem("jwtToken");
	localStorage.removeItem("anonymousJWT");
}

/**
 * Get the authorization header with the current JWT
 * @returns {Object} Headers object with Authorization if available
 */
export function getAuthHeader() {
	const jwt = getCurrentJWT();
	return jwt ? { Authorization: `Bearer ${jwt}` } : {};
}

/**
 * Get the organization ID from the current JWT
 * @returns {string|null} Organization ID or null if not available
 */
export function getOrganizationIdFromJWT() {
	const jwt = getCurrentJWT();
	if (!jwt) return null;

	const payload = decodeJWT(jwt);
	return payload?.organizationId || null;
}

/**
 * Get the user information from the current JWT
 * @returns {object|null} User info object or null if not available
 */
export function getUserInfoFromJWT() {
	const jwt = getCurrentJWT();
	if (!jwt) return null;

	const payload = decodeJWT(jwt);
	if (!payload || payload.is_anonymous) return null;

	return {
		userId: payload.user_id,
		userRole: payload.user_role,
		userFullName: payload.full_name
	};
}