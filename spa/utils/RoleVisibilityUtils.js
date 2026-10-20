/**
 * Built-in roles a unit replaced with its own and hid.
 *
 * Hiding changes no one's rights (services/roleVisibility.js): members who
 * hold the role keep it. It is only no longer offered, and the server refuses
 * to grant it anew. A list of roles to choose from therefore leaves a hidden
 * role out, unless the member already holds it, so it can still be seen and
 * removed.
 *
 * @module spa/utils/RoleVisibilityUtils
 */

/**
 * @param {Array<{id: number, hidden?: boolean}>} roles - Roles from GET /v1/roles
 * @param {Array<number|string>} [heldRoleIds] - Roles the member holds now
 * @returns {Array<Object>} The roles to offer, in their order
 */
export function rolesToOffer(roles = [], heldRoleIds = []) {
  const held = new Set((heldRoleIds || []).map(Number));
  return (roles || []).filter((role) => !role.hidden || held.has(Number(role.id)));
}
