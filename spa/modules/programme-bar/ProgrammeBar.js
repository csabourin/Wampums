/**
 * The leaders' "now / next" bar.
 *
 * While a planned meeting or camp day is under way, a bar pinned to the bottom
 * of every screen says what is on, how long it has left, and what comes next
 * and who leads it. Tapping it opens the rest of the day. It reads the phone's
 * clock once a minute and the programme from the cache, so it keeps working at
 * camp without a connection.
 *
 * It lives outside #app, so navigating keeps it; the router calls
 * syncProgrammeBar() after each navigation to start or stop it. When a camp is
 * prepared for offline use, the programme of each of its days is cached too.
 *
 * @module spa/modules/programme-bar/ProgrammeBar
 */
import { translate } from '../../app.js';
import { CONFIG } from '../../config.js';
import { BaseModule } from '../../utils/BaseModule.js';
import { setContent } from '../../utils/DOMUtils.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { openModal, closeModal } from '../../utils/ModalUtils.js';
import { focusPageStart } from '../../utils/PageFocusUtils.js';
import { hasPermission, isParent } from '../../utils/PermissionUtils.js';
import { localeForLanguage } from '../../utils/InterfaceLanguageUtils.js';
import { formatDate } from '../../utils/DateUtils.js';
import { getDayProgramme } from '../../api/api-programme.js';
import { offlineManager } from '../OfflineManager.js';
import {
  programmeMoment, localDateKey, previousDateKey, msUntilNextMinute, minutesOfDay,
} from '../../utils/ProgrammeTimeline.js';

const BAR_ID = 'programme-bar';
const ANNOUNCER_ID = 'programme-bar-announcer';
const SHEET_ID = 'programme-sheet';
const WAKE_LOCK_ID = 'programme-wake-lock';
const ACTIVE_CLASS = 'has-programme-bar';
const SPACE_PROPERTY = '--programme-bar-space';
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const MINUTES_PER_DAY = HOURS_PER_DAY * MINUTES_PER_HOUR;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
// Answers that mean "not yours to see", as opposed to "not reachable now".
const REFUSED_STATUSES = new Set([HTTP_UNAUTHORIZED, HTTP_FORBIDDEN]);
const MS_PER_MINUTE = 60000;
const MINUTE_DIGITS = 2;
// Any day will do: only the time of day is formatted.
const REFERENCE_YEAR = 2000;
const REFERENCE_DAY = [REFERENCE_YEAR, 0, 1];
// Kinds of planned day that are a meeting rather than a day of a longer event.
const MEETING_KINDS = new Set(['regular', 'special']);

const CHEVRON = `<svg class="programme-bar__chevron" aria-hidden="true" width="22" height="22" viewBox="0 0 24 24"
  fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
  <polyline points="6 15 12 9 18 15"></polyline></svg>`;

/** @type {?ProgrammeBar} */
let instance = null;

/**
 * Leaders only: whoever may read meeting preparations, unless they see the
 * unit as a parent (their own children only).
 *
 * @returns {boolean}
 */
export function canSeeProgrammeBar() {
  return hasPermission('meetings.view') && !isParent();
}

/**
 * Start the bar for a leader who is signed in, stop it otherwise. Safe to call
 * after every navigation.
 *
 * @param {Object} app - Application instance
 * @returns {?ProgrammeBar} The running bar, if any
 */
export function syncProgrammeBar(app) {
  const allowed = Boolean(app?.isLoggedIn) && canSeeProgrammeBar();
  if (allowed && !instance) {
    instance = new ProgrammeBar(app);
    instance.start();
  } else if (allowed) {
    // A language switch reloads the route: the bar speaks the new language too.
    instance.refreshLanguage();
  } else if (instance) {
    instance.destroy();
  }
  return instance;
}

export class ProgrammeBar extends BaseModule {
  /**
   * @param {Object} app - Application instance
   * @param {Object} [options]
   * @param {Function} [options.now] - The current time (tests set it)
   * @param {?Object} [options.wakeLock] - navigator.wakeLock, when the browser has it
   */
  constructor(app, { now = () => new Date(), wakeLock = globalThis.navigator?.wakeLock } = {}) {
    super(app);
    this.now = now;
    this.wakeLockApi = wakeLock || null;
    this.programme = null;
    this.loadedDate = null;
    this.loadedAt = 0;
    this.root = null;
    this.announcer = null;
    this.lastMarkup = '';
    this.sheetMarkup = new Map();
    this.checkedDayBefore = null;
    this.lastAnnounced = null;
    this.rendered = false;
    this.tickTimer = null;
    this.wakeLockWanted = false;
    this.wakeLockSentinel = null;
    this.wakeLockPending = false;
  }

