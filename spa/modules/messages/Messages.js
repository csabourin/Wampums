/**
 * The member's pushed messages.
 *
 * `/messages/:id` shows one message: the page a tapped push notification
 * opens, so the text is not lost once the notification is dismissed.
 * `/messages` lists the most recent ones. The server returns only the
 * member's own copies.
 *
 * @module spa/modules/messages/Messages
 */

import { translate } from '../../app.js';
import { setContent } from '../../utils/DOMUtils.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { formatTimestamp } from '../../utils/DateUtils.js';
import { renderBackLink } from '../../utils/BackLinkUtils.js';
import { getMessage, getMessages } from '../../api/api-messages.js';

const HTTP_NOT_FOUND = 404;

export class Messages {
  /**
   * @param {Object} app - Application instance
   * @param {Object} [options]
   * @param {number|null} [options.messageId] - Message to show; null lists them
   */
  constructor(app, { messageId = null } = {}) {
    this.app = app;
    this.messageId = Number.isInteger(messageId) && messageId > 0 ? messageId : null;
  }

  async init() {
    this.renderLoading();
    if (this.messageId) {
      await this.showMessage();
    } else {
      await this.showList();
    }
  }

  /** @returns {HTMLElement|null} The page root */
  root() {
    return document.getElementById('app');
  }

  /**
   * @param {string} value - Timestamp from the API
   * @returns {string} Date and time in the page language and the device's timezone
   */
  sentAt(value) {
    return formatTimestamp(value, this.app.lang || 'fr');
  }

  renderLoading() {
    setContent(this.root(), `
      <section class="page messages-page">
        <p class="loading-spinner" role="status">${escapeHTML(translate('loading'))}</p>
      </section>
    `);
  }

  /**
   * Show an error in place of the content.
   * @param {string} messageKey - Translation key
   * @param {string} backHref - Where the back link leads
   */
  renderProblem(messageKey, backHref) {
    setContent(this.root(), `
      <section class="page messages-page">
        ${renderBackLink(backHref)}
        <h1>${escapeHTML(translate('messages_title'))}</h1>
        <p role="alert">${escapeHTML(translate(messageKey))}</p>
      </section>
    `);
  }

  async showMessage() {
    let message;
    try {
      const response = await getMessage(this.messageId);
      message = response?.data;
    } catch (error) {
      debugError('Failed to load message:', error);
      this.renderProblem(error?.status === HTTP_NOT_FOUND ? 'message_not_found' : 'messages_load_error', '/messages');
      return;
    }
    if (!message) {
      this.renderProblem('message_not_found', '/messages');
      return;
    }

    const sender = message.sender_name
      ? `${escapeHTML(translate('message_sent_by'))} ${escapeHTML(message.sender_name)} · `
      : '';
    setContent(this.root(), `
      <section class="page messages-page">
        ${renderBackLink('/messages')}
        <article class="message-detail" aria-labelledby="message-title">
          <h1 id="message-title" tabindex="-1">${escapeHTML(message.title)}</h1>
          <p class="message-detail__meta">
            ${sender}<time datetime="${escapeHTML(message.created_at)}">${escapeHTML(this.sentAt(message.created_at))}</time>
          </p>
          <div class="message-detail__body">${escapeHTML(message.body)}</div>
        </article>
      </section>
    `);
    document.getElementById('message-title')?.focus?.();
  }

  async showList() {
    let messages;
    try {
      const response = await getMessages();
      messages = Array.isArray(response?.data) ? response.data : [];
    } catch (error) {
      debugError('Failed to load messages:', error);
      this.renderProblem('messages_load_error', '/dashboard');
      return;
    }

    const list = messages.length === 0
      ? `<p class="empty-state">${escapeHTML(translate('messages_empty'))}</p>`
      : `<ul class="message-list">
          ${messages.map((message) => `
            <li>
              <a class="message-list__item" href="/messages/${encodeURIComponent(message.id)}">
                <span class="message-list__title">${escapeHTML(message.title)}</span>
                <time class="message-list__date" datetime="${escapeHTML(message.created_at)}">${escapeHTML(this.sentAt(message.created_at))}</time>
              </a>
            </li>
          `).join('')}
        </ul>`;

    setContent(this.root(), `
      <section class="page messages-page">
        ${renderBackLink('/dashboard')}
        <h1>${escapeHTML(translate('messages_title'))}</h1>
        ${list}
      </section>
    `);
  }
}
