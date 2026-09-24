/**
 * Family sharing — who else can see this parent's children, and how to change
 * that.
 *
 * Three things on one page because a parent thinks of them as one: the people
 * they already share with, the requests they have sent and not yet had
 * answered, and a way to ask someone new. Before asking, the page says what
 * sharing means, in the same terms the other parent will read on the page
 * their email opens -- so neither side agrees to something the other did not.
 *
 * Ending a link is immediate and needs no one's permission, and the page asks
 * for confirmation first: it takes away the other parent's access to this
 * parent's children, and this parent's access to theirs.
 *
 * @module spa/modules/family-access/FamilyAccess
 */

import { translate } from '../../app.js';
import { setContent } from '../../utils/DOMUtils.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { formatDate } from '../../utils/DateUtils.js';
import { confirm } from '../../utils/DialogUtils.js';
import { loadFamilyAccessStyles } from './styles.js';
import {
  getFamilyLinks,
  requestFamilyLink,
  resendFamilyLinkRequest,
  withdrawFamilyLinkRequest,
  endFamilyLink,
} from '../../api/api-family.js';

/** Request states that can still be resent or withdrawn. */
const OPEN_STATES = new Set(['pending', 'expired']);

/** Why a request was refused, and what to tell the parent. */
const REFUSAL_MESSAGES = {
  self: 'family_access_error_self',
  no_children: 'family_access_error_no_children',
  already_linked: 'family_access_error_already_linked',
  already_requested: 'family_access_error_already_requested',
};

const SHORT_DATE = { year: 'numeric', month: 'short', day: 'numeric' };

export class FamilyAccess {
  /**
   * @param {Object} app - Application instance
   */
  constructor(app) {
    this.app = app;
    this.links = [];
    this.requests = [];
  }

  /** @returns {Promise<void>} */
  async init() {
    loadFamilyAccessStyles();
    this.renderLoading();
    try {
      await this.load();
      this.render();
    } catch (error) {
      debugError('Failed to load family links:', error);
      this.renderError();
    }
  }

  /** @returns {Promise<void>} */
  async load() {
    const response = await getFamilyLinks();
    this.links = Array.isArray(response?.data?.links) ? response.data.links : [];
    this.requests = Array.isArray(response?.data?.requests) ? response.data.requests : [];
  }

  /** @returns {HTMLElement|null} The page root */
  root() {
    return document.getElementById('app');
  }

  /** @returns {string} The page language */
  lang() {
    return this.app?.lang || document.documentElement.lang || 'fr';
  }

  /** @returns {void} */
  renderLoading() {
    setContent(this.root(), `
      <section class="page family-access" aria-busy="true">
        <h1>${translate('family_access_title')}</h1>
        <p role="status">${translate('loading')}</p>
      </section>
    `);
  }

  /** @returns {void} */
  renderError() {
    setContent(this.root(), `
      <section class="page family-access">
        <h1>${translate('family_access_title')}</h1>
        <p class="status-message error" role="alert">${translate('error_loading_data')}</p>
        <button type="button" class="button" id="family-access-retry">${translate('parent_invitations_retry')}</button>
      </section>
    `);
    document.getElementById('family-access-retry')?.addEventListener('click', () => this.init());
  }

  /**
   * One person this parent shares with.
   *
   * @param {Object} link - From the API
   * @returns {string} HTML
   */
  renderLink(link) {
    const name = link.partner_name || link.partner_email;
    return `
      <li class="family-access-item">
        <div>
          <strong>${escapeHTML(name || '')}</strong>
          ${link.partner_name ? `<div class="form-hint">${escapeHTML(link.partner_email || '')}</div>` : ''}
        </div>
        <button type="button" class="button button--small button--danger"
          data-end-link="${escapeHTML(String(link.id))}" data-name="${escapeHTML(name || '')}">
          ${translate('family_access_end')}
        </button>
      </li>
    `;
  }

  /**
   * One request this parent sent.
   *
   * @param {Object} request - From the API
   * @returns {string} HTML
   */
  renderRequest(request) {
    const state = escapeHTML(request.state || 'pending');
    const id = escapeHTML(request.id);
    const sent = request.sent_at
      ? `${translate('parent_invitations_sent_on')} ${escapeHTML(formatDate(request.sent_at, this.lang(), SHORT_DATE))}`
      : `<span class="text-warning">${translate('parent_invitations_not_sent')}</span>`;

    return `
      <li class="family-access-item">
        <div>
          <strong>${escapeHTML(request.target_email)}</strong>
          <span class="badge badge--${state}">${translate(`family_request_state_${state}`)}</span>
          ${OPEN_STATES.has(request.state) ? `<div class="form-hint">${sent}</div>` : ''}
        </div>
        ${OPEN_STATES.has(request.state) ? `
          <div class="family-access-item__actions">
            <button type="button" class="button button--small" data-resend="${id}">${translate('parent_invitations_resend')}</button>
            <button type="button" class="button button--small" data-withdraw="${id}">${translate('parent_invitations_revoke')}</button>
          </div>
        ` : ''}
      </li>
    `;
  }

