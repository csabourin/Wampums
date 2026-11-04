/**
 * Camp lists (#1319): the youth taking part in a planned camp, its team and
 * the volunteers of its shifts, as the camp permit asks for them.
 *
 * Reading takes `meetings.view` and `participants.view` with a unit-wide
 * scope; naming the team takes `meetings.manage`. Nothing here says the camp
 * is compliant: what the lists cannot vouch for, including the comparison with
 * the SISC, is listed under "To check".
 *
 * @module spa/modules/camp-plan/CampRoster
 */
import { translate } from '../../app.js';
import { setContent, loadStylesheet, withFormBusy } from '../../utils/DOMUtils.js';
import { escapeHTML, escapeAttribute } from '../../utils/SecurityUtils.js';
import { renderBackLink } from '../../utils/BackLinkUtils.js';
import { pageLoadingMarkup, pageErrorMarkup } from '../../utils/PageStateUtils.js';
import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { formatDate, getTodayISO } from '../../utils/DateUtils.js';
import { localeForLanguage } from '../../utils/InterfaceLanguageUtils.js';
import { hasPermission, isDemoUser } from '../../utils/PermissionUtils.js';
import { openModal } from '../../utils/ModalUtils.js';
import { confirmDestructive } from '../../utils/DialogUtils.js';
import { volunteerTypeLabel } from '../../utils/VolunteerTypeUtils.js';
import {
  getCampRoster, getCampTeamCandidates, saveCampTeamMember, removeCampTeamMember,
} from '../../api/api-camp-rosters.js';
import rules from '../../../config/camp_team.json';
import styles from '../../../css/camp-plan.css?url';

const BACK_HREF = '/camp-plans';
const MODAL_ID = 'camp-roster-modal';
const FORM_ID = 'camp-roster-member-form';

export class CampRoster {
  /**
   * @param {Object} app - Application instance
   * @param {{meetingId: number}} options
   */
  constructor(app, { meetingId }) {
    this.app = app;
    this.meetingId = meetingId;
    this.data = null;
    this.canManage = hasPermission('meetings.manage') && !isDemoUser();
    this.destroyed = false;
    this.request = 0;
    this.modal = null;
  }

  destroy() {
    this.destroyed = true;
    this.request += 1;
    this.modal?.close(true);
  }

  /** @returns {HTMLElement|null} */
  root() {
    return document.getElementById('app');
  }

  /** @returns {string} */
  lang() {
    return this.app.lang || 'fr';
  }

  /** @returns {string} A count in the interface's number format */
  number(value) {
    return new Intl.NumberFormat(localeForLanguage(this.lang())).format(Number(value) || 0);
  }

  async init() {
    const request = ++this.request;
    loadStylesheet(styles).catch((err) => debugError('Camp plan stylesheet failed', err));
    const options = { title: translate('camp_roster_title'), backHref: BACK_HREF };
    setContent(this.root(), pageLoadingMarkup(options));
    try {
      const response = await getCampRoster(this.meetingId);
      if (this.destroyed || request !== this.request) {
        return;
      }
      const data = response?.data;
      if (!data?.camp || !Array.isArray(data.youth) || !Array.isArray(data.team) || !Array.isArray(data.gaps)) {
        throw new Error('Missing camp roster');
      }
      this.data = data;
      this.render();
    } catch (err) {
      if (this.destroyed || request !== this.request) {
        return;
      }
      debugError('Failed to load the camp roster:', err);
      setContent(this.root(), pageErrorMarkup({ ...options, message: apiErrorMessage(err, 'camp_roster_load_failed'), retryId: 'camp-roster-retry' }));
      this.root().querySelector('#camp-roster-retry')?.addEventListener('click', () => this.init());
    }
  }

  /** @returns {string} A person's name, with the name they go by when there is one */
  personName(name, nickname) {
    const shown = name || translate('camp_roster_unnamed');
    return nickname
      ? translate('camp_roster_name_with_nickname').replace('{name}', shown).replace('{nickname}', nickname)
      : shown;
  }

  /** @returns {string} What the lists cannot vouch for; the SISC comparison is always among them for now */
  gapsMarkup() {
    const items = [...this.data.gaps, 'sisc_not_compared'];
    return `<section class="camp-roster__section" aria-labelledby="camp-roster-gaps">
        <h2 id="camp-roster-gaps">${escapeHTML(translate('camp_roster_to_check'))}</h2>
        <ul class="camp-roster__gaps">${items.map((gap) => `<li>${escapeHTML(translate(`camp_roster_gap_${gap}`))}</li>`).join('')}</ul>
      </section>`;
  }

