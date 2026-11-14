/**
 * Everyday offline preparation.
 *
 * A leader or a parent must be able to open Wampums without signal, with no
 * step to take before leaving, even when no camp is planned. After every
 * online launch, sign-in and return to the app, this reads again the screens
 * that matter most without a connection, through the very API functions
 * those screens use, so their cached copies are the ones the screens find:
 *
 *  - my tasks (`/tasks`);
 *  - the next meeting (dashboard);
 *  - the parent contact list (`/parent-contact-list`);
 *  - the volunteer space and its nearest camps (`/volunteer-space`).
 *
 * Each read runs only with the permission its endpoint requires, so nobody
 * is sent a refusal. Copies stay readable offline for
 * `OFFLINE_READS.RETENTION_MS` after the server confirmed them; older
 * ones are pruned here. Camp contacts stay network-only
 * (devdocs/MEMBER_PROFILE.md): consent cannot be checked offline.
 */
import { OFFLINE_READS } from '../../config/offline-reads.js';
import { pruneOfflineCache } from '../../indexedDB.js';
import { getMyTasks } from '../../api/api-tasks.js';
import { getNextMeetingInfo, getParentContactList } from '../../api/api-endpoints.js';
import { getVolunteerSpace, getVolunteerSpaceCamp } from '../../api/api-volunteer-space.js';
import { hasPermission, hasAnyPermission, hasOrganizationScope } from '../../utils/PermissionUtils.js';
import { buildScopedCacheKey } from '../../utils/OfflineCacheKeys.js';
import { isArchiveMode } from '../scout-year/ScoutYearContext.js';
import { debugLog, debugError } from '../../utils/DebugUtils.js';

/** Permissions that open GET /api/v1/meetings/next (routes/meetings.js). */
const NEXT_MEETING_PERMISSIONS = ['meetings.view', 'meetings.manage', 'activities.view', 'participants.view'];

/** Read again rather than accept a copy still fresh in the cache. */
const FRESH = Object.freeze({ forceRefresh: true });

/**
 * The reads to prepare, each with the permission its endpoint requires.
 * @type {ReadonlyArray<{name: string, allowed: () => boolean, read: () => Promise<*>}>}
 */
export const BASELINE_READS = Object.freeze([
  {
    name: 'tasks',
    allowed: () => hasPermission('tasks.view'),
    read: () => getMyTasks(FRESH),
  },
  {
    name: 'next_meeting',
    allowed: () => hasAnyPermission(...NEXT_MEETING_PERMISSIONS),
    read: () => getNextMeetingInfo(FRESH),
  },
  {
    name: 'parent_contacts',
    // routes/reports.js: reports.view, with a role covering the whole unit.
    allowed: () => hasPermission('reports.view') && hasOrganizationScope(),
    read: () => getParentContactList(FRESH),
  },
  {
    name: 'volunteer_space',
    allowed: () => hasPermission('volunteer_space.view'),
    read: async () => {
      const overview = await getVolunteerSpace();
      const camps = Array.isArray(overview?.data?.camps) ? overview.data.camps : [];
      const ids = camps.map((camp) => camp?.activity_id).filter(Boolean)
        .slice(0, OFFLINE_READS.BASELINE_MAX_CAMPS);
      await Promise.allSettled(ids.map((id) => getVolunteerSpaceCamp(id)));
      return overview;
    },
  },
]);

/** Whether a signed-in session is stored on this device. */
function isSignedIn() {
  try {
    return Boolean(localStorage.getItem('jwtToken') && localStorage.getItem('userId'));
  } catch (_error) {
    return false;
  }
}

/** Ask the browser to keep this origin's data under storage pressure. */
async function requestPersistentStorage() {
  const storage = typeof navigator === 'undefined' ? null : navigator.storage;
  if (typeof storage?.persist !== 'function') {
    return false;
  }
  try {
    if (typeof storage.persisted === 'function' && await storage.persisted()) {
      return true;
    }
    return await storage.persist();
  } catch (error) {
    debugLog('Persistent storage request failed:', error);
    return false;
  }
}

export class OfflineBaseline {
  /**
   * @param {Object} [options]
   * @param {ReadonlyArray} [options.reads] - Reads to prepare (tests)
   * @param {() => number} [options.now] - Clock (tests)
   */
  constructor({ reads = BASELINE_READS, now = () => Date.now() } = {}) {
    this.reads = reads;
    this.now = now;
    this.task = null;
    /** Last completed preparation per account, unit and year scope. */
    this.lastRun = new Map();
    this.onWake = () => {
      if (typeof document !== 'undefined' && document.hidden) {return;}
      void this.refresh();
    };
    this.onSignedIn = () => { void this.refresh({ force: true }); };
  }

  /** Prepare now and again whenever the app comes back online or into view. */
  start() {
    this.stop();
    window.addEventListener(OFFLINE_READS.SIGNED_IN_EVENT, this.onSignedIn);
    window.addEventListener('userLoggedIn', this.onWake);
    window.addEventListener('online', this.onWake);
    document.addEventListener('visibilitychange', this.onWake);
    pruneOfflineCache()
      .then((removed) => { if (removed) {debugLog(`Removed ${removed} offline copies past retention`);} })
      .catch((error) => debugError('Failed to prune offline copies:', error));
    this.onWake();
  }

  stop() {
    window.removeEventListener(OFFLINE_READS.SIGNED_IN_EVENT, this.onSignedIn);
    window.removeEventListener('userLoggedIn', this.onWake);
    window.removeEventListener('online', this.onWake);
    document.removeEventListener('visibilitychange', this.onWake);
  }

  /**
   * Read the baseline again when signed in, online, on the current year, and
   * not already done within `OFFLINE_READS.BASELINE_MIN_INTERVAL_MS` for this scope.
   * @param {{force?: boolean}} [options]
   * @returns {Promise<string[]|null>} Names of the reads that succeeded, or null when skipped
   */
  refresh({ force = false } = {}) {
    if (this.task) {return this.task;}
    if (!isSignedIn() || navigator.onLine === false || isArchiveMode()) {
      return Promise.resolve(null);
    }
    const scope = buildScopedCacheKey('');
    const last = this.lastRun.get(scope);
    if (!force && last !== undefined && this.now() - last < OFFLINE_READS.BASELINE_MIN_INTERVAL_MS) {
      return Promise.resolve(null);
    }
    this.task = this.run(scope).finally(() => { this.task = null; });
    return this.task;
  }

  /**
   * @param {string} scope - Account, unit and year the reads belong to
   * @returns {Promise<string[]>} Names of the reads that succeeded
   */
  async run(scope) {
    void requestPersistentStorage();
    const reads = this.reads.filter((entry) => {
      try {
        return entry.allowed();
      } catch (_error) {
        return false;
      }
    });
    const results = await Promise.allSettled(reads.map((entry) => entry.read()));
    const prepared = reads.filter((_entry, index) => results[index].status === 'fulfilled').map((entry) => entry.name);
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        debugError(`Offline preparation of ${reads[index].name} failed:`, result.reason);
      }
    });
    // Only a run that reached the server counts; a failed one is retried at the next wake.
    if (prepared.length === reads.length) {
      this.lastRun.set(scope, this.now());
    }
    debugLog('Offline baseline prepared:', prepared);
    return prepared;
  }
}

export const offlineBaseline = new OfflineBaseline();
