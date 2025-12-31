/**
 * Permission Utility Functions for React Native App
 *
 * Provides helper functions for checking user roles and permissions
 * Mirrors spa/utils/PermissionUtils.js functionality
 *
 * @module utils/PermissionUtils
 */

import StorageUtils from './StorageUtils';
import CONFIG from '../config';

/**
 * Get cached user permissions from storage
 * @returns {Promise<Array<string>>} Array of user permissions
 */
async function getUserPermissions() {
  try {
    const permissions = await StorageUtils.getItem(CONFIG.STORAGE_KEYS.USER_PERMISSIONS);
    const result = Array.isArray(permissions) ? permissions : [];
    console.log('[PermissionUtils] Retrieved permissions:', result);
    return result;
  } catch (error) {
    console.error('Error getting user permissions:', error);
    return [];
  }
}

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

// ==========================================
// Async Permission Checkers (No Arguments)
// ==========================================
// These functions fetch permissions from storage internally
// and are used by screens for permission checks

/**
 * Check if user can view badges
 * @returns {Promise<boolean>} True if user can view badges
 */
export async function canViewBadges() {
  const permissions = await getUserPermissions();
  return hasAnyPermission(['badges.view', 'badges.manage'], permissions);
}

/**
 * Check if user can approve badges
 * @returns {Promise<boolean>} True if user can approve badges
 */
export async function canApproveBadges() {
  const permissions = await getUserPermissions();
  const result = hasAnyPermission(['badges.approve', 'badges.manage'], permissions);
  console.log('[PermissionUtils] canApproveBadges check:', {
    permissions,
    required: ['badges.approve', 'badges.manage'],
    result,
    hasBadgesApprove: permissions.includes('badges.approve'),
    hasBadgesManage: permissions.includes('badges.manage')
  });
  return result;
}

/**
 * Check if user can manage badges
 * @returns {Promise<boolean>} True if user can manage badges
 */
export async function canManageBadges() {
  const permissions = await getUserPermissions();
  return hasPermission('badges.manage', permissions);
}

/**
 * Check if user can view inventory
 * @returns {Promise<boolean>} True if user can view inventory
 */
export async function canViewInventory() {
  const permissions = await getUserPermissions();
  return hasAnyPermission(['inventory.view', 'inventory.manage'], permissions);
}

/**
 * Check if user can manage inventory
 * @returns {Promise<boolean>} True if user can manage inventory
 */
export async function canManageInventory() {
  const permissions = await getUserPermissions();
  return hasPermission('inventory.manage', permissions);
}

/**
 * Check if user can view finance
 * @returns {Promise<boolean>} True if user can view finance
 */
export async function canViewFinance() {
  const permissions = await getUserPermissions();
  return hasAnyPermission(['finance.view', 'finance.manage'], permissions);
}

/**
 * Check if user can manage finance
 * @returns {Promise<boolean>} True if user can manage finance
 */
export async function canManageFinance() {
  const permissions = await getUserPermissions();
  return hasPermission('finance.manage', permissions);
}

/**
 * Check if user can approve finance
 * @returns {Promise<boolean>} True if user can approve finance
 */
export async function canApproveFinance() {
  const permissions = await getUserPermissions();
  return hasPermission('finance.approve', permissions);
}

/**
 * Check if user can view budget
 * @returns {Promise<boolean>} True if user can view budget
 */
export async function canViewBudget() {
  const permissions = await getUserPermissions();
  return hasAnyPermission(['budget.view', 'finance.manage'], permissions);
}

/**
 * Check if user can view groups
 * @returns {Promise<boolean>} True if user can view groups
 */
export async function canViewGroups() {
  const permissions = await getUserPermissions();
  return hasAnyPermission(['groups.view', 'groups.manage'], permissions);
}

/**
 * Check if user can view participants
 * @returns {Promise<boolean>} True if user can view participants
 */
export async function canViewParticipants() {
  const permissions = await getUserPermissions();
  return hasAnyPermission(['participants.view', 'participants.edit'], permissions);
}

/**
 * Check if user can view users
 * @returns {Promise<boolean>} True if user can view users
 */
export async function canViewUsers() {
  const permissions = await getUserPermissions();
  return hasAnyPermission(['users.view', 'users.assign_roles'], permissions);
}

/**
 * Check if user can send communications
 * @returns {Promise<boolean>} True if user can send communications
 */
export async function canSendCommunications() {
  const permissions = await getUserPermissions();
  return hasPermission('communications.send', permissions);
}

/**
 * Check if user is district admin
 * @returns {Promise<boolean>} True if user is district admin
 */
export async function isDistrictAdmin() {
  const permissions = await getUserPermissions();
  return hasPermission('users.assign_district', permissions);
}

/**
 * Check if user can view fundraisers
 * @returns {Promise<boolean>} True if user can view fundraisers
 */
export async function canViewFundraisers() {
  const permissions = await getUserPermissions();
  return hasAnyPermission(['fundraisers.view', 'fundraisers.create', 'fundraisers.edit'], permissions);
}

/**
 * Check if user can manage fundraisers (create, edit, or delete)
 * @returns {Promise<boolean>} True if user can manage fundraisers
 */
export async function canManageFundraisers() {
  const permissions = await getUserPermissions();
  return hasAnyPermission(['fundraisers.create', 'fundraisers.edit', 'fundraisers.delete'], permissions);
}

export default {
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  isAdmin,
  isStaff,
  getDashboardType,
  canViewBadges,
  canApproveBadges,
  canManageBadges,
  canViewInventory,
  canManageInventory,
  canViewFinance,
  canManageFinance,
  canApproveFinance,
  canViewBudget,
  canViewGroups,
  canViewParticipants,
  canViewUsers,
  canSendCommunications,
  isDistrictAdmin,
  canViewFundraisers,
  canManageFundraisers,
};
