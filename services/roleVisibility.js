/**
 * Built-in roles a unit hides once it has customized them.
 *
 * A unit that customizes a built-in role ("Personnaliser" in the role matrix)
 * would otherwise see both wherever roles are offered. It may hide the
 * built-in one (migration 038). Hiding changes no one's rights: members who
 * hold the role keep it and its permissions. The role is only left out of the
 * lists that offer roles, and granting it anew in that unit is refused, so an
 * old page or an API client cannot bring it back.
 *
 * A built-in role may be hidden only while the unit has a role customized
 * from it (`roles.customized_from_role_id`), so a hidden role always has a
 * replacement. The district role, which holds every permission, is never
 * hidden.
 */

const { normalizeRoleIds } = require('./roleAssignment');

/** Why a built-in role cannot be hidden, as translation-key suffixes the SPA knows. */
const HIDE_REFUSALS = {
  NOT_BUILT_IN: 'not_built_in',
  ALL_PERMISSIONS: 'all_permissions',
  NOT_CUSTOMIZED: 'not_customized',
};

/**
 * SQL condition, on a row `r` of roles, true when unit `$unit` hid it.
 * Callers bind the unit to the placeholder they pass.
 *
 * @param {string} placeholder - Placeholder holding the unit id, e.g. '$1'
 * @returns {string} SQL boolean expression
 */
function hiddenInUnitSql(placeholder) {
  return `EXISTS (SELECT 1 FROM organization_hidden_roles h
                  WHERE h.organization_id = ${placeholder} AND h.role_id = r.id)`;
}

/**
 * @param {Object} db - Database pool or client
 * @param {number} organizationId - The unit
 * @returns {Promise<number[]>} IDs of the roles the unit hid
 */
async function findHiddenRoleIds(db, organizationId) {
  const result = await db.query(
    'SELECT role_id FROM organization_hidden_roles WHERE organization_id = $1 ORDER BY role_id',
    [organizationId]
  );
  return result.rows.map((row) => Number(row.role_id));
}

/**
 * The roles among `roleIds` that the unit hid.
 *
 * @param {Object} db - Database pool or client
 * @param {Array<number|string>} roleIds - Role IDs
 * @param {number} organizationId - The unit
 * @returns {Promise<number[]>} Hidden role IDs, sorted
 */
async function findHiddenAmong(db, roleIds, organizationId) {
  const ids = normalizeRoleIds(roleIds);
  if (ids.length === 0) {
    return [];
  }
  const result = await db.query(
    `SELECT role_id FROM organization_hidden_roles
     WHERE organization_id = $1 AND role_id = ANY($2::int[])
     ORDER BY role_id`,
    [organizationId, ids]
  );
  return result.rows.map((row) => Number(row.role_id));
}

/**
 * Whether a role may be hidden in the unit.
 *
 * @param {{organization_id: ?number, is_system_role: boolean, grants_all_permissions?: boolean, customized_count?: number|string}} role
 *   Row from roles, with the number of the unit's roles customized from it
 * @returns {?string} A HIDE_REFUSALS value, or null when it may be hidden
 */
function hideRefusal(role) {
  if (role.organization_id !== null || !role.is_system_role) {
    return HIDE_REFUSALS.NOT_BUILT_IN;
  }
  if (role.grants_all_permissions) {
    return HIDE_REFUSALS.ALL_PERMISSIONS;
  }
  if (!(Number(role.customized_count) > 0)) {
    return HIDE_REFUSALS.NOT_CUSTOMIZED;
  }
  return null;
}

/**
 * Hide or show a built-in role in the unit.
 *
 * @param {Object} client - Client inside the change's transaction
 * @param {Object} change
 * @param {number} change.organizationId - The unit
 * @param {number} change.roleId - Role to hide or show
 * @param {boolean} change.hidden - True to hide
 * @param {string} change.changedBy - UUID of the person making the change
 * @returns {Promise<{status: 'not_found'}|{status: 'refused', reason: string}|{status: 'ok', hidden: boolean}>}
 */
async function setRoleHidden(client, { organizationId, roleId, hidden, changedBy }) {
  const role = (await client.query(
    `SELECT r.id, r.organization_id, r.is_system_role, r.grants_all_permissions,
            (SELECT COUNT(*) FROM roles c
              WHERE c.organization_id = $2 AND c.customized_from_role_id = r.id) AS customized_count
       FROM roles r
      WHERE r.id = $1
        AND (r.organization_id = $2 OR (r.organization_id IS NULL AND r.is_system_role))
      FOR UPDATE OF r`,
    [roleId, organizationId]
  )).rows[0];
  if (!role) {
    return { status: 'not_found' };
  }
  if (!hidden) {
    await client.query(
      'DELETE FROM organization_hidden_roles WHERE organization_id = $1 AND role_id = $2',
      [organizationId, roleId]
    );
    return { status: 'ok', hidden: false };
  }
  const reason = hideRefusal(role);
  if (reason) {
    return { status: 'refused', reason };
  }
  await client.query(
    `INSERT INTO organization_hidden_roles (organization_id, role_id, hidden_by)
     VALUES ($1, $2, $3) ON CONFLICT (organization_id, role_id) DO NOTHING`,
    [organizationId, roleId, changedBy]
  );
  return { status: 'ok', hidden: true };
}

/**
 * Show again every built-in role the unit no longer has a replacement for,
 * after a custom role was deleted or stopped replacing it.
 *
 * @param {Object} client - Client inside the change's transaction
 * @param {number} organizationId - The unit
 * @returns {Promise<void>}
 */
async function releaseUnreplacedHiddenRoles(client, organizationId) {
  await client.query(
    `DELETE FROM organization_hidden_roles h
      WHERE h.organization_id = $1
        AND NOT EXISTS (SELECT 1 FROM roles c
                         WHERE c.organization_id = $1 AND c.customized_from_role_id = h.role_id)`,
    [organizationId]
  );
}

module.exports = {
  HIDE_REFUSALS,
  hiddenInUnitSql,
  findHiddenRoleIds,
  findHiddenAmong,
  hideRefusal,
  setRoleHidden,
  releaseUnreplacedHiddenRoles,
};
