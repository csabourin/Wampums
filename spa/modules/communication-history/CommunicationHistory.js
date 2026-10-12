/**
 * Messages and news -- the history of the messages sent to families and the
 * unit's news, kept off the screens people use every week. Each item can be
 * archived out of sight and restored from the archive.
 *
 * @module spa/modules/communication-history/CommunicationHistory
 */

import { translate } from '../../app.js';
import { setContent } from '../../utils/DOMUtils.js';
import { escapeAttribute, escapeHTML, sanitizeURL } from '../../utils/SecurityUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { formatTimestamp } from '../../utils/DateUtils.js';
import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';
import { renderBackLink } from '../../utils/BackLinkUtils.js';
import { canSendCommunications } from '../../utils/PermissionUtils.js';
import { roleLabel } from '../../utils/RoleLabelUtils.js';
import { renderDeliveryLog } from '../announcements/deliveryLog.js';
import {
  getAnnouncementHistory,
  getNewsHistory,
  setAnnouncementArchived,
  setNewsArchived,
} from '../../api/api-communication-history.js';

/** Statuses of a message still waiting to go out: the server refuses to archive it. */
const PENDING_STATUSES = ['scheduled', 'sending'];

/** Kinds of item the screen archives, each with the call that archives it. */
const KINDS = {
  announcement: { setArchived: setAnnouncementArchived, headingId: 'communication-history-messages' },
  news: { setArchived: setNewsArchived, headingId: 'communication-history-news' },
};

/**
 * Count the emails and push notifications a message sent, and those that failed.
 *
 * @param {Object[]} logs - The message's delivery log rows
 * @returns {{email: {sent: number, failed: number}, push: {sent: number, failed: number}}} Counts
 */
function summarizeDelivery(logs) {
  const summary = { email: { sent: 0, failed: 0 }, push: { sent: 0, failed: 0 } };
  logs.forEach((log) => {
    const channel = summary[log.channel];
    if (channel && (log.status === 'sent' || log.status === 'failed')) {
      channel[log.status] += 1;
    }
  });
  return summary;
}

export class CommunicationHistory {
  /** @param {Object} app - Application instance */
  constructor(app) {
    this.app = app;
    this.canSend = canSendCommunications();
    this.showArchived = false;
    this.announcements = [];
    this.news = [];
    this.groups = [];
    this.unitRoles = [];
    this.pages = { announcement: 1, news: 1 };
    this.hasMore = { announcement: false, news: false };
    this.errors = { announcements: false, news: false };
    this.destroyed = false;
    this.loadGeneration = 0;
    this.loadingMore = new Set();
  }

  /** Called by the router when the person leaves this screen. */
  destroy() {
    this.destroyed = true;
  }

  /** @returns {Promise<void>} */
  async init() {
    this.renderLoading();
    await this.load();
    this.render();
  }

  /** @returns {HTMLElement|null} The page root */
  root() {
    return document.getElementById('app');
  }

  /**
   * Load both lists. One failing does not hide the other.
   *
   * @returns {Promise<boolean>} False when a newer load superseded this one and nothing was applied
   */
  async load() {
    const archived = this.showArchived;
    this.loadGeneration += 1;
    const generation = this.loadGeneration;
    const [announcements, news] = await Promise.allSettled([
      this.canSend ? getAnnouncementHistory({ archived }) : Promise.resolve(null),
      getNewsHistory({ archived }),
    ]);
    // A newer load started while this one was in flight: its answer is the one to show.
    if (generation !== this.loadGeneration) {
      return false;
    }
    this.errors.announcements = announcements.status === 'rejected';
    this.errors.news = news.status === 'rejected';
    [announcements, news].forEach((result) => {
      if (result.status === 'rejected') {
        debugError('Failed to load communication history:', result.reason);
      }
    });
    const announcementData = announcements.value;
    this.announcements = Array.isArray(announcementData?.data) ? announcementData.data : [];
    this.unitRoles = Array.isArray(announcementData?.roles) ? announcementData.roles : [];
    this.news = Array.isArray(news.value?.data) ? news.value.data : [];
    this.groups = Array.isArray(announcementData?.groups) ? announcementData.groups : [];
    this.pages = { announcement: 1, news: 1 };
    this.hasMore = {
      announcement: Boolean(announcementData?.pagination?.hasNext),
      news: Boolean(news.value?.pagination?.hasNext),
    };
    return true;
  }

