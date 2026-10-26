/**
 * The unit's equipment catalogue. Changes need a connection and are never
 * queued: an article named offline could collide with one named elsewhere.
 *
 * @module spa/api/api-equipment-catalog
 */
import { API } from './api-core.js';

/**
 * @param {{includeArchived?: boolean, forceRefresh?: boolean}} [options]
 * @returns {Promise<Object>} The articles, sorted by name
 */
export function getEquipmentCatalog({ includeArchived = false, ...options } = {}) {
  return API.get('v1/equipment-catalog', includeArchived ? { include_archived: 'true' } : {}, options);
}

/**
 * @param {Object} item - name, category, unit_of_measure, equipment_item_id
 * @returns {Promise<Object>} The new article
 */
export function createCatalogItem(item) {
  return API.post('v1/equipment-catalog', item);
}

/**
 * @param {number} itemId
 * @param {Object} changes - Fields to change; `archived` archives or restores
 * @returns {Promise<Object>} The article as it now is
 */
export function updateCatalogItem(itemId, changes) {
  return API.patch(`v1/equipment-catalog/${encodeURIComponent(itemId)}`, changes);
}

/**
 * Inventory items the unit may link an article to.
 *
 * @returns {Promise<Object>} The unit's equipment
 */
export function getLinkableEquipment() {
  return API.get('v1/resources/equipment');
}
