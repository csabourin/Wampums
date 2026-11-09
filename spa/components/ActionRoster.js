import { translate } from '../app.js';
import { getActionRoster } from '../api/api-action-roster.js';
import { getCachedDataIgnoreExpiration, setCachedData, getOfflineData } from '../indexedDB.js';
import { buildScopedCacheKey, normalizeApiPath } from '../utils/OfflineCacheKeys.js';
import { escapeAttribute, escapeHTML } from '../utils/SecurityUtils.js';
import { getCurrentUserId, getCurrentOrganizationId } from '../api/api-helpers.js';
import { CONFIG } from '../config.js';
import { getStorage, setStorage } from '../utils/StorageUtils.js';
import { offlineManager } from '../modules/OfflineManager.js';

/** Per-device note that the roster's explanation was shown once, open. */
const HELP_SEEN_KEY = 'actionRosterHelpSeen';

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
    this.dayPlanned = false;
    // The choices (day, meeting or activity, everyone) stay folded behind "Change".
    this.optionsOpen = false;
    // How the roster works is explained once, open, then folded on later
    // visits (a per-device convenience): it no longer pushes the names down.
    this.helpOpen = getStorage(HELP_SEEN_KEY) !== 'true';
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
    // A meeting planned in the year plan, or an activity, makes the day one to take attendance on.
    this.dayPlanned = (snapshot.meeting_dates || []).includes(date) || Boolean(snapshot.replacing_activities?.[date])
      || this.activities.length > 0;
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
    // An outing that replaces the day's meeting is the day's activity, even beside others.
    const replacingId = Number(snapshot.replacing_activities?.[date]) || null;
    const replacingActivity = this.activities.find((activity) => Number(activity.id) === replacingId);
    const defaultId = preparedActivity?.id || replacingActivity?.id || ((snapshot.meeting_dates || []).includes(date)
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

  /**
   * Why nobody is listed, in words that say how to get them back: unsigned
   * permission slips for the activity, or attendance taken with nobody present.
   * @returns {string} Plain text
   */
  emptyMessage() {
    return this.activity?.requires_permission
      ? translate('action_roster_empty_signed')
      : translate('action_roster_empty_attendance');
  }

  awardContext() { return { date: this.date, activity_id: this.activityId, include_all: this.showAll }; }

  /**
   * The roster's controls, kept to one line: what the list shows (the day and
   * the meeting or activity) with "Change" opening the choices, and "?" the
   * explanation. Showing everyone stays visible as a chip that turns it off.
   *
   * @param {Object} [options] - What the screen adds
   * @param {string} [options.dateLabel] - The day shown, as text (escaped here)
   * @param {string} [options.dateControl] - The screen's own date picker markup, placed with the choices
   * @returns {string} Markup
   */
  render({ dateLabel = '', dateControl = '' } = {}) {
    const id = `action-roster-${this.screen}`;
    // A notice that follows a choice is announced; the standing explanation is help.
    let stateNotice = '';
    if (this.showAll) {
      stateNotice = translate('action_roster_all_notice');
    } else if (this.activity?.requires_permission) {
      stateNotice = translate('action_roster_signed_notice');
    }
    const context = this.activity ? this.activity.name : translate('action_roster_unit');
    const summary = [dateLabel, context].filter(Boolean).map((part) => escapeHTML(part)).join(' · ');
    return `<div class="action-roster-controls">
      <div class="action-roster-summary">
        <p class="action-roster-summary__text" id="${id}-summary">${summary}</p>
        <button type="button" class="button button--secondary button--small" id="${id}-edit"
          aria-expanded="${this.optionsOpen ? 'true' : 'false'}" aria-controls="${id}-options" data-archive-safe>
          ${translate('action_roster_change')}
        </button>
        <button type="button" class="button button--ghost button--small action-roster-help-toggle" id="${id}-help-toggle"
          aria-expanded="${this.helpOpen ? 'true' : 'false'}" aria-controls="${id}-help" data-archive-safe
          aria-label="${escapeAttribute(translate('action_roster_help_summary'))}" title="${escapeAttribute(translate('action_roster_help_summary'))}">?</button>
      </div>
      ${this.showAll ? `<button type="button" class="action-roster-chip" id="${id}-all-off" data-archive-safe>
        ${translate('action_roster_all_chip')}<span class="visually-hidden"> — ${translate('action_roster_all_chip_remove')}</span>
        <span aria-hidden="true">✕</span>
      </button>` : ''}
      <div class="action-roster-options" id="${id}-options"${this.optionsOpen ? '' : ' hidden'}>
        ${dateControl}
        <label for="${id}-activity">${translate('action_roster_context')}</label>
        <select id="${id}-activity" data-archive-safe>
          <option value="" ${this.activityId === null ? 'selected' : ''}>${translate('action_roster_unit')}</option>
          ${this.activities.map((activity) => `<option value="${Number(activity.id)}" ${Number(activity.id) === this.activityId ? 'selected' : ''}>${escapeHTML(activity.name)}</option>`).join('')}
        </select>
        <label class="action-roster-toggle" for="${id}-all">
          <input type="checkbox" id="${id}-all" ${this.showAll ? 'checked' : ''} data-archive-safe>
          ${translate('action_roster_show_all')}
        </label>
      </div>
      <p class="action-roster-help" id="${id}-help"${this.helpOpen ? '' : ' hidden'}>${escapeHTML(translate('action_roster_attendance_notice'))}</p>
      <p role="status">${escapeHTML(stateNotice)}</p>
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
    // Turning the exception off from its chip; focus lands back on "Change".
    document.getElementById(`${id}-all-off`)?.addEventListener('click', async () => {
      this.showAll = false;
      // The screen redraws (sometimes after a read): focus the new "Change" once it is there.
      await onChange();
      document.getElementById(`${id}-edit`)?.focus();
    }, { signal });
    this.bindDisclosure(`${id}-edit`, `${id}-options`, (open) => { this.optionsOpen = open; }, signal);
    this.bindDisclosure(`${id}-help-toggle`, `${id}-help`, (open) => { this.helpOpen = open; }, signal);
    if (this.helpOpen) {
      setStorage(HELP_SEEN_KEY, 'true');
    }
  }

  /**
   * A button showing or hiding a region, in place: the button keeps focus
   * and says its state.
   *
   * @param {string} buttonId - The toggle
   * @param {string} regionId - What it shows
   * @param {Function} remember - Keeps the state across re-renders
   * @param {AbortSignal} signal - Released with the screen
   */
  bindDisclosure(buttonId, regionId, remember, signal) {
    const button = document.getElementById(buttonId);
    const region = document.getElementById(regionId);
    if (!button || !region) {
      return;
    }
    button.addEventListener('click', () => {
      const open = region.hidden;
      region.hidden = !open;
      button.setAttribute('aria-expanded', open ? 'true' : 'false');
      remember(open);
    }, { signal });
  }

  destroy() { this.controller?.abort(); }
}