  renderLoading() {
    setContent(this.root(), `
      <section class="page communication-history" aria-busy="true">
        ${renderBackLink()}
        <h1>${escapeHTML(translate('communication_history_title'))}</h1>
        <p role="status">${escapeHTML(translate('loading'))}</p>
      </section>
    `);
  }

  /**
   * @param {string} value - Timestamp from the API
   * @returns {string} Date and time in the page language
   */
  formatDateTime(value) {
    return value ? formatTimestamp(value, this.app.lang || 'fr') : '';
  }

  /**
   * @param {string} role - Raw role name of a recipient role
   * @returns {string} A label fit for people
   */
  roleName(role) {
    const label = roleLabel(role);
    if (label && label !== role) {
      return label;
    }
    const unitRole = this.unitRoles.find((entry) => entry.role_name === role);
    return unitRole?.display_name || role.replace(/_/g, ' ');
  }

  /**
   * The archive or restore button of one item.
   *
   * @param {'announcement'|'news'} kind - Kind of item
   * @param {number} id - Item id
   * @param {string} title - Item title, to name the button
   * @returns {string} HTML, empty without permission
   */
  renderArchiveButton(kind, id, title) {
    if (!this.canSend) {
      return '';
    }
    const action = this.showArchived ? 'restore' : 'archive';
    const label = translate(`communication_history_${action}_named`).replace('{title}', title);
    return `
      <button type="button" class="button button--small button--secondary"
        data-archive-kind="${kind}" data-archive-id="${Number(id)}"
        data-archive-to="${this.showArchived ? 'false' : 'true'}"
        aria-label="${escapeAttribute(label)}">
        ${escapeHTML(translate(this.showArchived ? 'communication_history_restore' : 'archive'))}
      </button>`;
  }

  /**
   * @param {Object} announcement - Row from GET /api/v1/announcements
   * @returns {string} HTML list item
   */
  renderAnnouncement(announcement) {
    // A message that is still to go out cannot be archived; once archived it can always be restored.
    const pending = !this.showArchived && PENDING_STATUSES.includes(announcement.status);
    const logs = Array.isArray(announcement.logs) ? announcement.logs : [];
    const delivery = summarizeDelivery(logs);
    const roles = (announcement.recipient_roles || []).map((role) => this.roleName(role));
    const groups = (announcement.recipient_groups || [])
      .map((id) => this.groups.find((group) => group.id === id)?.name)
      .filter(Boolean);
    const scheduled = announcement.scheduled_at
      ? `<div>${escapeHTML(translate('scheduled_for'))}: ${escapeHTML(this.formatDateTime(announcement.scheduled_at))}</div>`
      : '';
    const sent = announcement.sent_at
      ? `<div>${escapeHTML(translate('sent_at'))}: ${escapeHTML(this.formatDateTime(announcement.sent_at))}</div>`
      : '';
    const pushFailed = delivery.push.failed
      ? `<span class="badge warning">${escapeHTML(translate('push_failed').replace('{count}', delivery.push.failed))}</span>`
      : '';
    return `
      <li class="news-item announcement-item" tabindex="-1" data-announcement-id="${Number(announcement.id)}">
        <div class="news-item-header">
          <h3 class="news-title">${escapeHTML(announcement.subject)}</h3>
          <span class="news-date">${escapeHTML(translate(announcement.status))}</span>
        </div>
        <div class="announcement-details">
          <div>${escapeHTML(translate('recipient_roles'))}: ${roles.length ? roles.map(escapeHTML).join(', ') : escapeHTML(translate('no_data_available'))}</div>
          ${groups.length ? `<div>${escapeHTML(translate('select_groups'))}: ${groups.map(escapeHTML).join(', ')}</div>` : ''}
          ${scheduled}
          ${sent}
        </div>
        <div class="announcement-logs">
          <strong>${escapeHTML(translate('delivery_status_summary'))}:</strong>
          <span class="badge success">${escapeHTML(translate('emails'))}: ${delivery.email.sent}</span>
          <span class="badge warning">${escapeHTML(translate('failed'))}: ${delivery.email.failed}</span>
          <span class="badge info">${escapeHTML(translate('push_notifications'))}: ${delivery.push.sent}</span>
          ${pushFailed}
        </div>
        ${renderDeliveryLog(logs)}
        <div>${pending ? '' : this.renderArchiveButton('announcement', announcement.id, announcement.subject)}</div>
      </li>`;
  }

