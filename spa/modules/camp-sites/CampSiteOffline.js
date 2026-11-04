/**
 * A camp's site and emergency numbers kept on this device (#1327), so the
 * hospital, the poison centre and the number to call are there when the
 * network is not.
 *
 * A read-only copy of GET /v1/camp-sites/camps/:meetingId, without the
 * members a manager may choose a lead from. It is stored when the screen opens
 * online and by camp preparation, scoped to the account, unit and scout year,
 * and it expires with the camp's other prepared data. Any confirmed write to
 * the camp sites clears it (its `sources`), so a stale copy is never kept
 * after an edit.
 *
 * @module spa/modules/camp-sites/CampSiteOffline
 */
import { getCachedData, setCachedData } from '../../indexedDB.js';
import { buildScopedCacheKey } from '../../utils/OfflineCacheKeys.js';
import { OFFLINE_CAMPS } from '../../config/offline-camps.js';

/** Bumped when the stored shape changes, so an older copy is never read as a new one. */
const SNAPSHOT_VERSION = 1;
/** As long as a camp's prepared data: its longest stay and the days after it. */
export const CAMP_SITE_SNAPSHOT_MS = (OFFLINE_CAMPS.MAX_DAYS + OFFLINE_CAMPS.EXPIRY_BUFFER_DAYS) * OFFLINE_CAMPS.DAY_MS;

/**
 * @param {number} meetingId - The planned camp
 * @returns {string} Its snapshot's key, in the current scope
 */
export function campSiteSnapshotKey(meetingId) {
  return buildScopedCacheKey(`camp_site_snapshot_${Number(meetingId)}`);
}

/**
 * Keep a copy of the camp's site on this device.
 *
 * @param {number} meetingId - The planned camp
 * @param {Object} data - `data` of GET /v1/camp-sites/camps/:meetingId
 * @param {number} [duration] - How long the copy is kept
 * @returns {Promise<string>} The key it was stored under
 */
export async function storeCampSiteSnapshot(meetingId, data, duration = CAMP_SITE_SNAPSHOT_MS) {
  const { members: _members, ...kept } = data || {};
  const key = campSiteSnapshotKey(meetingId);
  await setCachedData(key, {
    schema: SNAPSHOT_VERSION,
    meetingId: Number(meetingId),
    preparedAt: Date.now(),
    data: kept,
  }, duration, { sources: ['/api/v1/camp-sites'] });
  return key;
}

/**
 * The copy kept on this device, or null when there is none for this camp in
 * this scope (or it expired).
 *
 * @param {number} meetingId - The planned camp
 * @returns {Promise<?{preparedAt: number, data: Object}>}
 */
export async function getCampSiteSnapshot(meetingId) {
  const snapshot = await getCachedData(campSiteSnapshotKey(meetingId));
  return snapshot?.schema === SNAPSHOT_VERSION && snapshot.meetingId === Number(meetingId) && snapshot.data?.camp
    ? snapshot
    : null;
}
