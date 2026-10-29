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

  statusOptions(current) {
    return Object.entries(CONFIG.TASKS.STATUS_KEYS).map(([status, key]) =>
      `<option value="${status}" ${current === status ? 'selected' : ''}>${translate(key)}</option>`).join('');
  }

  render() {
    if (this.destroyed) {return;}
    const cards = this.tasks.map((task) => `<li class="card task-card">
      <h2>${escapeHTML(task.title)}</h2>
      <p>${escapeHTML(this.eventName(task))}</p>
      <p>${translate('tasks_assignee')}: ${escapeHTML(task.assignee_name || translate('tasks_member'))}</p>
      <p>${translate('tasks_due')}: <time datetime="${escapeAttribute(task.due_date)}">${escapeHTML(formatDate(task.due_date, this.app.lang))}</time></p>
      ${task.equipment_lot_id ? `<p>${escapeHTML(translate(CAMP_LOTS.ROLE_KEYS[task.equipment_lot_role]))}</p>
        ${!this.unitView || task.assignee_id === getCurrentUserId() || hasPermission('camp_lots.view')
    ? `<a class="button button--secondary" href="/${this.unitView && hasPermission('camp_lots.view') ? 'camp-lots' : 'my-camp-lots'}/${Number(task.meeting_id)}">${translate('camp_lots_open')}</a>`
    : `<p>${translate('camp_lot_task_managed')}</p>`}` : `<form data-task-status="${Number(task.id)}" class="task-status-form">
        <label for="tasks-status-${Number(task.id)}">${translate('tasks_status')}</label>
        <select id="tasks-status-${Number(task.id)}" name="status" ${this.readOnly ? 'disabled' : ''}>${this.statusOptions(task.status)}</select>
        <button type="submit" class="button button--secondary" ${this.readOnly ? 'disabled' : ''}>${translate('save')}</button>
      </form>`}
      ${!task.equipment_lot_id && this.unitView && !this.readOnly ? `<button type="button" class="button button--ghost" data-task-edit="${Number(task.id)}">${translate('edit')}</button>` : ''}
      ${this.renderReminder(task)}
      <details><summary>${translate('tasks_history')}</summary><ul>${(task.history || []).map((entry) => `<li>
        ${escapeHTML(translate(CONFIG.TASKS.STATUS_KEYS[entry.status]))} · ${escapeHTML(entry.changed_by_name || translate('tasks_member'))} ·
        ${escapeHTML(formatTimestamp(entry.changed_at, this.app.lang))}</li>`).join('')}</ul></details>
    </li>`).join('');
    const root = document.getElementById('app');
    setContent(root, `<section class="page tasks-page">
      ${renderBackLink()}<h1>${translate('tile_tasks')}</h1>
      <p>${translate('tasks_intro')}</p>
      ${this.canManage ? `<div class="task-toolbar">
        <button type="button" class="button button--secondary" id="tasks-view" data-archive-safe>${translate(this.unitView ? 'tasks_mine' : 'tasks_unit')}</button>
        ${this.readOnly ? '' : `<button type="button" class="button button--primary" id="tasks-create">${translate('tasks_create')}</button>`}
      </div>` : ''}
      ${cards ? `<ul class="task-list">${cards}</ul>` : `<p class="empty-state">${translate('tasks_empty')}</p>`}
    </section>`);
    root.querySelectorAll('[data-equipment-reminder]').forEach((button) => button.addEventListener('click', () =>
      this.editReminder(this.tasks.find((task) => task.id === Number(button.dataset.equipmentReminder)))));
    root.querySelectorAll('[data-equipment-confirm]').forEach((button) => button.addEventListener('click', () => {
      button.disabled = true;
      const task = this.tasks.find((item) => item.id === Number(button.dataset.equipmentConfirm));
      this.confirmReminder(task).finally(() => {button.disabled = false;});
    }));
    document.getElementById('tasks-view')?.addEventListener('click', () => {
      this.unitView = !this.unitView;
      this.init();
    });
    document.getElementById('tasks-create')?.addEventListener('click', () => this.edit());
    root.querySelectorAll('[data-task-edit]').forEach((button) => button.addEventListener('click', () =>
      this.edit(this.tasks.find((task) => task.id === Number(button.dataset.taskEdit)))));
    root.querySelectorAll('[data-task-status]').forEach((form) => form.addEventListener('submit', (event) => {
      event.preventDefault();
      withFormBusy(form, async () => {
        const task = this.tasks.find((item) => item.id === Number(form.dataset.taskStatus));
        try {
          await changeTaskStatus(task.id, form.elements.status.value, task.status, !this.unitView);
        } catch (err) {
          if (!this.destroyed) {this.app.showMessage(apiErrorMessage(err, 'tasks_save_failed'), 'error');}
          return;
        }
        if (this.destroyed) {return;}
        this.app.showMessage(translate('tasks_saved'), 'success');
        await this.init();
        if (!this.destroyed) {
          (document.getElementById(`tasks-status-${task.id}`) || document.getElementById('tasks-retry'))?.focus();
        }
      });
    }));
  }

  /** Configuration and honest delivery feedback stay next to the assignment. */
  renderReminder(task) {
    const reminder = task.equipment_reminder;
    const blocked = task.assignee_active === false || task.assignee_has_email === false || task.assignee_can_confirm === false;
    const statusKeys = { pending: 'equipment_reminder_pending', sending: 'equipment_reminder_uncertain', uncertain: 'equipment_reminder_uncertain', sent: 'equipment_reminder_sent', failed: 'equipment_reminder_failed' };
    return `<section class="equipment-task-reminder" aria-label="${translate('equipment_reminder_title')}">
      ${reminder ? `<p class="equipment-reminder-materials">${escapeHTML(reminder.materials)}</p>
        <p>${translate(reminder.confirmed_at ? 'equipment_reminder_confirmed' : (statusKeys[reminder.delivery_status] || 'equipment_reminder_pending'))}</p>
        ${blocked ? `<p>${translate('equipment_reminder_unavailable')}</p>` : ''}
        ${!reminder.confirmed_at && task.assignee_id === getCurrentUserId() && !this.readOnly
    ? `<button type="button" class="button button--primary" data-equipment-confirm="${Number(task.id)}">${translate('equipment_reminder_confirm')}</button>` : ''}` : ''}
      ${this.canManage && !this.readOnly ? `<button type="button" class="button button--secondary" data-equipment-reminder="${Number(task.id)}">${translate(reminder ? 'equipment_reminder_edit' : 'equipment_reminder_enable')}</button>` : ''}
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
    document.querySelector(`[data-equipment-reminder="${task.id}"]`)?.focus();
  }

  /** One labelled form configures material, advance notice and minimum repeat delay. */
  editReminder(task) {
    const limits = CONFIG.EQUIPMENT_REMINDERS;
    const value = task.equipment_reminder;
    const modal = openModal({
      id: 'equipment-reminder-editor', title: translate('equipment_reminder_title'), closeOnBackdrop: false,
      canClose: () => document.getElementById('equipment-reminder-form')?.getAttribute('aria-busy') !== 'true',
      body: `<form id="equipment-reminder-form" class="task-editor">
        <p>${escapeHTML(task.title)}</p><p>${translate('equipment_reminder_intro')}</p>
        <label for="equipment-reminder-enabled"><input id="equipment-reminder-enabled" type="checkbox" name="reminder_enabled" checked>${translate('equipment_reminder_enable')}</label>
        <label for="equipment-reminder-materials">${translate('equipment_reminder_materials')}</label>
        <textarea id="equipment-reminder-materials" name="reminder_materials" required maxlength="${limits.MATERIALS_MAX_LENGTH}" rows="6">${escapeHTML(value?.materials || task.title)}</textarea>
        <label for="equipment-reminder-lead">${translate('equipment_reminder_lead')}</label>
        <input id="equipment-reminder-lead" name="reminder_lead" type="number" required min="0" max="${limits.MAX_LEAD_DAYS}" step="1" value="${value?.lead_days ?? limits.DEFAULT_LEAD_DAYS}">
        <label for="equipment-reminder-repeat">${translate('equipment_reminder_repeat')}</label>
        <input id="equipment-reminder-repeat" name="reminder_repeat" type="number" required min="${limits.MIN_REPEAT_HOURS}" max="${limits.MAX_REPEAT_HOURS}" step="1" value="${value?.repeat_hours ?? limits.DEFAULT_REPEAT_HOURS}">
        <p id="equipment-reminder-error" role="alert" tabindex="-1" hidden></p>
      </form>`,
      footer: `<button type="button" class="button button--secondary" data-modal-close>${translate('cancel')}</button>
        <button type="submit" form="equipment-reminder-form" class="button button--primary">${translate('save')}</button>`,
    });
    const form = document.getElementById('equipment-reminder-form');
    form.elements.reminder_enabled.addEventListener('change', () => {
      ['reminder_materials', 'reminder_lead', 'reminder_repeat'].forEach((name) => {
        form.elements[name].disabled = !form.elements.reminder_enabled.checked;
      });
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      withFormBusy(form, async () => {
        try {
          await configureEquipmentReminder(task.id, {
            enabled: form.elements.reminder_enabled.checked, expected_revision: value?.revision || 0,
            materials: form.elements.reminder_materials.value.trim(), lead_days: Number(form.elements.reminder_lead.value),
            repeat_hours: Number(form.elements.reminder_repeat.value),
          });
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

  /**
   * Open a task form with minimal event and member choices. A failed submission
   * retains the input; the modal cannot close while saving.
   * @param {Object|null} task - Existing task, or null to create
   */
  async edit(task = null) {
    let options;
    try {
      options = (await getTaskOptions()).data;
    } catch (err) {
      if (!this.destroyed) {this.app.showMessage(apiErrorMessage(err, 'tasks_load_failed'), 'error');}
      return;
    }
    if (this.destroyed) {return;}
    const eventValue = task ? `${task.activity_id ? 'activity' : 'meeting'}:${task.activity_id || task.meeting_id}` : '';
    const events = [
      ...options.activities.map((item) => ({ value: `activity:${item.id}`, label: item.name, date: item.date })),
      ...options.meetings.map((item) => ({ value: `meeting:${item.id}`, label: item.name || translate('tasks_meeting'), date: item.date })),
    ];
    if (task && !events.some((item) => item.value === eventValue)) {
      events.push({ value: eventValue, label: this.eventName(task), date: task.meeting_date });
    }
    const modal = openModal({
      id: 'tasks-editor', title: translate(task ? 'tasks_edit' : 'tasks_create'),
      closeOnBackdrop: false,
      canClose: () => document.getElementById('tasks-form')?.getAttribute('aria-busy') !== 'true',
      body: `<form id="tasks-form" class="task-editor">
        <label for="tasks-title">${translate('tasks_title_label')}</label>
        <input id="tasks-title" name="task_title" required maxlength="${CONFIG.TASKS.TITLE_MAX_LENGTH}" value="${escapeAttribute(task?.title || '')}">
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
        <p id="tasks-form-error" role="alert" tabindex="-1" hidden></p>
      </form>`,
      footer: `<button type="button" class="button button--secondary" data-modal-close>${translate('cancel')}</button>
        <button type="submit" class="button button--primary" form="tasks-form">${translate('save')}</button>`,
    });
    const form = document.getElementById('tasks-form');
    form.addEventListener('input', () => {
      form.querySelectorAll('[aria-invalid]').forEach((input) => {
        input.removeAttribute('aria-invalid');
        input.removeAttribute('aria-describedby');
      });
      document.getElementById('tasks-form-error').hidden = true;
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      withFormBusy(form, async () => {
        const [kind, id] = form.elements.task_event.value.split(':');
        const payload = {
          title: form.elements.task_title.value.trim(), assignee_id: form.elements.task_assignee.value,
          due_date: form.elements.task_due.value,
          activity_id: kind === 'activity' ? Number(id) : null,
          meeting_id: kind === 'meeting' ? Number(id) : null,
        };
        try {
          await saveTask(payload, task?.id || null);
        } catch (err) {
          if (this.destroyed) {return;}
          const problem = document.getElementById('tasks-form-error');
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
