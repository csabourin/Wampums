import { CONFIG } from '../../config.js';
import {
  deleteCachedData,
  getCachedData,
  setCachedData
} from '../../indexedDB.js';
import { debugError } from '../../utils/DebugUtils.js';

export const MEETING_SAVE_STATES = Object.freeze({
  SAVED: 'saved',
  DIRTY: 'dirty',
  SAVING: 'saving',
  LOCAL: 'local',
  CONFLICT: 'conflict',
  ERROR: 'error'
});

const DRAFT_VERSION = 1;

/**
 * Produce a stable comparison value for a complete preparation payload.
 * Object property order is stable because MeetingPrep owns payload creation.
 * @param {Object} formData - Meeting preparation payload
 * @returns {string} Serialized payload
 */
function fingerprint(formData) {
  return JSON.stringify(formData || {});
}

/**
 * Determine whether a destination contains user work that must be preserved.
 * Synchronized markers and identical snapshots are safe to replace.
 * @param {Object|null} existingDraft - Draft currently stored at the destination
 * @param {Object} snapshot - Snapshot requesting the destination key
 * @returns {boolean} Whether migration must stop to preserve both drafts
 */
function hasDraftCollision(existingDraft, snapshot) {
  if (!existingDraft?.formData || existingDraft.synchronized) return false;
  const existingFingerprint = existingDraft.fingerprint ||
    fingerprint(existingDraft.formData);
  return existingFingerprint !== snapshot.fingerprint;
}

/**
 * Local-first, serialized autosave coordinator for one meeting editing context.
 * It stores only the newest local snapshot and never overlaps server writes.
 */
export class MeetingAutosave {
  /**
   * @param {Object} options - Autosave dependencies and callbacks
   * @param {string} options.date - Initial meeting date used to find a recovery draft
   * @param {Function} options.capture - Return the latest full form payload
   * @param {Function} options.isValid - Whether a payload may be sent to the server
   * @param {Function} options.save - Persist a full payload to the server
   * @param {Function} options.onSaved - Apply a successful normalized response
   * @param {Function} options.onStatus - Receive save-state changes
   * @param {Function} [options.onManualError] - Report explicit Save failures
   */
  constructor({
    date,
    capture,
    isValid,
    save,
    onSaved,
    onStatus,
    onManualError = () => {}
  }) {
    this.date = date;
    this.capture = capture;
    this.isValid = isValid;
    this.save = save;
    this.onSaved = onSaved;
    this.onStatus = onStatus;
    this.onManualError = onManualError;

    this.state = MEETING_SAVE_STATES.SAVED;
    this.revision = 0;
    this.savedRevision = 0;
    this.latestSnapshot = null;
    this.baselineFingerprint = null;
    this.localDraftSafe = true;
    this.serverTimer = null;
    this.localTimer = null;
    this.localWritePromise = Promise.resolve();
    this.lastLocalRevision = 0;
    this.serverSavePromise = null;
    this.saveAgain = false;
    this.manualErrorRequested = false;
    this.destroyed = false;
    this.activeDraftKey = this.draftKey;
    this.draftConflict = null;
  }

  /** @returns {string} Logical cache key; IndexedDB adds user/org/year scope. */
  get draftKey() {
    return this.getDraftKey(this.date);
  }

  /**
   * Build the logical cache key for the date represented by a snapshot.
   * @param {string} date - Meeting date in YYYY-MM-DD format
   * @returns {string} Date-scoped logical cache key
   */
  getDraftKey(date) {
    return `meeting_preparation_draft_${date}`;
  }

  /**
   * Resolve a snapshot's immutable draft key, including legacy snapshots.
   * @param {Object} snapshot - Local draft snapshot
   * @returns {string} Logical cache key owned by the snapshot
   */
  getSnapshotDraftKey(snapshot) {
    return snapshot?.draftKey || this.getDraftKey(
      snapshot?.formData?.date || snapshot?.date || this.date
    );
  }

  /**
   * Record the server-rendered form as the clean baseline.
   * @param {Object} formData - Current server-backed form payload
   */
  setBaseline(formData) {
    this.baselineFingerprint = fingerprint(formData);
    if (!this.latestSnapshot) {
      this.setStatus(MEETING_SAVE_STATES.SAVED);
    }
  }

  /**
   * Load a recoverable local draft for this meeting date.
   * @returns {Promise<Object|null>} Stored draft snapshot
   */
  async restoreDraft() {
    try {
      const storedDraftKey = this.draftKey;
      const draft = await getCachedData(storedDraftKey);
      if (!draft || draft.version !== DRAFT_VERSION || !draft.formData) {
        return null;
      }

      this.revision = Math.max(1, Number(draft.revision) || 1);
      const restoredDate = draft.formData.date || draft.date || this.date;
      this.latestSnapshot = {
        ...draft,
        date: restoredDate,
        draftKey: this.getDraftKey(restoredDate),
        revision: this.revision,
        fingerprint: draft.fingerprint || fingerprint(draft.formData)
      };
      this.activeDraftKey = storedDraftKey;
      if (storedDraftKey !== this.latestSnapshot.draftKey) {
        this.lastLocalRevision = 0;
        this.localDraftSafe = false;
        await this.persistDraft(this.latestSnapshot);
      } else {
        this.lastLocalRevision = this.revision;
        this.localDraftSafe = true;
      }
      if (!this.localDraftSafe) return this.latestSnapshot;
      if (!this.draftConflict) this.setStatus(MEETING_SAVE_STATES.LOCAL);
      return this.latestSnapshot;
    } catch (error) {
      debugError('Unable to restore meeting preparation draft:', error);
      this.localDraftSafe = false;
      this.setStatus(MEETING_SAVE_STATES.ERROR);
      return null;
    }
  }

