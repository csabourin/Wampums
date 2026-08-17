/**
 * Account Reactivation Page
 *
 * The way back in for a parent whose membership was deactivated — most often
 * because their last child aged out, and now they have another to register.
 *
 * One route serves both halves of that journey, because the person arriving
 * here is in one of exactly two situations and the page can tell which by
 * looking at the query string. With no token they came from the login or
 * registration screen and need to ask for a link. With a token they came from
 * the email and need to confirm it.
 *
 * Reachable without an account, necessarily: everyone who needs this page is
 * locked out of the unit by definition. The signed token is the only
 * authorisation, and like the alumni links it is never shown or stored.
 *
 * Confirmation asks for a click rather than acting on load. An email client
 * that prefetches links would otherwise reactivate — or file a request with an
 * admin — on someone's behalf.
 */

import { translate } from '../../app.js';
import { setContent } from '../../utils/DOMUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
// getApiUrl comes from config.js, not from ajax-functions.js. The same name is
// exported by both, but ajax-functions aliases it to buildApiUrl, which appends
// `?organization_id=…` of its own. Adding a query string to that result yields a
// URL with two `?`, and every parameter after the first silently becomes part of
// the previous value — which is how the token below went missing in transit.
import { getApiUrl } from '../../config.js';
import { getCurrentOrganizationId } from '../../ajax-functions.js';

/**
 * What the page says once a link has been described but not yet used.
 *
 * The three "ready" states differ in what the click will actually do, and the
 * reader is told which before clicking: restored now, added to the unit now, or
 * passed to an admin. Promising the first while delivering the third would be
 * the one genuinely unkind outcome here.
 */
const READY_MESSAGES = {
  ready_reactivate: 'reactivation_confirm_reactivate',
  ready_join: 'reactivation_confirm_join',
  ready_review: 'reactivation_confirm_review'
};

/** What the page says once the link has been used, or found unusable. */
const OUTCOME_MESSAGES = {
  reactivated: 'reactivation_done_reactivated',
  joined: 'reactivation_done_joined',
  pending_approval: 'reactivation_done_pending',
  already_active: 'reactivation_already_active',
  invalid: 'reactivation_invalid'
};

export class ReactivationLink {
  /**
   * @param {Object} app - Application instance
   */
  constructor(app) {
    this.app = app;
    this.token = new URLSearchParams(window.location.search).get('token') || '';
    this.organizationName = '';
  }

  /**
   * Ask for a link, or act on the one that brought the reader here.
   *
   * @returns {Promise<void>}
   */
  async init() {
    if (!this.token) {
      this.renderRequestForm();
      return;
    }

    await this.renderConfirmation();
  }

  /**
   * Headline for every state of this page: the unit's name when we know it,
   * the generic title before the API has told us.
   *
   * @returns {string} Escaped heading text
   */
  heading() {
    return this.organizationName
      ? escapeHTML(this.organizationName)
      : translate('reactivation_page_title');
  }

