/**
 * Calendar subscription — the "Mon compte" section that gives a person a
 * private link their calendar app (Google, Apple, Outlook) subscribes to, so
 * the unit's activities appear and stay up to date there.
 *
 * The link is shown once, when it is made: the server keeps only its digest.
 * Afterwards the section says the link is active and when a calendar last
 * fetched it, and offers a new link (for another device) or turning it off.
 *
 * The panel keeps its state across the account page's redraws: mount() it in
 * the page's container after every render.
 *
 * @module spa/modules/calendar-feed/CalendarFeedPanel
 */

import { translate } from '../../app.js';
import { setContent } from '../../utils/DOMUtils.js';
import { escapeAttribute, escapeHTML } from '../../utils/SecurityUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';
import { confirm, confirmDestructive } from '../../utils/DialogUtils.js';
import { formatDate } from '../../utils/DateUtils.js';
import { isDemoUser } from '../../utils/PermissionUtils.js';
import { getOrganizationIdFromJWT, getUserInfoFromJWT } from '../../jwt-helper.js';
import {
  createCalendarFeed,
  getCalendarFeedStatus,
  revokeCalendarFeed,
} from '../../api/api-calendar-feed.js';

/** The anchor other screens link to (`/account-info#calendar-feed`). */
export const CALENDAR_FEED_ANCHOR = 'calendar-feed';

const STATE = Object.freeze({ IDLE: 'idle', LOADING: 'loading', READY: 'ready', ERROR: 'error' });

/**
 * A link made while its panel was already gone (the person left the page
 * before the answer came). It is shown only once and replaced the previous
 * link, so the next panel for the same account and unit shows it. Kept in
 * memory only: signing out reloads the page and drops it.
 */
let unclaimedLink = null;

/** @returns {string} Who a link belongs to: account and unit of the session */
function linkOwner() {
  return `${getUserInfoFromJWT()?.userId || ''}:${getOrganizationIdFromJWT() || ''}`;
}

/** @returns {?Object} The unclaimed link of this account and unit, handed over once */
function claimUnclaimedLink() {
  if (!unclaimedLink || unclaimedLink.owner !== linkOwner()) {
    return null;
  }
  const { link } = unclaimedLink;
  unclaimedLink = null;
  return link;
}

export class CalendarFeedPanel {
  /** @param {Object} app - Application instance */
  constructor(app) {
    this.app = app;
    this.state = STATE.IDLE;
    this.status = { active: false, created_at: null, last_used_at: null };
    // The link just made, shown until the person leaves the page.
    this.freshLink = claimUnclaimedLink();
    this.busy = false;
    this.container = null;
    this.destroyed = false;
  }

  /** Called when the account page is left. */
  destroy() {
    this.destroyed = true;
  }

  /**
   * Draw the section into its container, loading the status the first time.
   *
   * @param {HTMLElement|null} container - The page's section element
   * @returns {Promise<void>}
   */
  async mount(container) {
    this.container = container;
    if (!container) {
      return;
    }
    if (this.state === STATE.IDLE) {
      await this.load();
      this.revealIfLinkedTo();
      return;
    }
    this.render();
  }

  /** Load the status, drawing the loading and error states. */
  async load() {
    this.state = STATE.LOADING;
    this.render();
    try {
      const response = await getCalendarFeedStatus();
      this.status = { active: false, created_at: null, last_used_at: null, ...(response?.data || {}) };
      this.state = STATE.READY;
    } catch (error) {
      debugError('Failed to load calendar link status:', error);
      this.loadError = error;
      this.state = STATE.ERROR;
    }
    this.render();
  }

