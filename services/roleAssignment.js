/**
 * Rules for handing out roles.
 *
 * A role is district-level when it grants users.assign_district, whatever it is
 * called. Only someone who holds that permission may assign such a role or see
 * it in the list of assignable roles. Asking the role's permissions rather than
 * its name means a renamed or custom role carrying district powers is guarded
 * the same way as the built-in district role.
 */

const DISTRICT_ASSIGNMENT_PERMISSION = 'users.assign_district';

/**
 * Whether the caller may hand out district-level roles.
 * @param {string[]} callerPermissions - Permissions resolved by requirePermission
 * @returns {boolean}
 */
function canAssignDistrictRoles(callerPermissions) {
  return (callerPermissions || []).includes(DISTRICT_ASSIGNMENT_PERMISSION);
}

/**
 * Find which of the given roles are district-level.
 * @param {Object} pool - Database pool or client
 * @param {number[]} roleIds - Role IDs about to be assigned
 * @returns {Promise<number[]>} IDs of the roles that grant users.assign_district
 */
async function findDistrictLevelRoleIds(pool, roleIds) {
  const result = await pool.query(
    `SELECT DISTINCT rp.role_id AS id
     FROM role_permissions rp
     JOIN permissions p ON p.id = rp.permission_id
     WHERE rp.role_id = ANY($1::int[])
       AND p.permission_key = $2`,
    [roleIds, DISTRICT_ASSIGNMENT_PERMISSION]
  );
  return result.rows.map((row) => row.id);
}

module.exports = {
  DISTRICT_ASSIGNMENT_PERMISSION,
  canAssignDistrictRoles,
  findDistrictLevelRoleIds,
};
