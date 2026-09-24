/**
 * Parent invitations — where an administrator hands a family the means to
 * register themselves.
 *
 * Invitations are listed apart from real users on purpose: an invited address
 * is not an account until someone claims it, and showing the two together
 * would invite an admin to edit a "user" who does not exist yet.
 *
 * One flow here needs care. Inviting an address whose membership an
 * administrator closed by hand is not refused outright, and not allowed
 * silently either: the server stops, says when and why that membership was
 * closed, and this screen asks the admin whether they are sure, and why. The
 * reason is required and kept with the invitation.
 *
 * @module spa/modules/parent-invitations/ParentInvitations
 */

import { translate } from '../../app.js';
import { setContent } from '../../utils/DOMUtils.js';
import { loadFamilyAccessStyles } from '../family-access/styles.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { hasPermission } from '../../utils/PermissionUtils.js';
import { formatDate } from '../../utils/DateUtils.js';
import { openModal, closeModal } from '../../utils/ModalUtils.js';
import { confirm } from '../../utils/DialogUtils.js';
import {
  getParentInvitations,
  createParentInvitation,
  resendParentInvitation,
  revokeParentInvitation,
} from '../../api/api-parent-invitations.js';

const MODAL_ID = 'parent-invitation-modal';

/** States in which an invitation can still be resent or withdrawn. */
const OPEN_STATES = new Set(['pending', 'expired']);

/** Date formatting for list rows: short, and in the page's language. */
const SHORT_DATE = { year: 'numeric', month: 'short', day: 'numeric' };

/** Refusals the server explains with a code, and how to say them. */
const CONFLICT_MESSAGES = {
  already_member: 'parent_invitations_already_member',
  already_invited: 'parent_invitations_already_invited',
};

/** Fields of the invitation form, in the order they are read. */
const OPTIONAL_FIELDS = [
  'first_name',
  'last_name',
  'telephone_cellulaire',
  'telephone_residence',
  'support_contact_name',
  'support_contact_email',
];

export class ParentInvitations {
  /**
   * @param {Object} app - Application instance
   */
  constructor(app) {
    this.app = app;
    this.invitations = [];
    this.canInvite = hasPermission('users.invite');
  }

  /**
   * Load and show the list.
   *
   * @returns {Promise<void>}
   */
  async init() {
    loadFamilyAccessStyles();
    this.renderLoading();
    try {
      await this.load();
      this.render();
    } catch (error) {
      debugError('Failed to load parent invitations:', error);
      this.renderError();
    }
  }

  /** @returns {Promise<void>} */
  async load() {
    const response = await getParentInvitations();
    this.invitations = Array.isArray(response?.data) ? response.data : [];
  }

  /** @returns {HTMLElement|null} The page root */
  root() {
    return document.getElementById('app');
  }

  /** @returns {string} The page language */
  lang() {
    return this.app?.lang || document.documentElement.lang || 'fr';
  }

  /**
   * Format a timestamp for a row, or nothing when it is absent.
   *
   * @param {string|null} value - ISO timestamp
   * @returns {string} Escaped date
   */
  date(value) {
    return value ? escapeHTML(formatDate(value, this.lang(), SHORT_DATE)) : '';
  }

  /** @returns {void} */
  renderLoading() {
    setContent(this.root(), `
      <section class="page parent-invitations" aria-busy="true">
        <h1>${translate('parent_invitations_title')}</h1>
        <p role="status">${translate('loading')}</p>
      </section>
    `);
  }

  /** @returns {void} */
  renderError() {
    setContent(this.root(), `
      <section class="page parent-invitations">
        <h1>${translate('parent_invitations_title')}</h1>
        <p class="status-message error" role="alert">${translate('error_loading_data')}</p>
        <button type="button" class="button" id="parent-invitations-retry">${translate('parent_invitations_retry')}</button>
      </section>
    `);
    document.getElementById('parent-invitations-retry')?.addEventListener('click', () => this.init());
  }

  /** @returns {void} */
  render() {
    setContent(this.root(), `
      <section class="page parent-invitations">
        <header class="page__header">
          <h1>${translate('parent_invitations_title')}</h1>
          ${this.canInvite ? `
            <button type="button" id="invite-parent-btn" class="button button--primary">
              ${translate('parent_invitations_invite')}
            </button>
          ` : ''}
        </header>
        <p>${translate('parent_invitations_intro')}</p>
        <p id="parent-invitations-status" class="status-message" role="status" hidden></p>
        ${this.invitations.length === 0
          ? `<p class="empty-state">${translate('parent_invitations_empty')}</p>`
          : `<ul class="invitation-list">${this.invitations.map((invitation) => this.renderRow(invitation)).join('')}</ul>`}
      </section>
    `);

    this.attachListeners();
  }

