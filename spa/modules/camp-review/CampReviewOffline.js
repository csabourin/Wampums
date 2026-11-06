/**
 * A camp's review kept on this device (#1257), and the changes waiting in the
 * offline outbox, so notes can be added and weighed at the last campfire
 * without a network.
 *
 * - The **copy** is the last review the server confirmed. It is stored when the
 *   screen opens online and by camp preparation, scoped to the account, unit
 *   and scout year. Its key sits outside the API resource path, so a queued
 *   write does not clear it; every confirmed write, and every replay, applies
 *   its answer to it instead (`applyCampReviewAnswer`), even with the screen
 *   closed.
 * - **Pending** changes come from the shared, token-free outbox and are laid
 *   over the copy (`overlayPending`), marked as such: they are never written
 *   into the copy before the server confirms them. A change the server refuses
 *   leaves the outbox and so disappears from the view; the copy, which never
 *   held it, stays right.
 *
 * Callers pass the scope they captured before reading (as the camp lots and
 * camp sites do): a copy is written only while that scope is still the
 * session's, and read back only in that same scope.
 *
 * @module spa/modules/camp-review/CampReviewOffline
 */
import { getCachedData, setCachedData, getOfflineData } from '../../indexedDB.js';
import { buildScopedCacheKey, normalizeApiPath } from '../../utils/OfflineCacheKeys.js';
import { getCurrentUserId, getCurrentOrganizationId } from '../../api/api-helpers.js';
import { OFFLINE_CAMPS } from '../../config/offline-camps.js';

/** Bumped when the stored shape changes, so an older copy is never read as a new one. */
const SNAPSHOT_VERSION = 1;
/** As long as a camp's prepared data: its longest stay and the days after it. */
export const CAMP_REVIEW_SNAPSHOT_MS = (OFFLINE_CAMPS.MAX_DAYS + OFFLINE_CAMPS.EXPIRY_BUFFER_DAYS) * OFFLINE_CAMPS.DAY_MS;

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
/** A write to a camp's review: its note, and optionally one of its votes. */
export const CAMP_REVIEW_WRITE_PATH = new RegExp(`^/api/v1/camp-reviews/camps/([1-9]\\d*)/notes/(${UUID})(?:/votes/(${UUID}))?$`, 'i');

/** @returns {string} The session's scope: account, unit and scout year */
export function currentCampReviewScope() {
  return buildScopedCacheKey('');
}

/**
 * @param {string} scope - Captured with currentCampReviewScope()
 * @throws {Error} When the session changed since
 */
function assertScope(scope) {
  if (scope !== currentCampReviewScope()) {
    throw Object.assign(new Error('Session changed'), { name: 'AbortError' });
  }
}

/**
 * @param {number} meetingId - The planned camp
 * @param {string} [scope] - The scope it belongs to
 * @returns {string} Its copy's key
 */
export function campReviewSnapshotKey(meetingId, scope = currentCampReviewScope()) {
  return buildScopedCacheKey(`camp_review_snapshot_${Number(meetingId)}${scope}`);
}

/** @returns {Object} A note's weight recomputed from its votes and the notes merged into it */
const weighed = (note) => ({ ...note, weight: 1 + (note.votes || []).length
  + (note.merged || []).reduce((sum, child) => sum + (Number(child.weight) || 1), 0) });

/**
 * Keep a copy of the camp's review on this device.
 *
 * @param {number} meetingId - The planned camp
 * @param {{camp: Object, notes: Object[]}} data - `data` of GET /v1/camp-reviews/camps/:meetingId
 * @param {number} [duration] - How long the copy is kept
 * @param {string} [scope] - The scope captured before reading `data`
 * @returns {Promise<string>} The key it was stored under
 */
export async function storeCampReviewSnapshot(meetingId, data, duration = CAMP_REVIEW_SNAPSHOT_MS, scope = currentCampReviewScope()) {
  assertScope(scope);
  const key = campReviewSnapshotKey(meetingId, scope);
  await setCachedData(key, {
    schema: SNAPSHOT_VERSION,
    scope,
    meetingId: Number(meetingId),
    preparedAt: Date.now(),
    expiresAt: Date.now() + duration,
    data: { camp: data?.camp || null, review: data?.review || null, notes: Array.isArray(data?.notes) ? data.notes : [] },
  }, duration);
  assertScope(scope);
  return key;
}