  /**
   * Put the bar and its announcer in the page and load today's programme.
   *
   * @returns {Promise<void>}
   */
  start() {
    this.root = document.createElement('aside');
    this.root.id = BAR_ID;
    this.root.className = 'programme-bar';
    this.root.setAttribute('aria-label', translate('programme_bar_label'));
    this.root.hidden = true;

    // Said once when the activity changes, never every minute.
    this.announcer = document.createElement('div');
    this.announcer.id = ANNOUNCER_ID;
    this.announcer.className = 'visually-hidden';
    this.announcer.setAttribute('role', 'status');

    document.body.append(this.root, this.announcer);
    this.addEventListener(this.root, 'click', (event) => {
      if (event.target.closest('[data-programme-open]')) {
        this.openSheet();
      }
    });
    this.addDocumentEventListener('visibilitychange', () => this.onVisibilityChange());
    this.addWindowEventListener('campModeChanged', (event) => {
      if (event.detail?.enabled) {
        this.cacheCampDays(event.detail.activityId);
      }
    });
    return this.load();
  }

  /**
   * Camp mode was just prepared, online: keep every prepared day's programme
   * for the days without a connection. A day that fails is read again later.
   *
   * @param {string|number} activityId - The prepared camp's key
   * @returns {Promise<void>}
   */
  async cacheCampDays(activityId) {
    const dates = offlineManager.preparedActivities?.get(activityId)?.dates || [];
    if (dates.length === 0 || globalThis.navigator?.onLine === false) {
      return;
    }
    await Promise.allSettled(dates.map((date) => getDayProgramme(date, {
      forceRefresh: true,
      cacheDuration: CONFIG.CACHE_DURATION.CAMP_MODE,
    })));
    if (!this.isDestroyed) {
      await this.load();
    }
  }

  /**
   * Read the day's programme, from the server every time, so an edit or a
   * withdrawn access shows at the next reading even when a camp's days are
   * cached for longer. Unreachable, the cached copy answers; a failure with
   * nothing cached keeps what was read for the same day; a refusal (the
   * leader lost access) drops it at once; another day's plan is never shown.
   *
   * @returns {Promise<void>}
   */
  async load() {
    const date = this.programmeDate();
    const heldDate = this.loadedDate;
    try {
      const response = await getDayProgramme(date, { forceRefresh: true });
      if (this.isDestroyed) {
        return;
      }
      this.programme = response?.data || null;
      this.loadedDate = date;
      this.loadedAt = this.now().getTime();
      await this.carryOverFromDayBefore(heldDate);
      if (this.isDestroyed) {
        return;
      }
    } catch (error) {
      debugError('Programme bar: the day\'s programme could not be read', error);
      if (this.isDestroyed) {
        return;
      }
      // A refusal (access withdrawn) drops the day; the redraw below then hides
      // the bar and closes an open sheet, so none of it stays on screen.
      if (this.loadedDate !== date || REFUSED_STATUSES.has(error?.status)) {
        this.programme = null;
        this.loadedDate = date;
      }
    }
    this.update();
  }

  /**
   * Opened after midnight with nothing running today yet (an activity about
   * to start does not count, what is on comes first): an activity begun the
   * evening before may still be running. Looked for once per day, only in the
   * small hours, and not when the bar already followed the day before past
   * midnight; the day before is kept only if something of it is on.
   *
   * @param {?string} heldDate - The day the bar followed before this reading
   * @returns {Promise<void>}
   */
  async carryOverFromDayBefore(heldDate) {
    const now = this.now();
    const today = localDateKey(now);
    const dayBefore = previousDateKey(now);
    if (this.loadedDate !== today || heldDate === dayBefore || this.checkedDayBefore === today
      || now.getHours() >= CONFIG.PROGRAMME_BAR.CARRY_OVER_UNTIL_HOUR || this.moment().state === 'now') {
      return;
    }
    this.checkedDayBefore = today;
    let response;
    try {
      response = await getDayProgramme(dayBefore, { forceRefresh: true });
    } catch (error) {
      debugError('Programme bar: the day before\'s programme could not be read', error);
      return;
    }
    if (this.isDestroyed || !response?.data) {
      return;
    }
    const todays = { programme: this.programme, loadedDate: this.loadedDate };
    this.programme = response.data;
    this.loadedDate = dayBefore;
    if (this.moment().state === 'hidden') {
      this.programme = todays.programme;
      this.loadedDate = todays.loadedDate;
    }
  }