  /** When the page was opened at #calendar-feed, bring the section into view. */
  revealIfLinkedTo() {
    if (this.destroyed || window.location.hash !== `#${CALENDAR_FEED_ANCHOR}`) {
      return;
    }
    const heading = this.container?.querySelector('h2');
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
      heading.scrollIntoView({ block: 'start' });
    }
  }

  /** @returns {string} Formatted date in the interface language */
  date(value) {
    return formatDate(value, this.app?.lang || document.documentElement.lang || 'fr');
  }

  render() {
    if (this.destroyed || !this.container || !this.container.isConnected) {
      return;
    }
    setContent(this.container, `
      <h2 id="calendar-feed-heading">${escapeHTML(translate('calendar_feed_title'))}</h2>
      <p class="section-description">${escapeHTML(translate('calendar_feed_intro'))}</p>
      ${this.renderBody()}
    `);
    this.attach();
  }

  /** @returns {string} Markup for the current state */
  renderBody() {
    if (this.state === STATE.LOADING || this.state === STATE.IDLE) {
      return `<p role="status">${escapeHTML(translate('loading'))}</p>`;
    }
    if (this.state === STATE.ERROR) {
      return `
        <p class="status-message error" role="alert">${escapeHTML(apiErrorMessage(this.loadError, 'calendar_feed_load_failed'))}</p>
        <button type="button" class="button button--secondary" data-calendar-feed="retry">${escapeHTML(translate('retry'))}</button>
      `;
    }
    if (isDemoUser()) {
      return `<p class="form-help">${escapeHTML(translate('calendar_feed_demo'))}</p>`;
    }
    if (this.freshLink) {
      return this.renderFreshLink();
    }
    if (this.status.active) {
      return this.renderActive();
    }
    return `
      <button type="button" class="button button--primary" data-calendar-feed="create" ${this.busy ? 'disabled' : ''}>
        ${escapeHTML(translate('calendar_feed_create'))}
      </button>
    `;
  }

  /** @returns {string} The link just made, with the ways to use it */
  renderFreshLink() {
    return `
      <div class="calendar-feed__link">
        <label for="calendar-feed-url">${escapeHTML(translate('calendar_feed_url_label'))}</label>
        <div class="calendar-feed__link-row">
          <input id="calendar-feed-url" type="text" readonly value="${escapeAttribute(this.freshLink.url)}"
                 aria-describedby="calendar-feed-once">
          <button type="button" class="button button--secondary" data-calendar-feed="copy">
            ${escapeHTML(translate('calendar_feed_copy'))}
          </button>
        </div>
        <p class="calendar-feed__copy-status" role="status" id="calendar-feed-copy-status"></p>
        <p class="form-help" id="calendar-feed-once">${escapeHTML(translate('calendar_feed_shown_once'))}</p>
      </div>
      <button type="button" class="button button--primary" data-calendar-feed="open">
        ${escapeHTML(translate('calendar_feed_open'))}
      </button>
      <details class="calendar-feed__help">
        <summary>${escapeHTML(translate('calendar_feed_how_to'))}</summary>
        <ul>
          <li>${escapeHTML(translate('calendar_feed_how_google'))}</li>
          <li>${escapeHTML(translate('calendar_feed_how_apple'))}</li>
          <li>${escapeHTML(translate('calendar_feed_how_outlook'))}</li>
        </ul>
      </details>
      <div class="calendar-feed__actions">
        <button type="button" class="button button--danger button--small" data-calendar-feed="revoke" ${this.busy ? 'disabled' : ''}>
          ${escapeHTML(translate('calendar_feed_revoke'))}
        </button>
      </div>
    `;
  }

  /** @returns {string} An active link made earlier, which is no longer shown */
  renderActive() {
    const used = this.status.last_used_at ? this.date(this.status.last_used_at) : translate('calendar_feed_never_used');
    const summary = translate('calendar_feed_active')
      .replace('{created}', this.date(this.status.created_at))
      .replace('{used}', used);
    return `
      <p>${escapeHTML(summary)}</p>
      <p class="form-help">${escapeHTML(translate('calendar_feed_new_device'))}</p>
      <div class="calendar-feed__actions">
        <button type="button" class="button button--secondary" data-calendar-feed="create" ${this.busy ? 'disabled' : ''}>
          ${escapeHTML(translate('calendar_feed_recreate'))}
        </button>
        <button type="button" class="button button--danger button--small" data-calendar-feed="revoke" ${this.busy ? 'disabled' : ''}>
          ${escapeHTML(translate('calendar_feed_revoke'))}
        </button>
      </div>
    `;
  }

  /** Wire the buttons of the markup just drawn (replaced each time, so nothing stacks). */
  attach() {
    const actions = {
      retry: () => this.load(),
      create: () => this.create(),
      revoke: () => this.revoke(),
      copy: () => this.copy(),
      open: () => window.location.assign(this.freshLink.webcal_url),
    };
    this.container.querySelectorAll('[data-calendar-feed]').forEach((button) => {
      button.addEventListener('click', () => actions[button.dataset.calendarFeed]?.());
    });
  }

  /** Make a link; replacing an active one is confirmed first. */
  async create() {
    if (this.busy) {
      return;
    }
    if (this.status.active && !this.freshLink) {
      const confirmed = await confirm({
        title: translate('calendar_feed_recreate_confirm_title'),
        message: translate('calendar_feed_recreate_confirm_message'),
        confirmLabel: translate('calendar_feed_recreate'),
      });
      if (!confirmed) {
        return;
      }
    }
    this.busy = true;
    this.render();
    try {
      const response = await createCalendarFeed();
      const link = response?.data;
      if (!link?.url) {
        throw new Error('No link in the response');
      }
      this.freshLink = link;
      this.status = { active: true, created_at: link.created_at, last_used_at: null };
      if (this.destroyed) {
        unclaimedLink = { owner: linkOwner(), link };
      }
      this.app.showMessage(translate('calendar_feed_created'), 'success');
    } catch (error) {
      debugError('Failed to create calendar link:', error);
      this.app.showMessage(apiErrorMessage(error, 'calendar_feed_create_failed'), 'error');
    } finally {
      this.busy = false;
      this.render();
    }
    if (this.freshLink) {
      this.container?.querySelector('#calendar-feed-url')?.focus();
    }
  }

  /** Turn the link off, after a confirmation. */
  async revoke() {
    if (this.busy) {
      return;
    }
    const confirmed = await confirmDestructive({
      title: translate('calendar_feed_revoke_confirm_title'),
      message: translate('calendar_feed_revoke_confirm_message'),
      confirmLabel: translate('calendar_feed_revoke'),
    });
    if (!confirmed) {
      return;
    }
    this.busy = true;
    this.render();
    try {
      await revokeCalendarFeed();
      this.freshLink = null;
      this.status = { active: false, created_at: null, last_used_at: null };
      this.app.showMessage(translate('calendar_feed_revoked'), 'success');
    } catch (error) {
      debugError('Failed to turn off calendar link:', error);
      this.app.showMessage(apiErrorMessage(error, 'calendar_feed_revoke_failed'), 'error');
    } finally {
      this.busy = false;
      this.render();
    }
    this.container?.querySelector('[data-calendar-feed="create"]')?.focus();
  }

  /** Copy the link, or select it for the person to copy when the browser refuses. */
  async copy() {
    const field = this.container.querySelector('#calendar-feed-url');
    const status = this.container.querySelector('#calendar-feed-copy-status');
    try {
      await navigator.clipboard.writeText(this.freshLink.url);
      status.textContent = translate('calendar_feed_copied');
    } catch (error) {
      debugError('Clipboard refused the calendar link:', error);
      field.focus();
      field.select();
      status.textContent = translate('calendar_feed_copy_failed');
    }
  }
}
