/**
 * Rules for handing out roles and permissions.
 *
 * Someone may grant only what they hold. A role carries every permission
 * attached to it, so adding a role to a member — or removing one — requires
 * the caller to hold all of that role's permissions. Removal is covered too:
 * otherwise a unit admin could strip the district role from the district
 * administrator. The same rule applies to adding a permission to a role.
 *
 * Built-in or custom, what a role is called never matters; only what it grants.
 *
 * One exception: a permission marked `permissions.self_scoped` (migration 013)
 * does not count when the role is limited to the holder's own children
 * (`roles.data_scope = 'linked'`). There it gives no authority over anyone
 * else — registering or signing for one's own child — so a unit admin can make
 * someone a parent without holding parent-only permissions.
 */


/**
 * @param {Iterable<string>} required - Permission keys needed
 * @param {Iterable<string>} held - Permission keys the caller holds
 * @returns {string[]} Sorted keys in `required` missing from `held`
 */
function missingPermissions(required, held) {
  const heldSet = new Set(held || []);
  return [...new Set(required)].filter((key) => !heldSet.has(key)).sort();
}

/**
 * Normalize role IDs read from JSON (numbers or numeric strings).
 * @param {Array<number|string>} roleIds - Raw role IDs
 * @returns {number[]} Unique integer role IDs
 */
function normalizeRoleIds(roleIds) {
  return [...new Set((roleIds || []).map(Number).filter(Number.isInteger))];
}

/**
 * Load, for each role, the permissions someone needs to hold to grant it.
 * @param {Object} db - Database pool or client
 * @param {number[]} roleIds - Role IDs
 * @returns {Promise<Map<number, {roleName: string, permissions: string[]}>>}
 */
async function loadRolePermissions(db, roleIds) {
  const ids = normalizeRoleIds(roleIds);
  if (ids.length === 0) {
    return new Map();
  }
  const result = await db.query(
    `SELECT r.id, r.role_name,
            COALESCE(
              array_agg(p.permission_key) FILTER (
                WHERE p.permission_key IS NOT NULL
                  AND NOT (p.self_scoped AND r.data_scope = 'linked')
              ),
              '{}'
            ) AS permissions
     FROM roles r
     LEFT JOIN role_permissions rp ON rp.role_id = r.id
     LEFT JOIN permissions p ON p.id = rp.permission_id
     WHERE r.id = ANY($1::int[])
     GROUP BY r.id, r.role_name`,
    [ids]
  );
  return new Map(result.rows.map((row) => [
    Number(row.id),
    { roleName: row.role_name, permissions: row.permissions || [] },
  ]));
}

/**
 * Check that the caller may grant every role in `roleIds`.
 *
 * @param {Object} db - Database pool or client
 * @param {number[]} roleIds - Roles being granted (or removed)
 * @param {string[]} heldPermissions - Caller's permissions in the unit
 * @returns {Promise<{allowed: boolean, required: string[], missing: string[], roles: Array<{id: number, roleName: string, missing: string[]}>}>}
 *   `roles` lists only the roles the caller may not grant.
 */
async function checkRolesGrantable(db, roleIds, heldPermissions) {
  const rolePermissions = await loadRolePermissions(db, roleIds);
  const required = new Set();
  const roles = [];
  for (const [id, { roleName, permissions }] of rolePermissions) {
    permissions.forEach((key) => required.add(key));
    const missing = missingPermissions(permissions, heldPermissions);
    if (missing.length > 0) {
      roles.push({ id, roleName, missing });
    }
  }
  const missing = missingPermissions(required, heldPermissions);
  return { allowed: missing.length === 0, required: [...required].sort(), missing, roles };
}

/**
 * Check a change from a member's current roles to the requested ones. Every
 * role added or removed must be grantable; roles kept as they are need not be.
 *
 * @param {Object} db - Database pool or client
 * @param {Object} change
 * @param {Array<number|string>} change.currentRoleIds - Roles the member holds now
 * @param {Array<number|string>} change.requestedRoleIds - Roles the member should hold
 * @param {string[]} change.heldPermissions - Caller's permissions in the unit
 * @returns {Promise<ReturnType<typeof checkRolesGrantable> & {changedRoleIds: number[]}>}
 */
async function checkRoleChange(db, { currentRoleIds, requestedRoleIds, heldPermissions }) {
  const current = new Set(normalizeRoleIds(currentRoleIds));
  const requested = new Set(normalizeRoleIds(requestedRoleIds));
  const changedRoleIds = [
    ...[...requested].filter((id) => !current.has(id)),
    ...[...current].filter((id) => !requested.has(id)),
  ];
  const check = await checkRolesGrantable(db, changedRoleIds, heldPermissions);
  return { ...check, changedRoleIds };
}

/**
 * Whether adding or removing a permission on a role requires holding it.
 * @param {{self_scoped: boolean}} permission - Row from permissions
 * @param {{data_scope: string}} role - Row from roles
 * @returns {boolean}
 */
function permissionCountsAgainstGrantor(permission, role) {
  return !(permission.self_scoped && role.data_scope === 'linked');
}

module.exports = {
  checkRoleChange,
  permissionCountsAgainstGrantor,
  checkRolesGrantable,
  loadRolePermissions,
  missingPermissions,
  normalizeRoleIds,
};