  /** After a language switch, relabel the landmark and redraw in the new language. */
  refreshLanguage() {
    if (this.isDestroyed || !this.root) {
      return;
    }
    const label = translate('programme_bar_label');
    if (this.root.getAttribute('aria-label') === label) {
      return;
    }
    this.root.setAttribute('aria-label', label);
    // What was said in the other language is not left for a screen reader to find.
    this.announcer.textContent = '';
    this.lastMarkup = '';
    this.render();
  }

  /** Redraw now and again at the next minute. */
  update() {
    if (this.isDestroyed) {
      return;
    }
    this.render();
    if (this.tickTimer) {
      this.clearTimeout(this.tickTimer);
    }
    this.tickTimer = this.setTimeout(() => this.tick(), msUntilNextMinute(this.now()));
  }

  /**
   * The day whose programme the bar follows: today's, except after midnight
   * while an activity of the day before (a campfire, a night game) is still on.
   *
   * @returns {string} YYYY-MM-DD
   */
  programmeDate() {
    if (this.programme && this.carriedOverMinutes() > 0 && this.moment().state !== 'hidden') {
      return this.loadedDate;
    }
    return localDateKey(this.now());
  }

  /** @returns {number} A whole day when the programme held is the day before's */
  carriedOverMinutes() {
    return this.loadedDate === previousDateKey(this.now()) ? MINUTES_PER_DAY : 0;
  }

  /** Each minute: a new day or an old reading means reading again; otherwise redraw. */
  tick() {
    const now = this.now();
    const stale = now.getTime() - this.loadedAt >= CONFIG.PROGRAMME_BAR.REFRESH_AFTER_MINUTES * MS_PER_MINUTE;
    if (this.programmeDate() !== this.loadedDate || stale) {
      this.load();
      return;
    }
    this.update();
  }

  /** A phone woken up catches up at once, and the screen stays on if asked. */
  onVisibilityChange() {
    if (document.visibilityState !== 'visible') {
      return;
    }
    if (this.wakeLockWanted) {
      this.requestWakeLock();
    }
    this.tick();
  }

  /** @returns {import('../../utils/ProgrammeTimeline.js').ProgrammeMoment} */
  moment() {
    return programmeMoment(this.programme?.activities || [], this.now(), {
      leadMinutes: CONFIG.PROGRAMME_BAR.LEAD_MINUTES,
      endingSoonMinutes: CONFIG.PROGRAMME_BAR.ENDING_SOON_MINUTES,
      defaultLastMinutes: CONFIG.PROGRAMME_BAR.DEFAULT_LAST_ACTIVITY_MINUTES,
      carriedOverMinutes: this.carriedOverMinutes(),
    });
  }

  /** @returns {string} The interface language */
  lang() {
    return this.app?.lang || CONFIG.DEFAULT_LANG;
  }

  /**
   * @param {string} time - "HH:MM"
   * @returns {string} The time as the language writes it ("19 h 25", "7:25 p.m.")
   */
  formatTime(time) {
    const minutes = minutesOfDay(time);
    if (minutes === null) {
      return '';
    }
    const at = new Date(...REFERENCE_DAY, Math.floor(minutes / MINUTES_PER_HOUR), minutes % MINUTES_PER_HOUR);
    return new Intl.DateTimeFormat(localeForLanguage(this.lang()), { hour: 'numeric', minute: '2-digit' }).format(at);
  }

  /**
   * @param {number} minutes - A length of time
   * @returns {string} "12 min", "1 h 05"
   */
  formatLength(minutes) {
    if (minutes < MINUTES_PER_HOUR) {
      return translate('programme_minutes').replace('{minutes}', String(minutes));
    }
    return translate('programme_hours_minutes')
      .replace('{hours}', String(Math.floor(minutes / MINUTES_PER_HOUR)))
      .replace('{minutes}', String(minutes % MINUTES_PER_HOUR).padStart(MINUTE_DIGITS, '0'));
  }

