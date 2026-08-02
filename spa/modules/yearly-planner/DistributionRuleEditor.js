// DistributionRuleEditor.js
// Create a rule and let the backend place its generated series atomically.
import { translate } from '../../app.js';
import { BaseModule } from '../../utils/BaseModule.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { openModal } from '../../utils/ModalUtils.js';
import { createDistributionRule } from '../../api/api-yearly-planner.js';

export class DistributionRuleEditor extends BaseModule {
  constructor(app, { planId, onSaved }) {
    super(app);
    this.planId = planId;
    this.onSaved = onSaved;
  }

  open() {
    const modal = openModal({
      id: 'yp-distribution-rule-editor',
      title: escapeHTML(translate('yearly_planner_add_distribution_rule')),
      body: `
        <div class="yp-distribution-editor">
          <label class="form-group"><span>${escapeHTML(translate('activity_label'))}</span><input type="text" id="yp-rule-name" maxlength="255" required></label>
          <label class="form-group"><span>${escapeHTML(translate('yearly_planner_distribution_scope'))}</span>
            <select id="yp-rule-scope">
              <option value="period">${escapeHTML(translate('yearly_planner_each_period'))}</option>
              <option value="month">${escapeHTML(translate('yearly_planner_each_month'))}</option>
              <option value="year">${escapeHTML(translate('yearly_planner_whole_year'))}</option>
            </select>
          </label>
          <label class="form-group"><span>${escapeHTML(translate('yearly_planner_placement_rule'))}</span>
            <select id="yp-rule-placement">
              <option value="evenly_spaced">${escapeHTML(translate('yearly_planner_evenly_spaced'))}</option>
              <option value="near_start">${escapeHTML(translate('yearly_planner_near_start'))}</option>
              <option value="near_end">${escapeHTML(translate('yearly_planner_near_end'))}</option>
              <option value="manual">${escapeHTML(translate('yearly_planner_manual_only'))}</option>
            </select>
          </label>
          <label class="form-group"><span>${escapeHTML(translate('yearly_planner_occurrences_per_scope'))}</span><input type="number" id="yp-rule-count" min="1" max="60" value="1"></label>
          <label class="form-group"><span>${escapeHTML(translate('duration_minutes'))}</span><input type="number" id="yp-rule-duration" min="1" max="1440"></label>
          <label class="form-group"><span>${escapeHTML(translate('activity_description_label'))}</span><textarea id="yp-rule-description" rows="3"></textarea></label>
        </div>
      `,
      footer: `
        <button type="button" class="button button--secondary" data-modal-close>${escapeHTML(translate('cancel'))}</button>
        <button type="button" class="button button--primary" id="yp-rule-save">${escapeHTML(translate('save'))}</button>
      `,
      onClose: () => this.destroy()
    });
    modal.overlay.querySelector('#yp-rule-save')?.addEventListener('click', async () => {
      const activityName = modal.overlay.querySelector('#yp-rule-name')?.value.trim();
      if (!activityName) {
        this.app.showMessage(translate('plan_fields_required'), 'error');
        return;
      }
      try {
        await createDistributionRule(this.planId, {
          activity_name: activityName,
          distribution_scope: modal.overlay.querySelector('#yp-rule-scope').value,
          placement_rule: modal.overlay.querySelector('#yp-rule-placement').value,
          occurrences_per_scope: parseInt(modal.overlay.querySelector('#yp-rule-count').value, 10) || 1,
          settings: {
            duration_minutes: parseInt(modal.overlay.querySelector('#yp-rule-duration').value, 10) || null,
            description: modal.overlay.querySelector('#yp-rule-description').value.trim() || null
          }
        });
        modal.close();
        this.app.showMessage(translate('yearly_planner_distribution_created'), 'success');
        await this.onSaved?.();
      } catch (err) {
        debugError('Error creating distribution rule:', err);
        this.app.showMessage(translate('yearly_planner_error_saving'), 'error');
      }
    });
  }
}
