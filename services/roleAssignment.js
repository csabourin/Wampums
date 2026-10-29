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


const { UNIT_FINANCE_PERMISSIONS } = require('../config/constants');

/**
 * Load the given roles that a unit may use: the built-in roles, which are
 * shared and read-only (organization_id IS NULL, is_system_role), and the
 * unit's own custom roles. Another unit's roles, and custom roles no unit
 * owns, are left out. Queries listing roles repeat this condition inline.
 *
 * @param {Object} db - Database pool or client
 * @param {Array<number|string>} roleIds - Role IDs
 * @param {number} organizationId - The unit
 * @returns {Promise<Array<{id: number, role_name: string, is_system_role: boolean, organization_id: number|null, data_scope: string}>>}
 */
async function findRolesInUnit(db, roleIds, organizationId) {
  const ids = normalizeRoleIds(roleIds);
  if (ids.length === 0) {
    return [];
  }
  const result = await db.query(
    `SELECT id, role_name, is_system_role, organization_id, data_scope
     FROM roles
     WHERE id = ANY($1::int[])
       AND (organization_id = $2 OR (organization_id IS NULL AND is_system_role))`,
    [ids, organizationId]
  );
  return result.rows.map((row) => ({ ...row, id: Number(row.id) }));
}

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

/**
 * Record a change to a member's roles, with the roles as they are now, so the
 * history stays readable after a role is renamed or deleted. Nothing is
 * written when the roles did not change.
 *
 * @param {Object} client - Client inside the change's transaction
 * @param {Object} entry
 * @param {number} entry.organizationId - Unit
 * @param {string} entry.userId - Member UUID
 * @param {string} entry.changedBy - UUID of the person making the change
 * @param {number[]} entry.previousRoleIds - Roles before
 * @param {number[]} entry.newRoleIds - Roles after
 * @param {?string} entry.note - Optional reason
 * @returns {Promise<void>}
 */
async function recordRoleChange(client, { organizationId, userId, changedBy, previousRoleIds, newRoleIds, note }) {
  const before = normalizeRoleIds(previousRoleIds);
  const after = normalizeRoleIds(newRoleIds);
  const unchanged = before.length === after.length && before.every((id) => after.includes(id));
  if (unchanged) {
    return;
  }

  await client.query(
    `WITH snapshot AS (
       SELECT id, jsonb_build_object('id', id, 'role_name', role_name, 'display_name', display_name) AS role
         FROM roles
        WHERE id = ANY($4::int[]) OR id = ANY($5::int[])
     )
     INSERT INTO role_assignment_audit
       (organization_id, user_id, changed_by, previous_roles, new_roles, note)
     VALUES (
       $1, $2, $3,
       COALESCE((SELECT jsonb_agg(role ORDER BY id) FROM snapshot WHERE id = ANY($4::int[])), '[]'::jsonb),
       COALESCE((SELECT jsonb_agg(role ORDER BY id) FROM snapshot WHERE id = ANY($5::int[])), '[]'::jsonb),
       $6
     )`,
    [organizationId, userId, changedBy, before, after, note]
  );
}

/** Return the catalogued View key paired with Manage, when one exists. */
function pairedViewKey(key, catalog) {
  const view = key.endsWith('.manage') ? `${key.slice(0, -'.manage'.length)}.view` : null;
  return view && catalog.some((p) => p.permission_key === view) ? view : null;
}

/**
 * Validate one complete desired state. Unchanged permissions need not be held;
 * additions and removals do. Changing scope checks the authority newly exposed.
 * The same policy drives the matrix and both single and bulk writes.
 */
function checkPermissionChange({ role, catalog, currentKeys, requestedKeys, heldPermissions, previousScope, requireComplete = true }) {
  if (role.is_system_role) {
    return { status: 403, message: 'Cannot modify system roles', required: [], missing: [] };
  }
  const current = new Set(currentKeys);
  const requested = new Set(requestedKeys);
  if (role.data_scope === 'linked' && requested.has('ai.use')) {
    return { status: 409, message: 'AI is reserved for organization-scoped staff' };
  }
  const financial = catalog.find((p) => requested.has(p.permission_key)
    && role.data_scope === 'linked' && UNIT_FINANCE_PERMISSIONS.includes(p.permission_key));
  if (financial) {
    return { status: 409, message: `A role limited to its own children cannot hold ${financial.permission_key}` };
  }
  const incomplete = catalog.find((p) => requested.has(p.permission_key)
    && pairedViewKey(p.permission_key, catalog) && !requested.has(pairedViewKey(p.permission_key, catalog))
    && (requireComplete || !current.has(p.permission_key) || current.has(pairedViewKey(p.permission_key, catalog))));
  if (incomplete) {
    return { status: 409, message: 'Manage requires the matching View permission' };
  }
  const changed = catalog.filter((p) => current.has(p.permission_key) !== requested.has(p.permission_key)
    || (previousScope && previousScope !== role.data_scope && requested.has(p.permission_key)));
  const required = changed.filter((p) => permissionCountsAgainstGrantor(p, role)
    || (previousScope && permissionCountsAgainstGrantor(p, { data_scope: previousScope })))
    .map((p) => p.permission_key);
  // A district permission is delegable only from the district management space.
  if (changed.some((p) => p.district_only)) {
    required.push('roles.manage_district');
  }
  const missing = missingPermissions(required, heldPermissions);
  return missing.length ? { status: 403, message: 'You can only change permissions you hold', required: [...new Set(required)].sort(), missing } : null;
}

/** Explain the static constraint on a matrix cell; dependency locks are dynamic. */
function permissionLockReason(role, permission, heldPermissions, catalog = []) {
  if (role.is_system_role) { return 'system_role'; }
  if (role.data_scope === 'linked' && permission.permission_key === 'ai.use') { return 'linked_ai'; }
  if (permission.district_only && !heldPermissions.includes('roles.manage_district')) { return 'district_only'; }
  if (role.data_scope === 'linked' && UNIT_FINANCE_PERMISSIONS.includes(permission.permission_key)) { return 'linked_finance'; }
  if (permissionCountsAgainstGrantor(permission, role) && !heldPermissions.includes(permission.permission_key)) { return 'not_held'; }
  const view = pairedViewKey(permission.permission_key, catalog);
  const paired = catalog.find((p) => p.permission_key === view);
  if (paired && !(role.permission_ids || []).map(Number).includes(Number(paired.id))
    && permissionCountsAgainstGrantor(paired, role) && !heldPermissions.includes(view)) { return 'not_held'; }
  return null;
}

/** Store a role definition snapshot in the same transaction as its mutation. */
async function recordRoleDefinitionChange(client, { organizationId, changedBy, roleId, before, after }) {
  if (JSON.stringify(before) === JSON.stringify(after)) { return; }
  await client.query(
    `INSERT INTO role_permission_audit (organization_id, changed_by, role_id, previous_state, new_state)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
    [organizationId, changedBy, roleId, JSON.stringify(before), JSON.stringify(after)]
  );
}

module.exports = {
  pairedViewKey,
  checkPermissionChange,
  permissionLockReason,
  recordRoleDefinitionChange,
  recordRoleChange,
  findRolesInUnit,
  checkRoleChange,
  permissionCountsAgainstGrantor,
  checkRolesGrantable,
  loadRolePermissions,
  missingPermissions,
  normalizeRoleIds,
};