  /**
   * What the bar says at this moment, as plain text.
   *
   * @param {import('../../utils/ProgrammeTimeline.js').ProgrammeMoment} moment
   * @returns {{variant: string, label: string, name: string, length: string,
   *   detailLead: string, detailTime: string, detailRest: string}}
   */
  describe(moment) {
    const programme = this.programme;
    const dayPrefix = programme.day_count > 1
      ? `${translate('programme_day').replace('{day}', String(programme.day_number))} · `
      : '';

    if (moment.state === 'now') {
      const { current, next } = moment;
      return {
        variant: moment.endingSoon ? 'soon' : 'now',
        label: dayPrefix + translate(moment.endingSoon ? 'programme_ending_soon' : 'programme_now'),
        name: current.activity.name,
        length: this.formatLength(moment.minutesLeft),
        detailLead: next ? `${translate('programme_then')} · ` : translate('programme_last_activity'),
        detailTime: next ? this.formatTime(next.activity.time) : '',
        detailRest: next ? ` ${next.activity.name}${next.activity.leader ? ` · ${next.activity.leader}` : ''}` : '',
      };
    }

    const { next } = moment;
    let label = translate('programme_next_up');
    if (moment.state === 'before') {
      label = translate(MEETING_KINDS.has(programme.kind) ? 'programme_meeting_starts' : 'programme_day_starts');
    }
    return {
      variant: 'upcoming',
      label: dayPrefix + label,
      name: next.activity.name,
      length: translate('programme_in').replace('{time}', this.formatLength(moment.minutesUntil)),
      detailLead: '',
      detailTime: this.formatTime(next.activity.time),
      detailRest: next.activity.leader ? ` · ${next.activity.leader}` : '',
    };
  }

  /**
   * @param {ReturnType<ProgrammeBar['describe']>} view
   * @returns {string} The bar's markup
   */
  barMarkup(view) {
    return `
      <button type="button" class="programme-bar__button programme-bar__button--${view.variant}"
              data-programme-open aria-haspopup="dialog">
        <span class="programme-bar__row">
          <span class="programme-bar__main">
            <span class="programme-bar__label">${escapeHTML(view.label)}</span>
            <span class="programme-bar__name">${escapeHTML(view.name)}</span>
          </span>
          <span class="programme-bar__length">${escapeHTML(view.length)}</span>
        </span>
        <span class="programme-bar__row programme-bar__detail">
          <span>${escapeHTML(view.detailLead)}<strong>${escapeHTML(view.detailTime)}</strong>${escapeHTML(view.detailRest)}</span>
          ${CHEVRON}
        </span>
      </button>`;
  }

  /** Show, update or hide the bar; the page keeps room for it while it shows. */
  render() {
    const moment = this.programme ? this.moment() : null;
    const visible = Boolean(moment) && moment.state !== 'hidden';
    document.documentElement.classList.toggle(ACTIVE_CLASS, visible);

    const view = visible ? this.describe(moment) : null;
    if (view) {
      this.root.hidden = false;
      const markup = this.barMarkup(view);
      if (markup !== this.lastMarkup) {
        const hadFocus = this.root.contains(document.activeElement);
        setContent(this.root, markup);
        this.lastMarkup = markup;
        if (hadFocus) {
          this.root.querySelector('[data-programme-open]')?.focus();
        }
      }
      this.keepRoomForBar();
      this.syncSheet(moment);
    } else {
      // Focus on the bar or in its sheet would be lost with them: noted before
      // either goes, and moved to the start of the page once both have.
      const active = document.activeElement;
      const hadFocus = this.root.contains(active) || Boolean(document.getElementById(SHEET_ID)?.contains(active));
      this.syncSheet(null);
      if (this.lastMarkup) {
        setContent(this.root, '');
      }
      this.root.hidden = true;
      if (hadFocus) {
        focusPageStart({ follow: false });
      }
      this.lastMarkup = '';
      document.documentElement.style.removeProperty(SPACE_PROPERTY);
      // The programme is over: a screen kept on for it goes back to normal,
      // since the checkbox that would turn it off is no longer reachable.
      if (this.wakeLockWanted || this.wakeLockSentinel) {
        this.setWakeLock(false);
      }
    }
    this.announce(view);
  }

