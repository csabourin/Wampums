/**
 * API calls for badges recorded outside the normal approval flow.
 *
 * @module spa/api/api-badges
 */

import { API } from './api-core.js';
import { clearBadgeRelatedCaches } from '../indexedDB.js';

/**
 * Record badge levels a youth earned before the unit tracked them, without
 * awarding new-achievement points.
 * @param {{participant_id: number, date: ?string, star_type: string, entries: Array<{badge_template_id: number, level: number}>}} historyData
 * @returns {Promise<Object>} API response; `queued` with a `mutationId` when saved offline
 */
export async function saveBadgeHistory(historyData) {
  const result = await API.post('v1/badges/history', historyData);
  // The tracker reads badge data under legacy cache keys the write does not reach.
  if (!result?.queued) {
    await clearBadgeRelatedCaches();
  }
  return result;
}
