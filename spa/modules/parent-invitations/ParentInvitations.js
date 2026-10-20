/**
 * Invitations — where an administrator hands a family, or someone joining the
 * team, the means to register themselves. The invitation names the role the
 * person will hold: a family role lets them register their children, a team
 * role opens the unit's tools to them. Roles the unit hid are not offered.
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
import { apiErrorMessageKey } from '../../utils/ApiErrorUtils.js';
import { roleLabel } from '../../utils/RoleLabelUtils.js';
import { formatDate } from '../../utils/DateUtils.js';
import { openModal, closeModal } from '../../utils/ModalUtils.js';
import { confirm } from '../../utils/DialogUtils.js';
import {
  getParentInvitations,
  getInvitationRoles,
  createParentInvitation,
  updateParentInvitation,
  resendParentInvitation,
  revokeParentInvitation,
} from '../../api/api-parent-invitations.js';
import { renderBackLink } from '../../utils/BackLinkUtils.js';

import { familyOperationErrorKey, beginFamilyOperation, refreshFamilyAfterWrite, invitationLanguageField } from '../family-access/operations.js';

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

/** Role data scope of family roles, as the role picker groups them. */
const FAMILY_SCOPE = 'linked';

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
    this.roles = [];
    this.destroyed = false;
    // Naming a role other than the unit's parent role also takes
    // users.assign_roles; the role list says which the member may grant.
    this.canInvite = hasPermission('users.invite');
  }

  /** Called by the router when the person leaves this screen. */
  destroy() {
    this.destroyed = true;
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
    const [response, rolesResponse] = await Promise.all([
      getParentInvitations({ kind: 'all' }),
      this.canInvite ? getInvitationRoles() : null,
    ]);
    this.invitations = Array.isArray(response?.data) ? response.data : [];
    this.roles = Array.isArray(rolesResponse?.data) ? rolesResponse.data : [];
  }

  /** @returns {Object|undefined} The unit's parent role, granted by an invitation naming none */
  defaultFamilyRole() {
    return this.roles.find((role) => role.default_family);
  }

  /**
   * The role an invitation grants, as the list shows it.
   *
   * @param {Object} invitation - Row from the API
   * @returns {string} Escaped role names
   */
  invitationRoleText(invitation) {
    const named = Array.isArray(invitation.roles) ? invitation.roles : [];
    if (named.length > 0) {
      return named.map((role) => escapeHTML(roleLabel(role))).join(', ');
    }
    const family = this.defaultFamilyRole();
    return escapeHTML(family ? roleLabel(family) : translate('invitations_role_family'));
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
        ${renderBackLink()}
        <h1>${translate('invitations_title')}</h1>
        <p role="status">${translate('loading')}</p>
      </section>
    `);
  }

  /** @returns {void} */
  renderError() {
    if (this.destroyed) {return;}
    setContent(this.root(), `
      <section class="page parent-invitations">
        ${renderBackLink()}
        <h1>${translate('invitations_title')}</h1>
        <p class="status-message error" role="alert">${translate('error_loading_data')}</p>
        <button type="button" class="button" id="parent-invitations-retry">${translate('parent_invitations_retry')}</button>
      </section>
    `);
    document.getElementById('parent-invitations-retry')?.addEventListener('click', () => this.init());
  }

  /** @returns {void} */
  render() {
    if (this.destroyed) {return;}
    setContent(this.root(), `
      <section class="page parent-invitations">
        ${renderBackLink()}
        <header class="page__header">
          <h1>${translate('invitations_title')}</h1>
          ${this.canInvite ? `
            <button type="button" id="invite-parent-btn" class="button button--primary">
              ${translate('invitations_invite')}
            </button>
          ` : ''}
        </header>
        <p>${translate('invitations_intro')}</p>
        <p id="parent-invitations-status" class="status-message" role="status" hidden></p>
        ${this.invitations.length === 0
    ? `<p class="empty-state">${translate('invitations_empty')}</p>`
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
        ${Array.isArray(invitation.children) && invitation.children.length > 0 ? `
          <div class="invitation-card__meta">
            ${translate('parent_invitations_for_children')}
            ${invitation.children.map((child) => escapeHTML(`${child.first_name} ${child.last_name}`)).join(', ')}
          </div>
        ` : ''}
        <div class="invitation-card__meta">
          ${translate('invitations_role_label')} ${this.invitationRoleText(invitation)}
        </div>
        ${invitation.deactivation_override_reason ? `
          <div class="invitation-card__meta">
            ${translate('parent_invitations_reinstating')}: ${escapeHTML(invitation.deactivation_override_reason)}
          </div>
        ` : ''}
        ${canAct ? `
          <div class="invitation-card__actions">
            <button type="button" class="button button--small button--secondary" data-action="edit" data-id="${escapeHTML(invitation.id)}">
              ${translate('edit')}
            </button>
            <button type="button" class="button button--small button--secondary" data-action="resend" data-id="${escapeHTML(invitation.id)}">
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
        if (action === 'edit') {
          this.openInviteForm(this.invitations.find((invitation) => invitation.id === id));
        } else if (action === 'resend') {
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
    if (!element) {return;}
    element.textContent = translate(key);
    element.className = `status-message ${kind}`;
    element.hidden = false;
  }

  /**
   * The invitation form, in a modal.
   *
   * @returns {void}
   */
  openInviteForm(invitation = null) {
    if (this.pendingAction) {return;}
    this.editingInvitationId = invitation?.id || null;
    const field = (name, type, labelKey, extra = '') => `
      <div class="form-group">
        <label for="invite-${name}">${translate(labelKey)}</label>
        <input type="${type}" id="invite-${name}" name="${name}" value="${escapeHTML(invitation?.[name] || '')}" ${extra} />
      </div>
    `;

    openModal({
      id: MODAL_ID,
      canClose: () => !this.pendingAction,
      title: translate(invitation ? 'family_invitation_edit' : 'invitations_invite'),
      body: `
        <form id="parent-invitation-form" novalidate>
          ${field('email', 'email', 'email', 'required autocomplete="off" maxlength="255"')}
          ${invitationLanguageField('invite-language', invitation?.language || this.lang())}
          ${invitation
    ? `<p class="form-hint">${translate('invitations_role_label')} ${this.invitationRoleText(invitation)}</p>
             <p class="form-hint">${translate('family_invitation_edit_hint')}</p>`
    : this.renderRoleField()}
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
        <button type="button" class="button button--secondary" data-modal-close>${translate('cancel')}</button>
        <button type="button" id="parent-invitation-submit" class="button button--primary">
          ${translate(invitation ? 'family_invitation_save_send' : 'parent_invitations_send')}
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
      if (form) {this.submitInvitation(form);}
    });
  }

  /**
   * The role the invited person will hold, families' roles first, then the
   * team's. Roles the member may not grant are listed, disabled, so the choice
   * is honest about what exists. The unit's parent role is proposed first.
   *
   * @returns {string} HTML
   */
  renderRoleField() {
    const assignable = this.roles.filter((role) => role.assignable);
    const preferred = this.defaultFamilyRole() || assignable[0];
    if (!preferred) {
      return `<p class="status-message warning" role="alert">${translate('invitations_no_role')}</p>`;
    }
    const option = (role) => `
      <option value="${Number(role.id)}" ${role.id === preferred.id ? 'selected' : ''} ${role.assignable ? '' : 'disabled'}>
        ${escapeHTML(roleLabel(role))}${role.assignable ? '' : ` — ${escapeHTML(translate('invitations_role_unavailable'))}`}
      </option>`;
    const group = (labelKey, roles) => (roles.length
      ? `<optgroup label="${escapeHTML(translate(labelKey))}">${roles.map(option).join('')}</optgroup>` : '');
    return `
      <div class="form-group">
        <label for="invite-role">${translate('invitations_role')}</label>
        <select id="invite-role" name="role_id" required aria-describedby="invite-role-hint">
          ${group('invitations_role_group_family', this.roles.filter((role) => role.data_scope === FAMILY_SCOPE))}
          ${group('invitations_role_group_team', this.roles.filter((role) => role.data_scope !== FAMILY_SCOPE))}
        </select>
        <p class="form-hint" id="invite-role-hint">${translate('invitations_role_hint')}</p>
      </div>
    `;
  }

  /**
   * Read the form into the request body.
   *
   * @param {HTMLFormElement} form - The invitation form
   * @returns {Object} Request body
   */
  readInvitation(form) {
    const value = (name) => form.querySelector(`[name="${name}"]`)?.value.trim() || '';
    const body = { email: value('email'), language: value('language') };
    OPTIONAL_FIELDS.forEach((name) => {
      const entered = value(name);
      if (entered || this.editingInvitationId) {body[name] = entered || null;}
    });
    if (!this.editingInvitationId) {
      // The unit's parent role is granted by a family invitation naming none.
      const role = this.roles.find((candidate) => candidate.id === Number(value('role_id')));
      this.roleChosen = Boolean(role);
      if (role && !role.default_family) {
        body.role_ids = [role.id];
      }
    }
    return body;
  }

  /**
   * Send the invitation, or the confirmed reinstatement.
   *
   * @param {HTMLFormElement} form - The invitation form
   * @returns {Promise<void>}
   */
  async submitInvitation(form) {
    if (this.pendingAction) {return;}
    const body = this.readInvitation(form);
    if (!body.email) {
      this.showFormError('parent_invitations_email_required');
      return;
    }
    if (!this.editingInvitationId && !this.roleChosen) {
      this.showFormError('invitations_no_role');
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
    if (!form.reportValidity()) {return;}

    const release = beginFamilyOperation(this);
    if (!release) {return;}

    try {
      const response = await (this.editingInvitationId
        ? updateParentInvitation(this.editingInvitationId, body) : createParentInvitation(body));
      closeModal(MODAL_ID);
      if (!(await refreshFamilyAfterWrite(this, { emailSent: response?.data?.email_sent }))) {return;}
      if (response?.data?.email_sent === false) {
        this.showStatus('parent_invitations_created_not_sent', 'warning');
      } else {
        this.showStatus('parent_invitations_sent');
      }
    } catch (error) {
      if (error?.code === 'manually_deactivated') {
        release();
        this.askToReinstate(error.data || {});
        return;
      }
      debugError('Failed to invite parent:', error);
      // A refused role is a refusal, not a failure: say which
      this.showFormError(familyOperationErrorKey(error, CONFLICT_MESSAGES[error?.code]
        || apiErrorMessageKey(error, 'parent_invitations_failed')));
    } finally {
      release();
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
    if (!panel) {return;}

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
    if (submit) {submit.textContent = translate('parent_invitations_reinstate_and_send');}
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
    if (!element) {return;}
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
    const release = beginFamilyOperation(this);
    if (!release) {return;}
    try {
      const response = await resendParentInvitation(invitationId);
      if (!(await refreshFamilyAfterWrite(this, { emailSent: response?.data?.email_sent }))) {return;}
      this.showStatus(
        response?.data?.email_sent === false ? 'parent_invitations_created_not_sent' : 'parent_invitations_resent',
        response?.data?.email_sent === false ? 'warning' : 'success'
      );
    } catch (error) {
      debugError('Failed to resend invitation:', error);
      this.showStatus(familyOperationErrorKey(error, 'parent_invitations_failed'), 'error');
    } finally {
      release();
    }
  }

  /**
   * Withdraw an invitation, after asking.
   *
   * @param {string} invitationId - Invitation UUID
   * @returns {Promise<void>}
   */
  async revoke(invitationId) {
    if (this.pendingAction) {return;}
    const confirmed = await confirm({
      title: translate('parent_invitations_revoke'),
      message: translate('parent_invitations_revoke_confirm'),
      confirmLabel: translate('parent_invitations_revoke'),
      danger: true,
    });
    if (!confirmed) {return;}
    const release = beginFamilyOperation(this);
    if (!release) {return;}

    try {
      await revokeParentInvitation(invitationId);
      if (!(await refreshFamilyAfterWrite(this))) {return;}
      this.showStatus('parent_invitations_revoked');
    } catch (error) {
      debugError('Failed to revoke invitation:', error);
      this.showStatus(familyOperationErrorKey(error, 'parent_invitations_failed'), 'error');
    } finally {
      release();
    }
  }
}