  /** @returns {void} */
  render() {
    setContent(this.root(), `
      <section class="page family-access">
        <h1>${translate('family_access_title')}</h1>
        <p>${translate('family_access_intro')}</p>
        <p id="family-access-status" class="status-message" role="status" hidden></p>

        <h2>${translate('family_access_shared_with')}</h2>
        ${this.links.length === 0
          ? `<p class="empty-state">${translate('family_access_no_links')}</p>`
          : `<ul class="family-access-list">${this.links.map((link) => this.renderLink(link)).join('')}</ul>`}

        <h2>${translate('family_access_invite')}</h2>
        <div class="info-card">
          <p><strong>${translate('family_link_what_accepting_means')}</strong></p>
          <ul>
            <li>${translate('family_access_means_both_ways')}</li>
            <li>${translate('family_link_shares_future')}</li>
            <li>${translate('family_access_means_consent')}</li>
            <li>${translate('family_link_can_end')}</li>
          </ul>
        </div>
        <form id="family-access-form" novalidate>
          <div class="form-group">
            <label for="family-access-email">${translate('family_access_email_label')}</label>
            <input type="email" id="family-access-email" name="email" maxlength="255" autocomplete="off" required />
          </div>
          <p id="family-access-error" class="status-message error" role="alert" hidden></p>
          <button type="submit" id="family-access-send" class="button button--primary">${translate('family_access_send')}</button>
        </form>

        ${this.requests.length > 0 ? `
          <h2>${translate('family_access_requests')}</h2>
          <ul class="family-access-list">${this.requests.map((request) => this.renderRequest(request)).join('')}</ul>
        ` : ''}
      </section>
    `);

    this.attachListeners();
  }

  /** @returns {void} */
  attachListeners() {
    const form = document.getElementById('family-access-form');
    form?.addEventListener('submit', (event) => {
      event.preventDefault();
      this.sendRequest(form.querySelector('[name="email"]')?.value.trim() || '');
    });

    this.root()?.querySelectorAll('[data-end-link]').forEach((button) => {
      button.addEventListener('click', () => this.endLink(Number(button.dataset.endLink), button.dataset.name));
    });
    this.root()?.querySelectorAll('[data-resend]').forEach((button) => {
      button.addEventListener('click', () => this.act(() => resendFamilyLinkRequest(button.dataset.resend), 'family_access_resent'));
    });
    this.root()?.querySelectorAll('[data-withdraw]').forEach((button) => {
      button.addEventListener('click', () => this.act(() => withdrawFamilyLinkRequest(button.dataset.withdraw), 'family_access_withdrawn'));
    });
  }

  /**
   * Ask another parent to share this family.
   *
   * @param {string} email - Their address
   * @returns {Promise<void>}
   */
  async sendRequest(email) {
    if (!email) {
      this.showError('parent_invitations_email_required');
      return;
    }

    const button = document.getElementById('family-access-send');
    if (button) button.disabled = true;

    try {
      const response = await requestFamilyLink(email);
      await this.load();
      this.render();
      if (response?.data?.email_sent === false) {
        this.showStatus('family_access_created_not_sent', 'warning');
      } else {
        this.showStatus('family_access_sent');
      }
    } catch (error) {
      if (button) button.disabled = false;
      debugError('Failed to send family link request:', error);
      this.showError(REFUSAL_MESSAGES[error?.code] || 'family_access_error_failed');
    }
  }

  /**
   * End a link, after saying what that takes away.
   *
   * @param {number} linkId - Family link id
   * @param {string} name - The other parent, for the question
   * @returns {Promise<void>}
   */
  async endLink(linkId, name) {
    const confirmed = await confirm({
      title: translate('family_access_end'),
      message: translate('family_access_end_confirm').split('{name}').join(name || ''),
      confirmLabel: translate('family_access_end'),
      danger: true,
    });
    if (!confirmed) return;

    await this.act(() => endFamilyLink(linkId), 'family_access_ended');
  }

  /**
   * Run an action, reload, and report.
   *
   * @param {Function} action - Returns the API promise
   * @param {string} successKey - Translation key on success
   * @returns {Promise<void>}
   */
  async act(action, successKey) {
    try {
      await action();
      await this.load();
      this.render();
      this.showStatus(successKey);
    } catch (error) {
      debugError('Family access action failed:', error);
      this.showStatus('family_access_error_failed', 'error');
    }
  }

  /**
   * Put a translated error under the form.
   *
   * @param {string} key - Translation key
   * @returns {void}
   */
  showError(key) {
    const element = document.getElementById('family-access-error');
    if (!element) return;
    element.textContent = translate(key);
    element.hidden = false;
  }

  /**
   * Show a message at the top of the page.
   *
   * @param {string} key - Translation key
   * @param {string} [kind] - `success`, `warning` or `error`
   * @returns {void}
   */
  showStatus(key, kind = 'success') {
    const element = document.getElementById('family-access-status');
    if (!element) return;
    element.textContent = translate(key);
    element.className = `status-message ${kind}`;
    element.hidden = false;
  }
}
