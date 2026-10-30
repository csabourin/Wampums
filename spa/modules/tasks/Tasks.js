/** Personal assignments and unit task management, without youth records. */
import { translate } from '../../app.js';
import { CONFIG } from '../../config.js';
import { setContent, withFormBusy } from '../../utils/DOMUtils.js';
import { escapeHTML, escapeAttribute } from '../../utils/SecurityUtils.js';
import { hasPermission, isDemoUser } from '../../utils/PermissionUtils.js';
import { renderBackLink } from '../../utils/BackLinkUtils.js';
import { formatDate, formatTimestamp } from '../../utils/DateUtils.js';
import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { getMyTasks, getUnitTasks, getTaskOptions, saveTask, changeTaskStatus, configureEquipmentReminder, confirmEquipmentReminder } from '../../api/api-tasks.js';
import { CAMP_LOTS } from '../../config/camp-lots.js';
import { getCurrentUserId } from '../../api/api-helpers.js';
import { openModal } from '../../utils/ModalUtils.js';

const ISO_DATE_LENGTH = 10;
const DAYS_IN_WEEK = 7;
const HOURS_IN_DAY = 24;
const MS_PER_MINUTE = 60000;
const MS_PER_HOUR = 3600000;
const MS_PER_DAY = HOURS_IN_DAY * MS_PER_HOUR;

/** The next status a one-tap button moves a task to. Literal keys, so the translation test sees them. */
const STATUS_ACTIONS = {
  todo: [['in_progress', () => translate('tasks_action_start')], ['done', () => translate('tasks_action_done')]],
  in_progress: [['done', () => translate('tasks_action_done')]],
  done: [['todo', () => translate('tasks_action_reopen')]],
};

/** Due-date groups, in the order shown. */
const GROUPS = [
  ['overdue', () => translate('tasks_group_overdue')],
  ['week', () => translate('tasks_group_week')],
  ['later', () => translate('tasks_group_later')],
];

/** @param {Date} date @returns {string} YYYY-MM-DD in local time */
function localIsoDate(date) {
  const offset = date.getTimezoneOffset() * MS_PER_MINUTE;
  return new Date(date.getTime() - offset).toISOString().slice(0, ISO_DATE_LENGTH);
}

export class Tasks {
  constructor(app) {
    this.app = app;
    this.canManage = hasPermission('tasks.manage');
    this.readOnly = isDemoUser();
    const query = new URLSearchParams(window.location.search);
    const id = (key) => /^[1-9]\d*$/.test(query.get(key) || '') ? Number(query.get(key)) : null;
    this.focusTaskId = id('task_id');
    this.campMeetingId = id('meeting_id');
    this.campActivityId = id('activity_id');
    this.unitView = this.canManage && Boolean(this.campMeetingId || this.campActivityId);
    // From a camp's material list: open the task form for that material once the list is shown.
    const material = (query.get('material') || '').trim();
    this.pendingAssignment = this.canManage && !this.readOnly && material && this.campMeetingId ? {
      title: translate('tasks_bring_material').replace('{item}', material).slice(0, CONFIG.TASKS.TITLE_MAX_LENGTH),
      materials: (query.get('materials') || material).trim().slice(0, CONFIG.EQUIPMENT_REMINDERS.MATERIALS_MAX_LENGTH),
      event: `meeting:${this.campMeetingId}`,
    } : null;
    this.tasks = [];
    this.destroyed = false;
  }

  destroy() {this.destroyed = true;}

