/**
 * Volunteering (#1251): what each activity or camp needs, by time slot, and taking a place.
 *
 * Anyone with `volunteers.view` sees upcoming shifts, how many places are left, and takes or
 * gives up their own place; a place is confirmed when the server records it, and the last
 * place goes to one person only. Managers (`volunteers.manage`) add, edit and remove shifts and
 * see who signed up. Nothing here reads a youth, family or health record.
 *
 * @module spa/modules/volunteers/Volunteers
 */
import { translate } from '../../app.js';
import { setContent, withFormBusy, loadStylesheet } from '../../utils/DOMUtils.js';
import { escapeHTML, escapeAttribute } from '../../utils/SecurityUtils.js';
import { hasPermission } from '../../utils/PermissionUtils.js';
import { renderBackLink } from '../../utils/BackLinkUtils.js';
import { formatDate } from '../../utils/DateUtils.js';
import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { openModal } from '../../utils/ModalUtils.js';
import { confirmDestructive } from '../../utils/DialogUtils.js';
import { buildScopedCacheKey } from '../../utils/OfflineCacheKeys.js';
import limits from '../../../config/volunteer_shifts.json';
import {
  getVolunteerShifts, getVolunteerShiftActivities, saveVolunteerShift, deleteVolunteerShift,
  signUpForShift, withdrawFromShift, removeVolunteer,
} from '../../api/api-volunteers.js';
import styles from '../../../css/volunteers.css?url';

/** Server field names, and the form controls that show their errors. */
const FORM_FIELDS = {
  activity_id: 'volunteer_activity', title: 'volunteer_title', shift_date: 'volunteer_date',
  start_time: 'volunteer_start', end_time: 'volunteer_end', slots: 'volunteer_slots', notes: 'volunteer_notes',
};

export class Volunteers {
  /** @param {Object} app - Application instance */
  constructor(app) {
    this.app = app;
    this.shifts = [];
    this.vacantOnly = false;
    this.canManage = hasPermission('volunteers.manage');
    this.destroyed = false;
    this.scope = buildScopedCacheKey('');
  }

  destroy() {
    this.destroyed = true;
  }

  root() { return document.getElementById('app'); }

  lang() { return this.app.lang || 'fr'; }

  /** A late answer must not draw over the next screen, or over another account's or unit's. */
  stale() { return this.destroyed || this.scope !== buildScopedCacheKey(''); }

  async init() {
    loadStylesheet(styles).catch((err) => debugError('Volunteers stylesheet failed', err));
    this.renderLoading();
    try {
      await this.load();
      this.render();
    } catch (err) {
      debugError('Failed to load volunteer shifts:', err);
      this.renderError(err);
    }
  }

  async load() {
    const response = await getVolunteerShifts();
    this.shifts = Array.isArray(response?.data) ? response.data : [];
  }

  header() {
    return `${renderBackLink()}
      <h1>${escapeHTML(translate('volunteers_title'))}</h1>
      <p class="volunteers__intro">${escapeHTML(translate(this.canManage ? 'volunteers_intro_manage' : 'volunteers_intro'))}</p>`;
  }

  renderLoading() {
    setContent(this.root(), `<section class="page volunteers" aria-busy="true">${this.header()}
      <p role="status">${escapeHTML(translate('loading'))}</p></section>`);
  }

  renderError(err) {
    if (this.stale()) { return; }
    setContent(this.root(), `<section class="page volunteers">${this.header()}
      <p class="status-message error" role="alert">${escapeHTML(apiErrorMessage(err, 'error_loading_data'))}</p>
      <button type="button" class="button button--primary" id="volunteers-retry">${escapeHTML(translate('retry'))}</button></section>`);
    this.root().querySelector('#volunteers-retry').addEventListener('click', () => this.init());
  }

  /** @param {Object} shift @returns {number} Places still free */
  free(shift) { return Math.max(0, Number(shift.slots) - Number(shift.taken)); }

  placesText(shift) {
    const free = this.free(shift);
    return free
      ? translate('volunteers_places_free').replace('{free}', String(free)).replace('{slots}', String(shift.slots))
      : translate('volunteers_full');
  }

