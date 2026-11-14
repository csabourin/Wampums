/**
 * Everyday offline preparation.
 *
 * A leader or a parent must be able to open Wampums without signal, with no
 * step to take before leaving, even when no camp is planned. After every
 * online launch, sign-in, reconnection and return to the app, this reads
 * again, through the screens' own API functions so the copies are the ones
 * the screens find:
 *
 *  1. a catalogue of the main screens, so they work offline even if never
 *     opened on this device (BASELINE_READS), each behind the permission its
 *     endpoint requires;
 *  2. every read the person made on any screen (OfflineReadRegistry), so a
 *     screen they use, including one added later, stays ready with no list
 *     to maintain.
 *
 * A read is repeated once its copy is older than BASELINE_ENTRY_MAX_AGE_MS,
 * a few at a time. Copies stay readable offline for OFFLINE_READS.RETENTION_MS
 * after the server confirmed them; older ones are pruned here, and a copy the
 * server refuses (403/404) is deleted by api-core. Reads listed in
 * NETWORK_ONLY_READS are never kept (devdocs/OFFLINE_EVERYDAY.md).
 */
import { OFFLINE_READS } from '../../config/offline-reads.js';
import { getCachedConfirmedAt, pruneOfflineCache } from '../../indexedDB.js';
import { API } from '../../api/api-core.js';
import { getMyTasks } from '../../api/api-tasks.js';
import {
  getAttendance,
  getAttendanceDates,
  getAttendanceReport,
  fetchAllergiesReport,
  fetchHealthReport,
  fetchMedicationReport,
  getBadgeTrackerSummary,
  getGroups,
  getGuests,
  getHonors,
  getHonorsReport,
  getNextMeetingInfo,
  getParentContactList,
  getParentDashboard,
  getParticipants,
  getPointsReport,
} from '../../api/api-endpoints.js';
import { getActivities } from '../../api/api-activities.js';
import { getActionRoster } from '../../api/api-action-roster.js';
import { getDayProgramme } from '../../api/api-programme.js';
import { getCarpoolOffers } from '../../api/api-carpools.js';
import { getUpcomingCamps } from '../../api/api-camp-readiness.js';
import { getCampMaterialList } from '../../api/api-camp-material.js';
import { getPersonalEquipmentTasks } from '../../api/api-personal-equipment.js';
import { getVolunteerSpace, getVolunteerSpaceCamp } from '../../api/api-volunteer-space.js';
import { getCampContacts } from '../../api/api-member-profile.js';
import { getCampRoster } from '../../api/api-camp-rosters.js';
import { getActivityEndDateObj, getActivityStartDateObj } from '../../utils/ActivityDateUtils.js';
import { hasPermission, hasAnyPermission, hasOrganizationScope, holdsFamilyRole } from '../../utils/PermissionUtils.js';
import { buildScopedCacheKey } from '../../utils/OfflineCacheKeys.js';
import { listOfflineReads } from '../../utils/OfflineReadRegistry.js';
import { isArchiveMode } from '../scout-year/ScoutYearContext.js';
import { debugLog, debugError } from '../../utils/DebugUtils.js';

/** Permissions that open GET /api/v1/meetings/next (routes/meetings.js). */
const NEXT_MEETING_PERMISSIONS = ['meetings.view', 'meetings.manage', 'activities.view', 'participants.view'];
const MS_PER_DAY = 86400000;
const ISO_DATE_LENGTH = 10;
const HTTP_CLIENT_ERROR_MIN = 400;
const HTTP_SERVER_ERROR_MIN = 500;

/** Read again rather than accept a copy still fresh in the cache. */
const FRESH = Object.freeze({ forceRefresh: true });

/** Unit-wide reports, as routes/reports.js and routes/points.js require. */
const canReadUnitReports = () => hasPermission('reports.view') && hasOrganizationScope();

/**
 * Activities that have not ended and start within the lookahead, nearest first.
 * @param {Array<Object>} activities
 * @param {Date} [now]
 * @returns {Array<Object>}
 */
