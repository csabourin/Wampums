// CampSchedule.js
// Responsive editor for the per-day programme of a multi-day planner block.
import { translate } from '../../app.js';
import { BaseModule } from '../../utils/BaseModule.js';
import { setContent, withFormBusy } from '../../utils/DOMUtils.js';
import { escapeHTML, escapeAttribute } from '../../utils/SecurityUtils.js';
import { formatDate } from '../../utils/DateUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { openModal } from '../../utils/ModalUtils.js';
import { confirmDestructive } from '../../utils/DialogUtils.js';
import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';
import { hasOrganizationScope, hasPermission } from '../../utils/PermissionUtils.js';
import { getMaterialOptions } from '../../api/api-equipment-catalog.js';
import { getCampTeamCandidates } from '../../api/api-camp-rosters.js';
import { MaterialItemsField, renderMaterialItemsList } from '../equipment-catalog/MaterialItemsField.js';
import {
  getMeetingSchedule,
  updateMeetingDay,
  addMeetingActivity,
  updateMeetingActivity,
  deleteMeetingActivity
} from '../../api/api-yearly-planner.js';
import { CampDuplication } from './CampDuplication.js';
import { DATE_PART_WIDTH, TIME_HH_MM_LENGTH } from '../../utils/TimeUnits.js';

/** Add minutes to an HH:MM time without crossing beyond one day. */
function addMinutes(time, duration) {
  const match = String(time || '').match(/^(\d{2}):(\d{2})/);
  if (!match) {
    return '';
  }
  const total = Math.min(1439, (Number(match[1]) * 60) + Number(match[2]) + (Number(duration) || 0));
  return `${String(Math.floor(total / 60)).padStart(DATE_PART_WIDTH, '0')}:${String(total % 60).padStart(DATE_PART_WIDTH, '0')}`;
}

/** Longest logistic notes a line keeps, as the server checks (#1417). */
const NOTES_MAX_LENGTH = 4000;
/** How many members one line may name, as the server checks. */
const MAX_LEADERS = 10;
const HTTP_CONFLICT = 409;

/** Format a database time as HH:MM. */
function shortTime(value) {
  return value ? String(value).slice(0, TIME_HH_MM_LENGTH) : '';
}

export class CampSchedule extends BaseModule {
  constructor(app, { chip, lang, canManage, onChanged = null }) {
    super(app);
    this.chip = chip;
    this.lang = lang;
    this.canManage = canManage;
    this.onChanged = onChanged;
    this.schedule = null;
    this.dayOffset = 0;
    this.quickEdit = false;
    this.changed = false;
    this.modal = null;
    // What the unit has or may use; null until loaded, or when it could not be.
    this.materialChoices = null;
    this.itemFields = new Map();
    // Who may lead a line (#1417): the unit's team members; null until loaded, or when they could not be.
    this.leaderCandidates = null;
  }

  /** Load and open the camp schedule editor. */
  async open() {
    this.modal = openModal({
      id: 'yp-camp-schedule',
      title: escapeHTML(translate('yearly_planner_camp_schedule')),
      body: `<div class="loading-spinner" role="status"><span class="sr-only">${escapeHTML(translate('loading'))}</span></div>`,
      footer: `
        ${hasOrganizationScope() && hasPermission('meetings.view') ? `<a class="button button--secondary" href="/camp-readiness/${Number(this.chip.meetingId)}">${escapeHTML(translate('camp_readiness_title'))}</a>` : ''}
        ${hasPermission('meetings.view') ? `<a class="button button--secondary" href="/camp-site/${Number(this.chip.meetingId)}">${escapeHTML(translate('camp_site_open'))}</a>` : ''}
        ${hasPermission('meetings.view') ? `<a class="button button--secondary" href="/camp-plan/${Number(this.chip.meetingId)}">${escapeHTML(translate('camp_plan_open'))}</a>` : ''}
        ${hasPermission('camp_lots.view') ? `<a class="button button--secondary" href="/camp-lots/${Number(this.chip.meetingId)}">${translate('camp_lots_open')}</a>` : ''}
        ${hasPermission('personal_equipment.manage') ? `<a class="button button--secondary" href="/personal-equipment/${Number(this.chip.meetingId)}/manage">${escapeHTML(translate('personal_equipment_manage'))}</a>` : ''}
        <a class="button button--secondary" href="/camp-material/${Number(this.chip.meetingId)}">${escapeHTML(translate('camp_material_open'))}</a>
        <button type="button" class="button button--secondary" data-modal-close>${escapeHTML(translate('close'))}</button>
      `,
      onClose: () => {
        this.destroy();
        if (this.changed) {
          this.onChanged?.();
        }
      }
    });
    if (this.canManage) {
      await Promise.all([this.loadMaterialChoices(), this.loadLeaderCandidates()]);
    }
    await this.reload();
  }