  /**
   * @param {Object} item - Row from GET /api/v1/news
   * @returns {string} HTML list item
   */
  renderNewsItem(item) {
    const link = sanitizeURL(item.link || null);
    const more = link
      ? `<a class="text-link" href="${escapeAttribute(link)}" target="_blank" rel="noopener noreferrer">${escapeHTML(translate('news_read_more'))}</a>`
      : '';
    const title = item.title || translate('news_untitled');
    return `
      <li class="news-item" tabindex="-1" data-news-id="${Number(item.id)}">
        <div class="news-item-header">
          <h3 class="news-title">${escapeHTML(title)}</h3>
          <span class="news-date">${escapeHTML(translate('news_published'))}: <time datetime="${escapeAttribute(item.created_at || '')}">${escapeHTML(this.formatDateTime(item.created_at))}</time></span>
        </div>
        <p class="news-summary">${escapeHTML(item.content || translate('news_no_summary'))}</p>
        ${more}
        <div>${this.renderArchiveButton('news', item.id, title)}</div>
      </li>`;
  }

  /**
   * One section: heading, then the list, an empty note or an error with a retry.
   *
   * @param {Object} section
   * @param {string} section.headingId - DOM id of the heading
   * @param {string} section.titleKey - Translation key of the heading
   * @param {boolean} section.failed - The load failed
   * @param {string[]} section.items - Rendered list items
   * @param {string} section.emptyKey - Translation key of the empty note
   * @param {string} section.errorKey - Translation key of the error
   * @param {'announcement'|'news'} section.kind - Kind of item the section lists
   * @returns {string} HTML
   */
  renderSection({ headingId, titleKey, failed, items, emptyKey, errorKey, kind }) {
    let body;
    if (failed) {
      body = `
        <p class="status-message error" role="alert">${escapeHTML(translate(errorKey))}</p>
        <button type="button" class="button" data-communication-retry>${escapeHTML(translate('retry'))}</button>`;
    } else if (items.length) {
      const more = this.hasMore[kind]
        ? `<button type="button" class="button button--secondary" data-load-more="${kind}">${escapeHTML(translate('communication_history_load_more'))}</button>`
        : '';
      body = `<ul class="news-list">${items.join('')}</ul>${more}`;
    } else {
      body = `<p class="muted-text">${escapeHTML(translate(emptyKey))}</p>`;
    }
    return `
      <section class="card" aria-labelledby="${headingId}">
        <h2 id="${headingId}" tabindex="-1">${escapeHTML(translate(titleKey))}</h2>
        ${body}
      </section>`;
  }

  render() {
    // #app outlives every screen: a late answer must not draw over the next one.
    if (this.destroyed) {
      return;
    }
    const archivedSuffix = this.showArchived ? '_archived' : '';
    const messages = this.canSend
      ? this.renderSection({
        headingId: KINDS.announcement.headingId,
        titleKey: this.showArchived ? 'communication_history_messages_archived' : 'announcement_history',
        failed: this.errors.announcements,
        items: this.announcements.map((item) => this.renderAnnouncement(item)),
        emptyKey: `communication_history_no_messages${archivedSuffix}`,
        errorKey: 'communication_history_messages_error',
        kind: 'announcement',
      })
      : '';
    const news = this.renderSection({
      headingId: KINDS.news.headingId,
      titleKey: this.showArchived ? 'communication_history_news_archived' : 'news_updates',
      failed: this.errors.news,
      items: this.news.map((item) => this.renderNewsItem(item)),
      emptyKey: this.showArchived ? 'communication_history_no_news_archived' : 'news_empty',
      errorKey: 'news_error',
      kind: 'news',
    });
    const writeLink = this.canSend
      ? `<p><a href="/mailing-list" class="button button--primary">${escapeHTML(translate('mailing_list'))}</a></p>`
      : '';
    // The archive is read with communications.send; offering it to anyone else would only end in a refusal.
    const archiveToggle = this.canSend
      ? `<label class="checkbox-option" for="communication-history-archived">
          <input type="checkbox" id="communication-history-archived" data-archive-safe ${this.showArchived ? 'checked' : ''}>
          <span>${escapeHTML(translate('communication_history_show_archived'))}</span>
        </label>`
      : '';
    setContent(this.root(), `
      <section class="page communication-history">
        ${renderBackLink()}
        <h1>${escapeHTML(translate('communication_history_title'))}</h1>
        ${writeLink}
        ${archiveToggle}
        ${messages}
        ${news}
      </section>
    `);
    this.bind();
  }

