/**
 * RoleValidationUtils
 *
 * Utilities for role bundle management, conflict detection, and permission validation.
 *
 * Port of spa/utils/RoleValidationUtils.js
 */

import { DEFAULT_ROLE_SCOPE, ROLE_BUNDLES, ROLE_LEVELS } from '../config/roles.js';

/**
 * Merge live role records with client-side bundle metadata and permission lists.
 *
 * @param {Array<Object>} roleCatalog - Roles returned from the API
 * @param {Object} rolePermissions - Map of role id/name to permission keys
 * @returns {{ list: Array<Object>, byId: Map<number, Object>, byName: Map<string, Object> }}
 */
export function buildRoleBundleIndex(roleCatalog = [], rolePermissions = {}) {
  const list = roleCatalog.map((role) => {
    const metadata = ROLE_BUNDLES[role.role_name] || {};
    const permissions = new Set();

    (metadata.permissions || []).forEach((permission) => {
      if (permission) permissions.add(permission);
    });

    (rolePermissions[role.id] || rolePermissions[role.role_name] || []).forEach((permission) => {
      if (permission) permissions.add(permission);
    });

    return {
      ...role,
      display_name: metadata.displayName || role.display_name || role.role_name,
      description: metadata.description || role.description || "",
      permissions: Array.from(permissions),
      scope: metadata.scope || DEFAULT_ROLE_SCOPE,
      conflictsWith: metadata.conflictsWith || [],
      crossOrgEligibleFor: metadata.crossOrgEligibleFor || [],
      level: typeof metadata.level === "number" ? metadata.level : ROLE_LEVELS[role.role_name] || 0,
      tags: metadata.tags || [],
      featureFlags: metadata.featureFlags || [],
    };
  });

  return {
    list,
    byId: new Map(list.map((bundle) => [bundle.id, bundle])),
    byName: new Map(list.map((bundle) => [bundle.role_name, bundle])),
  };
}

/**
 * Detect conflicting role combinations based on bundle metadata.
 *
 * @param {string[]} selectedRoleNames - Names of the currently selected roles
 * @param {{ byName: Map<string, Object> }} roleIndex - Bundle lookup index
 * @returns {{ hasConflict: boolean, conflicts: string[] }}
 */
export function detectRoleConflicts(selectedRoleNames = [], roleIndex) {
  const selected = new Set(selectedRoleNames);
  const conflicts = new Set();

  selected.forEach((roleName) => {
    const bundle = roleIndex?.byName?.get(roleName);
    (bundle?.conflictsWith || []).forEach((conflictRole) => {
      if (selected.has(conflictRole)) {
        const pair = [roleName, conflictRole].sort().join(" + ");
        conflicts.add(pair);
      }
    });
  });

  return {
    hasConflict: conflicts.size > 0,
    conflicts: Array.from(conflicts),
  };
}

/**
 * Determine permission gaps between the selected roles and the acting admin.
 *
 * @param {string[]} selectedRoleNames - Selected role names
 * @param {{ byName: Map<string, Object> }} roleIndex - Bundle lookup index
 * @param {string[]} actorPermissions - Permission keys granted to the acting admin
 * @returns {{ missing: string[], required: string[], requiresWildcard: boolean }}
 */
export function calculatePermissionGaps(selectedRoleNames = [], roleIndex, actorPermissions = []) {
  const requiredPermissions = new Set();
  let requiresWildcard = false;

  selectedRoleNames.forEach((roleName) => {
    const bundle = roleIndex?.byName?.get(roleName);
    (bundle?.permissions || []).forEach((permission) => {
      if (permission === "*") {
        requiresWildcard = true;
      } else {
        requiredPermissions.add(permission);
      }
    });
  });

  const actorSet = new Set(actorPermissions || []);
  const missing = new Set();

  if (requiresWildcard && !actorSet.has("*")) {
    missing.add("*");
  }

  requiredPermissions.forEach((permission) => {
    if (!actorSet.has(permission)) {
      missing.add(permission);
    }
  });

  return {
    missing: Array.from(missing),
    required: Array.from(requiredPermissions),
    requiresWildcard,
  };
}

/**
 * Identify which selected roles are eligible for cross-organization usage.
 *
 * @param {string[]} selectedRoleNames - Selected role names
 * @param {{ byName: Map<string, Object> }} roleIndex - Bundle lookup index
 * @returns {string[]} Role names flagged for local group eligibility
 */
export function getLocalGroupEligibleRoles(selectedRoleNames = [], roleIndex) {
  return selectedRoleNames.filter((roleName) => {
    const bundle = roleIndex?.byName?.get(roleName);
    return (bundle?.crossOrgEligibleFor || []).includes("local_group");
  });
}

export default {
  buildRoleBundleIndex,
  detectRoleConflicts,
  calculatePermissionGaps,
  getLocalGroupEligibleRoles,
};
