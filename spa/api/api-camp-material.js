/**
 * A camp's collective material list, and reserving what it still needs.
 * Reserving requires a connection and is never queued: the server recounts
 * what is free when it receives the request, which a later replay would not
 * match.
 *
 * @module spa/api/api-camp-material
 */
import { API } from './api-core.js';
import { CONFIG } from '../config.js';

/**
 * Every activity's articles added up, the free-text material beside, and,
 * with inventory.view, what is reserved, free or missing over the camp's dates.
 *
 * @param {number} meetingId - The camp (year-plan meeting)
 * @param {{forceRefresh?: boolean}} [options]
 * @returns {Promise<Object>} API response
 */
export function getCampMaterialList(meetingId, { forceRefresh = false } = {}) {
  return API.get(
    `v1/yearly-planner/meetings/${encodeURIComponent(meetingId)}/material-list`,
    {},
    { forceRefresh, cacheDuration: CONFIG.CACHE_DURATION.SHORT },
  );
}

/**
 * Reserve, for the camp's dates, inventory the list still needs.
 *
 * @param {number} meetingId - The camp
 * @param {Array<{equipment_item_id: number, quantity: number}>} items - Each item once
 * @returns {Promise<Object>} The reservations written
 */
export function reserveCampMaterial(meetingId, items) {
  return API.post(
    `v1/resources/equipment/reservations/camps/${encodeURIComponent(meetingId)}`,
    { items },
    {},
    { queueOffline: false },
  );
}
