/**
 * Role names and the order used to pick a member's primary role for display.
 *
 * Nothing here decides access. Authorization goes through permissions
 * (`requirePermission`, `req.user.permissions`) and, for whether someone sees
 * the whole unit or only their own children, the role's `data_scope`
 * (`getUserDataScope`). A check on a role's name breaks for every custom role.
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

module.exports = {
  ROLES,
  ROLE_PRIORITY,
};
