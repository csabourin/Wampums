/**
 * Permission Utility Functions
 *
 * Provides helper functions for checking user roles and permissions
 * in the frontend application.
 *
 * @module utils/PermissionUtils
 */

import { app } from '../app.js';
import { debugLog } from './DebugUtils.js';

/**
 * Check if user has a specific permission
 *
 * @param {string} permissionKey - The permission key to check (e.g., 'finance.view')
 * @returns {boolean} True if user has the permission
 *
 * @example
 * if (hasPermission('finance.manage')) {
 *   // Show financial management features
 * }
 */
export function hasPermission(permissionKey) {
  if (!app.userPermissions || !Array.isArray(app.userPermissions)) {
    debugLog(`Permission check failed: no permissions loaded for key ${permissionKey}`);
    return false;
  }

  const result = app.userPermissions.includes(permissionKey);
  debugLog(`Permission check: ${permissionKey} = ${result}`);
  return result;
}

/**
 * Check if user has ANY of the specified permissions
 *
 * @param {...string} permissions - Permission keys to check
 * @returns {boolean} True if user has at least one of the permissions
 *
 * @example
 * if (hasAnyPermission('finance.view', 'budget.view')) {
 *   // User can see either finance or budget
 * }
 */
export function hasAnyPermission(...permissions) {
  if (!app.userPermissions || !Array.isArray(app.userPermissions)) {
    return false;
  }

  return permissions.some(perm => app.userPermissions.includes(perm));
}

/**
 * Check if user has ALL of the specified permissions
 *
 * @param {...string} permissions - Permission keys to check
 * @returns {boolean} True if user has all of the permissions
 *
 * @example
 * if (hasAllPermissions('users.view', 'users.edit')) {
 *   // User can both view and edit users
 * }
 */
export function hasAllPermissions(...permissions) {
  if (!app.userPermissions || !Array.isArray(app.userPermissions)) {
    return false;
  }

  return permissions.every(perm => app.userPermissions.includes(perm));
}

/**
 * Check if user has a specific role
 *
 * @param {string} roleName - The role name to check (e.g., 'district', 'leader')
 * @returns {boolean} True if user has the role
 *
 * @example
 * if (hasRole('district')) {
 *   // Show district-only features
 * }
 */
export function hasRole(roleName) {
  if (!app.userRoles || !Array.isArray(app.userRoles)) {
    debugLog(`Role check failed: no roles loaded for role ${roleName}`);
    return false;
  }

  const result = app.userRoles.includes(roleName);
  debugLog(`Role check: ${roleName} = ${result}`);
  return result;
}

/**
 * Check if user has ANY of the specified roles
 *
 * @param {...string} roles - Role names to check
 * @returns {boolean} True if user has at least one of the roles
 *
 * @example
 * if (hasAnyRole('district', 'unitadmin')) {
 *   // User is either district or unitadmin
 * }
 */
export function hasAnyRole(...roles) {
  if (!app.userRoles || !Array.isArray(app.userRoles)) {
    return false;
  }

  return roles.some(role => app.userRoles.includes(role));
}

/**
 * Check if user has ALL of the specified roles
 *
 * @param {...string} roles - Role names to check
 * @returns {boolean} True if user has all of the roles
 *
 * @example
 * if (hasAllRoles('leader', 'finance')) {
 *   // User has both leader and finance roles
 * }
 */
export function hasAllRoles(...roles) {
  if (!app.userRoles || !Array.isArray(app.userRoles)) {
    return false;
  }

  return roles.every(role => app.userRoles.includes(role));
}

/**
 * Check if user is a demo user (demoadmin or demoparent)
 *
 * @returns {boolean} True if user has a demo role
 *
 * @example
 * if (isDemoUser()) {
 *   // Show read-only warning
 * }
 */
export function isDemoUser() {
  return hasAnyRole('demoadmin', 'demoparent');
}

/**
 * Check if user is a parent (has parent role)
 *
 * @returns {boolean} True if user has parent role
 */
export function isParent() {
  return hasRole('parent') || hasRole('demoparent');
}

/**
 * Check if user is an admin (district or unitadmin)
 *
 * @returns {boolean} True if user is an admin
 */
export function isAdmin() {
  return hasAnyRole('district', 'unitadmin');
}

/**
 * Check if user is a district admin
 *
 * @returns {boolean} True if user is a district admin
 */
export function isDistrictAdmin() {
  return hasRole('district');
}

/**
 * Check if user can manage roles
 *
 * @returns {boolean} True if user can manage roles
 */
export function canManageRoles() {
  return hasPermission('roles.manage');
}

/**
 * Check if user can view roles
 *
 * @returns {boolean} True if user can view roles
 */
export function canViewRoles() {
  return hasPermission('roles.view');
}

/**
 * Check if user can assign roles to other users
 *
 * @returns {boolean} True if user can assign roles
 */
export function canAssignRoles() {
  return hasPermission('users.assign_roles');
}

/**
 * Check if user can create organizations
 *
 * @returns {boolean} True if user can create organizations
 */
export function canCreateOrganization() {
  return hasPermission('org.create');
}

/**
 * Get all user's permissions
 *
 * @returns {Array<string>} Array of permission keys
 */
export function getUserPermissions() {
  return app.userPermissions || [];
}

/**
 * Get all user's roles
 *
 * @returns {Array<string>} Array of role names
 */
export function getUserRoles() {
  return app.userRoles || [];
}

/**
 * Get primary user role (for backward compatibility)
 *
 * @returns {string|null} Primary role name
 */
export function getPrimaryRole() {
  return app.userRole;
}

/**
 * Permission-based route access check
 * Used by router to determine if user can access a route
 *
 * @param {Object} options - Check options
 * @param {string[]} options.roles - Required roles (at least one)
 * @param {string[]} options.permissions - Required permissions (at least one)
 * @param {boolean} options.requireAll - If true, require all permissions/roles instead of any
 * @returns {boolean} True if user has access
 *
 * @example
 * canAccessRoute({ permissions: ['finance.view'] })
 * canAccessRoute({ roles: ['district', 'unitadmin'] })
 * canAccessRoute({ permissions: ['users.view', 'users.edit'], requireAll: true })
 */
export function canAccessRoute(options = {}) {
  const { roles, permissions, requireAll = false } = options;

  // If no restrictions specified, allow access
  if (!roles && !permissions) {
    return true;
  }

  let hasRoleAccess = true;
  let hasPermissionAccess = true;

  // Check roles if specified
  if (roles && roles.length > 0) {
    hasRoleAccess = requireAll ? hasAllRoles(...roles) : hasAnyRole(...roles);
  }

  // Check permissions if specified
  if (permissions && permissions.length > 0) {
    hasPermissionAccess = requireAll ? hasAllPermissions(...permissions) : hasAnyPermission(...permissions);
  }

  // Return true if both checks pass
  return hasRoleAccess && hasPermissionAccess;
}

/**
 * Log current user's roles and permissions (for debugging)
 */
export function logUserAccess() {
  debugLog('=== USER ACCESS INFO ===');
  debugLog('Primary Role:', getPrimaryRole());
  debugLog('All Roles:', getUserRoles());
  debugLog('Permissions:', getUserPermissions());
  debugLog('Is Admin:', isAdmin());
  debugLog('Is District Admin:', isDistrictAdmin());
  debugLog('Is Parent:', isParent());
  debugLog('Is Demo User:', isDemoUser());
  debugLog('=== END ACCESS INFO ===');
}