  /**
   * Load what a schedule line may list: catalogue articles and the inventory
   * the unit may use. Without it, the lines keep what they list and only the
   * free-text material can be edited.
   */
  async loadMaterialChoices() {
    try {
      const response = await getMaterialOptions();
      this.materialChoices = response?.data || null;
    } catch (err) {
      debugError('Error loading the unit material:', err);
      this.materialChoices = null;
    }
  }

  /**
   * Load the members a line may name as in charge. Without them, a line keeps
   * the members it names and only the free-text field can be edited.
   */
  async loadLeaderCandidates() {
    if (!hasOrganizationScope()) {
      return;
    }
    try {
      const response = await getCampTeamCandidates(this.chip.meetingId);
      this.leaderCandidates = Array.isArray(response?.data) ? response.data : null;
    } catch (err) {
      debugError('Error loading the members who may lead a line:', err);
      this.leaderCandidates = null;
    }
  }

  /**
   * The members a line may name: the camp's team first, then the unit's other
   * team members, then anyone the line already names who is no longer offered.
   *
   * @param {Object[]} leaders - The line's members in charge
   * @returns {{user_id: string, name: string, checked: boolean, left: boolean}[]}
   */
  leaderChoices(leaders = []) {
    const named = new Map(leaders.map((leader) => [leader.user_id, leader]));
    const team = new Set(this.schedule?.team_user_ids || []);
    const offered = [...(this.leaderCandidates || [])]
      .sort((a, b) => Number(team.has(b.user_id)) - Number(team.has(a.user_id)));
    const choices = offered.map((member) => ({
      user_id: member.user_id, name: member.name, checked: named.has(member.user_id), left: false,
    }));
    leaders.filter((leader) => !offered.some((member) => member.user_id === leader.user_id))
      .forEach((leader) => choices.push({ user_id: leader.user_id, name: leader.name, checked: true, left: !leader.active_member }));
    return choices;
  }

  /**
   * The members in charge of a line being edited, as checkboxes (no dragging).
   *
   * @param {string} idPrefix - Unique prefix for the field's ids
   * @param {Object[]} leaders - The line's members in charge
   * @returns {string} HTML, or nothing when the members could not be loaded
   */
  leadersFieldset(idPrefix, leaders = []) {
    if (!this.leaderCandidates) {
      return '';
    }
    const choices = this.leaderChoices(leaders);
    const body = choices.length
      ? choices.map((choice, index) => `
          <label class="yp-schedule-leaders__choice" for="${idPrefix}-${index}">
            <input type="checkbox" id="${idPrefix}-${index}" value="${escapeAttribute(choice.user_id)}" ${choice.checked ? 'checked' : ''}>
            <span>${escapeHTML(choice.name)}${choice.left ? ` <span class="yp-schedule-leaders__left">${escapeHTML(translate('yearly_planner_leader_left'))}</span>` : ''}</span>
          </label>`).join('')
      : `<p>${escapeHTML(translate('yearly_planner_leaders_none'))}</p>`;
    return `<fieldset class="yp-schedule-leaders" data-leaders="${idPrefix}" aria-describedby="${idPrefix}-hint">
        <legend>${escapeHTML(translate('yearly_planner_leaders'))}</legend>
        <p class="field-hint" id="${idPrefix}-hint">${escapeHTML(translate('yearly_planner_leaders_hint'))}</p>
        ${body}
        <p class="field-error" id="${idPrefix}-error" role="alert" hidden></p>
      </fieldset>`;
  }