  /** Load fresh assignments after a write, without losing the saved outcome. */
  async init() {
    this.renderState('loading');
    try {
      const response = await (this.unitView ? getUnitTasks : getMyTasks)({ forceRefresh: true });
      if (this.destroyed) {return;}
      this.tasks = response.data.filter((task) => (!this.focusTaskId || task.id === this.focusTaskId) && ((!this.campMeetingId && !this.campActivityId)
        || (this.campMeetingId && Number(task.meeting_id) === this.campMeetingId)
        || (this.campActivityId && Number(task.activity_id) === this.campActivityId)));
      this.render();
      if (this.pendingAssignment) {
        const prefill = this.pendingAssignment;
        this.pendingAssignment = null;
        // A reload or Back must not open the form a second time.
        const url = new URL(window.location.href);
        ['material', 'materials'].forEach((key) => url.searchParams.delete(key));
        window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}`);
        await this.edit(null, prefill);
      }
    } catch (err) {
      debugError('Failed to load tasks', err);
      this.renderState('error');
    }
  }

  renderState(state) {
    if (this.destroyed) {return;}
    setContent(document.getElementById('app'), `<section class="page tasks-page">
      ${renderBackLink()}<h1>${translate('tile_tasks')}</h1>
      ${state === 'loading' ? `<p role="status">${translate('loading')}</p>`
    : `<p role="alert">${translate('tasks_load_failed')}</p><button class="button" id="tasks-retry">${translate('retry')}</button>`}
    </section>`);
    document.getElementById('tasks-retry')?.addEventListener('click', () => this.init());
  }

  /** Event labels name only the event, with no link to protected dossiers. */
  eventName(task) {
    return task.activity_name || task.meeting_name || translate('tasks_meeting');
  }

  /** @returns {'overdue'|'week'|'later'} Where an unfinished task is listed */
  groupOf(task) {
    const today = localIsoDate(new Date());
    const weekEnd = localIsoDate(new Date(Date.now() + DAYS_IN_WEEK * MS_PER_DAY));
    if (task.due_date < today) {return 'overdue';}
    return task.due_date <= weekEnd ? 'week' : 'later';
  }

  /** One-tap status changes; lot duties change through their lot instead. */
  statusMarkup(task) {
    if (task.equipment_lot_id) {
      const canOpen = !this.unitView || task.assignee_id === getCurrentUserId() || hasPermission('camp_lots.view');
      return `<p>${escapeHTML(translate(CAMP_LOTS.ROLE_KEYS[task.equipment_lot_role]))}</p>
        ${canOpen ? `<a class="button button--secondary" href="/${this.unitView && hasPermission('camp_lots.view') ? 'camp-lots' : 'my-camp-lots'}/${Number(task.meeting_id)}">${translate('camp_lots_open')}</a>`
    : `<p>${translate('camp_lot_task_managed')}</p>`}`;
    }
    const actions = (STATUS_ACTIONS[task.status] || []).map(([status, label]) => `<button type="button"
      class="button ${status === 'done' ? 'button--primary' : 'button--secondary'}" data-task-status="${Number(task.id)}" data-status="${status}"
      ${this.readOnly ? 'disabled' : ''}>${escapeHTML(label())}</button>`).join('');
    return `<div class="task-status" role="group" aria-label="${escapeAttribute(translate('tasks_status'))}">${actions}</div>`;
  }

  cardMarkup(task) {
    const status = translate(CONFIG.TASKS.STATUS_KEYS[task.status]);
    const overdue = task.status !== 'done' && this.groupOf(task) === 'overdue';
    return `<li class="card task-card ${task.status === 'done' ? 'task-card--done' : ''}" data-task-card="${Number(task.id)}">
      <h3>${escapeHTML(task.title)}</h3>
      <p class="task-card__badges"><span class="task-badge task-badge--${escapeAttribute(task.status)}">${translate('tasks_status')} : ${escapeHTML(status)}</span>
        ${overdue ? `<span class="task-badge task-badge--overdue">${translate('tasks_overdue')}</span>` : ''}</p>
      <p>${escapeHTML(this.eventName(task))}</p>
      <p>${translate('tasks_assignee')} : ${escapeHTML(task.assignee_name || translate('tasks_member'))}</p>
      <p>${translate('tasks_due')} : <time datetime="${escapeAttribute(task.due_date)}">${escapeHTML(formatDate(task.due_date, this.app.lang))}</time></p>
      ${this.statusMarkup(task)}
      ${this.renderReminder(task)}
      ${!task.equipment_lot_id && this.unitView && !this.readOnly ? `<button type="button" class="button button--ghost" data-task-edit="${Number(task.id)}">${translate('edit')}<span class="sr-only"> ${escapeHTML(task.title)}</span></button>` : ''}
      <details><summary>${translate('tasks_history')}</summary><ul>${(task.history || []).map((entry) => `<li>
        ${escapeHTML(translate(CONFIG.TASKS.STATUS_KEYS[entry.status]))} · ${escapeHTML(entry.changed_by_name || translate('tasks_member'))} ·
        ${escapeHTML(formatTimestamp(entry.changed_at, this.app.lang))}</li>`).join('')}</ul></details>
    </li>`;
  }

  /** Unfinished tasks by due date (overdue, this week, later); finished ones folded away. */
  listMarkup() {
    if (!this.tasks.length) {return `<p class="empty-state">${translate('tasks_empty')}</p>`;}
    const byDue = [...this.tasks].sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)) || a.id - b.id);
    const open = byDue.filter((task) => task.status !== 'done');
    const done = byDue.filter((task) => task.status === 'done');
    const sections = GROUPS.map(([group, label]) => {
      const tasks = open.filter((task) => this.groupOf(task) === group);
      if (!tasks.length) {return '';}
      return `<section class="task-group" aria-labelledby="tasks-group-${group}">
        <h2 id="tasks-group-${group}">${escapeHTML(label())} (${tasks.length})</h2>
        <ul class="task-list">${tasks.map((task) => this.cardMarkup(task)).join('')}</ul></section>`;
    }).join('');
    const finished = done.length ? `<details class="task-group task-group--done" ${open.length ? '' : 'open'}>
      <summary>${escapeHTML(translate('tasks_group_done'))} (${done.length})</summary>
      <ul class="task-list">${done.map((task) => this.cardMarkup(task)).join('')}</ul></details>` : '';
    return `${sections}${open.length ? '' : `<p>${translate('tasks_all_done')}</p>`}${finished}`;
  }

  render() {
    if (this.destroyed) {return;}
    const root = document.getElementById('app');
    setContent(root, `<section class="page tasks-page">
      ${renderBackLink()}<h1>${translate('tile_tasks')}</h1>
      <p>${translate('tasks_intro')}</p>
      ${this.canManage ? `<div class="task-toolbar">
        <div class="task-view-switch" role="group" aria-label="${escapeAttribute(translate('tasks_view_label'))}">
          <button type="button" class="button button--secondary" id="tasks-view-mine" aria-pressed="${!this.unitView}" data-archive-safe>${translate('tasks_mine')}</button>
          <button type="button" class="button button--secondary" id="tasks-view-unit" aria-pressed="${this.unitView}" data-archive-safe>${translate('tasks_unit')}</button>
        </div>
        ${this.readOnly ? '' : `<button type="button" class="button button--primary" id="tasks-create">${translate('tasks_create')}</button>`}
      </div>` : ''}
      ${this.listMarkup()}
    </section>`);
    this.bind(root);
  }

  bind(root) {
    root.querySelectorAll('[data-equipment-reminder]').forEach((button) => button.addEventListener('click', () =>
      this.editReminder(this.tasks.find((task) => task.id === Number(button.dataset.equipmentReminder)))));
    root.querySelectorAll('[data-equipment-confirm]').forEach((button) => button.addEventListener('click', () => {
      button.disabled = true;
      const task = this.tasks.find((item) => item.id === Number(button.dataset.equipmentConfirm));
      this.confirmReminder(task).finally(() => {button.disabled = false;});
    }));
    [['tasks-view-mine', false], ['tasks-view-unit', true]].forEach(([id, unit]) => {
      document.getElementById(id)?.addEventListener('click', () => {
        if (this.unitView === unit) {return;}
        this.unitView = unit;
        this.init().then(() => document.getElementById(id)?.focus());
      });
    });
    document.getElementById('tasks-create')?.addEventListener('click', () => this.edit());
    root.querySelectorAll('[data-task-edit]').forEach((button) => button.addEventListener('click', () =>
      this.edit(this.tasks.find((task) => task.id === Number(button.dataset.taskEdit)))));
    root.querySelectorAll('[data-task-status]').forEach((button) => button.addEventListener('click', () => this.changeStatus(button)));
  }

  /** Move a task to the status its button names, then put focus back on that task. */
  async changeStatus(button) {
    const task = this.tasks.find((item) => item.id === Number(button.dataset.taskStatus));
    const card = button.closest('[data-task-card]');
    card.querySelectorAll('[data-task-status]').forEach((control) => { control.disabled = true; });
    try {
      await changeTaskStatus(task.id, button.dataset.status, task.status, !this.unitView);
    } catch (err) {
      card.querySelectorAll('[data-task-status]').forEach((control) => { control.disabled = false; });
      if (!this.destroyed) {this.app.showMessage(apiErrorMessage(err, 'tasks_save_failed'), 'error');}
      return;
    }
    if (this.destroyed) {return;}
    this.app.showMessage(translate('tasks_saved'), 'success');
    await this.init();
    if (this.destroyed) {return;}
    const next = document.querySelector(`[data-task-card="${task.id}"]`);
    if (next) {
      // A finished task lands in the folded group: open it so focus is never hidden.
      const folded = next.closest('details');
      if (folded) {folded.open = true;}
    }
    (next?.querySelector('[data-task-status]') || next?.querySelector('h3') || document.getElementById('tasks-retry'))?.focus?.();
  }

  /** Configuration and honest delivery feedback stay next to the assignment. */
  renderReminder(task) {
    const reminder = task.equipment_reminder;
    // Only someone who can fix the assignment is told it cannot be reached.
    const blocked = this.canManage && (task.assignee_active === false || task.assignee_has_email === false || task.assignee_can_confirm === false);
    const statusKeys = { pending: 'equipment_reminder_pending', sending: 'equipment_reminder_uncertain', uncertain: 'equipment_reminder_uncertain', sent: 'equipment_reminder_sent', failed: 'equipment_reminder_failed' };
    // Ordinary tasks configure their reminder in the task form; lot duties have no task form here.
    const canConfigure = this.canManage && !this.readOnly && this.unitView && Boolean(task.equipment_lot_id);
    if (!reminder && !canConfigure && !blocked) {return '';}
    return `<section class="equipment-task-reminder" aria-labelledby="task-reminder-${Number(task.id)}">
      <h4 id="task-reminder-${Number(task.id)}">${translate('equipment_reminder_title')}</h4>
      ${reminder ? `<p class="equipment-reminder-materials">${escapeHTML(reminder.materials)}</p>
        <p>${translate(reminder.confirmed_at ? 'equipment_reminder_confirmed' : (statusKeys[reminder.delivery_status] || 'equipment_reminder_pending'))}</p>
        ${!reminder.confirmed_at && task.assignee_id === getCurrentUserId() && !this.readOnly
    ? `<button type="button" class="button button--secondary" data-equipment-confirm="${Number(task.id)}">${translate('equipment_reminder_confirm')}</button>` : ''}` : ''}
      ${blocked ? `<p class="task-warning">${translate('equipment_reminder_unavailable')}</p>` : ''}
      ${canConfigure ? `<button type="button" class="button button--secondary button--small" data-equipment-reminder="${Number(task.id)}">${translate(reminder ? 'equipment_reminder_edit' : 'equipment_reminder_enable')}</button>` : ''}
    </section>`;
  }

  /** Confirmation changes only this reminder revision, never the task's progress. */
  async confirmReminder(task) {
    try {await confirmEquipmentReminder(task.id, task.equipment_reminder.revision);}
    catch (err) {
      if (!this.destroyed) {this.app.showMessage(apiErrorMessage(err, 'equipment_reminder_save_failed'), 'error');}
      return;
    }
    if (this.destroyed) {return;}
    this.app.showMessage(translate('equipment_reminder_confirmed'), 'success');
    await this.init();
    document.querySelector(`[data-task-card="${task.id}"] h3`)?.setAttribute('tabindex', '-1');
    document.querySelector(`[data-task-card="${task.id}"] h3`)?.focus();
  }

  /**
   * A select of presets, plus the stored value when it is not one of them.
   * @param {number[]} presets
   * @param {number} current
   * @param {(value: number) => string} label
   */
  presetOptions(presets, current, label) {
    const values = presets.includes(current) ? presets : [...presets, current].sort((a, b) => a - b);
    return values.map((value) => `<option value="${value}" ${value === current ? 'selected' : ''}>${escapeHTML(label(value))}</option>`).join('');
  }

  leadLabel(days) {
    if (days === 0) {return translate('equipment_reminder_lead_same_day');}
    if (days === 1) {return translate('equipment_reminder_lead_day_before');}
    if (days % DAYS_IN_WEEK === 0) {return translate('equipment_reminder_lead_weeks').replace('{count}', String(days / DAYS_IN_WEEK));}
    return translate('equipment_reminder_lead_days').replace('{count}', String(days));
  }

  repeatLabel(hours) {
    if (hours === HOURS_IN_DAY) {return translate('equipment_reminder_repeat_daily');}
    if (hours === HOURS_IN_DAY * DAYS_IN_WEEK) {return translate('equipment_reminder_repeat_weekly');}
    if (hours % HOURS_IN_DAY === 0) {return translate('equipment_reminder_repeat_days').replace('{count}', String(hours / HOURS_IN_DAY));}
    return translate('equipment_reminder_repeat_hours').replace('{count}', String(hours));
  }

  /**
   * The reminder fields, shared by the task form and the lot-duty reminder dialog.
   * @param {Object|null} reminder - The task's current reminder
   * @param {string} fallbackMaterials - Suggested material when there is none yet
   * @param {boolean} optional - In the task form, the reminder is turned on by a checkbox
   */
  reminderFields(reminder, fallbackMaterials, optional) {
    const limits = CONFIG.EQUIPMENT_REMINDERS;
    const lead = reminder?.lead_days ?? limits.DEFAULT_LEAD_DAYS;
    const repeat = reminder?.repeat_hours ?? limits.DEFAULT_REPEAT_HOURS;
    const leadPresets = limits.LEAD_PRESET_DAYS.filter((value) => value <= limits.MAX_LEAD_DAYS);
    const repeatPresets = limits.REPEAT_PRESET_HOURS.filter((value) => value >= limits.MIN_REPEAT_HOURS && value <= limits.MAX_REPEAT_HOURS);
    const enabled = optional ? Boolean(reminder) : true;
    return `<fieldset class="task-reminder-fields"><legend>${translate('equipment_reminder_title')}</legend>
      <p>${translate('equipment_reminder_intro')}</p>
      <label class="equipment-reminder-toggle" for="equipment-reminder-enabled"><input id="equipment-reminder-enabled" type="checkbox" name="reminder_enabled" ${enabled ? 'checked' : ''}>${translate('equipment_reminder_enable')}</label>
      <div class="task-reminder-details" ${enabled ? '' : 'hidden'}>
        <label for="equipment-reminder-materials">${translate('equipment_reminder_materials')}</label>
        <textarea id="equipment-reminder-materials" name="reminder_materials" maxlength="${limits.MATERIALS_MAX_LENGTH}" rows="4">${escapeHTML(reminder?.materials || fallbackMaterials)}</textarea>
        <label for="equipment-reminder-lead">${translate('equipment_reminder_lead')}</label>
        <select id="equipment-reminder-lead" name="reminder_lead">${this.presetOptions(leadPresets, lead, (value) => this.leadLabel(value))}</select>
        <label for="equipment-reminder-repeat">${translate('equipment_reminder_repeat')}</label>
        <select id="equipment-reminder-repeat" name="reminder_repeat">${this.presetOptions(repeatPresets, repeat, (value) => this.repeatLabel(value))}</select>
      </div></fieldset>`;
  }

  bindReminderFields(form) {
    form.elements.reminder_enabled.addEventListener('change', () => {
      const enabled = form.elements.reminder_enabled.checked;
      form.querySelector('.task-reminder-details').hidden = !enabled;
      // A new reminder starts from the task's title, which usually names the material.
      const materials = form.elements.reminder_materials;
      if (enabled && !materials.value.trim() && form.elements.task_title) {materials.value = form.elements.task_title.value.trim();}
    });
  }

  /** @returns {Object} The reminder request for the form's current values */
  reminderPayload(form, reminder) {
    return {
      enabled: form.elements.reminder_enabled.checked, expected_revision: reminder?.revision || 0,
      materials: form.elements.reminder_materials.value.trim(), lead_days: Number(form.elements.reminder_lead.value),
      repeat_hours: Number(form.elements.reminder_repeat.value),
    };
  }

  /** Lot duties keep their own reminder dialog: they are edited through their lot, not the task form. */
  editReminder(task) {
    const modal = openModal({
      id: 'equipment-reminder-editor', title: translate('equipment_reminder_title'), closeOnBackdrop: false,
      canClose: () => document.getElementById('equipment-reminder-form')?.getAttribute('aria-busy') !== 'true',
      body: `<form id="equipment-reminder-form" class="task-editor">
        <p>${escapeHTML(task.title)}</p>
        ${this.reminderFields(task.equipment_reminder, task.title, false)}
        <p id="equipment-reminder-error" role="alert" tabindex="-1" hidden></p>
      </form>`,
      footer: `<button type="button" class="button button--secondary" data-modal-close>${translate('cancel')}</button>
        <button type="submit" form="equipment-reminder-form" class="button button--primary">${translate('save')}</button>`,
    });
    const form = document.getElementById('equipment-reminder-form');
    this.bindReminderFields(form);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      withFormBusy(form, async () => {
        try {
          await configureEquipmentReminder(task.id, this.reminderPayload(form, task.equipment_reminder));
        } catch (err) {
          if (this.destroyed) {return;}
          const problem = document.getElementById('equipment-reminder-error');
          problem.textContent = apiErrorMessage(err, 'equipment_reminder_save_failed'); problem.hidden = false; problem.focus();
          return;
        }
        form.removeAttribute('aria-busy'); modal.close();
        if (this.destroyed) {return;}
        this.app.showMessage(translate('equipment_reminder_saved'), 'success'); await this.init();
        document.querySelector(`[data-equipment-reminder="${task.id}"]`)?.focus();
      });
    });
  }

  /** The event a new task belongs to when the page was opened from a camp or an outing. */
  contextEvent(events) {
    const candidates = [this.campMeetingId && `meeting:${this.campMeetingId}`, this.campActivityId && `activity:${this.campActivityId}`].filter(Boolean);
    return candidates.find((value) => events.some((item) => item.value === value)) || '';
  }

  /**
   * Open a task form with minimal event and member choices, and its optional material
   * reminder. A failed submission retains the input; the modal cannot close while saving.
   * @param {Object|null} task - Existing task, or null to create
   * @param {Object} [prefill] - Values for a new task (title, event, materials)
   */
  async edit(task = null, prefill = {}) {
    let options;
    try {
      options = (await getTaskOptions()).data;
    } catch (err) {
      if (!this.destroyed) {this.app.showMessage(apiErrorMessage(err, 'tasks_load_failed'), 'error');}
      return;
    }
    if (this.destroyed) {return;}
    const events = [
      ...options.activities.map((item) => ({ value: `activity:${item.id}`, label: item.name, date: item.date })),
      ...options.meetings.map((item) => ({ value: `meeting:${item.id}`, label: item.name || translate('tasks_meeting'), date: item.date })),
    ];
    const eventValue = task ? `${task.activity_id ? 'activity' : 'meeting'}:${task.activity_id || task.meeting_id}` : (prefill.event || this.contextEvent(events));
    if (task && !events.some((item) => item.value === eventValue)) {
      events.push({ value: eventValue, label: this.eventName(task), date: task.meeting_date });
    }
    const reminder = task?.equipment_reminder || null;
    const title = task?.title || prefill.title || '';
    const modal = openModal({
      id: 'tasks-editor', title: translate(task ? 'tasks_edit' : 'tasks_create'),
      closeOnBackdrop: false,
      canClose: () => document.getElementById('tasks-form')?.getAttribute('aria-busy') !== 'true',
      body: `<form id="tasks-form" class="task-editor">
        <label for="tasks-title">${translate('tasks_title_label')}</label>
        <input id="tasks-title" name="task_title" required maxlength="${CONFIG.TASKS.TITLE_MAX_LENGTH}" value="${escapeAttribute(title)}">
        <label for="tasks-event">${translate('tasks_event')}</label>
        <select id="tasks-event" name="task_event" required><option value="">${translate('tasks_choose_event')}</option>
          ${events.map((item) => `<option value="${escapeAttribute(item.value)}" ${item.value === eventValue ? 'selected' : ''}>${escapeHTML(item.label)}${item.date ? ` · ${escapeHTML(formatDate(item.date, this.app.lang))}` : ''}</option>`).join('')}
        </select>
        <label for="tasks-assignee">${translate('tasks_assignee')}</label>
        <select id="tasks-assignee" name="task_assignee" required><option value="">${translate('tasks_choose_member')}</option>
          ${options.members.map((member) => `<option value="${escapeAttribute(member.id)}" ${member.id === task?.assignee_id ? 'selected' : ''}>${escapeHTML(member.full_name || translate('tasks_member'))}</option>`).join('')}
        </select>
        <label for="tasks-due">${translate('tasks_due')}</label>
        <input id="tasks-due" name="task_due" type="date" required value="${escapeAttribute(task?.due_date || '')}">
        ${this.reminderFields(reminder, prefill.materials || title, !prefill.materials)}
        <p id="tasks-form-error" role="alert" tabindex="-1" hidden></p>
      </form>`,
      footer: `<button type="button" class="button button--secondary" data-modal-close>${translate('cancel')}</button>
        <button type="submit" class="button button--primary" form="tasks-form">${translate('save')}</button>`,
    });
    const form = document.getElementById('tasks-form');
    this.bindReminderFields(form);
    form.addEventListener('input', () => {
      form.querySelectorAll('[aria-invalid]').forEach((input) => {
        input.removeAttribute('aria-invalid');
        input.removeAttribute('aria-describedby');
      });
      document.getElementById('tasks-form-error').hidden = true;
    });
    // Once the task is saved, a retry updates that task (when its fields changed) and its reminder:
    // it never creates a second task.
    let savedId = task?.id || null;
    let savedPayload = null;
    // Saving the task can renew its reminder's revision; the reminder request must name the new one.
    let reminderRevision = reminder?.revision || 0;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      withFormBusy(form, async () => {
        const problem = document.getElementById('tasks-form-error');
        const [kind, id] = form.elements.task_event.value.split(':');
        const payload = {
          title: form.elements.task_title.value.trim(), assignee_id: form.elements.task_assignee.value,
          due_date: form.elements.task_due.value,
          activity_id: kind === 'activity' ? Number(id) : null,
          meeting_id: kind === 'meeting' ? Number(id) : null,
        };
        const wantsReminder = form.elements.reminder_enabled.checked;
        if (wantsReminder && !form.elements.reminder_materials.value.trim()) {
          problem.textContent = translate('equipment_reminder_materials_required');
          problem.hidden = false;
          form.elements.reminder_materials.setAttribute('aria-invalid', 'true');
          form.elements.reminder_materials.setAttribute('aria-describedby', 'tasks-form-error');
          form.elements.reminder_materials.focus();
          return;
        }
        if (JSON.stringify(payload) !== savedPayload) {
          try {
            const result = await saveTask(payload, savedId);
            savedId = result?.data?.id || savedId;
            savedPayload = JSON.stringify(payload);
            if (Number.isInteger(result?.data?.equipment_reminder_revision)) {reminderRevision = result.data.equipment_reminder_revision;}
          } catch (err) {
            if (this.destroyed) {return;}
            problem.textContent = apiErrorMessage(err, 'tasks_save_failed');
            problem.hidden = false;
            (err.errors || []).forEach((field) => {
              const fields = { title: 'task_title', assignee_id: 'task_assignee', due_date: 'task_due', activity_id: 'task_event', meeting_id: 'task_event' };
              const control = form.elements.namedItem(fields[field.path] || '');
              if (control) {
                control.setAttribute('aria-invalid', 'true');
                control.setAttribute('aria-describedby', 'tasks-form-error');
              }
            });
            problem.focus();
            return;
          }
        }
        if ((wantsReminder || reminder) && savedId) {
          try {
            await configureEquipmentReminder(savedId, { ...this.reminderPayload(form, reminder), expected_revision: reminderRevision });
          } catch (err) {
            if (this.destroyed) {return;}
            // The task stands; say so, and let Save retry the reminder alone.
            problem.textContent = `${translate('tasks_saved_reminder_failed')} ${apiErrorMessage(err, 'equipment_reminder_save_failed')}`;
            problem.hidden = false;
            problem.focus();
            return;
          }
        }
        // Saving succeeded even if the subsequent refresh fails.
        form.removeAttribute('aria-busy');
        modal.close();
        if (this.destroyed) {return;}
        this.app.showMessage(translate('tasks_saved'), 'success');
        await this.init();
        if (!this.destroyed) {
          const target = task ? document.querySelector(`[data-task-edit="${task.id}"]`) : document.getElementById('tasks-create');
          (target || document.getElementById('tasks-retry'))?.focus();
        }
      });
    });
  }
}