/**
 * @param {number} meetingId - The planned camp
 * @param {string} [scope] - The scope captured before reading
 * @returns {Promise<?{preparedAt: number, expiresAt: number, data: {camp: Object, notes: Object[]}}>}
 *   The copy kept here, or null when there is none for this camp in this scope (or it expired)
 */
export async function getCampReviewSnapshot(meetingId, scope = currentCampReviewScope()) {
  const snapshot = await getCachedData(campReviewSnapshotKey(meetingId, scope));
  return scope === currentCampReviewScope() && snapshot?.schema === SNAPSHOT_VERSION && snapshot.scope === scope
    && snapshot.meetingId === Number(meetingId) && snapshot.expiresAt > Date.now() && snapshot.data?.camp
    && Array.isArray(snapshot.data.notes)
    ? snapshot
    : null;
}

/**
 * Apply what the server answered to a confirmed write onto the notes. The
 * answer is the note as shown: the note written, or the note it was merged
 * into, which then replaces that one.
 *
 * @param {Object[]} previous - The notes before
 * @param {{method: string, noteId: string, voteId?: ?string, unmerge?: boolean}} change - The write
 * @param {Object} answer - `data` of the server's answer
 * @returns {Object[]} The notes after
 */
export function applyAnswer(previous, { method, noteId, voteId, unmerge = false }, answer) {
  // The server read the whole review in the write transaction. Missing children may have been
  // detached, deleted or merged elsewhere: only that confirmed list can distinguish those cases.
  if (Array.isArray(answer?.notes)) {
    return answer.notes;
  }
  const notes = unmerge ? previous.map((note) => (note.merged?.some((child) => child.id === noteId)
    ? weighed({ ...note, merged: note.merged.filter((child) => child.id !== noteId) }) : note)) : previous;
  if (method === 'DELETE' && !voteId && !unmerge) {
    // Notes merged into a removed note stand on their own again, as the server keeps them:
    // detaching them is a change, so each is now one version further.
    return notes.flatMap((note) => (note.id === noteId
      ? (note.merged || []).map((child) => ({ ...child, merged: [], version: (Number(child.version) || 1) + 1 }))
      : [note.merged?.some((child) => child.id === noteId)
        ? weighed({ ...note, merged: note.merged.filter((child) => child.id !== noteId) }) : note]));
  }
  const note = answer?.note;
  if (!note) {
    return notes.filter((entry) => entry.id !== noteId);
  }
  const index = notes.findIndex((entry) => entry.id === note.id || entry.id === noteId);
  // Another device may have merged previously separate notes since this copy was read.
  const replaced = new Set([note.id, noteId, ...(note.merged || []).map((child) => child.id)]);
  const others = notes.filter((entry) => !replaced.has(entry.id));
  if (index === -1) {
    return [...others, note];
  }
  return [...others.slice(0, index), note, ...others.slice(index)];
}

/**
 * @param {string} url - A request URL
 * @returns {?{meetingId: number, noteId: string, voteId: ?string}} The review write it names, or null
 */
export function parseCampReviewWrite(url) {
  const match = CAMP_REVIEW_WRITE_PATH.exec(normalizeApiPath(url));
  return match ? { meetingId: Number(match[1]), noteId: match[2].toLowerCase(), voteId: match[3] ? match[3].toLowerCase() : null } : null;
}

/**
 * Keep the copy current after a confirmed write, from the screen or from a
 * replay with the screen closed. Without a copy for that camp, nothing is
 * stored: the next online visit makes one.
 *
 * @param {string} url - The write's URL
 * @param {string} method - PUT or DELETE
 * @param {Object} answer - `data` of the server's answer
 * @param {string} [scope] - The scope captured before the write
 * @returns {Promise<void>}
 */
export async function applyCampReviewAnswer(url, method, answer, scope = currentCampReviewScope()) {
  const write = parseCampReviewWrite(url);
  if (!write) {
    return;
  }
  await applyCampReviewWrite(write.meetingId, { method, noteId: write.noteId, voteId: write.voteId }, answer, scope);
}

/**
 * Apply a confirmed write to this camp's copy on the device, whether or not
 * its screen is still open. Without a copy, nothing is stored.
 *
 * @param {number} meetingId - The planned camp
 * @param {{method: string, noteId: string, voteId: ?string}} change - The write
 * @param {Object} answer - `data` of the server's answer
 * @param {string} [scope] - The scope captured before the write
 * @returns {Promise<void>}
 */