  /**
   * Capture a user change, coalescing identical input/change events.
   * @param {Object} options - Optional known payload and scheduling behavior
   * @param {Object} [options.formData] - Payload already validated by the caller
   * @param {boolean} [options.immediate] - Save to server without debounce
   * @param {boolean} [options.force] - Capture even when equal to the baseline
   * @returns {Object|null} New snapshot, or null when nothing changed
   */
  markDirty({ formData = null, immediate = false, force = false } = {}) {
    if (this.destroyed) return null;

    const captured = formData || this.capture();
    const nextFingerprint = fingerprint(captured);
    const comparisonFingerprint = this.latestSnapshot?.fingerprint ||
      this.baselineFingerprint;
    if (!force && nextFingerprint === comparisonFingerprint) {
      return null;
    }

    this.revision += 1;
    const snapshotDate = captured.date || this.latestSnapshot?.date || this.date;
    const snapshot = {
      version: DRAFT_VERSION,
      date: snapshotDate,
      draftKey: this.getDraftKey(snapshotDate),
      revision: this.revision,
      updatedAt: Date.now(),
      fingerprint: nextFingerprint,
      formData: captured
    };
    this.latestSnapshot = snapshot;
    this.localDraftSafe = false;
    this.setStatus(MEETING_SAVE_STATES.DIRTY);
    this.scheduleLocalWrite(snapshot);

    if (this.serverSavePromise) {
      this.saveAgain = true;
    } else if (immediate) {
      void this.flush();
    } else {
      this.scheduleServerSave();
    }
    return snapshot;
  }

  /** Schedule a local draft write after rapid typing settles. */
  scheduleLocalWrite(snapshot) {
    window.clearTimeout(this.localTimer);
    this.localTimer = window.setTimeout(() => {
      this.localTimer = null;
      void this.persistDraft(snapshot);
    }, CONFIG.UI.MEETING_DRAFT_WRITE_DELAY);
  }

  /** Schedule the quiet server autosave. */
  scheduleServerSave() {
    window.clearTimeout(this.serverTimer);
    this.serverTimer = window.setTimeout(() => {
      this.serverTimer = null;
      void this.flush();
    }, CONFIG.UI.MEETING_AUTOSAVE_DELAY);
  }

  /**
   * Queue a snapshot into the single ordered IndexedDB write chain.
   * @param {Object} [snapshot] - Snapshot to persist
   * @returns {Promise<boolean>} Whether the local draft is safely stored
   */
  persistDraft(snapshot = this.latestSnapshot) {
    if (!snapshot) return this.localWritePromise.then(() => true);
    if (
      this.localDraftSafe &&
      this.lastLocalRevision === snapshot.revision &&
      !this.draftConflict
    ) {
      return this.localWritePromise.then(() => true);
    }

    window.clearTimeout(this.localTimer);
    this.localTimer = null;
    this.localWritePromise = this.localWritePromise
      .catch(() => undefined)
      .then(async () => {
        const draftKey = this.getSnapshotDraftKey(snapshot);
        const previousDraftKey = this.activeDraftKey;
        if (previousDraftKey && previousDraftKey !== draftKey) {
          const destinationDraft = await getCachedData(draftKey);
          if (hasDraftCollision(destinationDraft, snapshot)) {
            await setCachedData(
              previousDraftKey,
              snapshot,
              CONFIG.UI.MEETING_DRAFT_EXPIRATION
            );
            if (this.latestSnapshot?.revision === snapshot.revision) {
              this.draftConflict = {
                sourceDraftKey: previousDraftKey,
                destinationDraftKey: draftKey,
                destinationDate: snapshot.date
              };
              this.localDraftSafe = true;
              this.lastLocalRevision = snapshot.revision;
              this.setStatus(MEETING_SAVE_STATES.CONFLICT);
            }
            return true;
          }
        }
        await setCachedData(
          draftKey,
          snapshot,
          CONFIG.UI.MEETING_DRAFT_EXPIRATION
        );
        this.activeDraftKey = draftKey;
        if (previousDraftKey && previousDraftKey !== draftKey) {
          await this.removeDraft(previousDraftKey, 'obsolete date');
        }
        if (this.latestSnapshot?.revision === snapshot.revision) {
          this.draftConflict = null;
          this.localDraftSafe = true;
          this.lastLocalRevision = snapshot.revision;
          if (
            this.state === MEETING_SAVE_STATES.DIRTY ||
            this.state === MEETING_SAVE_STATES.CONFLICT
          ) {
            this.setStatus(MEETING_SAVE_STATES.LOCAL);
          }
        }
        return true;
      })
      .catch((error) => {
        debugError('Unable to store meeting preparation draft:', error);
        this.localDraftSafe = false;
        this.setStatus(MEETING_SAVE_STATES.ERROR);
        return false;
      });
    return this.localWritePromise;
  }