  shiftMarkup(shift) {
    const id = Number(shift.id);
    const free = this.free(shift);
    const when = translate('volunteers_when')
      .replace('{date}', formatDate(shift.shift_date, this.lang()))
      .replace('{start}', shift.start_time).replace('{end}', shift.end_time);
    let action = '';
    if (shift.mine) {
      action = `<p class="volunteers__mine">${escapeHTML(translate('volunteers_your_place'))}</p>
        <button type="button" class="button button--secondary" data-withdraw="${id}">${escapeHTML(translate('volunteers_withdraw'))}</button>`;
    } else if (free) {
      action = `<button type="button" class="button button--primary" data-sign-up="${id}">${escapeHTML(translate('volunteers_take_place'))}</button>`;
    }
    const names = this.canManage && Array.isArray(shift.volunteers) ? `
      <h4 class="volunteers__names-title">${escapeHTML(translate('volunteers_who'))}</h4>
      ${shift.volunteers.length ? `<ul class="volunteers__names">${shift.volunteers.map((person) => `
        <li><span>${escapeHTML(person.name || translate('tasks_member'))}</span>
          <button type="button" class="button button--ghost button--small" data-remove="${id}" data-user="${escapeAttribute(person.user_id)}"
            aria-label="${escapeAttribute(translate('volunteers_remove_person').replace('{name}', person.name || ''))}">${escapeHTML(translate('remove'))}</button></li>`).join('')}</ul>`
    : `<p>${escapeHTML(translate('volunteers_nobody_yet'))}</p>`}` : '';
    const manage = this.canManage ? `<div class="volunteers__manage">
        <button type="button" class="button button--secondary button--small" data-edit="${id}">${escapeHTML(translate('edit'))}</button>
        <button type="button" class="button button--danger button--small" data-delete="${id}">${escapeHTML(translate('delete'))}</button></div>` : '';
    return `<li class="volunteers__shift ${free ? '' : 'is-full'}">
      <h3>${escapeHTML(shift.title)}</h3>
      <p>${escapeHTML(when)}</p>
      <p class="volunteers__places"><strong>${escapeHTML(this.placesText(shift))}</strong></p>
      ${shift.notes ? `<p class="volunteers__notes">${escapeHTML(shift.notes)}</p>` : ''}
      ${action}${names}${manage}</li>`;
  }

  /** Shifts grouped by their activity, in date order. */
  groupsMarkup() {
    const shown = this.vacantOnly ? this.shifts.filter((shift) => this.free(shift) > 0) : this.shifts;
    if (!this.shifts.length) {
      return `<p class="volunteers__empty">${escapeHTML(translate(this.canManage ? 'volunteers_empty_manage' : 'volunteers_empty'))}</p>`;
    }
    if (!shown.length) {
      return `<p class="volunteers__empty">${escapeHTML(translate('volunteers_all_filled'))}</p>`;
    }
    const groups = new Map();
    shown.forEach((shift) => {
      if (!groups.has(shift.activity_id)) { groups.set(shift.activity_id, []); }
      groups.get(shift.activity_id).push(shift);
    });
    return [...groups.values()].map((shifts) => {
      const [first] = shifts;
      const headingId = `volunteers-activity-${Number(first.activity_id)}`;
      const dates = translate('camp_readiness_upcoming_dates')
        .replace('{from}', formatDate(first.activity_start_date, this.lang()))
        .replace('{to}', formatDate(first.activity_end_date, this.lang()));
      return `<section class="volunteers__activity" aria-labelledby="${headingId}">
        <h2 id="${headingId}">${escapeHTML(first.activity_name)}</h2>
        <p class="volunteers__dates">${first.is_camp ? `<span class="volunteers__chip">${escapeHTML(translate('volunteers_camp'))}</span> ` : ''}${escapeHTML(dates)}</p>
        <ul class="volunteers__shifts">${shifts.map((shift) => this.shiftMarkup(shift)).join('')}</ul></section>`;
    }).join('');
  }

  render() {
    if (this.stale()) { return; }
    const root = this.root();
    setContent(root, `<section class="page volunteers">${this.header()}
      <div class="volunteers__tools">
        ${this.canManage ? `<button type="button" class="button button--primary" id="volunteers-add">${escapeHTML(translate('volunteers_add'))}</button>` : ''}
        <div class="checkbox-option">
          <input type="checkbox" id="volunteers-vacant-only" ${this.vacantOnly ? 'checked' : ''}>
          <label for="volunteers-vacant-only">${escapeHTML(translate('volunteers_vacant_only'))}</label>
        </div>
      </div>
      <div id="volunteers-list">${this.groupsMarkup()}</div></section>`);
    root.querySelector('#volunteers-add')?.addEventListener('click', () => this.openForm());
    root.querySelector('#volunteers-vacant-only').addEventListener('change', (event) => {
      this.vacantOnly = event.target.checked;
      setContent(root.querySelector('#volunteers-list'), this.groupsMarkup());
    });
    // One listener on the list, which the filter redraws but never replaces.
    root.querySelector('#volunteers-list').addEventListener('click', (event) => this.onListClick(event));
  }

