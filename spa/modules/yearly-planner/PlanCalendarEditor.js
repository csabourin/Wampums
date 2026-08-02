// PlanCalendarEditor.js
// Edit blackout ranges and anchor dates, then safely regenerate untouched dates.
import { translate } from '../../app.js';
import { BaseModule } from '../../utils/BaseModule.js';
import { setContent } from '../../utils/DOMUtils.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { openModal } from '../../utils/ModalUtils.js';
import { confirmDestructive } from '../../utils/DialogUtils.js';
import { updateYearPlan } from '../../api/api-yearly-planner.js';

export class PlanCalendarEditor extends BaseModule {
  constructor(app, { plan, onSaved }) {
    super(app);
    this.plan = plan;
    this.onSaved = onSaved;
    this.blackouts = structuredClone(plan.blackout_dates || []);
    this.anchors = structuredClone(plan.anchors || []);
    this.modal = null;
  }

  open() {
    this.modal = openModal({
      id: 'yp-calendar-editor',
      title: escapeHTML(translate('yearly_planner_calendar_rules')),
      body: '',
      footer: `
        <button type="button" class="button button--secondary" data-modal-close>${escapeHTML(translate('cancel'))}</button>
        <button type="button" class="button button--primary" id="yp-calendar-rules-save">${escapeHTML(translate('save'))}</button>
      `,
      onClose: () => this.destroy()
    });
    this.render();
  }

  render() {
    const body = this.modal.overlay.querySelector('.modal-body');
    setContent(body, `
      <div class="yp-calendar-editor">
        <p class="section-description">${escapeHTML(translate('yearly_planner_regenerate_help'))}</p>
        <section>
          <div class="yp-calendar-editor__heading">
            <h3>${escapeHTML(translate('yearly_planner_blackout_dates'))}</h3>
            <button type="button" class="button button--small button--secondary" id="yp-blackout-add">${escapeHTML(translate('add'))}</button>
          </div>
          <div class="yp-calendar-editor__rows">
            ${this.blackouts.map((blackout, index) => `
              <div class="yp-calendar-editor__row" data-blackout-index="${index}">
                <label><span>${escapeHTML(translate('yearly_planner_start_date'))}</span><input type="date" data-field="start_date" value="${escapeHTML(blackout.start_date || '')}"></label>
                <label><span>${escapeHTML(translate('yearly_planner_end_date'))}</span><input type="date" data-field="end_date" value="${escapeHTML(blackout.end_date || '')}"></label>
                <label><span>${escapeHTML(translate('label'))}</span><input type="text" data-field="label" maxlength="255" value="${escapeHTML(blackout.label || '')}"></label>
                <button type="button" class="button button--small button--danger" data-remove-blackout="${index}">${escapeHTML(translate('remove'))}</button>
              </div>
            `).join('') || `<p>${escapeHTML(translate('yearly_planner_no_blackouts'))}</p>`}
          </div>
        </section>
        <section>
          <div class="yp-calendar-editor__heading">
            <h3>${escapeHTML(translate('yearly_planner_anchor_dates'))}</h3>
            <button type="button" class="button button--small button--secondary" id="yp-anchor-add">${escapeHTML(translate('add'))}</button>
          </div>
          <div class="yp-calendar-editor__rows">
            ${this.anchors.map((anchor, index) => `
              <div class="yp-calendar-editor__row" data-anchor-index="${index}">
                <label><span>${escapeHTML(translate('date'))}</span><input type="date" data-field="date" value="${escapeHTML(anchor.date || '')}"></label>
                <label><span>${escapeHTML(translate('type'))}</span>
                  <select data-field="type">
                    <option value="meeting" ${anchor.type === 'meeting' ? 'selected' : ''}>${escapeHTML(translate('meeting'))}</option>
                    <option value="event" ${anchor.type === 'event' ? 'selected' : ''}>${escapeHTML(translate('yearly_planner_kind_special'))}</option>
                    <option value="no_meeting" ${anchor.type === 'no_meeting' ? 'selected' : ''}>${escapeHTML(translate('yearly_planner_no_meeting'))}</option>
                  </select>
                </label>
                <label><span>${escapeHTML(translate('yearly_planner_theme'))}</span><input type="text" data-field="theme" maxlength="255" value="${escapeHTML(anchor.theme || '')}"></label>
                <label><span>${escapeHTML(translate('yearly_planner_location'))}</span><input type="text" data-field="location" maxlength="500" value="${escapeHTML(anchor.location || '')}"></label>
                <button type="button" class="button button--small button--danger" data-remove-anchor="${index}">${escapeHTML(translate('remove'))}</button>
              </div>
            `).join('') || `<p>${escapeHTML(translate('yearly_planner_no_anchors'))}</p>`}
          </div>
        </section>
      </div>
    `);
    this.wireBody();
    this.modal.overlay.querySelector('#yp-calendar-rules-save')?.addEventListener('click', () => this.save());
  }

  capture() {
    this.blackouts = Array.from(this.modal.overlay.querySelectorAll('[data-blackout-index]')).map(row => ({
      start_date: row.querySelector('[data-field="start_date"]').value,
      end_date: row.querySelector('[data-field="end_date"]').value,
      label: row.querySelector('[data-field="label"]').value.trim()
    }));
    this.anchors = Array.from(this.modal.overlay.querySelectorAll('[data-anchor-index]')).map(row => ({
      date: row.querySelector('[data-field="date"]').value,
      type: row.querySelector('[data-field="type"]').value,
      theme: row.querySelector('[data-field="theme"]').value.trim(),
      location: row.querySelector('[data-field="location"]').value.trim()
    }));
  }

  wireBody() {
    this.modal.overlay.querySelector('#yp-blackout-add')?.addEventListener('click', () => {
      this.capture();
      this.blackouts.push({ start_date: '', end_date: '', label: '' });
      this.render();
    });
    this.modal.overlay.querySelector('#yp-anchor-add')?.addEventListener('click', () => {
      this.capture();
      this.anchors.push({ date: '', type: 'meeting', theme: '', location: '' });
      this.render();
    });
    this.modal.overlay.querySelectorAll('[data-remove-blackout]').forEach(button => {
      button.addEventListener('click', () => {
        this.capture();
        this.blackouts.splice(parseInt(button.dataset.removeBlackout, 10), 1);
        this.render();
      });
    });
    this.modal.overlay.querySelectorAll('[data-remove-anchor]').forEach(button => {
      button.addEventListener('click', () => {
        this.capture();
        this.anchors.splice(parseInt(button.dataset.removeAnchor, 10), 1);
        this.render();
      });
    });
  }

  async save() {
    this.capture();
    const invalidBlackout = this.blackouts.some(item => !item.start_date || !item.end_date || item.end_date < item.start_date);
    const invalidAnchor = this.anchors.some(item => !item.date);
    if (invalidBlackout || invalidAnchor) {
      this.app.showMessage(translate('plan_fields_required'), 'error');
      return;
    }
    const confirmed = await confirmDestructive({
      title: translate('yearly_planner_regenerate_dates'),
      message: translate('yearly_planner_regenerate_confirm')
    });
    if (!confirmed) {
      return;
    }
    try {
      await updateYearPlan(this.plan.id, {
        blackout_dates: this.blackouts,
        anchors: this.anchors,
        regenerate_meetings: true
      });
      this.modal.close();
      this.app.showMessage(translate('yearly_planner_calendar_rules_saved'), 'success');
      await this.onSaved?.();
    } catch (err) {
      debugError('Error updating calendar rules:', err);
      this.app.showMessage(translate('yearly_planner_error_saving'), 'error');
    }
  }
}
