import { offlineManager } from '../OfflineManager.js';
import { getCachedData } from '../../indexedDB.js';
import { buildScopedCacheKey } from '../../utils/OfflineCacheKeys.js';
import { OFFLINE_CAMPS } from '../../config/offline-camps.js';
import { verifyOfflineAssets } from './OfflineAssets.js';
import { isArchiveMode } from '../scout-year/ScoutYearContext.js';
import { debugError } from '../../utils/DebugUtils.js';

/**
 * Whether a camp is close enough for this device to prepare it: from
 * `OFFLINE_CAMPS.LOOKAHEAD_DAYS` before its first day until its last. Farther
 * camps are neither prepared nor offered a check, since their data would be stale.
 *
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @param {Date} [now=new Date()] - The moment to judge
 * @returns {boolean} True inside the window
 */
export function isCampPreparationWindow(startDate, endDate, now = new Date()) {
  const limit = new Date(now.getTime());
  limit.setDate(limit.getDate() + OFFLINE_CAMPS.LOOKAHEAD_DAYS);
  return Boolean(startDate) && Boolean(endDate)
    && startDate <= limit.toLocaleDateString('en-CA') && endDate >= now.toLocaleDateString('en-CA');
}

/** Automatic, account-scoped preparation. Readiness is rechecked on this device, never inferred from a flag. */
export class CampPreparation {
  constructor(manager = offlineManager, checkAssets = verifyOfflineAssets) {
    this.manager = manager;
    this.checkAssets = checkAssets;
    this.states = new Map();
    this.activities = [];
    this.allowed = () => false;
    this.scope = null;
    this.lastAttempt = 0;
    this.task = null;
    this.wakeRequested = false;
    this.onWake = () => {
      if (this.task) { this.wakeRequested = true; }
      void this.refresh();
    };
    this.onSync = (event) => { if (!event.detail?.isSyncing) { this.onWake(); } };
  }

  /** Install one coordinator for the authenticated app, with an explicit permission/scope gate. */
  start(allowed) {
    this.stop();
    this.allowed = allowed;
    window.addEventListener('userLoggedIn', this.onWake);
    window.addEventListener('online', this.onWake);
    window.addEventListener('offline', this.onWake);
    window.addEventListener('syncStatusChanged', this.onSync);
    navigator.serviceWorker?.addEventListener('controllerchange', this.onWake);
    document.addEventListener('visibilitychange', this.onWake);
    this.timer = window.setInterval(this.onWake, OFFLINE_CAMPS.RETRY_MS);
    this.onWake();
  }

  stop() {
    this.wakeRequested = false;
    clearInterval(this.timer);
    window.removeEventListener('userLoggedIn', this.onWake);
    window.removeEventListener('online', this.onWake);
    window.removeEventListener('offline', this.onWake);
    window.removeEventListener('syncStatusChanged', this.onSync);
    navigator.serviceWorker?.removeEventListener('controllerchange', this.onWake);
    document.removeEventListener('visibilitychange', this.onWake);
  }

  /** Forget in-memory claims whenever the account, unit or scout year changes. */
  ensureScope() {
    const scope = buildScopedCacheKey('');
    if (scope !== this.scope) {
      this.scope = scope;
      this.activities = [];
      this.states.clear();
      this.lastAttempt = 0;
      this.manager.restoreCampMode?.();
    }
    return scope;
  }

  forget(id) {
    if (id === undefined) { this.states.clear(); }
    else { this.states.delete(String(id)); }
    window.dispatchEvent(new CustomEvent('campReadinessChanged'));
  }

  getStatus(id) {
    if (this.scope !== buildScopedCacheKey('')) { return { status: 'incomplete' }; }
    return this.states.get(String(id)) || { status: 'incomplete' };
  }

  announce(id, status, preparedAt = null) {
    this.states.set(String(id), { status, preparedAt });
    window.dispatchEvent(new CustomEvent('campReadinessChanged'));
  }

  /** Check that every data entry in this account's snapshot still exists and is unexpired. */
  async hasData(prep) {
    if (prep?.scope !== this.scope || !prep.cacheKeys?.length) { return false; }
    const entries = await Promise.all(prep.cacheKeys.map((key) => getCachedData(key)));
    return entries.every((entry) => entry !== null && entry !== undefined);
  }

  /** Verify the snapshot and the worker's cached screens, translations and document. */
  async verify(id) {
    const scope = this.ensureScope();
    const prep = this.manager.preparedActivities?.get(Number(id)) || this.manager.preparedActivities?.get(id);
    const ready = await this.hasData(prep) && await this.checkAssets();
    const current = this.manager.preparedActivities?.get(Number(id)) || this.manager.preparedActivities?.get(id);
    if (scope !== buildScopedCacheKey('') || current !== prep) { return false; }
    this.announce(id, ready ? 'ready' : 'incomplete', prep?.preparedAt);
    return ready;
  }

  /** A manual check refreshes data, then verifies this device; the automatic pass uses the same path. */
  async prepare(id, start, end) {
    const scope = this.ensureScope();
    const key = id || `manual_${start}`;
    if (!navigator.onLine) { return this.verify(key); }
    this.announce(key, 'preparing');
    try {
      await this.manager.prepareForActivity(id, start, end);
      if (scope !== buildScopedCacheKey('')) { return false; }
      return await this.verify(key);
    } catch (error) {
      if (scope === buildScopedCacheKey('')) { this.announce(key, 'incomplete'); }
      throw error;
    }
  }

  /** Start a bounded background pass; failures remain visible and retry while the app is open. */
  refresh() {
    if (this.task || document.hidden || isArchiveMode() || !this.allowed() || !localStorage.getItem('jwtToken')) {
      return this.task || Promise.resolve();
    }
    this.task = this.run().catch((error) => debugError('Automatic camp preparation failed', error))
      .finally(() => {
        this.task = null;
        if (this.wakeRequested) {
          this.wakeRequested = false;
          this.onWake();
        }
      });
    return this.task;
  }

  async run() {
    const scope = this.ensureScope();
    this.manager.autoDetectCampMode?.();
    if (Date.now() - this.lastAttempt >= OFFLINE_CAMPS.RETRY_MS) {
      this.lastAttempt = Date.now();
      const activities = await this.manager.getUpcomingCamps();
      if (scope !== buildScopedCacheKey('')) { return; }
      this.activities = activities;
    }
    if (scope !== buildScopedCacheKey('')) { return; }
    // Snapshots share caches: serialize camps to avoid overwriting each other mid-preparation.
    await this.activities.reduce(async (previous, activity) => {
      await previous;
      if (!isCampPreparationWindow(activity.activity_start_date, activity.activity_end_date)) { return; }
      if (scope !== buildScopedCacheKey('')) { return; }
      await this.verify(activity.id);
      const prep = this.manager.preparedActivities.get(activity.id);
      if (navigator.onLine && (!await this.hasData(prep) || Date.now() - prep?.preparedAt >= OFFLINE_CAMPS.REFRESH_MS)) {
        try {
          await this.prepare(activity.id, activity.activity_start_date, activity.activity_end_date);
        } catch (error) {
          debugError('Camp snapshot will be retried', error);
        }
      }
    }, Promise.resolve());
    window.dispatchEvent(new CustomEvent('campReadinessChanged'));
  }
}

export const campPreparation = new CampPreparation();
