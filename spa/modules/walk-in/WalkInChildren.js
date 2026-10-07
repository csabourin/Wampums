/**
 * Welcome a new child — enter a child who arrived at a meeting before their
 * family has an account, and invite their parent.
 *
 * Built for the edge of a meeting: four fields, one button, and the child is on
 * the roster -- attendance, points and honours work from that moment. The
 * parent's side is settled by the server: an existing parent here is linked at
 * once, an address already invited gains the child, anyone else is invited.
 *
 * Below the form, every child of this year whom no account can see yet, with
 * the invitation they are waiting on and a way to resend it or correct the
 * address. Children leave the list when a parent accepts.
 *
 * @module spa/modules/walk-in/WalkInChildren
 */

import { translate } from '../../app.js';
import { setContent } from '../../utils/DOMUtils.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { formatDate } from '../../utils/DateUtils.js';
import { loadFamilyAccessStyles } from '../family-access/styles.js';
import { birthDateBounds, childProblem } from '../family-access/childValidation.js';
import {
  getWalkInChildren,
  addWalkInChild,
  inviteParentForChild,
  resendWalkInInvitation,
  updateWalkInChild,
  withdrawWalkInChild,
  revokeWalkInInvitation,
} from '../../api/api-walk-in.js';
import { confirm } from '../../utils/DialogUtils.js';
import { openChildEditor } from '../family-access/childEditor.js';
import { familyOperationErrorKey, beginFamilyOperation, refreshFamilyAfterWrite, invitationLanguageField } from '../family-access/operations.js';
import { renderBackLink } from '../../utils/BackLinkUtils.js';

const SHORT_DATE = { year: 'numeric', month: 'short', day: 'numeric' };
const BIRTH_DATE = { year: 'numeric', month: 'long', day: 'numeric' };

/** What to say once a child is added, by what happened to the parent side. */
const PARENT_MESSAGES = {
  invited: 'walk_in_added_invited',
  added_to_invitation: 'walk_in_added_to_invitation',
  linked_existing_account: 'walk_in_added_linked',
};

/** What to say once a parent is invited for a child already on the list. */
const INVITE_MESSAGES = {
  invited: 'walk_in_invited',
  added_to_invitation: 'walk_in_added_to_invitation',
  linked_existing_account: 'walk_in_linked',
};

export class WalkInChildren {
  /**
   * @param {Object} app - Application instance
   */
  constructor(app) {
    this.app = app;
    this.children = [];
    // Set when the server stopped on a hand-removed parent and this user may
    // reinstate them: the form then asks for a reason before resending.
    this.pendingOverride = null;
  }

  /** @returns {Promise<void>} */
  async init() {
    loadFamilyAccessStyles();
    this.renderLoading();
    try {
      await this.load();
      this.render();
    } catch (error) {
      debugError('Failed to load walk-in children:', error);
      this.renderError();
    }
  }

