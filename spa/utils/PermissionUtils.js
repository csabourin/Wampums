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
 * Determine if the current user can access parent-facing tools
 * Allows staff with participant visibility to use parent dashboards
 *
 * @returns {boolean} True when user is a parent or has participant view access
 */
export function canAccessParentTools() {
  const parentFriendlyStaffRoles = [
    'district',
    'unitadmin',
    'leader',
    'demoadmin'
  ];

  if (isParent()) {
    return true;
  }

  if (!canViewParticipants()) {
    return false;
  }

  return hasAnyRole(...parentFriendlyStaffRoles);
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
 * Determine if the current user can view finance data
 *
 * @returns {boolean} True when finance view permission is granted
 */
export function canViewFinance() {
  return hasPermission('finance.view');
}

/**
 * Determine if the current user can manage finance data
 *
 * @returns {boolean} True when finance manage permission is granted
 */
export function canManageFinance() {
  return hasPermission('finance.manage');
}

/**
 * Determine if the current user can approve finance actions
 *
 * @returns {boolean} True when finance approve permission is granted
 */
export function canApproveFinance() {
  return hasPermission('finance.approve') || canManageFinance();
}

/**
 * Determine if the current user can view budget data
 *
 * @returns {boolean} True when budget view permission is granted
 */
export function canViewBudget() {
  return hasPermission('budget.view');
}

/**
 * Determine if the current user can manage budget data
 *
 * @returns {boolean} True when budget manage permission is granted
 */
export function canManageBudget() {
  return hasPermission('budget.manage');
}

/**
 * Determine if the current user can view fundraiser information
 *
 * @returns {boolean} True when fundraiser view permission is granted
 */
export function canViewFundraisers() {
  return hasPermission('fundraisers.view');
}

/**
 * Determine if the current user can create or edit fundraisers
 *
 * @returns {boolean} True when any fundraiser management permission is granted
 */
export function canManageFundraisers() {
  return hasAnyPermission('fundraisers.create', 'fundraisers.edit', 'fundraisers.delete');
}

/**
 * Determine if the current user can view inventory data
 *
 * @returns {boolean} True when any inventory access permission is granted
 */
export function canViewInventory() {
  return hasAnyPermission('inventory.view', 'inventory.manage', 'inventory.reserve', 'inventory.value');
}

/**
 * Determine if the current user can manage inventory items
 *
 * @returns {boolean} True when inventory manage permission is granted
 */
export function canManageInventory() {
  return hasPermission('inventory.manage');
}

/**
 * Determine if the current user can view badge data
 *
 * @returns {boolean} True when badges view permission is granted
 */
export function canViewBadges() {
  return hasPermission('badges.view');
}

/**
 * Determine if the current user can approve badge completions
 *
 * @returns {boolean} True when badges approve permission is granted
 */
export function canApproveBadges() {
  return hasPermission('badges.approve');
}

/**
 * Determine if the current user can manage badge definitions
 *
 * @returns {boolean} True when badges manage permission is granted
 */
export function canManageBadges() {
  return hasPermission('badges.manage');
}

/**
 * Determine if the current user can view participant data
 *
 * @returns {boolean} True when participants view permission is granted
 */
export function canViewParticipants() {
  return hasPermission('participants.view');
}

/**
 * Determine if the current user can edit participant data
 *
 * @returns {boolean} True when any participant mutation permission is granted
 */
export function canManageParticipants() {
  return hasAnyPermission('participants.edit', 'participants.create', 'participants.delete', 'participants.transfer');
}

/**
 * Determine if the current user can view user accounts
 *
 * @returns {boolean} True when users view permission is granted
 */
export function canViewUsers() {
  return hasPermission('users.view');
}

/**
 * Determine if the current user can manage user accounts
 *
 * @returns {boolean} True when any user management permission is granted
 */
export function canManageUsers() {
  return hasAnyPermission('users.edit', 'users.delete', 'users.assign_roles', 'users.invite', 'users.assign_district');
}

/**
 * Determine if the current user can view group data
 *
 * @returns {boolean} True when groups view permission is granted
 */
export function canViewGroups() {
  return hasPermission('groups.view');
}

/**
 * Determine if the current user can manage groups
 *
 * @returns {boolean} True when any group mutation permission is granted
 */
export function canManageGroups() {
  return hasAnyPermission('groups.create', 'groups.edit', 'groups.delete');
}

/**
 * Determine if the current user can send communications
 *
 * @returns {boolean} True when communications send permission is granted
 */
export function canSendCommunications() {
  return hasPermission('communications.send');
}

/**
 * Determine if the current user can view reports
 *
 * @returns {boolean} True when reports view permission is granted
 */
export function canViewReports() {
  return hasPermission('reports.view');
}

/**
 * Determine if the current user can view activities
 *
 * @returns {boolean} True when activities view permission is granted
 */
export function canViewActivities() {
  return hasPermission('activities.view');
}

/**
 * Determine if the current user can manage activities
 *
 * @returns {boolean} True when any activity mutation permission is granted
 */
export function canManageActivities() {
  return hasAnyPermission('activities.create', 'activities.edit', 'activities.delete');
}

/**
 * Determine if the current user can view attendance data
 *
 * @returns {boolean} True when attendance view or manage permission is granted
 */
export function canViewAttendance() {
  return hasAnyPermission('attendance.view', 'attendance.manage');
}

/**
 * Determine if the current user can manage attendance
 *
 * @returns {boolean} True when attendance manage permission is granted
 */
export function canManageAttendance() {
  return hasPermission('attendance.manage');
}

/**
 * Determine if the current user can manage points and honors
 *
 * @returns {boolean} True when points manage permission is granted
 */
export function canManagePoints() {
  return hasPermission('points.manage');
}

/**
 * Determine if the current user can view points and honors
 *
 * @returns {boolean} True when points view permission is granted
 */
export function canViewPoints() {
  return hasPermission('points.view');
}

/**
 * Determine if the current user can view medication data
 *
 * @returns {boolean} True when any medication access permission is granted
 */
export function canViewMedication() {
  return hasAnyPermission('medication.view', 'medication.manage', 'medication.distribute');
}

/**
 * Determine if the current user can manage medication requirements and receptions
 *
 * @returns {boolean} True when medication manage permission is granted
 */
export function canManageMedication() {
  return hasPermission('medication.manage');
}

/**
 * Determine if the current user can distribute (dispense) medication
 *
 * @returns {boolean} True when medication distribute or manage permission is granted
 */
export function canDistributeMedication() {
  return hasAnyPermission('medication.distribute', 'medication.manage');
}

/**
 * Determine if the current user can view carpool information
 *
 * @returns {boolean} True when any carpool access permission is granted
 */
export function canViewCarpools() {
  return hasAnyPermission('carpools.view', 'carpools.manage');
}

/**
 * Determine if the current user can manage carpools
 *
 * @returns {boolean} True when carpool manage permission is granted
 */
export function canManageCarpools() {
  return hasPermission('carpools.manage');
}

/**
 * Determine if the current user can access administrative tools
 *
 * Combines permission checks with leadership roles to keep compatibility
 * with existing role payloads coming from /api/roles.
 *
 * @returns {boolean} True when the user can access admin interfaces
 */
export function canAccessAdminPanel() {
  if (canManageUsers() || canViewUsers() || canManageRoles() || canViewRoles() || canCreateOrganization() || canSendCommunications()) {
    return true;
  }

  return hasAnyRole('district', 'unitadmin', 'leader', 'demoadmin');
}

/**
 * Determine if the current user can manage form builder tools
 *
 * @returns {boolean} True when user has form permissions or admin access
 */
export function canManageForms() {
  if (hasAnyPermission('forms.view', 'forms.create', 'forms.edit', 'forms.manage')) {
    return true;
  }

  return canAccessAdminPanel();
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
