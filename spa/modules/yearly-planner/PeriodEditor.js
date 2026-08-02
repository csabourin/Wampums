// PeriodEditor.js
// Edit period dates and its safe, user-selected year-view colour.
import { translate } from '../../app.js';
import { BaseModule } from '../../utils/BaseModule.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { openModal } from '../../utils/ModalUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { updatePeriod } from '../../api/api-yearly-planner.js';
import { periodColor, PERIOD_FALLBACK_COLORS } from './PlannerModel.js';

export class PeriodEditor extends BaseModule {
  constructor(app, { period, onSaved }) {
    super(app);
    this.period = period;
    this.onSaved = onSaved;
  }

  open() {
    const color = periodColor(this.period, 0);
    const modal = openModal({
      id: 'yp-period-editor',
      title: escapeHTML(translate('yearly_planner_edit_period')),
      body: `
        <div class="yp-period-editor">
          <label class="form-group">
            <span>${escapeHTML(translate('title'))}</span>
            <input type="text" id="yp-period-edit-title" maxlength="255" value="${escapeHTML(this.period.title || '')}" required>
          </label>
          <label class="form-group">
            <span>${escapeHTML(translate('yearly_planner_start_date'))}</span>
            <input type="date" id="yp-period-edit-start" value="${escapeHTML(String(this.period.start_date).slice(0, 10))}" required>
          </label>
          <label class="form-group">
            <span>${escapeHTML(translate('yearly_planner_end_date'))}</span>
            <input type="date" id="yp-period-edit-end" value="${escapeHTML(String(this.period.end_date).slice(0, 10))}" required>
          </label>
          <fieldset class="yp-period-editor__colors">
            <legend>${escapeHTML(translate('yearly_planner_period_color'))}</legend>
            <div class="yp-period-editor__swatches">
              ${PERIOD_FALLBACK_COLORS.map(swatch => `
                <button type="button" class="yp-period-editor__swatch ${swatch === color ? 'is-selected' : ''}"
                        data-period-color="${swatch}" style="--period-swatch:${swatch}"
                        aria-label="${escapeHTML(swatch)}" aria-pressed="${swatch === color}"></button>
              `).join('')}
              <label class="yp-period-editor__custom">
                <span>${escapeHTML(translate('yearly_planner_custom_color'))}</span>
                <input type="color" id="yp-period-edit-color" value="${escapeHTML(color)}">
              </label>
            </div>
          </fieldset>
        </div>
      `,
      footer: `
        <button type="button" class="button button--secondary" data-modal-close>${escapeHTML(translate('cancel'))}</button>
        <button type="button" class="button button--primary" id="yp-period-edit-save">${escapeHTML(translate('save'))}</button>
      `,
      onClose: () => this.destroy()
    });

    const colorInput = modal.overlay.querySelector('#yp-period-edit-color');
    modal.overlay.querySelectorAll('[data-period-color]').forEach(button => {
      button.addEventListener('click', () => {
        colorInput.value = button.dataset.periodColor;
        modal.overlay.querySelectorAll('[data-period-color]').forEach(item => {
          const selected = item === button;
          item.classList.toggle('is-selected', selected);
          item.setAttribute('aria-pressed', String(selected));
        });
      });
    });
    colorInput?.addEventListener('input', () => {
      modal.overlay.querySelectorAll('[data-period-color]').forEach(item => {
        item.classList.remove('is-selected');
        item.setAttribute('aria-pressed', 'false');
      });
    });
    modal.overlay.querySelector('#yp-period-edit-save')?.addEventListener('click', async () => {
      const title = modal.overlay.querySelector('#yp-period-edit-title')?.value.trim();
      const startDate = modal.overlay.querySelector('#yp-period-edit-start')?.value;
      const endDate = modal.overlay.querySelector('#yp-period-edit-end')?.value;
      if (!title || !startDate || !endDate || endDate < startDate) {
        this.app.showMessage(translate('plan_fields_required'), 'error');
        return;
      }
      try {
        await updatePeriod(this.period.id, {
          title,
          start_date: startDate,
          end_date: endDate,
          settings: { ...(this.period.settings || {}), color: colorInput.value }
        });
        modal.close();
        this.app.showMessage(translate('yearly_planner_period_updated'), 'success');
        await this.onSaved?.();
      } catch (err) {
        debugError('Error updating period:', err);
        this.app.showMessage(translate('yearly_planner_error_saving'), 'error');
      }
    });
  }
}