  onListClick(event) {
    const button = event.target.closest('button');
    if (!button) { return; }
    const { dataset } = button;
    if (dataset.signUp) { this.act(button, () => signUpForShift(dataset.signUp), 'volunteers_signed_up', 'volunteers_sign_up_failed'); }
    if (dataset.withdraw) { this.act(button, () => withdrawFromShift(dataset.withdraw), 'volunteers_withdrawn', 'volunteers_withdraw_failed'); }
    if (dataset.remove) { this.removePerson(button, dataset.remove, dataset.user); }
    if (dataset.edit) { this.openForm(this.shifts.find((shift) => Number(shift.id) === Number(dataset.edit))); }
    if (dataset.delete) { this.removeShift(button, Number(dataset.delete)); }
  }

  /**
   * Send one change, say how it went, then show the shifts as they now are.
   * A refusal (the shift filled up meanwhile) is explained, and the list is reloaded either way.
   */
  async act(button, request, doneKey, failedKey) {
    button.disabled = true;
    try {
      await request();
      this.app.showMessage(translate(doneKey), 'success');
    } catch (err) {
      debugError('Volunteer change failed:', err);
      this.app.showMessage(apiErrorMessage(err, failedKey), 'error');
    }
    await this.reload();
  }

  async reload() {
    try {
      await this.load();
      this.render();
    } catch (err) {
      debugError('Failed to reload volunteer shifts:', err);
      this.renderError(err);
    }
  }

  async removePerson(button, shiftId, userId) {
    const confirmed = await confirmDestructive({
      title: translate('volunteers_remove_title'), message: translate('volunteers_remove_confirm'),
    });
    if (confirmed) {
      await this.act(button, () => removeVolunteer(shiftId, userId), 'volunteers_removed', 'volunteers_remove_failed');
    }
  }

  async removeShift(button, shiftId) {
    const shift = this.shifts.find((item) => Number(item.id) === shiftId);
    const confirmed = await confirmDestructive({
      title: translate('volunteers_delete_title'),
      message: translate('volunteers_delete_confirm').replace('{title}', shift?.title || ''),
    });
    if (confirmed) {
      await this.act(button, () => deleteVolunteerShift(shiftId), 'volunteers_deleted', 'volunteers_delete_failed');
    }
  }

