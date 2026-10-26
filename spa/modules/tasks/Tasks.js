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
import { getMyTasks, getUnitTasks, getTaskOptions, saveTask, changeTaskStatus } from '../../api/api-tasks.js';
import { openModal } from '../../utils/ModalUtils.js';

export class Tasks {
  constructor(app) {
    this.app = app;
    this.canManage = hasPermission('tasks.manage');
    this.readOnly = isDemoUser();
    this.unitView = false;
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
      this.tasks = response.data;
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
      <form data-task-status="${Number(task.id)}" class="task-status-form">
        <label for="tasks-status-${Number(task.id)}">${translate('tasks_status')}</label>
        <select id="tasks-status-${Number(task.id)}" name="status" ${this.readOnly ? 'disabled' : ''}>${this.statusOptions(task.status)}</select>
        <button type="submit" class="button button--secondary" ${this.readOnly ? 'disabled' : ''}>${translate('save')}</button>
      </form>
      ${this.unitView && !this.readOnly ? `<button type="button" class="button button--ghost" data-task-edit="${Number(task.id)}">${translate('edit')}</button>` : ''}
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
    const modal = openModal({
      id: 'tasks-editor', title: translate(task ? 'tasks_edit' : 'tasks_create'),
      closeOnBackdrop: false,
      canClose: () => document.getElementById('tasks-form')?.getAttribute('aria-busy') !== 'true',
      body: `<form id="tasks-form" class="task-editor">
        <label for="tasks-title">${translate('tasks_title_label')}</label>
        <input id="tasks-title" name="task_title" required maxlength="${CONFIG.TASKS.TITLE_MAX_LENGTH}" value="${escapeAttribute(task?.title || '')}">
        <label for="tasks-event">${translate('tasks_event')}</label>
        <select id="tasks-event" name="task_event" required><option value="">${translate('tasks_choose_event')}</option>
          ${events.map((item) => `<option value="${escapeAttribute(item.value)}" ${item.value === eventValue ? 'selected' : ''}>${escapeHTML(item.label)} · ${escapeHTML(formatDate(item.date, this.app.lang))}</option>`).join('')}
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