  /**
   * Read the members chosen in a leaders fieldset.
   *
   * @param {HTMLElement} container - Where the fieldset is
   * @param {string} idPrefix - Its prefix
   * @returns {string[]|null|undefined} The ids; undefined when the field is absent; null when too many
   */
  readLeaders(container, idPrefix) {
    const fieldset = container.querySelector(`[data-leaders="${idPrefix}"]`);
    if (!fieldset) {
      return undefined;
    }
    const ids = [...fieldset.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value);
    const errorNode = fieldset.querySelector('.field-error');
    if (ids.length > MAX_LEADERS) {
      errorNode.textContent = translate('schedule_leaders_too_many').replace('{count}', String(MAX_LEADERS));
      errorNode.hidden = false;
      fieldset.querySelector('input[type="checkbox"]:checked')?.focus();
      return null;
    }
    errorNode.hidden = true;
    errorNode.textContent = '';
    return ids;
  }

  /**
   * @param {string} idPrefix - Unique prefix for the field's ids
   * @param {Object[]} items - The line's articles
   * @returns {MaterialItemsField}
   */
  materialField(idPrefix, items = []) {
    return new MaterialItemsField({
      choices: this.materialChoices,
      items,
      idPrefix,
      lang: this.lang,
      canManageCatalog: hasPermission('equipment_catalog.manage'),
    });
  }

  /** Fetch the authoritative schedule after every mutation. */
  async reload() {
    try {
      const response = await getMeetingSchedule(this.chip.meetingId, { forceRefresh: true });
      this.schedule = response?.data || null;
      const lastOffset = Math.max(0, (this.schedule?.days?.length || 1) - 1);
      this.dayOffset = Math.min(this.dayOffset, lastOffset);
      this.render();
    } catch (err) {
      debugError('Error loading camp schedule:', err);
      this.app.showMessage(apiErrorMessage(err, 'yearly_planner_schedule_load_error'), 'error');
      this.modal?.close();
    }
  }

  /** Render the selected day into the existing modal. */
  render() {
    const body = this.modal?.overlay.querySelector('.modal-body');
    if (!body || !this.schedule) {
      return;
    }
    const day = this.schedule.days[this.dayOffset];
    this.itemFields = new Map();
    const isEmpty = this.schedule.days.every(item =>
      !item.title && !item.notes && !item.activities.some(activity => Number(activity.day_offset) > 0)
    );

    setContent(body, `
      <div class="yp-schedule">
        <div class="yp-schedule__days" role="group" aria-label="${escapeHTML(translate('yearly_planner_schedule_days'))}">
          ${this.schedule.days.map(item => `
            <button type="button" class="yp-schedule__day ${item.day_offset === this.dayOffset ? 'is-active' : ''}"
                    data-day-offset="${item.day_offset}"
                    aria-pressed="${item.day_offset === this.dayOffset}">
              ${escapeHTML(formatDate(item.date, this.lang, { weekday: 'short', day: 'numeric' }))}
            </button>
          `).join('')}
        </div>

        ${this.canManage && this.schedule.meeting_kind === 'camp' ? `
          <div class="yp-schedule__copy">
            <button type="button" class="button button--secondary" id="yp-schedule-duplicate">
              ${escapeHTML(translate(isEmpty ? 'camp_duplicate_open' : 'camp_duplicate_open_more'))}
            </button>
          </div>
        ` : ''}

        <section class="yp-schedule__heading">
          <h3>${escapeHTML(formatDate(day.date, this.lang, { weekday: 'long', month: 'long', day: 'numeric' }))}</h3>
          <label class="form-group">
            <span>${escapeHTML(translate('title'))}</span>
            <input type="text" id="yp-schedule-title" maxlength="255"
                   value="${escapeHTML(day.title || '')}" ${this.canManage ? '' : 'disabled'}>
          </label>
          <label class="form-group">
            <span>${escapeHTML(translate('notes'))}</span>
            <textarea id="yp-schedule-notes" rows="2" ${this.canManage ? '' : 'disabled'}>${escapeHTML(day.notes || '')}</textarea>
          </label>
          ${this.canManage ? `
            <button type="button" class="button button--secondary" id="yp-schedule-save-day">
              ${escapeHTML(translate('save'))}
            </button>
          ` : ''}
        </section>

        <div class="yp-schedule__toolbar">
          <h3>${escapeHTML(translate('activities'))}</h3>
          ${this.canManage ? `
            <button type="button" class="button button--ghost" id="yp-schedule-quick"
                    aria-pressed="${this.quickEdit}">
              ${escapeHTML(translate('yearly_planner_quick_edit'))}
            </button>
            <button type="button" class="button button--primary" data-add-position="${day.activities.length}">
              <i class="fas fa-plus" aria-hidden="true"></i> ${escapeHTML(translate('add_activity'))}
            </button>
          ` : ''}
        </div>

        <div class="yp-schedule__activities">
          ${this.renderInsertButton(0)}
          ${day.activities.length === 0 ? `
            <p class="empty-state">${escapeHTML(translate('no_activities_scheduled'))}</p>
          ` : day.activities.map((activity, index) => `
            ${this.renderActivity(activity)}
            ${this.renderInsertButton(index + 1)}
          `).join('')}
        </div>
      </div>
    `);
    this.wire();
  }