  /** @returns {string} How the youth list was drawn up */
  consentText() {
    const { consent, scout_year: scoutYear } = this.data;
    if (!scoutYear) {
      return translate('camp_roster_youth_no_year');
    }
    if (!consent?.requested) {
      return translate('camp_roster_youth_whole_unit');
    }
    return translate('camp_roster_youth_consent')
      .replace('{signed}', this.number(consent.signed))
      .replace('{pending}', this.number(consent.pending))
      .replace('{withdrawn}', this.number(consent.withdrawn));
  }

  /** @returns {string} The youth taking part */
  youthMarkup() {
    const { youth } = this.data;
    const count = translate('camp_roster_youth_count').replace('{count}', this.number(youth.length));
    const rows = youth.map((person) => {
      const name = this.personName(`${person.first_name || ''} ${person.last_name || ''}`.trim(), person.nickname);
      const age = Number.isInteger(person.age_at_camp)
        ? translate('camp_roster_age_years').replace('{age}', this.number(person.age_at_camp))
        : translate('camp_roster_age_unknown');
      return `<tr>
          <td data-label="${escapeAttribute(translate('camp_roster_column_name'))}">${escapeHTML(name)}</td>
          <td data-label="${escapeAttribute(translate('camp_roster_column_age'))}">${escapeHTML(age)}</td>
        </tr>`;
    }).join('');
    const table = youth.length
      ? `<table class="mobile-labeled-table camp-roster__table">
          <caption class="sr-only">${escapeHTML(translate('camp_roster_youth'))}</caption>
          <thead><tr>
            <th scope="col">${escapeHTML(translate('camp_roster_column_name'))}</th>
            <th scope="col">${escapeHTML(translate('camp_roster_column_age'))}</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>`
      : `<p class="camp-plan__empty">${escapeHTML(translate('camp_roster_youth_empty'))}</p>`;
    return `<section class="camp-roster__section" aria-labelledby="camp-roster-youth">
        <h2 id="camp-roster-youth">${escapeHTML(translate('camp_roster_youth'))}</h2>
        <p><strong>${escapeHTML(count)}</strong></p>
        <p>${escapeHTML(this.consentText())}</p>
        ${table}
      </section>`;
  }

  /** @returns {string} A team member's age on the camp's first day, in words */
  ageStatusText(member) {
    return translate(`camp_roster_age_status_${member.age_status}`);
  }

  /** @returns {string} One member of the team */
  memberMarkup(member) {
    const name = this.personName(member.name, member.nickname);
    const left = member.active_member ? '' : `<p class="camp-roster__warning">${escapeHTML(translate('camp_roster_member_left'))}</p>`;
    const actions = this.canManage
      ? `<div class="camp-plan__actions">
          <button type="button" class="button button--secondary button--small" data-edit-member="${escapeAttribute(member.user_id)}">${escapeHTML(translate('edit'))}<span class="sr-only"> : ${escapeHTML(name)}</span></button>
          <button type="button" class="button button--danger button--small" data-remove-member="${escapeAttribute(member.user_id)}">${escapeHTML(translate('camp_roster_remove'))}<span class="sr-only"> : ${escapeHTML(name)}</span></button>
        </div>`
      : '';
    return `<li class="camp-roster__member" data-member="${escapeAttribute(member.user_id)}">
        <p class="camp-roster__member-name"><strong>${escapeHTML(name)}</strong></p>
        <p>${escapeHTML(translate(`camp_roster_role_${member.team_role}`))} · ${escapeHTML(this.ageStatusText(member))}</p>
        ${left}
        ${actions}
      </li>`;
  }

  /** @returns {string} The camp's named team */
  teamMarkup() {
    const { team } = this.data;
    const add = this.canManage
      ? `<button type="button" class="button button--primary" id="camp-roster-add">${escapeHTML(translate('camp_roster_add_member'))}</button>`
      : '';
    const list = team.length
      ? `<ul class="camp-roster__list">${team.map((member) => this.memberMarkup(member)).join('')}</ul>`
      : `<p class="camp-plan__empty">${escapeHTML(translate('camp_roster_team_empty'))}</p>`;
    return `<section class="camp-roster__section" aria-labelledby="camp-roster-team">
        <h2 id="camp-roster-team">${escapeHTML(translate('camp_roster_team'))}</h2>
        ${list}
        ${add}
      </section>`;
  }

