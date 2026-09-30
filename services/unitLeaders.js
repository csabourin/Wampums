'use strict';

/**
 * Unit leaders — the people who run the unit, as opposed to the families.
 *
 * A leader is an active member holding at least one role whose data scope is
 * the whole unit (`roles.data_scope = 'organization'`). That is the same line
 * `getUserDataScope` draws, and it follows the roles a unit actually defines:
 * a custom or renamed staff role counts, a family role never does. Role names
 * are not consulted.
 *
 * @module services/unitLeaders
 */

const LEADERS_SQL = `
  SELECT DISTINCT u.id, u.full_name
    FROM users u
    JOIN user_organizations uo ON uo.user_id = u.id
   CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(uo.role_ids, '[]'::jsonb)) AS role_id_text
    JOIN roles r ON r.id = role_id_text::integer
   WHERE uo.organization_id = $1
     AND uo.status = 'active'
     AND r.data_scope = 'organization'`;

/**
 * List the unit's leaders.
 *
 * @param {import('pg').Pool|import('pg').PoolClient} db - Pool or client
 * @param {number} organizationId - Unit
 * @returns {Promise<Array<{id: string, full_name: string}>>} Leaders by name
 */
async function listUnitLeaders(db, organizationId) {
  const result = await db.query(`${LEADERS_SQL} ORDER BY u.full_name`, [organizationId]);
  return result.rows;
}

/**
 * Whether every given user is a leader of the unit.
 *
 * @param {import('pg').Pool|import('pg').PoolClient} db - Pool or client
 * @param {number} organizationId - Unit
 * @param {string[]} userIds - User UUIDs; empty values are ignored
 * @returns {Promise<boolean>} True when all of them are leaders
 */
async function areUnitLeaders(db, organizationId, userIds) {
  const wanted = [...new Set(userIds.filter(Boolean).map(String))];
  if (wanted.length === 0) {
    return true;
  }
  const result = await db.query(
    `SELECT COUNT(*)::int AS found FROM (${LEADERS_SQL} AND u.id = ANY($2::uuid[])) AS leaders`,
    [organizationId, wanted]
  );
  return result.rows[0].found === wanted.length;
}

module.exports = { listUnitLeaders, areUnitLeaders };