  /** Render an insert-between control only while quick edit is armed. */
  renderInsertButton(position) {
    if (!this.canManage || !this.quickEdit) {
      return '';
    }
    return `
      <button type="button" class="yp-schedule__insert" data-add-position="${position}">
        ${escapeHTML(translate('insert_row_here'))}
      </button>
    `;
  }

  /** Render one responsive schedule card. */
  renderActivity(activity) {
    if (this.quickEdit && this.canManage) {
      return `
        <article class="yp-schedule-card" data-activity-id="${activity.id}">
          <label><span>${escapeHTML(translate('time'))}</span><input type="time" data-field="start_time" value="${shortTime(activity.start_time)}"></label>
          <label><span>${escapeHTML(translate('activity_label'))}</span><input type="text" data-field="name" maxlength="255" value="${escapeHTML(activity.name)}"></label>
          <label><span>${escapeHTML(translate('duration_minutes'))}</span><input type="number" data-field="duration_minutes" min="1" max="1440" value="${activity.duration_minutes || ''}"></label>
          ${this.leadersFieldset(`yp-schedule-leaders-${Number(activity.id)}`, activity.leaders)}
          <label><span>${escapeHTML(translate(this.leaderCandidates ? 'yearly_planner_responsible_other' : 'yearly_planner_responsible'))}</span><input type="text" data-field="responsable" maxlength="255" value="${escapeHTML(activity.responsable || '')}"></label>
          <label><span>${escapeHTML(translate('yearly_planner_logistic_notes'))}</span><textarea data-field="description" rows="2" maxlength="${NOTES_MAX_LENGTH}">${escapeHTML(activity.description || '')}</textarea></label>
          <label><span>${escapeHTML(translate('yearly_planner_material'))}</span><textarea data-field="material" rows="2">${escapeHTML(activity.material || '')}</textarea></label>
          ${this.quickEditItems(activity)}
          <div class="yp-schedule-card__actions">
            <button type="button" class="button button--small button--primary" data-save-activity="${activity.id}">${escapeHTML(translate('save'))}</button>
            <button type="button" class="button button--small button--danger" data-delete-activity="${activity.id}">${escapeHTML(translate('delete'))}</button>
          </div>
        </article>
      `;
    }
    return `
      <article class="yp-schedule-card" data-activity-id="${activity.id}">
        <div class="yp-schedule-card__time">${escapeHTML(shortTime(activity.start_time) || '—')}</div>
        <div><strong>${escapeHTML(activity.name)}</strong>${activity.duration_minutes ? ` <span>· ${Number(activity.duration_minutes)} min</span>` : ''}</div>
        ${this.leadersText(activity) ? `<div><span class="yp-schedule-card__label">${escapeHTML(translate('yearly_planner_responsible'))}</span>${escapeHTML(this.leadersText(activity))}</div>` : ''}
        ${activity.description ? `<div class="yp-schedule-card__notes"><span class="yp-schedule-card__label">${escapeHTML(translate('yearly_planner_logistic_notes'))}</span>${escapeHTML(activity.description)}</div>` : ''}
        ${activity.material ? `<div><span class="yp-schedule-card__label">${escapeHTML(translate('yearly_planner_material'))}</span>${escapeHTML(activity.material)}</div>` : ''}
        ${activity.material_items?.length ? `<div><span class="yp-schedule-card__label">${escapeHTML(translate('equipment_catalog_items_legend'))}</span>${renderMaterialItemsList(activity.material_items, this.lang)}</div>` : ''}
        ${this.canManage ? `
          <div class="yp-schedule-card__actions">
            <button type="button" class="button button--small button--secondary" data-edit-activity="${activity.id}">${escapeHTML(translate('edit'))}</button>
            <button type="button" class="button button--small button--danger" data-delete-activity="${activity.id}">${escapeHTML(translate('delete'))}</button>
          </div>
        ` : ''}
      </article>
    `;
  }

