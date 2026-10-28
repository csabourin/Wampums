/** Device snapshots and the shared, token-free outbox are the only offline sources. */
import { getCachedData, setCachedData, getOfflineData } from '../../indexedDB.js';
import { buildScopedCacheKey, normalizeApiPath } from '../../utils/OfflineCacheKeys.js';
import { getCurrentUserId, getCurrentOrganizationId } from '../../api/api-helpers.js';
import { verifyOfflineAssets } from '../offline/OfflineAssets.js';
import { invalidateForWrite } from '../../utils/CacheInvalidation.js';
import { CAMP_LOTS } from '../../config/camp-lots.js';

const STATUS_PATH = /^\/api\/v1\/camp-equipment-lots\/(?:mine\/)?([1-9]\d*)\/status$/;
/** A translated refusal, distinct from a write saved to the device. */
export function lotOfflineError() {
  return Object.assign(new Error('camp_lot_not_prepared'), { code: 'camp_lot_not_prepared' });
}
export const lotEndpoint = (meetingId, ownOnly) => `v1/camp-equipment-lots/${ownOnly ? 'mine/' : ''}meetings/${encodeURIComponent(meetingId)}`;
export const lotSnapshotKey = (meetingId, ownOnly) => buildScopedCacheKey(`camp_lots_snapshot_${ownOnly ? 'mine' : 'unit'}_${Number(meetingId)}`);

/** Snapshots contain no youth, health, family or account email data. */
export async function storeLotSnapshot(meetingId, lots, ownOnly, duration = CAMP_LOTS.CACHE_MS) {
  const snapshot = { schema: CAMP_LOTS.SNAPSHOT_VERSION, scope: buildScopedCacheKey(''), meetingId: Number(meetingId), ownOnly,
    preparedAt: Date.now(), expiresAt: Date.now() + duration, lots };
  await setCachedData(lotSnapshotKey(meetingId, ownOnly), snapshot, duration,
    { sources: ['/api/v1/camp-equipment-lots'] });
  return snapshot;
}

/** An old, expired, different-account or unproved flag never authorizes queueing. */
export async function getLotSnapshot(meetingId, ownOnly) {
  const scope = buildScopedCacheKey('');
  const snapshot = await getCachedData(lotSnapshotKey(meetingId, ownOnly));
  return scope === buildScopedCacheKey('') && snapshot?.scope === scope && snapshot.schema === CAMP_LOTS.SNAPSHOT_VERSION
    && snapshot.meetingId === Number(meetingId) && snapshot.ownOnly === ownOnly && snapshot.expiresAt > Date.now()
    && Array.isArray(snapshot.lots) ? snapshot : null;
}

/** Ordered changes belonging to this signed-in account and unit, across all tabs. */
export async function pendingLotChanges() {
  const userId = String(getCurrentUserId());
  const organizationId = String(getCurrentOrganizationId());
  return (await getOfflineData()).flatMap((record) => {
    const data = record.data;
    const match = data?.url && STATUS_PATH.exec(normalizeApiPath(data.url));
    if (!match || String(record.action || data.method).toUpperCase() !== 'PATCH'
      || String(data.userId) !== userId || String(data.organizationId) !== organizationId) { return []; }
    try {
      const body = JSON.parse(data.body);
      return [{ lotId: Number(match[1]), ...body, mutationId: data.idempotencyKey }];
    } catch { return []; }
  });
}

/** Pending progress is explicitly labelled, never inserted into confirmed history. */
export function overlayLotChanges(lots, changes) {
  return lots.map((lot) => changes.filter((change) => change.lotId === lot.id).reduce((current, change) => ({
    ...current, status: change.status, version: Math.max(current.version, change.expected_version + 1),
    pending: true, previousMutationId: change.mutation_id,
  }), lot));
}

/** Central queue gate, including the network-error fallback of the API client. */
export async function assertPreparedLotMutation(url, body) {
  const scope = buildScopedCacheKey('');
  const path = normalizeApiPath(url);
  const match = STATUS_PATH.exec(path);
  let input;
  try { input = JSON.parse(body); } catch { throw lotOfflineError(); }
  const ownOnly = path.includes('/mine/');
  const snapshot = await getLotSnapshot(input?.meeting_id, ownOnly);
  const lot = snapshot && overlayLotChanges(snapshot.lots, await pendingLotChanges()).find((entry) => entry.id === Number(match?.[1]));
  if (!lot || input.expected_version !== lot.version
    || !CAMP_LOTS.LOT_TRANSITIONS[lot.status]?.includes(input.status)
    || !await verifyOfflineAssets({ download: false }) || scope !== buildScopedCacheKey('')) { throw lotOfflineError(); }
}

/**
 * Keep prepared copies current even if the page that queued the change is closed.
 * The response may be an older receipt: it must not replace a newer version.
 */
export async function applyReplayedLot(lot) {
  const scope = buildScopedCacheKey('');
  for (const ownOnly of [false, true]) {
    // eslint-disable-next-line no-await-in-loop -- update the two scoped copies in sequence
    const snapshot = await getLotSnapshot(lot.meeting_id, ownOnly);
    if (!snapshot || !snapshot.lots.some((entry) => entry.id === lot.id)) { continue; }
    if (scope !== buildScopedCacheKey('')) { return; }
    const lots = snapshot.lots.map((entry) => entry.id === lot.id && entry.version <= lot.version ? lot : entry);
    const remaining = snapshot.expiresAt - Date.now();
    // eslint-disable-next-line no-await-in-loop -- retain the original expiry, not another full camp period
    await storeLotSnapshot(lot.meeting_id, lots, ownOnly, remaining);
  }
  if (scope === buildScopedCacheKey('')) { await invalidateForWrite('v1/tasks'); }
}