  /** @returns {string} The volunteers of the camp's shifts: names for volunteer managers only */
  volunteersMarkup() {
    const { volunteers } = this.data;
    const count = Number(volunteers?.count) || 0;
    let body;
    if (!count) {
      body = `<p class="camp-plan__empty">${escapeHTML(translate('camp_roster_volunteers_empty'))}</p>`;
    } else if (Array.isArray(volunteers.people)) {
      body = `<ul class="camp-roster__list">${volunteers.people.map((person) => {
        const types = (person.types || []).map((type) => volunteerTypeLabel(type)).join(', ');
        const state = person.pending ? ` · ${translate('camp_roster_volunteer_pending')}` : '';
        return `<li class="camp-roster__member"><p><strong>${escapeHTML(this.personName(person.name, person.nickname))}</strong></p>
            <p>${escapeHTML(`${types}${state}`)}</p></li>`;
      }).join('')}</ul>`;
    } else {
      body = `<p>${escapeHTML(translate('camp_roster_volunteers_count').replace('{count}', this.number(count)))}</p>`;
    }
    return `<section class="camp-roster__section" aria-labelledby="camp-roster-volunteers">
        <h2 id="camp-roster-volunteers">${escapeHTML(translate('camp_roster_volunteers'))}</h2>
        ${body}
      </section>`;
  }

  render() {
    if (this.destroyed || !this.data) {
      return;
    }
    const { camp } = this.data;
    const name = camp.theme || translate('camp_readiness_camp');
    const dates = translate('camp_readiness_upcoming_dates')
      .replace('{from}', formatDate(camp.date_from, this.lang())).replace('{to}', formatDate(camp.date_to, this.lang()));
    const cancelled = camp.is_cancelled
      ? `<p class="camp-roster__warning" role="note">${escapeHTML(translate('camp_roster_cancelled'))}</p>` : '';
    setContent(this.root(), `<section class="page camp-plan camp-roster">
        ${renderBackLink(BACK_HREF)}
        <h1>${escapeHTML(translate('camp_roster_title'))}</h1>
        <p class="camp-plan__intro"><strong>${escapeHTML(name)}</strong> · ${escapeHTML(dates)}</p>
        ${cancelled}
        <p class="camp-plan__intro">${escapeHTML(translate('camp_roster_intro'))}</p>
        ${this.gapsMarkup()}
        ${this.youthMarkup()}
        ${this.teamMarkup()}
        ${this.volunteersMarkup()}
      </section>`);
    this.bind();
  }

  bind() {
    const root = this.root();
    root.querySelector('#camp-roster-add')?.addEventListener('click', () => this.openMemberForm(null));
    root.querySelectorAll('[data-edit-member]').forEach((button) => {
      button.addEventListener('click', () => this.openMemberForm(button.dataset.editMember));
    });
    root.querySelectorAll('[data-remove-member]').forEach((button) => {
      button.addEventListener('click', () => this.removeMember(button.dataset.removeMember));
    });
  }

  /**
   * Open the form naming a member to the team, or changing their role.
   * @param {string|null} userId - The member edited, or null to add one
   */
  async openMemberForm(userId) {
    const member = userId ? this.data.team.find((entry) => entry.user_id === userId) : null;
    let candidates = [];
    if (!member) {
      try {
        const response = await getCampTeamCandidates(this.meetingId);
        if (this.destroyed) {
          return;
        }
        const named = new Set(this.data.team.map((entry) => entry.user_id));
        candidates = (Array.isArray(response?.data) ? response.data : []).filter((entry) => !named.has(entry.user_id));
      } catch (err) {
        debugError('Failed to load the team candidates:', err);
        this.app.showMessage(apiErrorMessage(err, 'camp_roster_candidates_failed'), 'error');
        return;
      }
      if (!candidates.length) {
        this.app.showMessage(translate('camp_roster_no_candidates'), 'info');
        return;
      }
    }
    const who = member
      ? `<p><strong>${escapeHTML(this.personName(member.name, member.nickname))}</strong></p>`
      : `<div class="form-group">
          <label for="camp-roster-member">${escapeHTML(translate('camp_roster_member'))}</label>
          <select id="camp-roster-member" name="member" required aria-describedby="camp-roster-member-error">
            ${candidates.map((entry) => `<option value="${escapeAttribute(entry.user_id)}">${escapeHTML(this.personName(entry.name, entry.nickname))}</option>`).join('')}
          </select>
          <p class="field-error" id="camp-roster-member-error" role="alert"></p>
        </div>`;
    const roles = rules.team_roles.map((role) => `<option value="${escapeAttribute(role)}"${member?.team_role === role ? ' selected' : ''}>${escapeHTML(translate(`camp_roster_role_${role}`))}</option>`).join('');
    const body = `<form id="${FORM_ID}" novalidate>
        ${who}
        <div class="form-group">
          <label for="camp-roster-role">${escapeHTML(translate('camp_roster_team_role'))}</label>
          <select id="camp-roster-role" name="team_role" aria-describedby="camp-roster-role-error">${roles}</select>
          <p class="field-error" id="camp-roster-role-error" role="alert"></p>
        </div>
        <div class="form-group">
          <label for="camp-roster-birth">${escapeHTML(translate('camp_roster_birth_date'))}</label>
          <input type="date" id="camp-roster-birth" name="date_of_birth" value="${escapeAttribute(member?.date_of_birth || '')}"
            aria-describedby="camp-roster-birth-help camp-roster-birth-error">
          <p class="form-help" id="camp-roster-birth-help">${escapeHTML(translate('camp_roster_birth_date_help'))}</p>
          <p class="field-error" id="camp-roster-birth-error" role="alert"></p>
        </div>
      </form>`;
    const footer = `<button type="button" class="button button--secondary" data-modal-close>${escapeHTML(translate('cancel'))}</button>
      <button type="submit" class="button button--primary" form="${FORM_ID}">${escapeHTML(translate('save'))}</button>`;
    let saving = false;
    this.modal = openModal({
      id: MODAL_ID,
      title: escapeHTML(translate(member ? 'camp_roster_edit_member' : 'camp_roster_add_member')),
      body,
      footer,
      closeOnBackdrop: false,
      canClose: () => !saving,
      onClose: () => { this.modal = null; },
    });
    const form = this.modal.dialog.querySelector(`#${FORM_ID}`);
    form.querySelectorAll('select, input').forEach((field) => {
      field.addEventListener('input', () => this.clearFieldError(form, field));
      field.addEventListener('change', () => this.clearFieldError(form, field));
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      withFormBusy(form, async () => {
        saving = true;
        try {
          await this.saveMember(form, member);
        } finally {
          saving = false;
        }
      });
    });
  }

