/**
 * Complete registration — the page an admin's invitation email opens.
 *
 * Reachable without an account: the person arriving has none yet, or has one
 * and is being brought into a new unit. The token in the URL is the only
 * authority, and it is sent back to the server exactly as received.
 *
 * Opening the page changes nothing. The page asks the server what the link is,
 * shows the form or the outcome, and only a submit spends the invitation — a
 * mail client prefetching the link must not create an account.
 *
 * A reader who already has an account is never shown a password field. Their
 * password is theirs; this page only asks them to confirm joining the unit.
 *
 * @module spa/modules/family-access/CompleteRegistration
 */

import { translate } from '../../app.js';
import { setContent } from '../../utils/DOMUtils.js';
import { loadFamilyAccessStyles } from './styles.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { renderAccountFields, readAccountFields, accountProblem } from './AccountFields.js';
import { describeLink, postLink } from './publicLinks.js';
import { adoptLinkLanguage } from './linkLanguage.js';

const DESCRIBE_PATH = '/api/v1/public/parent-invitations/describe';
const ACCEPT_PATH = '/api/v1/public/parent-invitations/accept';

/** What the page says about a link that can no longer be used. */
const DEAD_LINK_MESSAGES = {
  accepted: 'complete_registration_already_used',
  expired: 'complete_registration_expired',
  revoked: 'complete_registration_revoked',
  invalid: 'complete_registration_invalid',
};

/** Refusals the reader can fix, and what to tell them. */
const FIXABLE_ERRORS = {
  name_required: 'account_name_required',
  password_required: 'password_min_length',
};

/** What the page says after the invitation was spent. */
const RESULT_MESSAGES = {
  account_created: 'complete_registration_done_created',
  membership_added: 'complete_registration_done_joined',
  already_member: 'complete_registration_done_joined',
  pending_approval: 'complete_registration_done_pending',
};

export class CompleteRegistration {
  /**
   * @param {Object} app - Application instance
   */
  constructor(app) {
    this.app = app;
    this.token = new URLSearchParams(window.location.search).get('token') || '';
    this.link = null;
  }

