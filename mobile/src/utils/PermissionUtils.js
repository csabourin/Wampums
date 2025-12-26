/**
 * Permission Utility Functions for React Native App
 *
 * Provides helper functions for checking user roles and permissions
 * Mirrors spa/utils/PermissionUtils.js functionality
 *
 * @module utils/PermissionUtils
 */

/**
 * Check if user has a specific permission
 *
 * @param {string} permissionKey - The permission key to check (e.g., 'finance.view')
 * @param {Array<string>} userPermissions - Array of user permissions from storage
 * @returns {boolean} True if user has the permission
 *
 * @example
 * const permissions = await StorageUtils.getItem('USER_PERMISSIONS');
 * if (hasPermission('finance.manage', permissions)) {
 *   // Show financial management features
 * }
 */
export function hasPermission(permissionKey, userPermissions) {
  if (!userPermissions || !Array.isArray(userPermissions)) {
    return false;
  }

  return userPermissions.includes(permissionKey);
}

/**
 * Check if user has ANY of the specified permissions
 *
 * @param {Array<string>} permissions - Permission keys to check
 * @param {Array<string>} userPermissions - Array of user permissions from storage
 * @returns {boolean} True if user has at least one of the permissions
 *
 * @example
 * if (hasAnyPermission(['finance.view', 'budget.view'], userPermissions)) {
 *   // User can see either finance or budget
 * }
 */
export function hasAnyPermission(permissions, userPermissions) {
  if (!userPermissions || !Array.isArray(userPermissions)) {
    return false;
  }

  return permissions.some((perm) => userPermissions.includes(perm));
}

/**
 * Check if user has ALL of the specified permissions
 *
 * @param {Array<string>} permissions - Permission keys to check
 * @param {Array<string>} userPermissions - Array of user permissions from storage
 * @returns {boolean} True if user has all of the permissions
 *
 * @example
 * if (hasAllPermissions(['users.view', 'users.edit'], userPermissions)) {
 *   // User can both view and edit users
 * }
 */
export function hasAllPermissions(permissions, userPermissions) {
  if (!userPermissions || !Array.isArray(userPermissions)) {
    return false;
  }

  return permissions.every((perm) => userPermissions.includes(perm));
}

/**
 * Check if user has admin-level permissions
 * Admin users have extensive permissions like managing users, roles, and organization
 *
 * @param {Array<string>} userPermissions - Array of user permissions from storage
 * @returns {boolean} True if user has admin-level permissions
 *
 * @example
 * if (isAdmin(userPermissions)) {
 *   // Show district dashboard
 * }
 */
export function isAdmin(userPermissions) {
  // Check for key admin permissions
  const adminPermissions = [
    'users.assign_roles',
    'roles.manage',
    'org.view',
    'users.assign_district',
  ];

  return hasAnyPermission(adminPermissions, userPermissions);
}

/**
 * Check if user has staff-level permissions (leader, finance, etc.)
 * Staff users can manage participants, attendance, activities
 *
 * @param {Array<string>} userPermissions - Array of user permissions from storage
 * @returns {boolean} True if user has staff-level permissions
 *
 * @example
 * if (isStaff(userPermissions)) {
 *   // Show leader dashboard
 * }
 */
export function isStaff(userPermissions) {
  // Check for key staff permissions
  const staffPermissions = [
    'participants.view',
    'participants.edit',
    'attendance.manage',
    'activities.view',
    'groups.view',
    'points.manage',
  ];

  return hasAnyPermission(staffPermissions, userPermissions);
}

/**
 * Determine which dashboard type to show based on permissions
 * Roles are linked to permissions via the role_permissions table, so any
 * assigned permission indicates a non-parent dashboard context.
 *
 * @param {Array<string>} userPermissions - Array of user permissions from storage
 * @returns {'leader'|'parent'} Dashboard type to display
 *
 * @example
 * const dashboardType = getDashboardType(userPermissions);
 * // Returns 'leader' or 'parent'
 */
export function getDashboardType(userPermissions) {
  const hasPermissions = Array.isArray(userPermissions)
    ? userPermissions.length > 0
    : false;

  return hasPermissions ? 'leader' : 'parent';
}

export default {
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  isAdmin,
  isStaff,
  getDashboardType,
};
