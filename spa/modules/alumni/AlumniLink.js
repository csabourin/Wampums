/**
 * Alumni Link Page
 *
 * The landing page behind the two links in an alumni email: the opt-in offered
 * when a family's access is withdrawn, and the unsubscribe carried by every
 * later mailing.
 *
 * It is reachable without an account, which is the whole point — the person
 * arriving here had their access closed, which is precisely why they are being
 * asked. The signed token in the query string is the only authorisation, and it
 * is never shown or stored.
 *
 * The opt-in asks for a click rather than acting on page load. An email client
 * that prefetches links would otherwise consent on someone's behalf, and a
 * consent nobody gave is exactly what this feature exists to avoid. The
 * unsubscribe is the opposite case and acts immediately: someone who asked to be
 * left alone should not have to ask twice.
 */

import { translate } from '../../app.js';
import { setContent } from '../../utils/DOMUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { getApiUrl } from '../../config.js';

/** The two things this page can be asked to do. */
export const CONSENT_ACTION = 'consent';
export const UNSUBSCRIBE_ACTION = 'unsubscribe';

/** Outcome message per state returned by the API. */
const STATE_MESSAGES = {
  consented: 'alumni_consent_done',
  already_consented: 'alumni_consent_already',
  membership_active: 'alumni_consent_membership_active',
  unsubscribed: 'alumni_unsubscribe_done',
  invalid: 'alumni_consent_invalid',
  unreachable: 'alumni_link_unreachable'
};

export class AlumniLink {
  /**
   * @param {Object} app - Application instance
   * @param {string} action - CONSENT_ACTION or UNSUBSCRIBE_ACTION
   */
  constructor(app, action = CONSENT_ACTION) {
    this.app = app;
    this.action = action;
    this.token = new URLSearchParams(window.location.search).get('token') || '';
    this.organizationName = '';
  }

  /**
   * Draw the page, then do whatever the action calls for.
   *
   * @returns {Promise<void>}
   */
  async init() {
    if (!this.token) {
      this.renderOutcome('invalid');
      return;
    }

    this.renderLoading();
    if (this.action === UNSUBSCRIBE_ACTION) {
      await this.submit('unsubscribe');
      return;
    }

    await this.renderInvitation();
  }

  /** @returns {string} The page's heading */
  heading() {
    const titleKey = this.action === UNSUBSCRIBE_ACTION
      ? 'alumni_unsubscribe_page_title'
      : 'alumni_consent_page_title';
    return this.organizationName ? escapeHTML(this.organizationName) : translate(titleKey);
  }

  /** Shown while the link is being checked. */
  renderLoading() {
    setContent(document.getElementById('app'), `
      <section class="page alumni-link" aria-busy="true">
        <h1>${this.heading()}</h1>
        <p role="status">${translate('loading')}</p>
      </section>
    `);
  }

  /**
   * Ask the API about this link. A failure to reach it is 'unreachable', never
   * 'invalid': the link may well be fine.
   *
   * @param {string} url - Endpoint
   * @param {RequestInit} [options] - fetch options
   * @returns {Promise<string>} The state the API reported
   */
  async requestState(url, options) {
    try {
      const response = await fetch(url, options);
      // These endpoints answer every link, valid or not, with 200 and a state.
      // Anything else (too many tries, a server error) says nothing about the link.
      if (!response.ok) {
        return 'unreachable';
      }
      const body = await response.json();
      this.organizationName = body?.data?.organization_name || this.organizationName;
      return body?.data?.state || 'invalid';
    } catch (error) {
      debugError('Failed to reach the alumni link endpoint:', error);
      return 'unreachable';
    }
  }

  /**
   * Ask the API what this opt-in link is about, then offer the button.
   *
   * @returns {Promise<void>}
   */
  async renderInvitation() {
    const state = await this.requestState(
      `${getApiUrl('/api/v1/public/alumni/invitation')}?token=${encodeURIComponent(this.token)}`
    );

    if (state !== 'ready') {
      this.renderOutcome(state);
      return;
    }

    setContent(document.getElementById('app'), `
      <section class="page alumni-link">
        <h1>${this.heading()}</h1>
        <p>${translate('alumni_invite_offer')}</p>
        <button type="button" id="alumni-consent-btn" class="button button--primary">
          ${translate('alumni_consent_confirm')}
        </button>
        <p class="text-muted">${translate('alumni_invite_silence')}</p>
      </section>
    `);

    document.getElementById('alumni-consent-btn')?.addEventListener('click', (event) => {
      event.currentTarget.disabled = true;
      this.submit('consent');
    });
  }

  /**
   * Post the token to the API and show what came back.
   *
   * @param {string} endpoint - 'consent' or 'unsubscribe'
   * @returns {Promise<void>}
   */
  async submit(endpoint) {
    const state = await this.requestState(getApiUrl(`/api/v1/public/alumni/${endpoint}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: this.token })
    });

    this.renderOutcome(state);
  }

  /**
   * Show the final message. There is deliberately nothing else on the page —
   * no login prompt, no navigation: the reader has no account here.
   *
   * @param {string} state - State returned by the API
   * @returns {void}
   */
  renderOutcome(state) {
    const messageKey = STATE_MESSAGES[state] || STATE_MESSAGES.invalid;
    const unreachable = state === 'unreachable';

    setContent(document.getElementById('app'), `
      <section class="page alumni-link">
        <h1>${this.heading()}</h1>
        <p role="${unreachable ? 'alert' : 'status'}">${translate(messageKey)}</p>
        ${unreachable ? `<button type="button" id="alumni-link-retry" class="button button--secondary">${translate('retry')}</button>` : ''}
      </section>
    `);
    document.getElementById('alumni-link-retry')?.addEventListener('click', () => this.init());
  }
}