  /**
   * The page keeps as much room at its end as the bar takes (it grows when a
   * long name wraps), so nothing focused at the bottom ends up under it.
   * Without a measurement (no layout), the stylesheet's default stands.
   */
  keepRoomForBar() {
    const height = this.root.offsetHeight;
    if (height > 0) {
      document.documentElement.style.setProperty(
        SPACE_PROPERTY,
        `calc(${height}px + (2 * var(--space-sm)) + env(safe-area-inset-bottom, 0px))`,
      );
    }
  }

  /**
   * Say the new activity once when it changes (or starts ending), not on the
   * first drawing and not as the minutes go by.
   *
   * @param {?ReturnType<ProgrammeBar['describe']>} view
   */
  announce(view) {
    const key = view ? `${view.variant}|${view.name}` : null;
    if (!key) {
      // Nothing showing: no activity name or countdown is left to be found.
      this.announcer.textContent = '';
    } else if (this.rendered && key !== this.lastAnnounced) {
      this.announcer.textContent = translate('programme_announcement')
        .replace('{label}', view.label)
        .replace('{name}', view.name)
        .replace('{time}', view.length);
    }
    this.lastAnnounced = key;
    this.rendered = true;
  }

  /** @returns {string} The sheet's title */
  sheetTitle() {
    const programme = this.programme;
    if (MEETING_KINDS.has(programme.kind)) {
      return translate('programme_sheet_title');
    }
    return programme.title || translate('programme_day_sheet_title');
  }

  /** @returns {string} The day, and which day of how many */
  sheetWhen() {
    const programme = this.programme;
    const parts = [formatDate(programme.date, this.lang())];
    if (programme.day_count > 1) {
      parts.push(translate('programme_day_of')
        .replace('{day}', String(programme.day_number))
        .replace('{count}', String(programme.day_count)));
    }
    if (MEETING_KINDS.has(programme.kind) && programme.title) {
      parts.push(programme.title);
    }
    return parts.join(' · ');
  }

  /**
   * @param {Object} activity - ProgrammeActivity
   * @param {string} status - done, now, upcoming or untimed
   * @param {?number} minutesLeft - For the activity on now
   * @returns {string} One line of the day
   */
  sheetItem(activity, status, minutesLeft) {
    let tag = '';
    if (status === 'now') {
      tag = `<span class="programme-sheet__tag programme-sheet__tag--now">${escapeHTML(
        translate('programme_status_now').replace('{time}', this.formatLength(minutesLeft)),
      )}</span>`;
    } else if (status === 'done') {
      tag = `<span class="programme-sheet__tag">${escapeHTML(translate('programme_status_done'))}</span>`;
    }
    const meta = [activity.leader, activity.duration_minutes ? this.formatLength(activity.duration_minutes) : '']
      .filter(Boolean).join(' · ');
    return `
      <li class="programme-sheet__item programme-sheet__item--${status}">
        <span class="programme-sheet__time">${escapeHTML(activity.time ? this.formatTime(activity.time) : translate('programme_no_time'))}</span>
        <span class="programme-sheet__body">
          ${tag}
          <span class="programme-sheet__name">${escapeHTML(activity.name)}</span>
          ${meta ? `<span>${escapeHTML(meta)}</span>` : ''}
          ${activity.material ? `<span>${escapeHTML(translate('programme_material').replace('{material}', activity.material))}</span>` : ''}
        </span>
      </li>`;
  }

  /**
   * @param {Object} moment - Where the programme stands now
   * @returns {string} Every activity of the day, in order, untimed ones last
   */
  sheetItems(moment) {
    const timedIds = new Set(moment.entries.map((entry) => entry.activity.id));
    return [
      ...moment.entries.map((entry) => this.sheetItem(entry.activity, entry.status, moment.minutesLeft)),
      ...this.programme.activities
        .filter((activity) => !timedIds.has(activity.id))
        .map((activity) => this.sheetItem(activity, 'untimed', null)),
    ].join('');
  }

