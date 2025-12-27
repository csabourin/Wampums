/**
 * Centralized Role Definitions and Groupings
 *
 * Single source of truth for all role-related logic throughout the application.
 * This eliminates hardcoded role strings scattered across 30+ files.
 *
 * Usage:
 *   const { ROLES, ROLE_GROUPS, hasStaffRole } = require('../config/role-constants');
 *   if (hasStaffRole(userRoles)) { ... }
 *
 * @module config/role-constants
 */

/**
 * Individual role names
 * These match the role_name column in the roles table
 */
const ROLES = {
  // Administrative roles
  DISTRICT: 'district',
  UNIT_ADMIN: 'unitadmin',

  // Program roles
  LEADER: 'leader',

  // Specialized roles
  FINANCE: 'finance',
  EQUIPMENT: 'equipment',
  ADMINISTRATION: 'administration',

  // Family roles
  PARENT: 'parent',

  // Demo roles (read-only)
  DEMO_ADMIN: 'demoadmin',
  DEMO_PARENT: 'demoparent',

  // Legacy roles (deprecated, kept for backward compatibility)
  ADMIN: 'admin',
  ANIMATION: 'animation',
};

/**
 * Role groupings by access level and data scope
 * These define which roles have access to what data
 */
const ROLE_GROUPS = {
  /**
   * Staff roles with organization-wide participant access
   * These users can view ALL participants in the organization
   * Data scope: 'organization'
   */
  STAFF_PARTICIPANT_ACCESS: [
    ROLES.DISTRICT,
    ROLES.UNIT_ADMIN,
    ROLES.LEADER,
    ROLES.ADMIN,         // Legacy
    ROLES.ANIMATION,     // Legacy
    ROLES.DEMO_ADMIN
  ],

  /**
   * Parent-only roles with linked participant access
   * These users can only view participants they're linked to
   * Data scope: 'linked'
   */
  PARENT_ONLY: [
    ROLES.PARENT,
    ROLES.DEMO_PARENT
  ],

  /**
   * Staff roles (non-parent, non-demo)
   * Used for general staff operations
   */
  STAFF: [
    ROLES.DISTRICT,
    ROLES.UNIT_ADMIN,
    ROLES.LEADER,
    ROLES.FINANCE,
    ROLES.EQUIPMENT,
    ROLES.ADMINISTRATION,
    ROLES.ADMIN,         // Legacy
    ROLES.ANIMATION      // Legacy
  ],

  /**
   * Administrative roles with full system access
   * Can manage users, roles, and organization settings
   */
  ADMIN: [
    ROLES.DISTRICT,
    ROLES.UNIT_ADMIN
  ],

  /**
   * Demo roles (read-only access)
   * Cannot perform write operations
   */
  DEMO: [
    ROLES.DEMO_ADMIN,
    ROLES.DEMO_PARENT
  ],

  /**
   * Financial access roles
   * Can view/manage budgets, expenses, fundraisers
   */
  FINANCE_ACCESS: [
    ROLES.DISTRICT,
    ROLES.UNIT_ADMIN,
    ROLES.FINANCE,
    ROLES.ADMINISTRATION,
    ROLES.DEMO_ADMIN
  ],

  /**
   * Communication roles
   * Can send messages, announcements, notifications
   */
  COMMUNICATION_ACCESS: [
    ROLES.DISTRICT,
    ROLES.UNIT_ADMIN,
    ROLES.LEADER,
    ROLES.ADMINISTRATION,
    ROLES.ADMIN,         // Legacy
    ROLES.ANIMATION      // Legacy
  ],

  /**
   * Carpool management roles
   * Can create and manage carpool assignments
   */
  CARPOOL_MANAGEMENT: [
    ROLES.DISTRICT,
    ROLES.UNIT_ADMIN,
    ROLES.LEADER,
    ROLES.ADMIN,         // Legacy
    ROLES.ANIMATION      // Legacy
  ]
};

/**
 * Role priority for default selection when user has multiple roles
 * Higher priority (lower index) = preferred default role
 */
const ROLE_PRIORITY = [
  ROLES.DISTRICT,
  ROLES.UNIT_ADMIN,
  ROLES.LEADER,
  ROLES.FINANCE,
  ROLES.EQUIPMENT,
  ROLES.ADMINISTRATION,
  ROLES.PARENT,
  ROLES.DEMO_ADMIN,
  ROLES.DEMO_PARENT,
  ROLES.ADMIN,         // Legacy
  ROLES.ANIMATION      // Legacy
];

/**
 * Legacy role aliases for backward compatibility
 * Maps old role names to new canonical names
 */
const ROLE_ALIASES = {
  'animator': ROLES.ANIMATION,
  'animateur': ROLES.ANIMATION
};

/**
 * Data scope types
 * Determines what data users can access based on their roles
 */