export function upcomingActivities(activities, now = new Date()) {
  const today = new Date(now.getTime());
  today.setHours(0, 0, 0, 0);
  const limit = new Date(today.getTime() + OFFLINE_READS.BASELINE_ACTIVITY_LOOKAHEAD_DAYS * MS_PER_DAY);
  return (Array.isArray(activities) ? activities : [])
    .filter((activity) => {
      const end = getActivityEndDateObj(activity);
      const start = getActivityStartDateObj(activity);
      return end && start && end >= today && start <= limit;
    })
    .sort((a, b) => getActivityStartDateObj(a) - getActivityStartDateObj(b))
    .slice(0, OFFLINE_READS.BASELINE_MAX_ACTIVITIES);
}

/**
 * A local calendar day, YYYY-MM-DD, as the screens name dates.
 * @param {Date} date
 * @returns {string}
 */
function localDay(date) {
  return date.toLocaleDateString('en-CA');
}

/**
 * The days whose screens are prepared: today, the next BASELINE_DAYS_AHEAD
 * days, and the next meeting if it falls later.
 * @param {string|null} nextMeetingDate - YYYY-MM-DD
 * @param {Date} [now]
 * @returns {string[]}
 */
export function preparedDays(nextMeetingDate, now = new Date()) {
  const days = [];
  for (let offset = 0; offset <= OFFLINE_READS.BASELINE_DAYS_AHEAD; offset += 1) {
    const day = new Date(now.getTime());
    day.setDate(day.getDate() + offset);
    days.push(localDay(day));
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(nextMeetingDate || '') && !days.includes(nextMeetingDate)) {
    days.push(nextMeetingDate);
  }
  return days;
}

/** The reads of one day's screens (points, attendance, honors, programme), by permission. */
function dayReads(date) {
  return [
    hasAnyPermission('attendance.view', 'points.view', 'honors.view') ? getActionRoster(date) : null,
    hasPermission('attendance.view') ? getAttendance(date) : null,
    hasPermission('attendance.view') ? getGuests(date) : null,
    hasPermission('honors.view') ? getHonors(date) : null,
    hasPermission('meetings.view') ? getDayProgramme(date) : null,
  ].filter(Boolean);
}

/**
 * The main screens, prepared even if never opened on this device, each with
 * the permission its endpoint requires.
 * @type {ReadonlyArray<{name: string, allowed: () => boolean, read: () => Promise<*>}>}
 */