  /** Wire the controls of the markup just drawn; the old ones are gone, so listeners never stack. */
  bind() {
    const root = this.root();
    root.querySelector('#communication-history-archived')?.addEventListener('change', (event) => {
      this.showArchived = event.target.checked;
      this.reload({ focusId: 'communication-history-archived' });
    });
    root.querySelectorAll('[data-communication-retry]').forEach((button) => {
      button.addEventListener('click', () => this.reload());
    });
    root.querySelectorAll('[data-load-more]').forEach((button) => {
      button.addEventListener('click', () => this.loadMore(button.dataset.loadMore));
    });
    root.querySelectorAll('[data-archive-kind]').forEach((button) => {
      button.addEventListener('click', () => this.setArchived(button));
    });
  }

  /**
   * Fetch both lists again and redraw.
   *
   * @param {Object} [options]
   * @param {string} [options.focusId] - Element to focus afterwards, so a control that is
   *   redrawn under the person's hands does not drop their place in the page
   * @returns {Promise<void>}
   */
  async reload({ focusId = null } = {}) {
    if (!focusId) {
      this.renderLoading();
    }
    if (!(await this.load())) {
      return;
    }
    this.render();
    if (focusId) {
      document.getElementById(focusId)?.focus();
    }
  }

  /**
   * Append the next page of one list, keeping focus on the first item it added.
   *
   * @param {'announcement'|'news'} kind - The list to extend
   * @returns {Promise<void>}
   */
  async loadMore(kind) {
    // A second tap while the page is on its way would append the same page twice.
    if (this.loadingMore.has(kind)) {
      return;
    }
    this.loadingMore.add(kind);
    const button = document.querySelector(`[data-load-more="${kind}"]`);
    if (button) {
      button.disabled = true;
    }
    try {
      await this.fetchNextPage(kind);
    } finally {
      this.loadingMore.delete(kind);
    }
  }

  /**
   * Fetch and append the page after the one shown.
   *
   * @param {'announcement'|'news'} kind - The list to extend
   * @returns {Promise<void>}
   */
  async fetchNextPage(kind) {
    const generation = this.loadGeneration;
    const archived = this.showArchived;
    const page = this.pages[kind] + 1;
    const previousCount = (kind === 'announcement' ? this.announcements : this.news).length;
    let response;
    try {
      response = await (kind === 'announcement' ? getAnnouncementHistory : getNewsHistory)({ archived, page });
    } catch (error) {
      debugError('Failed to load more of the history:', error);
      this.app.showMessage(apiErrorMessage(error, 'communication_history_more_failed'), 'error');
      const retry = document.querySelector(`[data-load-more="${kind}"]`);
      if (retry) {
        retry.disabled = false;
      }
      return;
    }
    // The person switched lists, or reloaded, while this page was on its way.
    if (generation !== this.loadGeneration || this.destroyed) {
      return;
    }
    const rows = Array.isArray(response?.data) ? response.data : [];
    if (kind === 'announcement') {
      this.announcements = [...this.announcements, ...rows];
    } else {
      this.news = [...this.news, ...rows];
    }
    this.pages[kind] = page;
    this.hasMore[kind] = Boolean(response?.pagination?.hasNext);
    this.render();
    const items = document.querySelectorAll(`#${KINDS[kind].headingId} ~ ul > li`);
    items[previousCount]?.focus();
  }

  /**
   * Archive or restore the item of a clicked button, then redraw both lists.
   *
   * @param {HTMLButtonElement} button - The clicked archive or restore button
   * @returns {Promise<void>}
   */
  async setArchived(button) {
    const { archiveKind: kind, archiveId: id, archiveTo } = button.dataset;
    const archived = archiveTo === 'true';
    const { setArchived, headingId } = KINDS[kind];
    button.disabled = true;
    let result;
    try {
      result = await setArchived(Number(id), archived);
    } catch (error) {
      debugError('Failed to archive:', error);
      button.disabled = false;
      this.app.showMessage(
        apiErrorMessage(error, archived ? 'communication_history_archive_failed' : 'communication_history_restore_failed'),
        'error',
      );
      return;
    }
    // Offline, the write is only queued: say so rather than claim it is done.
    if (result?.queued) {
      button.disabled = false;
      this.app.showMessage(translate('communication_history_queued'), 'info');
      return;
    }
    this.app.showMessage(translate(archived ? 'communication_history_archived' : 'communication_history_restored'), 'success');
    // The write stands even if the reload fails: the lists show their own error.
    if (!(await this.load())) {
      return;
    }
    this.render();
    // The button that held focus is gone; keep the person in the section they were working in.
    document.getElementById(headingId)?.focus();
  }
}
