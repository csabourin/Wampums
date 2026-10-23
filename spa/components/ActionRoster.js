import { translate } from '../app.js';
import { getActionRoster } from '../api/api-action-roster.js';
import { getCachedDataIgnoreExpiration, setCachedData, getOfflineData } from '../indexedDB.js';
import { buildScopedCacheKey, normalizeApiPath } from '../utils/OfflineCacheKeys.js';
import { escapeHTML } from '../utils/SecurityUtils.js';
import { getCurrentUserId, getCurrentOrganizationId } from '../api/api-helpers.js';
import { CONFIG } from '../config.js';
import { offlineManager } from '../modules/OfflineManager.js';

/** Shared activity selection, signed-authorizations filter and explicit exceptions. */
export class ActionRoster {
  constructor(screen) {
    this.screen = screen;
    this.date = null;
    this.activities = [];
    this.attendance = {};
    this.activityId = null;
    this.showAll = false;
    this.controller = null;
  }

  /** Load the same snapshot online or from camp preparation, then overlay unsent attendance. */
  async load(date) {
    const cacheKey = `action_roster_${date}`;
    let snapshot;
    if (!navigator.onLine) {
      snapshot = await getCachedDataIgnoreExpiration(cacheKey);
    }
    if (!snapshot) {
      try {
        const response = await getActionRoster(date);
        snapshot = response?.data;
      } catch (error) {
        if (!error.isNetworkError && !error.data?.offline) { throw error; }
        snapshot = await getCachedDataIgnoreExpiration(cacheKey);
        if (!snapshot) { throw error; }
      }
      if (!Array.isArray(snapshot?.activities) || !Array.isArray(snapshot?.attendance)) {
        throw new Error('Invalid activity roster response');
      }
      await setCachedData(cacheKey, snapshot, CONFIG.CACHE_DURATION.CAMP_MODE);
    }
    this.date = date;
    this.activities = (snapshot.activities || []).filter((activity) => activity.start_date <= date && date <= activity.end_date);
    this.attendance = Object.fromEntries((snapshot.attendance || []).filter((row) => !row.date || row.date === date)
      .map((row) => [String(row.participant_id), { status: row.status, is_on_site: row.is_on_site }]));
    if (!navigator.onLine) {
      const cached = await getCachedDataIgnoreExpiration(`attendance_${date}`);
      const local = (cached?.data || cached)?.attendanceData;
      if (local && !Array.isArray(local)) { this.setAttendance(local); }
    }
    const pending = await getOfflineData();
    for (const record of pending) {
      if (!record.data?.url || String(record.data.userId) !== String(getCurrentUserId()) ||
          String(record.data.organizationId) !== String(getCurrentOrganizationId())) { continue; }
      const path = normalizeApiPath(record.data.url);
      if (!['/api/v1/attendance', '/api/v1/attendance/departure'].includes(path)) { continue; }
      const body = JSON.parse(record.data.body || '{}');
      if (body.date !== date) { continue; }
      this.attendance[String(body.participant_id)] = path.endsWith('/departure')
        ? { status: 'present', is_on_site: false } : { status: body.status, is_on_site: ['present', 'late'].includes(body.status) };
    }
    const saved = sessionStorage.getItem(buildScopedCacheKey(`action_activity_${date}`));
    const preparedId = offlineManager.campMode ? Number(offlineManager.activeActivityId) : null;
    const preparedActivity = this.activities.find((activity) => Number(activity.id) === preparedId);
    const defaultId = preparedActivity?.id || ((snapshot.meeting_dates || []).includes(date)
      ? null : this.activities.length === 1 ? this.activities[0].id : null);
    const selected = saved === null ? defaultId : Number(saved) || null;
    this.activityId = this.activities.some((activity) => Number(activity.id) === Number(selected)) ? Number(selected) : null;
    // An override is a deliberate choice for this screen, never silently inherited.
    this.showAll = false;
  }

  get activity() { return this.activities.find((activity) => Number(activity.id) === this.activityId) || null; }

  /** Keep departure display distinct while retaining the day's underlying attendance credit. */
  setAttendance(statuses) {
    this.attendance = Object.fromEntries(Object.entries(statuses).filter(([, status]) => status).map(([id, status]) =>
      [String(id), { status: status === 'departed' ? 'present' : status, is_on_site: status !== 'departed' }]));
  }

  /** Visibility never removes the full roster used for records and totals. */
  includes(id) {
    if (this.showAll) { return true; }
    if (this.activity?.requires_permission && !this.activity.signed_participant_ids.map(String).includes(String(id))) { return false; }
    if (this.screen === 'attendance' || Object.keys(this.attendance).length === 0) { return true; }
    const record = this.attendance[String(id)];
    return Boolean(record && ['present', 'late'].includes(record.status) && record.is_on_site !== false);
  }

  awardContext() { return { date: this.date, activity_id: this.activityId, include_all: this.showAll }; }

  render() {
    const id = `action-roster-${this.screen}`;
    return `<div class="action-roster-controls">
      <label for="${id}-activity">${translate('action_roster_context')}</label>
      <select id="${id}-activity" data-archive-safe>
        <option value="" ${this.activityId === null ? 'selected' : ''}>${translate('action_roster_unit')}</option>
        ${this.activities.map((activity) => `<option value="${Number(activity.id)}" ${Number(activity.id) === this.activityId ? 'selected' : ''}>${escapeHTML(activity.name)}</option>`).join('')}
      </select>
      <label class="action-roster-toggle" for="${id}-all">
        <input type="checkbox" id="${id}-all" ${this.showAll ? 'checked' : ''} data-archive-safe>
        ${translate('action_roster_show_all')}
      </label>
      <p role="status">${escapeHTML(this.showAll ? translate('action_roster_all_notice') : this.activity?.requires_permission
    ? translate('action_roster_signed_notice') : translate('action_roster_attendance_notice'))}</p>
    </div>`;
  }

  /** Replace listeners on each render; hidden selections must be cleared by the owner. */
  attach(onChange) {
    this.controller?.abort();
    this.controller = new AbortController();
    const { signal } = this.controller;
    const id = `action-roster-${this.screen}`;
    document.getElementById(`${id}-activity`)?.addEventListener('change', (event) => {
      this.activityId = Number(event.target.value) || null;
      this.showAll = false;
      sessionStorage.setItem(buildScopedCacheKey(`action_activity_${this.date}`), String(this.activityId || ''));
      onChange();
    }, { signal });
    document.getElementById(`${id}-all`)?.addEventListener('change', (event) => {
      this.showAll = event.target.checked;
      onChange();
    }, { signal });
  }

  destroy() { this.controller?.abort(); }
}