  /**
   * Read the link, then show the form or the outcome.
   *
   * @returns {Promise<void>}
   */
  async init() {
    loadFamilyAccessStyles();
    this.renderLoading();
    this.link = this.token ? await describeLink(DESCRIBE_PATH, this.token) : { state: 'invalid' };

    // Speak the email's language. If switching reloads the route, the reload
    // renders this page afresh and this pass must not render over it.
    if (await adoptLinkLanguage(this.app, this.link.language)) {
      return;
    }

    if (this.link.state === 'ready_new_account') {
      this.renderNewAccountForm();
    } else if (this.link.state === 'ready_existing_account') {
      this.renderExistingAccountConfirmation();
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

  /**
   * Heading: the unit's name once known.
   *
   * @returns {string} Escaped heading
   */
  heading() {
    return this.link?.organization_name
      ? escapeHTML(this.link.organization_name)
      : translate('complete_registration_title');
  }

  /**
   * Who to ask for help, when the admin named someone.
   *
   * @returns {string} HTML, or empty
   */
  supportBlock() {
    if (!this.link?.support_contact_email) {
      return '';
    }
    const name = escapeHTML(this.link.support_contact_name || this.link.organization_name || '');
    const email = escapeHTML(this.link.support_contact_email);
    return `
      <aside class="info-card" aria-label="${translate('complete_registration_help_label')}">
        <p>${translate('complete_registration_help')}</p>
        <p><strong>${name}</strong><br /><a href="mailto:${email}">${email}</a></p>
      </aside>
    `;
  }

  /** @returns {void} */
  renderLoading() {
    setContent(this.root(), `
      <section class="page complete-registration" aria-busy="true">
        <h1>${translate('complete_registration_title')}</h1>
        <p role="status">${translate('loading')}</p>
      </section>
    `);
  }

  /**
   * The form for someone who has no account yet.
   *
   * @returns {void}
   */
  renderNewAccountForm() {
    setContent(this.root(), `
      <section class="page complete-registration">
        <h1>${this.heading()}</h1>
        <p>${translate('complete_registration_intro')}</p>
        <form id="complete-registration-form" novalidate>
          ${renderAccountFields({ email: this.link.email, prefill: this.link })}
          <p id="complete-registration-error" class="status-message error" role="alert" hidden></p>
          <div class="form-actions">
            <button type="submit" id="complete-registration-submit" class="button button--primary">
              ${translate('complete_registration_submit')}
            </button>
          </div>
        </form>
        ${this.supportBlock()}
      </section>
    `);

    document.getElementById('complete-registration-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      this.submitNewAccount(event.currentTarget);
    });
  }

  /**
   * Validate, then spend the invitation.
   *
   * @param {HTMLFormElement} form - The form
   * @returns {Promise<void>}
   */
  async submitNewAccount(form) {
    const values = readAccountFields(form);
    const problem = accountProblem(values);
    if (problem) {
      this.showError(problem);
      return;
    }

    const button = document.getElementById('complete-registration-submit');
    if (button) button.disabled = true;

    const { password_confirm: _confirm, ...fields } = values;
    const outcome = await postLink(ACCEPT_PATH, { token: this.token, ...fields });
    this.handleOutcome(outcome, button);
  }

  /**
   * The confirmation for someone who already has an account.
   *
   * @returns {void}
   */
  renderExistingAccountConfirmation() {
    setContent(this.root(), `
      <section class="page complete-registration">
        <h1>${this.heading()}</h1>
        <p>${translate('complete_registration_existing_intro')}</p>
        <p><strong>${escapeHTML(this.link.email || '')}</strong></p>
        <p id="complete-registration-error" class="status-message error" role="alert" hidden></p>
        <button type="button" id="complete-registration-confirm" class="button button--primary">
          ${translate('complete_registration_existing_submit')}
        </button>
        ${this.supportBlock()}
      </section>
    `);

    document.getElementById('complete-registration-confirm')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      const outcome = await postLink(ACCEPT_PATH, { token: this.token });
      this.handleOutcome(outcome, button);
    });
  }

  /**
   * Show what the server did, or why it did not.
   *
   * @param {Object} outcome - From {@link postLink}
   * @param {HTMLButtonElement|null} button - The button to re-enable on a fixable error
   * @returns {void}
   */
  handleOutcome(outcome, button) {
    const { data } = outcome;

    if (data.error === 'account_just_created') {
      // An account appeared for this address between reading the link and
      // submitting it. Read the link again: it now asks to confirm instead.
      this.init();
      return;
    }

    if (!outcome.ok || data.error) {
      if (button) button.disabled = false;
      this.showError(FIXABLE_ERRORS[data.error] || 'complete_registration_failed');
      return;
    }

    if (data.result) {
      this.renderMessage(RESULT_MESSAGES[data.result] || RESULT_MESSAGES.membership_added, {
        showLogin: data.result !== 'pending_approval',
      });
      return;
    }

    // Not spent: the link stopped being usable while the page was open.
    this.renderMessage(DEAD_LINK_MESSAGES[data.state] || DEAD_LINK_MESSAGES.invalid, {
      showLogin: data.state === 'accepted',
    });
  }

  /**
   * Put a translated error under the form.
   *
   * @param {string} key - Translation key
   * @returns {void}
   */
  showError(key) {
    const element = document.getElementById('complete-registration-error');
    if (!element) return;
    element.textContent = translate(key);
    element.hidden = false;
  }

  /**
   * A final message, with the way on to the login page when there is somewhere
   * to log in to.
   *
   * @param {string} key - Translation key
   * @param {Object} [options] - Options
   * @param {boolean} [options.showLogin] - Offer the login button
   * @returns {void}
   */
  renderMessage(key, { showLogin = false } = {}) {
    setContent(this.root(), `
      <section class="page complete-registration">
        <h1>${this.heading()}</h1>
        <p role="status">${translate(key)}</p>
        ${showLogin ? `<a class="button button--primary" href="/login">${translate('login')}</a>` : ''}
        ${this.supportBlock()}
      </section>
    `);
  }
}