  /**
   * Who leads a line, in words: the members named, marked when they left the unit, then the free text.
   *
   * @param {Object} activity
   * @returns {string} Plain text, empty when no one is named
   */
  leadersText(activity) {
    const names = (activity.leaders || []).map((leader) => (leader.active_member
      ? leader.name : `${leader.name} ${translate('yearly_planner_leader_left')}`));
    if (activity.responsable) {
      names.push(activity.responsable);
    }
    return names.join(', ');
  }

  /**
   * The catalogue-article field of a line being edited, kept so Save reads it.
   *
   * @param {Object} activity
   * @returns {string} HTML
   */
  quickEditItems(activity) {
    const items = activity.material_items || [];
    // Having nothing to choose from is pointed out once, in the add form, not on every line.
    const choices = this.materialChoices;
    if (choices && !choices.articles?.length && !choices.equipment?.length && items.length === 0) {
      return '';
    }
    const field = this.materialField(`yp-schedule-items-${Number(activity.id)}`, items);
    this.itemFields.set(Number(activity.id), field);
    return field.markup();
  }

  /** Attach handlers to the freshly rendered selected day. */
  wire() {
    const root = this.modal.overlay;
    this.itemFields.forEach(field => field.attach(root));
    root.querySelectorAll('[data-day-offset]').forEach(button => {
      button.addEventListener('click', () => {
        this.dayOffset = parseInt(button.dataset.dayOffset, 10);
        this.render();
      });
    });
    root.querySelector('#yp-schedule-quick')?.addEventListener('click', () => {
      this.quickEdit = !this.quickEdit;
      this.render();
    });
    root.querySelector('#yp-schedule-save-day')?.addEventListener('click', () => this.saveDay());
    root.querySelectorAll('[data-add-position]').forEach(button => {
      button.addEventListener('click', () => this.openActivityForm(parseInt(button.dataset.addPosition, 10)));
    });
    root.querySelectorAll('[data-edit-activity]').forEach(button => {
      button.addEventListener('click', () => {
        this.quickEdit = true;
        this.render();
        this.modal.overlay.querySelector(`[data-activity-id="${button.dataset.editActivity}"] input`)?.focus();
      });
    });
    root.querySelectorAll('[data-save-activity]').forEach(button => {
      button.addEventListener('click', () => this.saveActivity(parseInt(button.dataset.saveActivity, 10)));
    });
    root.querySelectorAll('[data-delete-activity]').forEach(button => {
      button.addEventListener('click', () => this.removeActivity(parseInt(button.dataset.deleteActivity, 10)));
    });
    root.querySelector('#yp-schedule-duplicate')?.addEventListener('click', () => this.openDuplication());
  }

