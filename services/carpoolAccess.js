'use strict';

/**
 * Who sees which children on the carpool screens.
 *
 * `carpools.view` lets a family offer a ride and seat its own children. It is
 * not a right to the unit's roster: a family member (a role limited to linked
 * children) sees only the children linked to their account, together with the
 * seat counts every family needs. Whoever manages carpools, or holds a role
 * covering the whole unit, sees every child.
 *
 * @module services/carpoolAccess
 */

const { getUserDataScope } = require('../middleware/auth');

/**
 * The account whose children a carpool listing is limited to, or null when the
 * caller may see the whole unit.
 *
 * Pass the result as a `$n::uuid` parameter and filter with
 * `$n::uuid IS NULL OR <participant> IN (SELECT participant_id FROM user_participants WHERE user_id = $n)`.
 *
 * @param {Object} req - Authenticated request (permissions loaded by requirePermission)
 * @param {Object} pool - Database pool
 * @returns {Promise<string|null>} User UUID to restrict to, or null for the whole unit
 */
async function carpoolRosterRestriction(req, pool) {
  if ((req.userPermissions || []).includes('carpools.manage')) {
    return null;
  }
  return await getUserDataScope(req, pool) === 'organization' ? null : req.user.id;
}

module.exports = { carpoolRosterRestriction };