  /** Clear the message tied to a field once the person changes it. */
  clearFieldError(form, field) {
    field.removeAttribute('aria-invalid');
    const error = form.querySelector(`#${field.id}-error`);
    if (error) {
      error.textContent = '';
    }
  }

  /** Show a refusal next to the field it is about. */
  showFieldError(form, fieldId, message) {
    const field = form.querySelector(`#${fieldId}`);
    const error = form.querySelector(`#${fieldId}-error`);
    if (field && error) {
      field.setAttribute('aria-invalid', 'true');
      error.textContent = message;
      field.focus();
      return true;
    }
    return false;
  }

  /** Send the form; a field refusal stays in the form, next to its field. */
  async saveMember(form, member) {
    const userId = member ? member.user_id : form.querySelector('#camp-roster-member')?.value;
    const birth = form.querySelector('#camp-roster-birth').value;
    if (birth && birth > getTodayISO()) {
      this.showFieldError(form, 'camp-roster-birth', translate('camp_roster_birth_date_invalid'));
      return;
    }
    const payload = { team_role: form.querySelector('#camp-roster-role').value };
    // Editing shows the recorded date, so emptying it clears it. Adding shows none (another camp may
    // have recorded one on the account), so an empty field sends nothing and the account keeps its own.
    if (birth || member) {
      payload.date_of_birth = birth || null;
    }
    try {
      await saveCampTeamMember(this.meetingId, userId, payload);
      if (this.destroyed) {
        return;
      }
      this.app.showMessage(translate('camp_roster_team_saved'), 'success');
      this.modal?.close(true);
      // A reload that fails after the save shows its own retry; the toast already said it was saved.
      await this.init();
    } catch (err) {
      debugError('Failed to save the camp team member:', err);
      const fields = { team_role: 'camp-roster-role', date_of_birth: 'camp-roster-birth', user_id: 'camp-roster-member' };
      const fieldError = Array.isArray(err?.errors) ? err.errors.find((entry) => fields[entry.path]) : null;
      const message = apiErrorMessage(err, 'camp_roster_save_failed');
      if (!fieldError || !this.showFieldError(form, fields[fieldError.path], message)) {
        this.app.showMessage(message, 'error');
      }
    }
  }

  /** Take a member off the team, once confirmed. */
  async removeMember(userId) {
    const member = this.data.team.find((entry) => entry.user_id === userId);
    if (!member) {
      return;
    }
    const confirmed = await confirmDestructive({
      title: translate('camp_roster_remove_title'),
      message: translate('camp_roster_remove_confirm').replace('{name}', this.personName(member.name, member.nickname)),
      confirmLabel: translate('camp_roster_remove'),
    });
    if (!confirmed || this.destroyed) {
      return;
    }
    try {
      await removeCampTeamMember(this.meetingId, userId);
      if (this.destroyed) {
        return;
      }
      this.app.showMessage(translate('camp_roster_team_removed'), 'success');
      await this.init();
    } catch (err) {
      debugError('Failed to remove the camp team member:', err);
      this.app.showMessage(apiErrorMessage(err, 'camp_roster_save_failed'), 'error');
    }
  }
}
