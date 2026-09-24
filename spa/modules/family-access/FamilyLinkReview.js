/**
 * Family link review — the page one parent's request to share a family opens.
 *
 * This page is where consent happens, so it is written to be understood before
 * it is acted on. It says who is asking, from which unit, how many children
 * accepting would open to the reader — a count, never names — and that the
 * sharing runs both ways and includes children either parent adds later.
 * Declining is offered with equal weight, on the same screen.
 *
 * Opening the page changes nothing; only a button the reader presses does.
 *
 * @module spa/modules/family-access/FamilyLinkReview
 */

import { translate } from '../../app.js';
import { setContent } from '../../utils/DOMUtils.js';
import { loadFamilyAccessStyles } from './styles.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { renderAccountFields, readAccountFields, accountProblem } from './AccountFields.js';
import { describeLink, postLink } from './publicLinks.js';

const DESCRIBE_PATH = '/api/v1/public/family-links/describe';
const ACCEPT_PATH = '/api/v1/public/family-links/accept';
const DECLINE_PATH = '/api/v1/public/family-links/decline';

/** What the page says about a request that can no longer be answered. */
const DEAD_LINK_MESSAGES = {
  accepted: 'family_link_already_accepted',
  declined: 'family_link_already_declined',
  revoked: 'family_link_withdrawn',
  expired: 'family_link_expired',
  unavailable: 'family_link_unavailable',
  invalid: 'family_link_invalid',
};

/** Refusals the page can explain. */
const ERROR_MESSAGES = {
  name_required: 'account_name_required',
  password_required: 'password_min_length',
  membership_blocked: 'family_link_membership_blocked',
};

export class FamilyLinkReview {
  /**
   * @param {Object} app - Application instance
   */
  constructor(app) {
    this.app = app;
    this.token = new URLSearchParams(window.location.search).get('token') || '';
    this.link = null;
  }

  /**
   * Read the request, then explain it and ask.
   *
   * @returns {Promise<void>}
   */
  async init() {
    loadFamilyAccessStyles();
    this.renderLoading();
    this.link = this.token ? await describeLink(DESCRIBE_PATH, this.token) : { state: 'invalid' };

    if (this.link.state === 'ready_new_account' || this.link.state === 'ready_existing_account') {
      this.renderReview();
    } else {
      this.renderMessage(DEAD_LINK_MESSAGES[this.link.state] || DEAD_LINK_MESSAGES.invalid, {
        showLogin: this.link.state === 'accepted',
      });
    }
  }

  /** @returns {HTMLElement|null} The page root */
  root() {
    return document.getElementById('app');
  }

  /** @returns {void} */
  renderLoading() {
    setContent(this.root(), `
      <section class="page family-link-review" aria-busy="true">
        <h1>${translate('family_link_title')}</h1>
        <p role="status">${translate('loading')}</p>
      </section>
    `);
  }

  /**
   * Fill `{placeholders}` in a translated string with escaped values.
   *
   * @param {string} key - Translation key
   * @param {Object} values - Replacements
   * @returns {string} HTML-safe text
   */
  fill(key, values) {
    return Object.entries(values).reduce(
      (text, [name, value]) => text.split(`{${name}}`).join(escapeHTML(String(value ?? ''))),
      translate(key)
    );
  }

