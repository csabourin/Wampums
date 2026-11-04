/**
 * A camp's site and emergency numbers kept on this device (#1327), so the
 * hospital, the poison centre and the number to call are there when the
 * network is not.
 *
 * A read-only copy of GET /v1/camp-sites/camps/:meetingId, without the
 * members a manager may choose a lead from. It is stored when the screen opens
 * online and by camp preparation, scoped to the account, unit and scout year,
 * and it expires with the camp's other prepared data. Any confirmed write to
 * the camp sites clears it, so a stale copy is never kept after an edit: its
 * key sits under the resource's own path, which the writes clear in every
 * mode (by prefix in camp mode or offline, by `sources` otherwise).
 *
 * Callers pass the scope they captured before reading (as the camp lots do):
 * a copy is written only while that scope is still the session's, records it,
 * and is read back only in that same scope, so an account, unit or year
 * switch during a request can neither store nor show another session's copy.
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

/** @returns {string} The session's scope: account, unit and scout year */
export function currentCampSiteScope() {
  return buildScopedCacheKey('');
}

/**
 * @param {string} scope - Captured with currentCampSiteScope()
 * @throws {Error} When the session changed since
 */
function assertScope(scope) {
  if (scope !== currentCampSiteScope()) {
    throw Object.assign(new Error('Session changed'), { name: 'AbortError' });
  }
}

/**
 * @param {number} meetingId - The planned camp
 * @param {string} [scope] - The scope it belongs to
 * @returns {string} Its snapshot's key
 */
export function campSiteSnapshotKey(meetingId, scope = currentCampSiteScope()) {
  return buildScopedCacheKey(`/api/v1/camp-sites/camps/${Number(meetingId)}/offline-copy${scope}`);
}

/**
 * Keep a copy of the camp's site on this device.
 *
 * @param {number} meetingId - The planned camp
 * @param {Object} data - `data` of GET /v1/camp-sites/camps/:meetingId
 * @param {number} [duration] - How long the copy is kept
 * @param {string} [scope] - The scope captured before reading `data`
 * @returns {Promise<string>} The key it was stored under
 * @throws {Error} When the session changed since `scope` was captured
 */
export async function storeCampSiteSnapshot(meetingId, data, duration = CAMP_SITE_SNAPSHOT_MS, scope = currentCampSiteScope()) {
  assertScope(scope);
  const { members: _members, ...kept } = data || {};
  const key = campSiteSnapshotKey(meetingId, scope);
  await setCachedData(key, {
    schema: SNAPSHOT_VERSION,
    scope,
    meetingId: Number(meetingId),
    preparedAt: Date.now(),
    data: kept,
  }, duration, { sources: ['/api/v1/camp-sites'] });
  assertScope(scope);
  return key;
}

/**
 * The copy kept on this device, or null when there is none for this camp in
 * this scope (or it expired).
 *
 * @param {number} meetingId - The planned camp
 * @param {string} [scope] - The scope captured before reading
 * @returns {Promise<?{preparedAt: number, data: Object}>}
 */
export async function getCampSiteSnapshot(meetingId, scope = currentCampSiteScope()) {
  const snapshot = await getCachedData(campSiteSnapshotKey(meetingId, scope));
  return scope === currentCampSiteScope() && snapshot?.schema === SNAPSHOT_VERSION && snapshot.scope === scope
    && snapshot.meetingId === Number(meetingId) && snapshot.data?.camp
    ? snapshot
    : null;
}