  /**
   * Keep an open sheet in step with the bar: redraw its day as the clock turns
   * or the programme is read again, and close it once the bar is gone, so it
   * never shows a stale "in progress" or a screen lock for a finished day.
   *
   * @param {?Object} moment - Where the programme stands, or null when hidden
   */
  syncSheet(moment) {
    const sheet = document.getElementById(SHEET_ID);
    if (!sheet) {
      return;
    }
    if (!moment || moment.state === 'hidden') {
      closeModal(SHEET_ID);
      return;
    }
    const parts = [
      [`#${SHEET_ID}-title`, escapeHTML(this.sheetTitle())],
      ['.programme-sheet__when', escapeHTML(this.sheetWhen())],
      ['.programme-sheet__list', this.sheetItems(moment)],
    ];
    parts.forEach(([selector, markup]) => {
      const element = sheet.querySelector(selector);
      if (element && this.sheetMarkup.get(selector) !== markup) {
        setContent(element, markup);
        this.sheetMarkup.set(selector, markup);
      }
    });
  }

  /** Open the rest of the day, with a way to keep the screen on. */
  openSheet() {
    if (!this.programme) {
      return;
    }
    const items = this.sheetItems(this.moment());
    // What the sheet opens with is current; syncSheet() redraws only changes.
    this.sheetMarkup = new Map([[`#${SHEET_ID}-title`, escapeHTML(this.sheetTitle())],
      ['.programme-sheet__when', escapeHTML(this.sheetWhen())], ['.programme-sheet__list', items]]);

    const wakeLock = this.wakeLockApi ? `
      <div class="programme-sheet__wake">
        <input type="checkbox" id="${WAKE_LOCK_ID}" ${this.wakeLockWanted ? 'checked' : ''}>
        <label for="${WAKE_LOCK_ID}">${escapeHTML(translate('programme_keep_screen_on'))}</label>
      </div>` : '';

    const { dialog } = openModal({
      id: SHEET_ID,
      title: escapeHTML(this.sheetTitle()),
      className: 'programme-sheet',
      body: `
        <p class="programme-sheet__when">${escapeHTML(this.sheetWhen())}</p>
        <ol class="programme-sheet__list">${items}</ol>
        ${wakeLock}`,
      footer: `<button type="button" class="button button--secondary" data-modal-close>${escapeHTML(translate('close'))}</button>`,
      initialFocus: '[data-modal-close]',
    });
    dialog.querySelector(`#${WAKE_LOCK_ID}`)?.addEventListener('change', (event) => {
      this.setWakeLock(event.target.checked);
    });
  }

  /**
   * @param {boolean} wanted - Whether the screen should stay on
   * @returns {Promise<void>}
   */
  async setWakeLock(wanted) {
    this.wakeLockWanted = wanted;
    if (wanted) {
      await this.requestWakeLock();
    } else {
      await this.releaseWakeLock();
    }
  }

  /** @returns {Promise<void>} */
  async requestWakeLock() {
    if (!this.wakeLockApi || this.wakeLockSentinel || this.wakeLockPending) {
      return;
    }
    this.wakeLockPending = true;
    try {
      const sentinel = await this.wakeLockApi.request('screen');
      this.wakeLockPending = false;
      // Unticked, ended or left while the browser was answering: let it go.
      if (!this.wakeLockWanted || this.isDestroyed) {
        await sentinel.release();
        return;
      }
      this.wakeLockSentinel = sentinel;
      sentinel.addEventListener?.('release', () => {
        if (this.wakeLockSentinel === sentinel) {
          this.wakeLockSentinel = null;
        }
      });
    } catch (error) {
      this.wakeLockPending = false;
      debugError('Programme bar: the screen could not be kept on', error);
      if (this.isDestroyed) {
        return;
      }
      this.wakeLockWanted = false;
      const checkbox = document.getElementById(WAKE_LOCK_ID);
      if (checkbox) {
        checkbox.checked = false;
      }
      this.app?.showMessage?.(translate('programme_keep_screen_on_failed'), 'error');
    }
  }

  /** @returns {Promise<void>} */
  async releaseWakeLock() {
    const sentinel = this.wakeLockSentinel;
    this.wakeLockSentinel = null;
    try {
      await sentinel?.release();
    } catch (error) {
      debugError('Programme bar: the screen lock could not be released', error);
    }
  }

  /** Remove the bar: signed out, or no longer a leader of this unit. */
  destroy() {
    super.destroy();
    this.wakeLockWanted = false;
    this.releaseWakeLock();
    closeModal(SHEET_ID);
    this.root?.remove();
    this.announcer?.remove();
    document.documentElement.classList.remove(ACTIVE_CLASS);
    document.documentElement.style.removeProperty(SPACE_PROPERTY);
    if (instance === this) {
      instance = null;
    }
  }
}