  /** @param {Object} [shift] - The shift to edit; none to add one */
  async openForm(shift = null) {
    let activities;
    try {
      const response = await getVolunteerShiftActivities();
      activities = Array.isArray(response?.data) ? response.data : [];
    } catch (err) {
      debugError('Failed to load activities for shifts:', err);
      this.app.showMessage(apiErrorMessage(err, 'error_loading_data'), 'error');
      return;
    }
    if (this.stale()) { return; }
    if (shift && !activities.some((item) => Number(item.id) === Number(shift.activity_id))) {
      activities.unshift({ id: shift.activity_id, name: shift.activity_name,
        activity_start_date: shift.activity_start_date, activity_end_date: shift.activity_end_date });
    }
    const option = (item) => `<option value="${Number(item.id)}" data-from="${escapeAttribute(item.activity_start_date)}"
        data-to="${escapeAttribute(item.activity_end_date)}" ${Number(item.id) === Number(shift?.activity_id) ? 'selected' : ''}>
        ${escapeHTML(item.name)} · ${escapeHTML(formatDate(item.activity_start_date, this.lang()))}</option>`;
    const modal = openModal({
      id: 'volunteers-editor',
      title: escapeHTML(translate(shift ? 'volunteers_edit' : 'volunteers_add')),
      closeOnBackdrop: false,
      canClose: () => document.getElementById('volunteers-form')?.getAttribute('aria-busy') !== 'true',
      body: activities.length ? `<form id="volunteers-form" class="volunteers__form" novalidate>
        <label for="volunteers-activity">${escapeHTML(translate('volunteers_activity'))}</label>
        <select id="volunteers-activity" name="volunteer_activity" required>
          <option value="">${escapeHTML(translate('volunteers_choose_activity'))}</option>${activities.map(option).join('')}</select>
        <label for="volunteers-title">${escapeHTML(translate('volunteers_shift_title'))}</label>
        <input id="volunteers-title" name="volunteer_title" required maxlength="${limits.title_max_length}"
          aria-describedby="volunteers-title-help" value="${escapeAttribute(shift?.title || '')}">
        <small class="form-help" id="volunteers-title-help">${escapeHTML(translate('volunteers_shift_title_help'))}</small>
        <label for="volunteers-date">${escapeHTML(translate('volunteers_date'))}</label>
        <input id="volunteers-date" name="volunteer_date" type="date" required value="${escapeAttribute(shift?.shift_date || '')}">
        <div class="volunteers__times">
          <div><label for="volunteers-start">${escapeHTML(translate('volunteers_start'))}</label>
            <input id="volunteers-start" name="volunteer_start" type="time" required value="${escapeAttribute(shift?.start_time || '')}"></div>
          <div><label for="volunteers-end">${escapeHTML(translate('volunteers_end'))}</label>
            <input id="volunteers-end" name="volunteer_end" type="time" required value="${escapeAttribute(shift?.end_time || '')}"></div>
        </div>
        <label for="volunteers-slots">${escapeHTML(translate('volunteers_slots'))}</label>
        <input id="volunteers-slots" name="volunteer_slots" type="number" inputmode="numeric" required min="1" max="${limits.max_slots}"
          value="${escapeAttribute(String(shift?.slots || 1))}">
        <label for="volunteers-notes">${escapeHTML(translate('volunteers_notes'))}</label>
        <textarea id="volunteers-notes" name="volunteer_notes" rows="3" maxlength="${limits.notes_max_length}">${escapeHTML(shift?.notes || '')}</textarea>
        <p id="volunteers-form-error" role="alert" tabindex="-1" hidden></p>
      </form>` : `<p>${escapeHTML(translate('volunteers_no_activity'))}</p>`,
      footer: `<button type="button" class="button button--secondary" data-modal-close>${escapeHTML(translate('cancel'))}</button>
        ${activities.length ? `<button type="submit" class="button button--primary" form="volunteers-form">${escapeHTML(translate('save'))}</button>` : ''}`,
    });
    const form = document.getElementById('volunteers-form');
    if (!form) { return; }
    const limitDates = () => {
      const chosen = form.elements.volunteer_activity.selectedOptions[0];
      form.elements.volunteer_date.min = chosen?.dataset.from || '';
      form.elements.volunteer_date.max = chosen?.dataset.to || '';
    };
    limitDates();
    form.elements.volunteer_activity.addEventListener('change', limitDates);
    form.addEventListener('input', () => this.clearErrors(form));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      withFormBusy(form, () => this.submitForm(form, modal, shift));
    });
  }

  clearErrors(form) {
    form.querySelectorAll('[aria-invalid]').forEach((control) => {
      control.removeAttribute('aria-invalid');
      control.setAttribute('aria-describedby', control.dataset.describedby || '');
      if (!control.dataset.describedby) { control.removeAttribute('aria-describedby'); }
    });
    document.getElementById('volunteers-form-error').hidden = true;
  }

  /** Point the form's message at the fields it is about, and move focus to it. */
  showErrors(form, message, fieldNames) {
    const problem = document.getElementById('volunteers-form-error');
    problem.textContent = message;
    problem.hidden = false;
    fieldNames.forEach((name) => {
      const control = form.elements.namedItem(FORM_FIELDS[name] || '');
      if (control) {
        control.dataset.describedby = control.getAttribute('aria-describedby') || '';
        control.setAttribute('aria-invalid', 'true');
        control.setAttribute('aria-describedby', [control.dataset.describedby, 'volunteers-form-error'].filter(Boolean).join(' '));
      }
    });
    problem.focus();
  }

  /** @returns {Array<string>} Server field names the form cannot send as they are */
  checkForm(payload, form) {
    const date = form.elements.volunteer_date;
    const wrong = [];
    if (!payload.activity_id) { wrong.push('activity_id'); }
    if (!payload.title) { wrong.push('title'); }
    if (!payload.shift_date || (date.min && payload.shift_date < date.min) || (date.max && payload.shift_date > date.max)) { wrong.push('shift_date'); }
    if (!payload.start_time) { wrong.push('start_time'); }
    if (!payload.end_time || payload.end_time <= payload.start_time) { wrong.push('end_time'); }
    if (!Number.isInteger(payload.slots) || payload.slots < 1 || payload.slots > limits.max_slots) { wrong.push('slots'); }
    return wrong;
  }

  async submitForm(form, modal, shift) {
    const value = (name) => form.elements[name].value.trim();
    const payload = {
      activity_id: Number(value('volunteer_activity')) || null, title: value('volunteer_title'),
      shift_date: value('volunteer_date'), start_time: value('volunteer_start'), end_time: value('volunteer_end'),
      slots: Number(value('volunteer_slots')), notes: value('volunteer_notes'),
    };
    const wrong = this.checkForm(payload, form);
    if (wrong.length) {
      this.showErrors(form, translate('volunteers_form_invalid'), wrong);
      return;
    }
    try {
      await saveVolunteerShift(payload, shift?.id || null);
    } catch (err) {
      if (this.stale()) { return; }
      debugError('Failed to save volunteer shift:', err);
      this.showErrors(form, apiErrorMessage(err, 'volunteers_save_failed'), (err.errors || []).map((field) => field.path));
      return;
    }
    form.removeAttribute('aria-busy');
    modal.close();
    if (this.stale()) { return; }
    this.app.showMessage(translate('volunteers_saved'), 'success');
    await this.reload();
  }
}