  /**
   * Remove a draft, replacing it with a non-restorable marker if deletion fails.
   * @param {string} draftKey - Logical cache key to remove
   * @param {string} reason - Diagnostic context for cleanup failures
   * @returns {Promise<void>}
   */
  async removeDraft(draftKey, reason) {
    try {
      await deleteCachedData(draftKey);
    } catch (error) {
      debugError(`Unable to remove ${reason} meeting draft:`, error);
      try {
        await setCachedData(
          draftKey,
          { version: DRAFT_VERSION, synchronized: true },
          CONFIG.UI.MEETING_DRAFT_EXPIRATION
        );
      } catch (markerError) {
        debugError('Unable to mark meeting draft as synchronized:', markerError);
      }
    }
  }

  /**
   * Save the newest valid snapshot, serializing any changes made in flight.
   * @param {Object} options - Save behavior
   * @param {boolean} [options.manual] - Explicit Save should surface errors
   * @returns {Promise<boolean>} Whether the latest snapshot reached the server
   */
  async flush({ manual = false } = {}) {
    window.clearTimeout(this.serverTimer);
    this.serverTimer = null;

    if (manual) this.manualErrorRequested = true;
    if (!this.latestSnapshot) {
      this.manualErrorRequested = false;
      return true;
    }
    await this.persistDraft(this.latestSnapshot);
    if (this.draftConflict) {
      this.manualErrorRequested = false;
      return false;
    }

    if (this.serverSavePromise) {
      this.saveAgain = true;
      return this.serverSavePromise;
    }

    this.serverSavePromise = this.runSaveLoop({ manual })
      .finally(() => {
        this.serverSavePromise = null;
        this.manualErrorRequested = false;
      });
    return this.serverSavePromise;
  }

  /** Run the latest-wins server loop without overlapping POST requests. */
  async runSaveLoop({ manual }) {
    let latestSaved = false;
    do {
      this.saveAgain = false;
      const snapshot = this.latestSnapshot;
      if (!snapshot || snapshot.revision <= this.savedRevision) {
        return true;
      }
      await this.persistDraft(snapshot);
      if (this.draftConflict) {
        this.setStatus(MEETING_SAVE_STATES.CONFLICT);
        return false;
      }
      if (!this.isValid(snapshot.formData)) {
        this.setStatus(MEETING_SAVE_STATES.LOCAL);
        return false;
      }

      this.setStatus(MEETING_SAVE_STATES.SAVING);
      try {
        const response = await this.save(snapshot.formData);
        this.savedRevision = snapshot.revision;
        const wasLatestBeforeApply = this.latestSnapshot?.revision === snapshot.revision;
        await this.onSaved(response, snapshot, { isLatest: wasLatestBeforeApply });
        // Cache cleanup and response application are asynchronous. Recheck in
        // case the user edited again while that work was finishing.
        const isLatest = this.latestSnapshot?.revision === snapshot.revision;

        if (isLatest) {
          await this.localWritePromise;
          const synchronizedDraftKey = this.getSnapshotDraftKey(snapshot);
          await this.removeDraft(synchronizedDraftKey, 'synchronized');
          this.date = snapshot.date;
          this.activeDraftKey = synchronizedDraftKey;
          this.latestSnapshot = null;
          this.lastLocalRevision = 0;
          this.baselineFingerprint = snapshot.fingerprint;
          this.localDraftSafe = true;
          this.setStatus(MEETING_SAVE_STATES.SAVED);
          latestSaved = true;
        } else {
          this.saveAgain = true;
        }
      } catch (error) {
        const serverRejected = Boolean(error?.status);
        this.setStatus(
          this.localDraftSafe && !serverRejected
            ? MEETING_SAVE_STATES.LOCAL
            : MEETING_SAVE_STATES.ERROR
        );
        if (manual || this.manualErrorRequested) this.onManualError(error);
        return false;
      }
    } while (this.saveAgain || this.latestSnapshot);

    return latestSaved;
  }

  /**
   * Apply a state transition only when it changes.
   * @param {string} state - One of MEETING_SAVE_STATES
   */
  setStatus(state) {
    if (this.state === state) return;
    this.state = state;
    this.onStatus(state);
  }

  /** @returns {boolean} Whether unsaved work lacks a durable local draft. */
  hasUnsafeChanges() {
    return Boolean(this.latestSnapshot) && !this.localDraftSafe;
  }

  /** Persist the latest snapshot and release timers for this editing context. */
  async destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    window.clearTimeout(this.serverTimer);
    window.clearTimeout(this.localTimer);
    this.serverTimer = null;
    this.localTimer = null;
    await this.persistDraft(this.latestSnapshot);
  }
}