  /**
   * One invitation.
   *
   * @param {Object} invitation - Row from the API
   * @returns {string} HTML
   */
  renderRow(invitation) {
    const name = [invitation.first_name, invitation.last_name].filter(Boolean).join(' ');
    const state = escapeHTML(invitation.state || 'pending');
    const canAct = this.canInvite && OPEN_STATES.has(invitation.state);

    let delivery;
    if (invitation.state === 'accepted') {
      delivery = `${translate('parent_invitations_accepted_on')} ${this.date(invitation.accepted_at)}`;
    } else if (invitation.state === 'revoked') {
      delivery = `${translate('parent_invitations_revoked_on')} ${this.date(invitation.revoked_at)}`;
    } else if (invitation.sent_at) {
      delivery = `${translate('parent_invitations_sent_on')} ${this.date(invitation.sent_at)}`;
    } else {
      delivery = `<span class="text-warning">${translate('parent_invitations_not_sent')}</span>`;
    }

    return `
      <li class="invitation-card" data-id="${escapeHTML(invitation.id)}">
        <div class="invitation-card__main">
          <strong>${escapeHTML(name || invitation.email)}</strong>
          <span class="badge badge--${state}">${translate(`parent_invitation_state_${state}`)}</span>
        </div>
        ${name ? `<div class="invitation-card__email">${escapeHTML(invitation.email)}</div>` : ''}
        <div class="invitation-card__meta">${delivery}</div>
        ${invitation.deactivation_override_reason ? `
          <div class="invitation-card__meta">
            ${translate('parent_invitations_reinstating')}: ${escapeHTML(invitation.deactivation_override_reason)}
          </div>
        ` : ''}
        ${canAct ? `
          <div class="invitation-card__actions">
            <button type="button" class="button button--small" data-action="resend" data-id="${escapeHTML(invitation.id)}">
              ${translate('parent_invitations_resend')}
            </button>
            <button type="button" class="button button--small button--danger" data-action="revoke" data-id="${escapeHTML(invitation.id)}">
              ${translate('parent_invitations_revoke')}
            </button>
          </div>
        ` : ''}
      </li>
    `;
  }

  /** @returns {void} */
  attachListeners() {
    document.getElementById('invite-parent-btn')?.addEventListener('click', () => this.openInviteForm());

    this.root()?.querySelectorAll('[data-action]').forEach((button) => {
      button.addEventListener('click', () => {
        const { action, id } = button.dataset;
        if (action === 'resend') {
          this.resend(id);
        } else if (action === 'revoke') {
          this.revoke(id);
        }
      });
    });
  }

  /**
   * Show a message at the top of the list.
   *
   * @param {string} key - Translation key
   * @param {string} [kind] - `success`, `warning` or `error`
   * @returns {void}
   */
  showStatus(key, kind = 'success') {
    const element = document.getElementById('parent-invitations-status');
    if (!element) return;
    element.textContent = translate(key);
    element.className = `status-message ${kind}`;
    element.hidden = false;
  }

  /**
   * The invitation form, in a modal.
   *
   * @returns {void}
   */
  openInviteForm() {
    const field = (name, type, labelKey, extra = '') => `
      <div class="form-group">
        <label for="invite-${name}">${translate(labelKey)}</label>
        <input type="${type}" id="invite-${name}" name="${name}" ${extra} />
      </div>
    `;

    openModal({
      id: MODAL_ID,
      title: translate('parent_invitations_invite'),
      body: `
        <form id="parent-invitation-form" novalidate>
          ${field('email', 'email', 'email', 'required autocomplete="off" maxlength="255"')}
          <p class="form-hint">${translate('parent_invitations_optional_hint')}</p>
          ${field('first_name', 'text', 'first_name', 'maxlength="255"')}
          ${field('last_name', 'text', 'last_name', 'maxlength="255"')}
          ${field('telephone_cellulaire', 'tel', 'telephone_cellulaire', 'maxlength="20"')}
          ${field('telephone_residence', 'tel', 'telephone_residence', 'maxlength="20"')}
          ${field('support_contact_name', 'text', 'parent_invitations_support_name', 'maxlength="255"')}
          ${field('support_contact_email', 'email', 'parent_invitations_support_email', 'maxlength="255"')}
          <div id="parent-invitation-override" hidden></div>
          <p id="parent-invitation-error" class="status-message error" role="alert" hidden></p>
        </form>
      `,
      footer: `
        <button type="button" class="button" data-modal-close>${translate('cancel')}</button>
        <button type="button" id="parent-invitation-submit" class="button button--primary">
          ${translate('parent_invitations_send')}
        </button>
      `,
    });

    // The send button lives in the modal footer, outside the form, so it is
    // wired directly rather than through the form's submit event. Enter in a
    // field still submits through the form.
    const form = document.getElementById('parent-invitation-form');
    form?.addEventListener('submit', (event) => {
      event.preventDefault();
      this.submitInvitation(form);
    });
    document.getElementById('parent-invitation-submit')?.addEventListener('click', () => {
      if (form) this.submitInvitation(form);
    });
  }

