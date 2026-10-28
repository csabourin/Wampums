/** Lots use the shared API client; only prepared state changes may be queued. */
import { buildScopedCacheKey } from '../utils/OfflineCacheKeys.js';
import { debugError } from '../utils/DebugUtils.js';
import { API } from './api-core.js';
import { getLotSnapshot, storeLotSnapshot, pendingLotChanges, lotEndpoint, lotOfflineError, assertLotScope } from '../modules/camp-lots/CampLotOffline.js';

/** Fresh server data online, scoped prepared data when the network is absent. */
export async function getCampLots(meetingId, ownOnly = false) {
  const scope = buildScopedCacheKey('');
  if (navigator.onLine === false) {
    const snapshot = await getLotSnapshot(meetingId, ownOnly, scope);
    if (!snapshot) { throw lotOfflineError(); }
    return { success: true, data: snapshot.lots };
  }
  try {
    const result = await API.getNoCache(lotEndpoint(meetingId, ownOnly));
    assertLotScope(scope);
    const changes = await pendingLotChanges(scope);
    const previous = await getLotSnapshot(meetingId, ownOnly, scope);
    const pendingIds = new Set(changes.map((change) => change.lotId));
    const prepared = result.data.map((lot) => pendingIds.has(lot.id)
      ? previous?.lots.find((entry) => entry.id === lot.id) || lot : lot);
    try { await storeLotSnapshot(meetingId, prepared, ownOnly, undefined, scope); }
    catch (err) { assertLotScope(scope); debugError('Could not prepare camp lots on this device', err); return { ...result, offlinePreparationFailed: true }; }
    assertLotScope(scope);
    return result;
  } catch (err) {
    assertLotScope(scope);
    if (!err.isNetworkError) { throw err; }
    const snapshot = await getLotSnapshot(meetingId, ownOnly, scope);
    if (!snapshot) { throw lotOfflineError(); }
    return { success: true, data: snapshot.lots };
  }
}
export const getCampLotOptions = (meetingId) => API.getNoCache(`v1/camp-equipment-lots/meetings/${encodeURIComponent(meetingId)}/options`);
export const saveCampLot = (meetingId, payload, id = null) => id
  ? API.put(`v1/camp-equipment-lots/meetings/${encodeURIComponent(meetingId)}/${encodeURIComponent(id)}`, payload, {}, { queueOffline: false })
  : API.post(`v1/camp-equipment-lots/meetings/${encodeURIComponent(meetingId)}`, payload, {}, { queueOffline: false });
/** Keep the body receipt id identical to the shared outbox event id, including a lost first response. */
export const changeCampLotStatus = (lot, status, ownOnly) => {
  const mutationId = crypto.randomUUID();
  return API.patch(`v1/camp-equipment-lots/${ownOnly ? 'mine/' : ''}${encodeURIComponent(lot.id)}/status`, {
    status, expected_version: lot.version, mutation_id: mutationId, meeting_id: lot.meeting_id,
    ...(lot.previousMutationId ? { previous_mutation_id: lot.previousMutationId } : {}),
  }, {}, { headers: { 'Idempotency-Key': mutationId } });
};