const DATA_SCOPE = {
  ORGANIZATION: 'organization',  // Can see all data in organization
  LINKED: 'linked'               // Can only see data they're linked to
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Check if a role is a staff role with organization-wide access
 * @param {string} roleName - Role name to check
 * @returns {boolean} True if role has staff-level access
 */
function isStaffRole(roleName) {
  return ROLE_GROUPS.STAFF_PARTICIPANT_ACCESS.includes(roleName);
}

/**
 * Check if a role is parent-only (linked access)
 * @param {string} roleName - Role name to check
 * @returns {boolean} True if role is parent-only
 */
function isParentOnlyRole(roleName) {
  return ROLE_GROUPS.PARENT_ONLY.includes(roleName);
}

/**
 * Check if a role is a demo role (read-only)
 * @param {string} roleName - Role name to check
 * @returns {boolean} True if role is a demo role
 */
function isDemoRole(roleName) {
  return ROLE_GROUPS.DEMO.includes(roleName);
}

/**
 * Check if a role is an admin role
 * @param {string} roleName - Role name to check
 * @returns {boolean} True if role is an admin role
 */
function isAdminRole(roleName) {
  return ROLE_GROUPS.ADMIN.includes(roleName);
}

/**
 * Check if user roles array contains any staff role
 * @param {Array<string>} userRoles - Array of user's role names
 * @returns {boolean} True if user has at least one staff role
 *
 * @example
 * const userRoles = ['parent', 'leader'];
 * hasStaffRole(userRoles); // true (because 'leader' is a staff role)
 */
function hasStaffRole(userRoles) {
  if (!Array.isArray(userRoles)) {
    return false;
  }
  return userRoles.some(role => isStaffRole(role));
}

/**
 * Check if user has ONLY parent roles (no staff roles)
 * @param {Array<string>} userRoles - Array of user's role names
 * @returns {boolean} True if user has only parent roles
 *
 * @example
 * isParentOnly(['parent']); // true
 * isParentOnly(['parent', 'leader']); // false (has staff role)
 * isParentOnly(['parent', 'demoparent']); // true
 */
function isParentOnly(userRoles) {
  if (!Array.isArray(userRoles) || userRoles.length === 0) {
    return false;
  }
  return userRoles.every(role => isParentOnlyRole(role));
}

/**
 * Check if user has any demo roles
 * @param {Array<string>} userRoles - Array of user's role names
 * @returns {boolean} True if user has any demo role
 */
function hasDemoRole(userRoles) {
  if (!Array.isArray(userRoles)) {
    return false;
  }
  return userRoles.some(role => isDemoRole(role));
}

/**
 * Check if user has any admin roles
 * @param {Array<string>} userRoles - Array of user's role names
 * @returns {boolean} True if user has any admin role
 */
function hasAdminRole(userRoles) {
  if (!Array.isArray(userRoles)) {
    return false;
  }
  return userRoles.some(role => isAdminRole(role));
}

/**
 * Check if user has any of the specified roles
 * @param {Array<string>} userRoles - Array of user's role names
 * @param {Array<string>} requiredRoles - Roles to check for
 * @returns {boolean} True if user has at least one required role
 */
function hasAnyRole(userRoles, requiredRoles) {
  if (!Array.isArray(userRoles) || !Array.isArray(requiredRoles)) {
    return false;
  }
  return userRoles.some(role => requiredRoles.includes(role));
}

/**
 * Check if user has all of the specified roles
 * @param {Array<string>} userRoles - Array of user's role names
 * @param {Array<string>} requiredRoles - Roles to check for
 * @returns {boolean} True if user has all required roles
 */
function hasAllRoles(userRoles, requiredRoles) {
  if (!Array.isArray(userRoles) || !Array.isArray(requiredRoles)) {
    return false;
  }
  return requiredRoles.every(role => userRoles.includes(role));
}

/**
 * Get the primary role from a user's roles based on priority
 * @param {Array<string>} userRoles - Array of user's role names
 * @returns {string|null} Highest priority role or null
 */
function getPrimaryRole(userRoles) {
  if (!Array.isArray(userRoles) || userRoles.length === 0) {
    return null;
  }

  // Find the first role in ROLE_PRIORITY that the user has
  for (const priorityRole of ROLE_PRIORITY) {
    if (userRoles.includes(priorityRole)) {
      return priorityRole;
    }
  }

  // Fallback to first role if none match priority list
  return userRoles[0];
}

/**
 * Normalize a role name using aliases
 * @param {string} roleName - Role name to normalize
 * @returns {string} Normalized role name
 */
function normalizeRoleName(roleName) {
  if (!roleName) {
    return roleName;
  }

  const sanitized = roleName.toLowerCase().trim();
  return ROLE_ALIASES[sanitized] || sanitized;
}

/**
 * Get data scope for a set of roles
 * If user has ANY organization-scoped role, they get organization access
 * Otherwise, they get linked access
 *
 * @param {Array<string>} userRoles - Array of user's role names
 * @returns {string} 'organization' or 'linked'
 */
function getDataScopeForRoles(userRoles) {
  if (hasStaffRole(userRoles)) {
    return DATA_SCOPE.ORGANIZATION;
  }
  return DATA_SCOPE.LINKED;
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  // Constants
  ROLES,
  ROLE_GROUPS,
  ROLE_PRIORITY,
  ROLE_ALIASES,
  DATA_SCOPE,

  // Single role checkers
  isStaffRole,
  isParentOnlyRole,
  isDemoRole,
  isAdminRole,

  // Multi-role checkers
  hasStaffRole,
  isParentOnly,
  hasDemoRole,
  hasAdminRole,
  hasAnyRole,
  hasAllRoles,

  // Utility functions
  getPrimaryRole,
  normalizeRoleName,
  getDataScopeForRoles
};
