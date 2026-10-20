// SessionUtils.js
import { getStorage } from './StorageUtils.js';
import { debugLog, debugError } from './DebugUtils.js';

/**
 * Check if user has a valid session
 * @returns {Object} Session information: isLoggedIn, userRole, userRoles, userPermissions, userFullName,
 *   userId, userDataScope ('organization', 'linked', or null before the server has said) and
 *   userFamilyRole (true when one role is a family role, whatever its name)
 */
export function checkSession() {
  const token = getStorage('jwtToken');
  const userRole = getStorage('userRole');
  const userRolesStr = getStorage('userRoles');
  const userPermissionsStr = getStorage('userPermissions');
  const userFullName = getStorage('userFullName');
  const userId = getStorage('userId');
  const userDataScope = getStorage('userDataScope') || null;
  const userFamilyRole = getStorage('userFamilyRole') === 'true';

  // Parse roles and permissions from JSON strings
  let userRoles = [];
  let userPermissions = [];
  try {
    userRoles = userRolesStr ? JSON.parse(userRolesStr) : (userRole ? [userRole] : []);
    userPermissions = userPermissionsStr ? JSON.parse(userPermissionsStr) : [];
  } catch (e) {
    debugError('Error parsing roles/permissions from localStorage:', e);
    userRoles = userRole ? [userRole] : [];
    userPermissions = [];
  }

  // Simple check - we consider the user logged in if we have a token AND user ID
  // The actual token validation happens on the server
  const isLoggedIn = !!token && !!userId && !!userRole;

  debugLog('Session check:', { isLoggedIn, userRole, userRoles, userPermissions, userFullName, userId });
  return {
    isLoggedIn,
    userRole,
    userRoles,
    userPermissions,
    userFullName,
    userId,
    userDataScope,
    userFamilyRole
  };
}
