'use strict';

/**
 * Which equipment a unit may use.
 *
 * A unit uses its own equipment, equipment shared with it explicitly
 * (`equipment_item_organizations`), and the equipment of units in its local
 * group unless the owner turned sharing off. Inactive equipment is nobody's.
 * Reservations and loans both check it here, so the two never disagree.
 *
 * @module services/equipmentAccess
 */

/** Equipment the unit ($1) may use, among the ids in $2 (every item when NULL). */
const ACCESSIBLE_EQUIPMENT_SQL = `
  SELECT DISTINCT ei.id
    FROM equipment_items ei
    LEFT JOIN equipment_item_organizations eio
      ON eio.equipment_id = ei.id
     AND eio.organization_id = $1
    LEFT JOIN organization_local_groups owner_olg
      ON owner_olg.organization_id = ei.organization_id
    LEFT JOIN organization_local_groups requester_olg
      ON requester_olg.organization_id = $1
     AND requester_olg.local_group_id = owner_olg.local_group_id
   WHERE ($2::int[] IS NULL OR ei.id = ANY($2::int[]))
     AND ei.is_active IS DISTINCT FROM false
     AND (
       eio.organization_id IS NOT NULL
       OR ei.organization_id = $1
       OR (
         COALESCE((ei.attributes->>'share_with_local_group')::boolean, true)
         AND requester_olg.local_group_id IS NOT NULL
       )
     )`;

/**
 * Ids, among those given, of the equipment the unit may use.
 *
 * @param {import('pg').Pool|import('pg').PoolClient} db - Pool or client
 * @param {number} organizationId - Unit
 * @param {number[]} equipmentIds - Equipment named by a request
 * @returns {Promise<Set<number>>} The accessible ones
 */
async function findAccessibleEquipmentIds(db, organizationId, equipmentIds) {
  const ids = [...new Set(equipmentIds.map(Number))];
  if (ids.length === 0) {
    return new Set();
  }
  const result = await db.query(ACCESSIBLE_EQUIPMENT_SQL, [organizationId, ids]);
  return new Set(result.rows.map((row) => Number(row.id)));
}

/**
 * Ids of every piece of equipment the unit may use.
 *
 * @param {import('pg').Pool|import('pg').PoolClient} db - Pool or client
 * @param {number} organizationId - Unit
 * @returns {Promise<number[]>}
 */
async function listAccessibleEquipmentIds(db, organizationId) {
  const result = await db.query(ACCESSIBLE_EQUIPMENT_SQL, [organizationId, null]);
  return result.rows.map((row) => Number(row.id));
}

/**
 * Whether the unit may use one piece of equipment.
 *
 * @param {import('pg').Pool|import('pg').PoolClient} db - Pool or client
 * @param {number} organizationId - Unit
 * @param {number} equipmentId - Equipment
 * @returns {Promise<boolean>}
 */
async function isEquipmentAccessible(db, organizationId, equipmentId) {
  const accessible = await findAccessibleEquipmentIds(db, organizationId, [equipmentId]);
  return accessible.has(Number(equipmentId));
}

module.exports = { findAccessibleEquipmentIds, listAccessibleEquipmentIds, isEquipmentAccessible };