  /**
   * Read the form into the request body.
   *
   * @param {HTMLFormElement} form - The invitation form
   * @returns {Object} Request body
   */
  readInvitation(form) {
    const value = (name) => form.querySelector(`[name="${name}"]`)?.value.trim() || '';
    const body = { email: value('email'), language: this.lang() };
    OPTIONAL_FIELDS.forEach((name) => {
      const entered = value(name);
      if (entered) body[name] = entered;
    });
    return body;
  }

  /**
   * Send the invitation, or the confirmed reinstatement.
   *
   * @param {HTMLFormElement} form - The invitation form
   * @returns {Promise<void>}
   */
  async submitInvitation(form) {
    const body = this.readInvitation(form);
    if (!body.email) {
      this.showFormError('parent_invitations_email_required');
      return;
    }

    const override = document.getElementById('parent-invitation-override');
    if (override && !override.hidden) {
      const reason = document.getElementById('parent-invitation-reason')?.value.trim() || '';
      if (!reason) {
        this.showFormError('parent_invitations_reason_required');
        return;
      }
      body.confirm_reactivation = true;
      body.reactivation_reason = reason;
    }

    const submit = document.getElementById('parent-invitation-submit');
    if (submit) submit.disabled = true;

    try {
      const response = await createParentInvitation(body);
      closeModal(MODAL_ID);
      await this.load();
      this.render();
      if (response?.data?.email_sent === false) {
        this.showStatus('parent_invitations_created_not_sent', 'warning');
      } else {
        this.showStatus('parent_invitations_sent');
      }
    } catch (error) {
      if (submit) submit.disabled = false;
      if (error?.code === 'manually_deactivated') {
        this.askToReinstate(error.data || {});
        return;
      }
      debugError('Failed to invite parent:', error);
      this.showFormError(CONFLICT_MESSAGES[error?.code] || 'parent_invitations_failed');
    }
  }

  /**
   * The address belongs to someone an administrator removed by hand. Say when
   * and why, and ask for a reason before going ahead.
   *
   * @param {Object} details - `deactivated_at` and `deactivated_reason` from the server
   * @returns {void}
   */
  askToReinstate(details) {
    const panel = document.getElementById('parent-invitation-override');
    if (!panel) return;

    const when = details.deactivated_at ? this.date(details.deactivated_at) : translate('parent_invitations_date_unknown');
    const why = details.deactivated_reason
      ? escapeHTML(details.deactivated_reason)
      : translate('parent_invitations_reason_unknown');

    setContent(panel, `
      <div class="info-card info-card--warning" role="alert">
        <p><strong>${translate('parent_invitations_deactivated_title')}</strong></p>
        <p>${translate('parent_invitations_deactivated_on')} ${when} — ${why}</p>
        <p>${translate('parent_invitations_deactivated_question')}</p>
        <label for="parent-invitation-reason">${translate('parent_invitations_reason_label')}</label>
        <textarea id="parent-invitation-reason" rows="3" maxlength="1000" required></textarea>
      </div>
    `);
    panel.hidden = false;

    const submit = document.getElementById('parent-invitation-submit');
    if (submit) submit.textContent = translate('parent_invitations_reinstate_and_send');
    document.getElementById('parent-invitation-reason')?.focus();
  }

  /**
   * Put a translated error at the bottom of the form.
   *
   * @param {string} key - Translation key
   * @returns {void}
   */
  showFormError(key) {
    const element = document.getElementById('parent-invitation-error');
    if (!element) return;
    element.textContent = translate(key);
    element.hidden = false;
  }

  /**
   * Send a fresh link.
   *
   * @param {string} invitationId - Invitation UUID
   * @returns {Promise<void>}
   */
  async resend(invitationId) {
    try {
      const response = await resendParentInvitation(invitationId);
      await this.load();
      this.render();
      this.showStatus(
        response?.data?.email_sent === false ? 'parent_invitations_created_not_sent' : 'parent_invitations_resent',
        response?.data?.email_sent === false ? 'warning' : 'success'
      );
    } catch (error) {
      debugError('Failed to resend invitation:', error);
      this.showStatus('parent_invitations_failed', 'error');
    }
  }

  /**
   * Withdraw an invitation, after asking.
   *
   * @param {string} invitationId - Invitation UUID
   * @returns {Promise<void>}
   */
  async revoke(invitationId) {
    const confirmed = await confirm({
      title: translate('parent_invitations_revoke'),
      message: translate('parent_invitations_revoke_confirm'),
      confirmLabel: translate('parent_invitations_revoke'),
      danger: true,
    });
    if (!confirmed) return;

    try {
      await revokeParentInvitation(invitationId);
      await this.load();
      this.render();
      this.showStatus('parent_invitations_revoked');
    } catch (error) {
      debugError('Failed to revoke invitation:', error);
      this.showStatus('parent_invitations_failed', 'error');
    }
  }
}