  /** @returns {Promise<void>} */
  async load() {
    const response = await getWalkInChildren();
    this.children = Array.isArray(response?.data) ? response.data : [];
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
      <section class="page walk-in" aria-busy="true">
        ${renderBackLink()}
        <h1>${translate('walk_in_title')}</h1>
        <p role="status">${translate('loading')}</p>
      </section>
    `);
  }

  /** @returns {void} */
  renderError() {
    setContent(this.root(), `
      <section class="page walk-in">
        ${renderBackLink()}
        <h1>${translate('walk_in_title')}</h1>
        <p class="status-message error" role="alert">${translate('error_loading_data')}</p>
        <button type="button" class="button" id="walk-in-retry">${translate('parent_invitations_retry')}</button>
      </section>
    `);
    document.getElementById('walk-in-retry')?.addEventListener('click', () => this.init());
  }

  /**
   * The line under a child's name saying where their invitation stands.
   *
   * @param {Object|null} invitation - From the API
   * @returns {string} HTML
   */
  invitationLine(invitation) {
    if (!invitation) {
      return `<span class="text-warning">${translate('walk_in_no_invitation')}</span>`;
    }
    const email = escapeHTML(invitation.email);
    if (invitation.state === 'expired') {
      return `${email} — <span class="text-warning">${translate('parent_invitation_state_expired')}</span>`;
    }
    if (!invitation.sent_at) {
      return `${email} — <span class="text-warning">${translate('parent_invitations_not_sent')}</span>`;
    }
    return `${email} — ${translate('parent_invitations_sent_on')} ${escapeHTML(formatDate(invitation.sent_at, this.lang(), SHORT_DATE))}`;
  }

  /**
   * One child waiting for a parent.
   *
   * @param {Object} child - From the API
   * @returns {string} HTML
   */
  renderChild(child) {
    const id = escapeHTML(String(child.id));
    const invitation = child.invitation;
    return `
      <li class="walk-in-child" data-child="${id}">
        <div class="walk-in-child__who">
          <strong>${escapeHTML(`${child.first_name} ${child.last_name}`)}</strong>
          <span class="form-hint">${escapeHTML(formatDate(child.date_naissance, this.lang(), BIRTH_DATE))}</span>
          <span class="form-hint">${this.invitationLine(invitation)}</span>
        </div>
        <div class="walk-in-child__actions">
          <button type="button" class="button button--small button--secondary" data-edit-child="${id}">${translate('edit')}</button>
          <button type="button" class="button button--small button--danger" data-withdraw-child="${id}">${translate('family_child_withdraw')}</button>
          ${invitation ? `
            <button type="button" class="button button--small button--secondary" data-resend="${escapeHTML(invitation.id)}">
              ${translate('parent_invitations_resend')}
            </button>
            <button type="button" class="button button--small button--danger" data-revoke="${escapeHTML(invitation.id)}">${translate('parent_invitations_revoke')}</button>
          ` : ''}
          <button type="button" class="button button--small button--secondary" data-invite="${id}">
            ${translate(invitation ? 'walk_in_change_email' : 'walk_in_invite_parent')}
          </button>
        </div>
        <form class="walk-in-child__invite" data-invite-form="${id}" hidden novalidate>
          <div class="form-group">
            <label for="walk-in-email-${id}">${translate('walk_in_parent_email')}</label>
            <input type="email" id="walk-in-email-${id}" name="parent_email" maxlength="255" autocomplete="off" required />
          </div>
          ${invitationLanguageField(`walk-in-invite-language-${id}`, this.lang())}
          <button type="submit" class="button button--small button--primary">${translate('walk_in_send_invitation')}</button>
        </form>
      </li>
    `;
  }

  /** @returns {void} */
  render() {
    const { today, earliest } = birthDateBounds();
    setContent(this.root(), `
      <section class="page walk-in">
        ${renderBackLink()}
        <h1>${translate('walk_in_title')}</h1>
        <p>${translate('walk_in_intro')}</p>
        <p id="walk-in-status" class="status-message" role="status" hidden></p>

        <form id="walk-in-form" novalidate>
          <div class="form-group">
            <label for="walk-in-first-name">${translate('first_name')}</label>
            <input type="text" id="walk-in-first-name" name="first_name" maxlength="255" autocomplete="off" required />
          </div>
          <div class="form-group">
            <label for="walk-in-last-name">${translate('last_name')}</label>
            <input type="text" id="walk-in-last-name" name="last_name" maxlength="255" autocomplete="off" required />
          </div>
          <div class="form-group">
            <label for="walk-in-birth-date">${translate('date_naissance')}</label>
            <input type="date" id="walk-in-birth-date" name="date_naissance" min="${earliest}" max="${today}" required />
          </div>
          <div class="form-group">
            <label for="walk-in-parent-email">${translate('walk_in_parent_email')}</label>
            <input type="email" id="walk-in-parent-email" name="parent_email" maxlength="255" autocomplete="off" required />
          </div>
          ${invitationLanguageField('walk-in-language', this.lang())}
          <div id="walk-in-override" hidden></div>
          <p id="walk-in-error" class="status-message error" role="alert" hidden></p>
          <div class="walk-in-form__actions">
            <button type="submit" id="walk-in-submit" class="button button--primary">${translate('walk_in_add')}</button>
          </div>
        </form>

        <h2>${translate('walk_in_waiting_title')}</h2>
        ${this.children.length === 0
    ? `<p class="empty-state">${translate('walk_in_waiting_empty')}</p>`
    : `<ul class="walk-in-list">${this.children.map((child) => this.renderChild(child)).join('')}</ul>`}
      </section>
    `);

    this.attachListeners();
  }

  /** @returns {void} */
  attachListeners() {
    const form = document.getElementById('walk-in-form');
    form?.addEventListener('submit', (event) => {
      event.preventDefault();
      this.submitChild(form);
    });

    this.root()?.querySelectorAll('[data-resend]').forEach((button) => {
      button.addEventListener('click', () => this.resend(button.dataset.resend));
    });

    this.root()?.querySelectorAll('[data-edit-child]').forEach((button) => {
      button.addEventListener('click', () => {
        const child = this.children.find((item) => String(item.id) === button.dataset.editChild);
        if (child) {openChildEditor(this, child, updateWalkInChild);}
      });
    });
    this.root()?.querySelectorAll('[data-withdraw-child]').forEach((button) => {
      button.addEventListener('click', () => this.withdraw(Number(button.dataset.withdrawChild)));
    });
    this.root()?.querySelectorAll('[data-revoke]').forEach((button) => {
      button.addEventListener('click', () => {
        const child = this.children.find((item) => item.invitation?.id === button.dataset.revoke);
        if (child) {this.withdraw(child.id, child.invitation.id);}
      });
    });

    this.root()?.querySelectorAll('[data-invite]').forEach((button) => {
      button.addEventListener('click', () => {
        const inviteForm = this.root().querySelector(`[data-invite-form="${button.dataset.invite}"]`);
        if (inviteForm) {
          inviteForm.hidden = !inviteForm.hidden;
          inviteForm.querySelector('input')?.focus();
        }
      });
    });

    this.root()?.querySelectorAll('[data-invite-form]').forEach((inviteForm) => {
      inviteForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const email = inviteForm.querySelector('[name="parent_email"]')?.value.trim() || '';
        this.inviteFor(Number(inviteForm.dataset.inviteForm), email, inviteForm.querySelector('[name="language"]')?.value || this.lang());
      });
    });
  }

  /** Confirm a child withdrawal or an invitation withdrawal before performing it. */
  async withdraw(participantId, invitationId = null) {
    if (this.pendingAction) {return;}
    const child = this.children.find((item) => item.id === participantId);
    if (!child) {return;}
    const accepted = await confirm({
      title: translate(invitationId ? 'parent_invitations_revoke' : 'family_child_withdraw'),
      message: invitationId ? translate('family_walk_in_revoke_confirm')
        : translate('family_child_withdraw_confirm').replace('{name}', `${child.first_name} ${child.last_name}`),
      confirmLabel: translate(invitationId ? 'parent_invitations_revoke' : 'family_child_withdraw'), danger: true,
    });
    if (!accepted) {return;}
    const release = beginFamilyOperation(this);
    if (!release) {return;}
    try {
      await (invitationId ? revokeWalkInInvitation(invitationId) : withdrawWalkInChild(participantId));
      if (await refreshFamilyAfterWrite(this)) {
        this.showStatus(invitationId ? 'parent_invitations_revoked' : 'family_child_withdrawn');
      }
    } catch (err) {
      debugError('Failed to withdraw walk-in record:', err);
      this.showStatus(familyOperationErrorKey(err, 'walk_in_error_failed'), 'error');
    } finally {
      release();
    }
  }

  /**
   * Read the quick-add form.
   *
   * @param {HTMLFormElement} form - The form
   * @returns {Object} Request body
   */
  readChild(form) {
    const value = (name) => form.querySelector(`[name="${name}"]`)?.value.trim() || '';
    return {
      first_name: value('first_name'),
      last_name: value('last_name'),
      date_naissance: value('date_naissance'),
      parent_email: value('parent_email'),
      language: value('language') || this.lang(),
    };
  }

  /**
   * Add the child, reinstating a removed parent only with a written reason.
   *
   * @param {HTMLFormElement} form - The quick-add form
   * @returns {Promise<void>}
   */
  async submitChild(form) {
    if (this.pendingAction) {return;}
    if (!form.reportValidity()) {return;}
    // The last child's confirmation would otherwise sit beside this one's error.
    const status = document.getElementById('walk-in-status');
    if (status) {status.hidden = true;}
    const body = this.readChild(form);
    const problem = childProblem(body);
    if (problem) {
      this.showError(problem);
      return;
    }
    if (!body.parent_email) {
      this.showError('walk_in_error_email_required');
      return;
    }
    if (this.pendingOverride) {
      const reason = document.getElementById('walk-in-reason')?.value.trim() || '';
      if (!reason) {
        this.showError('parent_invitations_reason_required');
        return;
      }
      body.confirm_reactivation = true;
      body.reactivation_reason = reason;
    }

    const release = beginFamilyOperation(this);
    if (!release) {return;}

    try {
      const response = await addWalkInChild(body);
      this.pendingOverride = null;
      form.reset();
      if (!(await refreshFamilyAfterWrite(this, { emailSent: response?.data?.email_sent }))) {return;}
      this.announce(PARENT_MESSAGES[response?.data?.parent] || PARENT_MESSAGES.invited, body, response?.data?.email_sent);
      document.getElementById('walk-in-first-name')?.focus();
    } catch (error) {
      release();
      this.handleRefusal(error, body);
    } finally {
      release();
    }
  }

  /**
   * Invite a parent for a child already on the list, or correct the address.
   *
   * @param {number} participantId - Child
   * @param {string} email - Parent address
   * @returns {Promise<void>}
   */
  async inviteFor(participantId, email, language = this.lang()) {
    if (this.pendingAction) {return;}
    if (!email) {
      this.showStatus('walk_in_error_email_required', 'error');
      return;
    }
    const release = beginFamilyOperation(this);
    if (!release) {return;}
    try {
      const response = await inviteParentForChild(participantId, { parent_email: email, language });
      if (!(await refreshFamilyAfterWrite(this, { emailSent: response?.data?.email_sent }))) {return;}
      this.announce(INVITE_MESSAGES[response?.data?.parent] || INVITE_MESSAGES.invited, null, response?.data?.email_sent);
    } catch (error) {
      debugError('Failed to invite parent for walk-in child:', error);
      const key = {
        already_has_parent: 'walk_in_error_already_has_parent',
        manually_deactivated: 'walk_in_error_removed_member',
      }[error?.code] || 'walk_in_error_failed';
      this.showStatus(familyOperationErrorKey(error, key), 'error');
    } finally {
      release();
    }
  }

  /**
   * Send a fresh link.
   *
   * @param {string} invitationId - Invitation UUID
   * @returns {Promise<void>}
   */
  async resend(invitationId) {
    const release = beginFamilyOperation(this);
    if (!release) {return;}
    try {
      const response = await resendWalkInInvitation(invitationId);
      if (!(await refreshFamilyAfterWrite(this, { emailSent: response?.data?.email_sent }))) {return;}
      this.showStatus(response?.data?.email_sent === false ? 'parent_invitations_created_not_sent' : 'parent_invitations_resent',
        response?.data?.email_sent === false ? 'warning' : 'success');
    } catch (error) {
      debugError('Failed to resend walk-in invitation:', error);
      this.showStatus(familyOperationErrorKey(error, 'walk_in_error_failed'), 'error');
    } finally {
      release();
    }
  }

  /**
   * Explain why the server refused, and offer what can be done about it.
   *
   * @param {Error} error - From the API client, with `code` and `data`
   * @param {Object} body - What was sent
   * @returns {void}
   */
  handleRefusal(error, body) {
    if (error?.code === 'duplicate_child') {
      const existing = error.data?.existing;
      this.showError('walk_in_error_duplicate', existing ? `${existing.first_name} ${existing.last_name}` : '');
      return;
    }
    if (error?.code === 'manually_deactivated') {
      if (error.data?.can_override) {
        this.askForReason(error.data);
      } else {
        this.showError('walk_in_error_removed_member');
      }
      return;
    }
    debugError('Failed to add walk-in child:', error, body);
    this.showError(familyOperationErrorKey(error, 'walk_in_error_failed'));
  }

  /**
   * The parent's address belongs to someone an administrator removed. Show when
   * and why, and ask for a reason before going ahead.
   *
   * @param {Object} details - `deactivated_at`, `deactivated_reason`
   * @returns {void}
   */
  askForReason(details) {
    const panel = document.getElementById('walk-in-override');
    if (!panel) {return;}
    const when = details.deactivated_at
      ? escapeHTML(formatDate(details.deactivated_at, this.lang(), SHORT_DATE))
      : translate('parent_invitations_date_unknown');
    const why = details.deactivated_reason
      ? escapeHTML(details.deactivated_reason)
      : translate('parent_invitations_reason_unknown');
    setContent(panel, `
      <div class="info-card info-card--warning" role="alert">
        <p><strong>${translate('parent_invitations_deactivated_title')}</strong></p>
        <p>${translate('parent_invitations_deactivated_on')} ${when} — ${why}</p>
        <p>${translate('parent_invitations_deactivated_question')}</p>
        <label for="walk-in-reason">${translate('parent_invitations_reason_label')}</label>
        <textarea id="walk-in-reason" rows="3" maxlength="1000" required></textarea>
      </div>
    `);
    panel.hidden = false;
    this.pendingOverride = details;
    const button = document.getElementById('walk-in-submit');
    if (button) {button.textContent = translate('parent_invitations_reinstate_and_send');}
    document.getElementById('walk-in-reason')?.focus();
  }

  /**
   * Say what happened, naming the child the admin just entered -- the admin
   * knows the name; the email never carries it.
   *
   * @param {string} key - Translation key; `{name}` is the child's name
   * @param {Object|null} child - The child submitted, when there was one
   * @param {boolean|null} emailSent - Whether an email left, when one was due
   * @returns {void}
   */
  announce(key, child, emailSent) {
    if (emailSent === false) {
      this.showStatus('walk_in_added_not_sent', 'warning');
      return;
    }
    const name = child ? `${child.first_name} ${child.last_name}` : '';
    this.showStatus(key, 'success', name);
  }

  /**
   * Put a translated error under the form.
   *
   * @param {string} key - Translation key; `{name}` is replaced when given
   * @param {string} [name] - Replacement
   * @returns {void}
   */
  showError(key, name = '') {
    const element = document.getElementById('walk-in-error');
    if (!element) {return;}
    element.textContent = translate(key).split('{name}').join(name);
    element.hidden = false;
  }

  /**
   * Show a message at the top of the page.
   *
   * @param {string} key - Translation key; `{name}` is replaced when given
   * @param {string} [kind] - `success`, `warning` or `error`
   * @param {string} [name] - Replacement
   * @returns {void}
   */
  showStatus(key, kind = 'success', name = '') {
    const element = document.getElementById('walk-in-status');
    if (!element) {return;}
    element.textContent = translate(key).split('{name}').join(name);
    element.className = `status-message ${kind}`;
    element.hidden = false;
    element.scrollIntoView?.({ block: 'nearest' });
  }
}