export async function applyCampReviewWrite(meetingId, change, answer, scope = currentCampReviewScope()) {
  if (scope !== currentCampReviewScope()) {
    return;
  }
  const snapshot = await getCampReviewSnapshot(meetingId, scope);
  if (!snapshot) {
    return;
  }
  const notes = applyAnswer(snapshot.data.notes, { ...change, method: String(change.method).toUpperCase() }, answer);
  // Keep the copy's original expiry, not another full camp period.
  await storeCampReviewSnapshot(meetingId, { ...snapshot.data, notes }, snapshot.expiresAt - Date.now(), scope);
}

/**
 * Record a confirmed closing or reopening in this camp's copy on the device,
 * so an offline visit neither accepts notes on a closed review nor refuses
 * them on a reopened one. Without a copy, nothing is stored.
 *
 * @param {number} meetingId - The planned camp
 * @param {Object} review - The review's state as the server answered it
 * @param {string} [scope] - The scope captured before the change
 * @returns {Promise<void>}
 */
export async function storeCampReviewState(meetingId, review, scope = currentCampReviewScope()) {
  if (scope !== currentCampReviewScope()) {
    return;
  }
  const snapshot = await getCampReviewSnapshot(meetingId, scope);
  if (!snapshot) {
    return;
  }
  await storeCampReviewSnapshot(meetingId, { ...snapshot.data, review }, snapshot.expiresAt - Date.now(), scope);
}

/**
 * Changes to this camp's review waiting in the outbox, for this account and
 * unit, in the order they will be sent, across all tabs.
 *
 * @param {number} meetingId - The planned camp
 * @param {string} [scope] - The scope captured before reading
 * @returns {Promise<Array<{method: string, noteId: string, voteId: ?string, body: Object, mutationId: string}>>}
 */
export async function pendingCampReviewChanges(meetingId, scope = currentCampReviewScope()) {
  assertScope(scope);
  const userId = String(getCurrentUserId());
  const organizationId = String(getCurrentOrganizationId());
  const records = await getOfflineData();
  assertScope(scope);
  return records
    .filter((record) => record.data?.url)
    .sort((a, b) => Number(a.data.timestamp || 0) - Number(b.data.timestamp || 0))
    .flatMap((record) => {
      const { data } = record;
      const write = parseCampReviewWrite(data.url);
      if (!write || write.meetingId !== Number(meetingId)
        || String(data.userId) !== userId || String(data.organizationId) !== organizationId) {
        return [];
      }
      let body = {};
      try {
        body = data.body ? JSON.parse(data.body) : {};
      } catch {
        return [];
      }
      return [{ method: String(record.action || data.method).toUpperCase(), ...write, body, mutationId: data.idempotencyKey }];
    });
}

/**
 * Lay the changes waiting to be sent over the confirmed notes, each marked
 * `pending`, so the screen shows them at once without counting them as saved.
 *
 * @param {Object[]} notes - The confirmed notes
 * @param {Array<Object>} changes - From pendingCampReviewChanges()
 * @returns {Object[]} The notes as they will be once sent
 */
export function overlayPending(notes, changes) {
  return changes.reduce((current, change) => {
    const index = current.findIndex((note) => note.id === change.noteId);
    if (change.voteId) {
      if (index === -1) {
        return current;
      }
      const note = current[index];
      const votes = (note.votes || []).filter((vote) => vote.id !== change.voteId);
      if (change.method === 'PUT') {
        votes.push({ id: change.voteId, mine: true, pending: true });
      }
      return current.map((entry, position) => (position === index ? weighed({ ...note, votes, pending: true }) : entry));
    }
    if (change.method === 'DELETE') {
      return current.filter((note) => note.id !== change.noteId);
    }
    const { expected_version: _expected, ...fields } = change.body || {};
    if (index === -1) {
      return [...current, weighed({ id: change.noteId, ...fields, day: fields.day || null, theme: fields.theme || null,
        version: 1, votes: [], pending: true })];
    }
    return current.map((entry, position) => (position === index ? { ...entry, ...fields, pending: true } : entry));
  }, notes.map((note) => ({ ...note, votes: [...(note.votes || [])] })));
}