  /**
   * Ask for the address, and post it. The response never says whether the
   * address was known, so neither does this page.
   *
   * @returns {void}
   */
  renderRequestForm() {
    setContent(document.getElementById('app'), `
      <section class="page reactivation-link">
        <h1>${translate('reactivation_page_title')}</h1>
        <p>${translate('reactivation_request_intro')}</p>
        <form id="reactivation-request-form" novalidate>
          <label for="reactivation-email">${translate('reactivation_request_email_label')}</label>
          <input type="email" id="reactivation-email" name="email" autocomplete="email" required />
          <button type="submit" id="reactivation-request-btn" class="button button--primary">
            ${translate('reactivation_request_submit')}
          </button>
        </form>
        <p id="reactivation-request-status" class="status-message" role="status" aria-live="polite"></p>
      </section>
    `);

    document.getElementById('reactivation-request-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      this.submitRequest();
    });
  }

  /**
   * Post the address to the API.
   *
   * @returns {Promise<void>}
   */
  async submitRequest() {
    const input = document.getElementById('reactivation-email');
    const button = document.getElementById('reactivation-request-btn');
    const status = document.getElementById('reactivation-request-status');
    const email = (input?.value || '').trim();

    if (!email) {
      return;
    }

    if (button) {
      button.disabled = true;
    }

    try {
      const organizationId = getCurrentOrganizationId();
      const response = await fetch(getApiUrl('/api/v1/public/reactivation/request'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(organizationId ? { 'x-organization-id': String(organizationId) } : {})
        },
        body: JSON.stringify({ email })
      });

      // Deliberately not branching on whether the address was known: the API
      // does not say, and a page that guessed would undo that.
      if (status) {
        status.textContent = response.ok
          ? translate('reactivation_request_sent')
          : translate('reactivation_request_error');
        status.className = `status-message ${response.ok ? 'success' : 'error'}`;
      }

      if (response.ok) {
        document.getElementById('reactivation-request-form')?.remove();
      } else if (button) {
        button.disabled = false;
      }
    } catch (error) {
      debugError('Failed to request a reactivation link:', error);
      if (status) {
        status.textContent = translate('reactivation_request_error');
        status.className = 'status-message error';
      }
      if (button) {
        button.disabled = false;
      }
    }
  }

  /**
   * Ask the API what this link would do, then offer the button.
   *
   * @returns {Promise<void>}
   */
  async renderConfirmation() {
    let state = 'invalid';
    try {
      // Built through URL rather than string concatenation so that a base which
      // already carries a query string appends to it instead of starting a
      // second one.
      const url = new URL(getApiUrl('/api/v1/public/reactivation/link'));
      url.searchParams.set('token', this.token);

      const response = await fetch(url);
      const body = await response.json();
      state = body?.data?.state || 'invalid';
      this.organizationName = body?.data?.organization_name || '';
    } catch (error) {
      debugError('Failed to read the reactivation link:', error);
    }

    const readyMessage = READY_MESSAGES[state];
    if (!readyMessage) {
      this.renderOutcome(state);
      return;
    }

    setContent(document.getElementById('app'), `
      <section class="page reactivation-link">
        <h1>${this.heading()}</h1>
        <p>${translate(readyMessage)}</p>
        <button type="button" id="reactivation-confirm-btn" class="button button--primary">
          ${translate('reactivation_confirm_button')}
        </button>
      </section>
    `);

    document.getElementById('reactivation-confirm-btn')?.addEventListener('click', (event) => {
      event.currentTarget.disabled = true;
      this.submitConfirmation();
    });
  }

  /**
   * Use the link.
   *
   * @returns {Promise<void>}
   */
  async submitConfirmation() {
    let state = 'invalid';
    try {
      const response = await fetch(getApiUrl('/api/v1/public/reactivation/confirm'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: this.token })
      });
      const body = await response.json();
      state = body?.data?.state || 'invalid';
      this.organizationName = body?.data?.organization_name || this.organizationName;
    } catch (error) {
      debugError('Failed to confirm the reactivation link:', error);
    }

    this.renderOutcome(state);
  }

  /**
   * Show the final message, with a way on to the login page when access was
   * actually restored — and without one when it was not, since the reader
   * still has nothing to log in to.
   *
   * @param {string} state - State returned by the API
   * @returns {void}
   */
  renderOutcome(state) {
    const messageKey = OUTCOME_MESSAGES[state] || OUTCOME_MESSAGES.invalid;
    const hasAccess = state === 'reactivated' || state === 'joined' || state === 'already_active';

    setContent(document.getElementById('app'), `
      <section class="page reactivation-link">
        <h1>${this.heading()}</h1>
        <p role="status">${translate(messageKey)}</p>
        ${hasAccess ? `
          <a class="button button--primary" href="/login">${translate('login')}</a>
        ` : ''}
      </section>
    `);
  }
}
