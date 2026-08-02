// CampSchedule.js
// Responsive editor for the per-day programme of a multi-day planner block.
import { translate } from '../../app.js';
import { BaseModule } from '../../utils/BaseModule.js';
import { setContent } from '../../utils/DOMUtils.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { formatDate } from '../../utils/DateUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { openModal } from '../../utils/ModalUtils.js';
import { confirmDestructive } from '../../utils/DialogUtils.js';
import {
  getMeetingSchedule,
  updateMeetingDay,
  addMeetingActivity,
  updateMeetingActivity,
  deleteMeetingActivity,
  copyMeetingSchedule
} from '../../api/api-yearly-planner.js';

/** Add minutes to an HH:MM time without crossing beyond one day. */
function addMinutes(time, duration) {
  const match = String(time || '').match(/^(\d{2}):(\d{2})/);
  if (!match) {
    return '';
  }
  const total = Math.min(1439, (Number(match[1]) * 60) + Number(match[2]) + (Number(duration) || 0));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** Format a database time as HH:MM. */
function shortTime(value) {
  return value ? String(value).slice(0, 5) : '';
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
  }

  /** Load and open the camp schedule editor. */
  async open() {
    this.modal = openModal({
      id: 'yp-camp-schedule',
      title: escapeHTML(translate('yearly_planner_camp_schedule')),
      body: '<div class="loading-spinner" role="status"></div>',
      footer: `<button type="button" class="button button--secondary" data-modal-close>${escapeHTML(translate('close'))}</button>`,
      onClose: () => {
        this.destroy();
        if (this.changed) {
          this.onChanged?.();
        }
      }
    });
    await this.reload();
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
      this.app.showMessage(translate('yearly_planner_schedule_load_error'), 'error');
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

        ${isEmpty && this.canManage && this.schedule.copy_sources?.length ? `
          <div class="yp-schedule__copy">
            <label class="form-group">
              <span>${escapeHTML(translate('yearly_planner_copy_previous_camp'))}</span>
              <select id="yp-schedule-source">
                ${this.schedule.copy_sources.map(source => `
                  <option value="${source.id}">
                    ${escapeHTML(source.theme || translate('yearly_planner_camp'))} —
                    ${escapeHTML(formatDate(source.meeting_date, this.lang))} (${Number(source.span_days)} ${escapeHTML(translate('days'))})
                  </option>
                `).join('')}
              </select>
            </label>
            <button type="button" class="button button--secondary" id="yp-schedule-copy">
              ${escapeHTML(translate('copy'))}
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
          <label><span>${escapeHTML(translate('yearly_planner_responsible'))}</span><input type="text" data-field="responsable" maxlength="255" value="${escapeHTML(activity.responsable || '')}"></label>
          <label><span>${escapeHTML(translate('yearly_planner_material'))}</span><textarea data-field="material" rows="2">${escapeHTML(activity.material || '')}</textarea></label>
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
        ${activity.responsable ? `<div><span class="yp-schedule-card__label">${escapeHTML(translate('yearly_planner_responsible'))}</span>${escapeHTML(activity.responsable)}</div>` : ''}
        ${activity.material ? `<div><span class="yp-schedule-card__label">${escapeHTML(translate('yearly_planner_material'))}</span>${escapeHTML(activity.material)}</div>` : ''}
        ${this.canManage ? `
          <div class="yp-schedule-card__actions">
            <button type="button" class="button button--small button--secondary" data-edit-activity="${activity.id}">${escapeHTML(translate('edit'))}</button>
            <button type="button" class="button button--small button--danger" data-delete-activity="${activity.id}">${escapeHTML(translate('delete'))}</button>
          </div>
        ` : ''}
      </article>
    `;
  }

  /** Attach handlers to the freshly rendered selected day. */
  wire() {
    const root = this.modal.overlay;
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
    root.querySelector('#yp-schedule-copy')?.addEventListener('click', () => this.copySchedule());
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
      this.app.showMessage(translate('yearly_planner_error_saving'), 'error');
    }
  }

  /** Open the compact add form with a cascaded default time. */
  openActivityForm(position) {
    const activities = this.schedule.days[this.dayOffset].activities;
    const previous = activities[Math.max(0, position - 1)];
    const suggestedTime = position > 0 ? addMinutes(previous?.start_time, previous?.duration_minutes) : '';
    const modal = openModal({
      id: 'yp-schedule-activity',
      title: escapeHTML(translate('add_activity')),
      body: `
        <div class="yp-schedule-form">
          <label class="form-group"><span>${escapeHTML(translate('time'))}</span><input type="time" id="yp-schedule-new-time" value="${suggestedTime}"></label>
          <label class="form-group"><span>${escapeHTML(translate('activity_label'))}</span><input type="text" id="yp-schedule-new-name" maxlength="255" required></label>
          <label class="form-group"><span>${escapeHTML(translate('duration_minutes'))}</span><input type="number" id="yp-schedule-new-duration" min="1" max="1440"></label>
          <label class="form-group"><span>${escapeHTML(translate('yearly_planner_responsible'))}</span><input type="text" id="yp-schedule-new-responsible" maxlength="255"></label>
          <label class="form-group"><span>${escapeHTML(translate('yearly_planner_material'))}</span><textarea id="yp-schedule-new-material" rows="2"></textarea></label>
        </div>
      `,
      footer: `
        <button type="button" class="button button--secondary" data-modal-close>${escapeHTML(translate('cancel'))}</button>
        <button type="button" class="button button--primary" id="yp-schedule-create">${escapeHTML(translate('save'))}</button>
      `
    });
    modal.overlay.querySelector('#yp-schedule-create')?.addEventListener('click', async () => {
      const name = modal.overlay.querySelector('#yp-schedule-new-name')?.value.trim();
      if (!name) {
        this.app.showMessage(translate('plan_fields_required'), 'error');
        return;
      }
      try {
        await addMeetingActivity(this.chip.meetingId, {
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
        this.app.showMessage(translate('yearly_planner_error_saving'), 'error');
      }
    });
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
    try {
      await updateMeetingActivity(activityId, {
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
      this.app.showMessage(translate('yearly_planner_error_saving'), 'error');
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
      this.app.showMessage(translate('yearly_planner_error_deleting'), 'error');
    }
  }

  async copySchedule() {
    const sourceId = parseInt(this.modal.overlay.querySelector('#yp-schedule-source')?.value, 10);
    if (!sourceId) {
      return;
    }
    try {
      await copyMeetingSchedule(this.chip.meetingId, sourceId);
      this.changed = true;
      this.app.showMessage(translate('yearly_planner_schedule_copied'), 'success');
      await this.reload();
    } catch (err) {
      debugError('Error copying camp schedule:', err);
      this.app.showMessage(translate('yearly_planner_schedule_copy_error'), 'error');
    }
  }
}