  async saveDay() {
    try {
      await updateMeetingDay(this.chip.meetingId, this.dayOffset, {
        title: this.modal.overlay.querySelector('#yp-schedule-title')?.value.trim() || null,
        notes: this.modal.overlay.querySelector('#yp-schedule-notes')?.value.trim() || null
      });
      this.changed = true;
      this.app.showMessage(translate('yearly_planner_day_saved'), 'success');
      await this.reload();
    } catch (err) {
      debugError('Error saving camp day:', err);
      this.app.showMessage(apiErrorMessage(err, 'yearly_planner_error_saving'), 'error');
    }
  }

  /** Open the compact add form with a cascaded default time. */
  openActivityForm(position) {
    const activities = this.schedule.days[this.dayOffset].activities;
    const previous = activities[Math.max(0, position - 1)];
    const suggestedTime = position > 0 ? addMinutes(previous?.start_time, previous?.duration_minutes) : '';
    const newItems = this.materialField('yp-schedule-new-items');
    const modal = openModal({
      id: 'yp-schedule-activity',
      title: escapeHTML(translate('add_activity')),
      body: `
        <form class="yp-schedule-form" id="yp-schedule-new-form" novalidate>
          <label class="form-group"><span>${escapeHTML(translate('time'))}</span><input type="time" id="yp-schedule-new-time" value="${suggestedTime}"></label>
          <label class="form-group"><span>${escapeHTML(translate('activity_label'))}</span><input type="text" id="yp-schedule-new-name" maxlength="255" required aria-required="true"></label>
          <p class="field-error" id="yp-schedule-new-name-error" role="alert" hidden></p>
          <label class="form-group"><span>${escapeHTML(translate('duration_minutes'))}</span><input type="number" id="yp-schedule-new-duration" min="1" max="1440"></label>
          ${this.leadersFieldset('yp-schedule-new-leaders')}
          <label class="form-group"><span>${escapeHTML(translate(this.leaderCandidates ? 'yearly_planner_responsible_other' : 'yearly_planner_responsible'))}</span><input type="text" id="yp-schedule-new-responsible" maxlength="255"></label>
          <label class="form-group"><span>${escapeHTML(translate('yearly_planner_logistic_notes'))}</span><textarea id="yp-schedule-new-notes" rows="2" maxlength="${NOTES_MAX_LENGTH}"></textarea></label>
          <label class="form-group"><span>${escapeHTML(translate('yearly_planner_material'))}</span><textarea id="yp-schedule-new-material" rows="2"></textarea></label>
          ${newItems.markup()}
        </form>
      `,
      footer: `
        <button type="button" class="button button--secondary" data-modal-close>${escapeHTML(translate('cancel'))}</button>
        <button type="submit" form="yp-schedule-new-form" class="button button--primary" id="yp-schedule-create">${escapeHTML(translate('save'))}</button>
      `
    });
    const form = modal.overlay.querySelector('#yp-schedule-new-form');
    newItems.attach(form);
    const nameInput = modal.overlay.querySelector('#yp-schedule-new-name');
    const nameError = modal.overlay.querySelector('#yp-schedule-new-name-error');
    const clearNameError = () => {
      nameError.hidden = true;
      nameError.textContent = '';
      nameInput.removeAttribute('aria-invalid');
      nameInput.removeAttribute('aria-describedby');
    };
    nameInput.addEventListener('input', clearNameError);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const name = nameInput.value.trim();
      if (!name) {
        nameError.textContent = translate('plan_fields_required');
        nameError.hidden = false;
        nameInput.setAttribute('aria-invalid', 'true');
        nameInput.setAttribute('aria-describedby', nameError.id);
        nameInput.focus();
        return;
      }
      const materialItems = newItems.value();
      const leaderIds = this.readLeaders(form, 'yp-schedule-new-leaders');
      if (materialItems === null || leaderIds === null) {
        return;
      }
      withFormBusy(form, () => this.createActivity(modal, position, name, materialItems, leaderIds));
    });
  }

  /**
   * Save the activity the add form describes, then reload the day.
   *
   * @param {{overlay: HTMLElement, close: Function}} modal - The add form's dialog
   * @param {number} position - Where the activity goes in the day
   * @param {string} name - Its name, already checked
   * @param {Object[]|undefined} materialItems - Catalogue articles; undefined without a catalogue
   * @param {string[]|undefined} leaderIds - Members in charge; undefined when they could not be loaded
   * @returns {Promise<void>}
   */
  async createActivity(modal, position, name, materialItems, leaderIds) {
    try {
      await addMeetingActivity(this.chip.meetingId, {
        ...(materialItems ? { material_items: materialItems } : {}),
        ...(leaderIds ? { leader_ids: leaderIds } : {}),
        description: modal.overlay.querySelector('#yp-schedule-new-notes')?.value.trim() || null,
        day_offset: this.dayOffset,
        sort_order: position,
        start_time: modal.overlay.querySelector('#yp-schedule-new-time')?.value || null,
        name,
        duration_minutes: parseInt(modal.overlay.querySelector('#yp-schedule-new-duration')?.value, 10) || null,
        responsable: modal.overlay.querySelector('#yp-schedule-new-responsible')?.value.trim() || null,
        material: modal.overlay.querySelector('#yp-schedule-new-material')?.value.trim() || null
      });
      modal.close();
      this.changed = true;
      await this.reload();
    } catch (err) {
      debugError('Error adding camp activity:', err);
      this.app.showMessage(apiErrorMessage(err, 'yearly_planner_error_saving'), 'error');
    }
  }

  async saveActivity(activityId) {
    const card = this.modal.overlay.querySelector(`[data-activity-id="${activityId}"]`);
    if (!card) {
      return;
    }
    const field = name => card.querySelector(`[data-field="${name}"]`);
    const name = field('name')?.value.trim();
    if (!name) {
      this.app.showMessage(translate('plan_fields_required'), 'error');
      return;
    }
    const materialItems = this.itemFields.get(activityId)?.value();
    const leaderIds = this.readLeaders(card, `yp-schedule-leaders-${activityId}`);
    if (materialItems === null || leaderIds === null) {
      return;
    }
    const loaded = this.schedule.days.flatMap((day) => day.activities).find((activity) => Number(activity.id) === activityId);
    try {
      await updateMeetingActivity(activityId, {
        ...(materialItems ? { material_items: materialItems } : {}),
        ...(leaderIds ? { leader_ids: leaderIds } : {}),
        // Refused (409) when someone changed the line since it was loaded, rather than overwriting their change.
        ...(loaded && loaded.updated_at !== undefined ? { expected_updated_at: loaded.updated_at } : {}),
        description: field('description')?.value.trim() || null,
        name,
        start_time: field('start_time')?.value || null,
        duration_minutes: parseInt(field('duration_minutes')?.value, 10) || null,
        responsable: field('responsable')?.value.trim() || null,
        material: field('material')?.value.trim() || null
      });
      this.changed = true;
      await this.reload();
    } catch (err) {
      debugError('Error updating camp activity:', err);
      this.app.showMessage(apiErrorMessage(err, 'yearly_planner_error_saving'), 'error');
      if (err?.status === HTTP_CONFLICT) {
        // Someone else's change is shown; the person redoes theirs on top of it.
        await this.reload();
      }
    }
  }

  async removeActivity(activityId) {
    const confirmed = await confirmDestructive({
      title: translate('yearly_planner_remove_schedule_line'),
      message: translate('yearly_planner_remove_schedule_line_confirm')
    });
    if (!confirmed) {
      return;
    }
    try {
      await deleteMeetingActivity(activityId);
      this.changed = true;
      await this.reload();
    } catch (err) {
      debugError('Error deleting camp activity:', err);
      this.app.showMessage(apiErrorMessage(err, 'yearly_planner_error_deleting'), 'error');
    }
  }

  /** Reuse an earlier camp's schedule, packing list, lots or tasks, then show the result here. */
  openDuplication() {
    new CampDuplication(this.app, {
      meetingId: this.chip.meetingId,
      lang: this.lang,
      onDone: () => {
        this.changed = true;
        this.reload();
      }
    }).open();
  }
}