  /**
   * The explanation, the choice, and — for someone without an account — the
   * fields to create one.
   *
   * @returns {void}
   */
  renderReview() {
    const isNew = this.link.state === 'ready_new_account';
    const count = Number(this.link.shared_children_count) || 0;

    setContent(this.root(), `
      <section class="page family-link-review">
        <h1>${translate('family_link_title')}</h1>
        <p>${this.fill('family_link_intro', {
          requester: this.link.requester_name || '',
          organization: this.link.organization_name || '',
        })}</p>
        <div class="info-card">
          <p><strong>${translate('family_link_what_accepting_means')}</strong></p>
          <ul>
            <li>${this.fill(count === 1 ? 'family_link_shares_one' : 'family_link_shares_many', { count })}</li>
            <li>${translate('family_link_shares_yours')}</li>
            <li>${translate('family_link_shares_future')}</li>
            <li>${translate('family_link_can_end')}</li>
          </ul>
        </div>
        <form id="family-link-form" novalidate>
          ${isNew ? `
            <p>${translate('family_link_create_account')}</p>
            ${renderAccountFields({ email: this.link.email })}
          ` : `
            <p><strong>${escapeHTML(this.link.email || '')}</strong></p>
          `}
          <p id="family-link-error" class="status-message error" role="alert" hidden></p>
          <div class="form-actions">
            <button type="submit" id="family-link-accept" class="button button--primary">
              ${translate('family_link_accept')}
            </button>
            <button type="button" id="family-link-decline" class="button button--secondary">
              ${translate('family_link_decline')}
            </button>
          </div>
        </form>
      </section>
    `);

    document.getElementById('family-link-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      this.submitAccept(event.currentTarget, isNew);
    });
    document.getElementById('family-link-decline')?.addEventListener('click', () => this.submitDecline());
  }

  /**
   * Accept, creating the account first when there is none.
   *
   * @param {HTMLFormElement} form - The form
   * @param {boolean} isNew - The reader has no account yet
   * @returns {Promise<void>}
   */
  async submitAccept(form, isNew) {
    let fields = {};
    if (isNew) {
      const values = readAccountFields(form);
      const problem = accountProblem(values);
      if (problem) {
        this.showError(problem);
        return;
      }
      const { password_confirm: _confirm, ...rest } = values;
      fields = rest;
    }

    this.setBusy(true);
    const outcome = await postLink(ACCEPT_PATH, { token: this.token, ...fields });
    const { data } = outcome;

    if (data.error === 'account_just_created') {
      this.init();
      return;
    }

    if (data.error || !outcome.ok) {
      this.setBusy(false);
      this.showError(ERROR_MESSAGES[data.error] || 'family_link_failed');
      return;
    }

    if (data.result) {
      this.renderMessage('family_link_done_linked', { showLogin: true });
      return;
    }

    this.renderMessage(DEAD_LINK_MESSAGES[data.state] || DEAD_LINK_MESSAGES.invalid, {
      showLogin: data.state === 'accepted',
    });
  }

  /**
   * Decline. Nothing is shared, and the requester sees that it was declined.
   *
   * @returns {Promise<void>}
   */
  async submitDecline() {
    this.setBusy(true);
    const outcome = await postLink(DECLINE_PATH, { token: this.token });

    if (outcome.data.declined) {
      this.renderMessage('family_link_done_declined');
      return;
    }
    if (!outcome.ok) {
      this.setBusy(false);
      this.showError('family_link_failed');
      return;
    }
    this.renderMessage(DEAD_LINK_MESSAGES[outcome.data.state] || DEAD_LINK_MESSAGES.invalid);
  }

  /**
   * Disable both answers while one is being sent, so they cannot race.
   *
   * @param {boolean} busy - Whether a request is in flight
   * @returns {void}
   */
  setBusy(busy) {
    ['family-link-accept', 'family-link-decline'].forEach((id) => {
      const button = document.getElementById(id);
      if (button) button.disabled = busy;
    });
  }

  /**
   * Put a translated error above the buttons.
   *
   * @param {string} key - Translation key
   * @returns {void}
   */
  showError(key) {
    const element = document.getElementById('family-link-error');
    if (!element) return;
    element.textContent = translate(key);
    element.hidden = false;
  }

  /**
   * A final message.
   *
   * @param {string} key - Translation key
   * @param {Object} [options] - Options
   * @param {boolean} [options.showLogin] - Offer the login button
   * @returns {void}
   */
  renderMessage(key, { showLogin = false } = {}) {
    setContent(this.root(), `
      <section class="page family-link-review">
        <h1>${translate('family_link_title')}</h1>
        <p role="status">${translate(key)}</p>
        ${showLogin ? `<a class="button button--primary" href="/login">${translate('login')}</a>` : ''}
      </section>
    `);
  }
}
