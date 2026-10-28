'use strict';

/**
 * Which equipment a unit may use.
 *
 * A unit uses the equipment owned by its Scout group, its unit equipment, and equipment shared with it explicitly
 * (`equipment_item_organizations`), and the equipment of units in its local
 * group unless the owner turned sharing off. Inactive equipment is nobody's.
 * Reservations and loans both check it here, so the two never disagree.
 *
 * @module services/equipmentAccess
 */

/** Equipment the unit ($1) may use, among the ids in $2 (every item when NULL). */
const { equipmentAccessSql } = require('./equipmentOwnership');
const ACCESSIBLE_EQUIPMENT_SQL = `
  SELECT DISTINCT ei.id FROM equipment_items ei
  WHERE ($2::int[] IS NULL OR ei.id = ANY($2::int[]))
    AND ei.is_active IS DISTINCT FROM false AND ${equipmentAccessSql('ei', '$1')}`;

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