export const BASELINE_READS = Object.freeze([
  { name: 'tasks', allowed: () => hasPermission('tasks.view'), read: () => getMyTasks(FRESH) },
  {
    name: 'next_meeting',
    allowed: () => hasAnyPermission(...NEXT_MEETING_PERMISSIONS),
    read: () => getNextMeetingInfo(FRESH),
  },
  { name: 'parent_contacts', allowed: canReadUnitReports, read: () => getParentContactList(FRESH) },
  {
    name: 'parent_dashboard',
    // routes/dashboards.js: participants.view; only families open this dashboard.
    allowed: () => holdsFamilyRole() && hasPermission('participants.view'),
    read: () => getParentDashboard(),
  },
  { name: 'participants', allowed: () => hasPermission('participants.view'), read: () => getParticipants() },
  { name: 'groups', allowed: () => hasPermission('groups.view'), read: () => getGroups() },
  {
    name: 'attendance',
    allowed: () => hasPermission('attendance.view'),
    read: () => Promise.all([getAttendanceDates(), getAttendance()]),
  },
  {
    name: 'days',
    allowed: () => hasAnyPermission('attendance.view', 'points.view', 'honors.view', 'meetings.view'),
    read: async () => {
      const next = hasAnyPermission(...NEXT_MEETING_PERMISSIONS)
        ? await getNextMeetingInfo().catch(() => null) : null;
      const nextDate = String(next?.data?.date || next?.data?.meeting_date || '').slice(0, ISO_DATE_LENGTH);
      return Promise.all(preparedDays(nextDate).flatMap(dayReads));
    },
  },
  { name: 'points', allowed: () => hasPermission('points.view'), read: () => API.getNoCache('v1/points') },
  { name: 'honors', allowed: () => hasPermission('honors.view'), read: () => getHonors() },
  { name: 'badges', allowed: () => hasPermission('badges.view'), read: () => getBadgeTrackerSummary() },
  {
    name: 'reports',
    allowed: canReadUnitReports,
    // Health, allergies and medication too: vital at camp, where there is no signal.
    read: () => Promise.all([getPointsReport(), getHonorsReport(), getAttendanceReport(),
      fetchHealthReport(), fetchAllergiesReport(), fetchMedicationReport()]),
  },
  {
    name: 'activities_and_carpools',
    allowed: () => hasPermission('activities.view'),
    read: async () => {
      const activities = await getActivities(FRESH);
      if (hasPermission('carpools.view')) {
        await Promise.all(upcomingActivities(activities).map((activity) => getCarpoolOffers(activity.id)));
      }
      return activities;
    },
  },
  {
    name: 'camp_material',
    // routes/camp-readiness.js (upcoming: unit scope) and the material list (meetings.view).
    allowed: () => hasPermission('meetings.view') && hasOrganizationScope(),
    read: async () => {
      const response = await getUpcomingCamps();
      const camps = Array.isArray(response?.data) ? response.data : [];
      const meetingIds = camps.slice(0, OFFLINE_READS.BASELINE_MAX_CAMPS).map((camp) => camp?.id).filter(Boolean);
      // The camp's lists, team health included (routes/camp-rosters.js: participants.view too).
      const rosters = hasPermission('participants.view') ? meetingIds.map((meetingId) => getCampRoster(meetingId)) : [];
      await Promise.all([...meetingIds.map((meetingId) => getCampMaterialList(meetingId, FRESH)), ...rosters]);
      return response;
    },
  },
  {
    name: 'personal_equipment',
    allowed: () => hasPermission('personal_equipment.view'),
    read: () => getPersonalEquipmentTasks(),
  },
  {
    name: 'volunteer_space',
    allowed: () => hasPermission('volunteer_space.view'),
    read: async () => {
      const overview = await getVolunteerSpace();
      const camps = Array.isArray(overview?.data?.camps) ? overview.data.camps : [];
      const ids = camps.map((camp) => camp?.activity_id).filter(Boolean)
        .slice(0, OFFLINE_READS.BASELINE_MAX_CAMPS);
      // Each camp and the consented contacts of its team, to reach someone without signal.
      await Promise.all(ids.flatMap((id) => [getVolunteerSpaceCamp(id), getCampContacts(id)]));
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

/** A refusal or a missing resource: asking again this session would only be refused again. */
function isRefusal(error) {
  const status = Number(error?.status);
  return status >= HTTP_CLIENT_ERROR_MIN && status < HTTP_SERVER_ERROR_MIN;
}

/**
 * Run tasks a few at a time.
 * @param {Array<() => Promise<*>>} tasks
 * @param {number} limit
 * @returns {Promise<Array<{status: string, value?: *, reason?: *}>>}
 */
async function runLimited(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const index = next;
      next += 1;
      try {
        // eslint-disable-next-line no-await-in-loop -- each worker reads one after another, by design
        results[index] = { status: 'fulfilled', value: await tasks[index]() };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, tasks.length)) }, worker));
  return results;
}

export class OfflineBaseline {
  /**
   * @param {Object} [options]
   * @param {ReadonlyArray} [options.reads] - Catalogue to prepare (tests)
   * @param {(scope: string) => Array} [options.registry] - Recorded reads (tests)
   * @param {() => number} [options.now] - Clock (tests)
   */
  constructor({ reads = BASELINE_READS, registry = listOfflineReads, now = () => Date.now() } = {}) {
    this.reads = reads;
    this.registry = registry;
    this.now = now;
    this.task = null;
    this.startTimer = null;
    /** Last wake that prepared, per scope. */
    this.lastRun = new Map();
    /** Last time each catalogue read completed, per scope and name. */
    this.lastDone = new Map();
    /** Reads the server refused this session, per scope and name. */
    this.refused = new Set();
    this.onWake = () => {
      if (typeof document !== 'undefined' && document.hidden) {return;}
      void this.refresh();
    };
    this.onSignedIn = () => { void this.refresh({ force: true }); };
  }

  /** Prepare shortly after launch, and again on sign-in, reconnection and return to the app. */
  start() {
    this.stop();
    window.addEventListener(OFFLINE_READS.SIGNED_IN_EVENT, this.onSignedIn);
    window.addEventListener('userLoggedIn', this.onWake);
    window.addEventListener('online', this.onWake);
    document.addEventListener('visibilitychange', this.onWake);
    pruneOfflineCache()
      .then((removed) => { if (removed) {debugLog(`Removed ${removed} offline copies past retention`);} })
      .catch((error) => debugError('Failed to prune offline copies:', error));
    this.startTimer = setTimeout(this.onWake, OFFLINE_READS.BASELINE_START_DELAY_MS);
  }

  stop() {
    clearTimeout(this.startTimer);
    window.removeEventListener(OFFLINE_READS.SIGNED_IN_EVENT, this.onSignedIn);
    window.removeEventListener('userLoggedIn', this.onWake);
    window.removeEventListener('online', this.onWake);
    document.removeEventListener('visibilitychange', this.onWake);
  }

  /**
   * Prepare when signed in, online and on the current year, at most once per
   * BASELINE_MIN_INTERVAL_MS unless forced (a sign-in).
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
    this.lastRun.set(scope, this.now());
    this.task = this.run(scope, force).finally(() => { this.task = null; });
    return this.task;
  }

  /** Catalogue reads allowed, not refused, and not done recently (unless forced). */
  dueCatalogue(scope, force) {
    return this.reads.filter((entry) => {
      const id = `${scope}#${entry.name}`;
      if (this.refused.has(id)) {return false;}
      try {
        if (!entry.allowed()) {return false;}
      } catch (_error) {
        return false;
      }
      const done = this.lastDone.get(id);
      return force || done === undefined || this.now() - done >= OFFLINE_READS.BASELINE_ENTRY_MAX_AGE_MS;
    }).map((entry) => ({ ...entry, id: `${scope}#${entry.name}` }));
  }

  /** Recorded reads whose copy is missing or older than BASELINE_ENTRY_MAX_AGE_MS. */
  async dueRecorded(scope, force) {
    const recorded = (this.registry(scope) || [])
      .filter((entry) => !this.refused.has(`${scope}#read:${entry.cacheKey}`));
    const ages = await Promise.all(recorded.map((entry) => getCachedConfirmedAt(entry.cacheKey).catch(() => null)));
    return recorded
      .filter((_entry, index) => force || ages[index] === null
        || this.now() - ages[index] >= OFFLINE_READS.BASELINE_ENTRY_MAX_AGE_MS)
      .map((entry) => ({
        id: `${scope}#read:${entry.cacheKey}`,
        name: entry.endpoint,
        read: () => API.get(entry.endpoint, entry.params || {}, {
          cacheKey: entry.cacheKey,
          cacheDuration: entry.cacheDuration,
          forceRefresh: true,
          offlineReplay: true,
        }),
      }));
  }

  /**
   * @param {string} scope - Account, unit and year the reads belong to
   * @param {boolean} force - Read everything again
   * @returns {Promise<string[]>} Names of the reads that succeeded
   */
  async run(scope, force) {
    void requestPersistentStorage();
    const catalogue = this.dueCatalogue(scope, force);
    const recorded = await this.dueRecorded(scope, force);
    const due = [...catalogue, ...recorded];
    const results = await runLimited(due.map((entry) => () => entry.read()), OFFLINE_READS.BASELINE_CONCURRENCY);
    const prepared = [];
    let failed = false;
    results.forEach((result, index) => {
      const entry = due[index];
      if (result.status === 'fulfilled') {
        prepared.push(entry.name);
        this.lastDone.set(entry.id, this.now());
      } else if (isRefusal(result.reason)) {
        this.refused.add(entry.id);
      } else {
        failed = true;
        debugError(`Offline preparation of ${entry.name} failed:`, result.reason);
      }
    });
    // Reads that failed for want of a network are tried again at the next wake.
    if (failed) {
      this.lastRun.delete(scope);
    }
    debugLog('Offline baseline prepared:', prepared);
    return prepared;
  }
}

export const offlineBaseline = new OfflineBaseline();
