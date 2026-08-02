// AchievementEditor.js
// Reachable participant-level controls for objective achievements.
import { translate } from '../../app.js';
import { BaseModule } from '../../utils/BaseModule.js';
import { setContent } from '../../utils/DOMUtils.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { getTodayISO } from '../../utils/DateUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { openModal } from '../../utils/ModalUtils.js';
import { getParticipants } from '../../api/api-endpoints.js';
import { getAchievements, grantAchievements, removeAchievement } from '../../api/api-yearly-planner.js';

export class AchievementEditor extends BaseModule {
  constructor(app, { objective, onSaved }) {
    super(app);
    this.objective = objective;
    this.onSaved = onSaved;
    this.modal = null;
    this.participants = [];
    this.achievements = [];
  }

  async open() {
    this.modal = openModal({
      id: 'yp-achievement-editor',
      title: escapeHTML(this.objective.title),
      body: '<div class="loading-spinner" role="status"></div>',
      footer: `
        <button type="button" class="button button--secondary" data-modal-close>${escapeHTML(translate('cancel'))}</button>
        <button type="button" class="button button--primary" id="yp-achievement-save">${escapeHTML(translate('save'))}</button>
      `,
      onClose: () => this.destroy()
    });
    this.addEventListener(
      this.modal.overlay.querySelector('#yp-achievement-save'),
      'click',
      () => this.save()
    );
    try {
      const [participantsResponse, achievementsResponse] = await Promise.all([
        getParticipants(),
        getAchievements({ objective_id: this.objective.id }, { forceRefresh: true })
      ]);
      this.participants = Array.isArray(participantsResponse?.data) ? participantsResponse.data : [];
      this.achievements = Array.isArray(achievementsResponse?.data) ? achievementsResponse.data : [];
      this.render();
    } catch (err) {
      debugError('Error loading objective achievements:', err);
      this.app.showMessage(translate('yearly_planner_achievement_load_error'), 'error');
      this.modal.close();
    }
  }

  render() {
    const body = this.modal?.overlay.querySelector('.modal-body');
    if (!body) {
      return;
    }
    const achievedIds = new Set(this.achievements.map(item => Number(item.participant_id)));
    setContent(body, `
      <div class="yp-achievements">
        <p>${escapeHTML(translate('yearly_planner_achievement_help'))}</p>
        ${this.participants.length === 0 ? `
          <p class="empty-state">${escapeHTML(translate('no_participants'))}</p>
        ` : `
          <div class="yp-achievements__list">
            ${this.participants.map(participant => {
              const name = participant.full_name || [participant.first_name, participant.last_name].filter(Boolean).join(' ');
              return `
                <label class="yp-achievements__participant">
                  <input type="checkbox" value="${participant.id}" ${achievedIds.has(Number(participant.id)) ? 'checked' : ''}>
                  <span>${escapeHTML(name || String(participant.id))}</span>
                </label>
              `;
            }).join('')}
          </div>
        `}
      </div>
    `);
  }

  async save() {
    const selected = new Set(
      Array.from(this.modal.overlay.querySelectorAll('.yp-achievements__participant input:checked'))
        .map(input => parseInt(input.value, 10))
    );
    const existing = new Map(this.achievements.map(item => [Number(item.participant_id), item]));
    const additions = [...selected].filter(id => !existing.has(id));
    const removals = [...existing.entries()].filter(([id]) => !selected.has(id)).map(([, item]) => item);

    try {
      if (additions.length > 0) {
        await grantAchievements({
          objective_id: this.objective.id,
          participant_ids: additions,
          achieved_date: getTodayISO(),
          attribution_source: 'manual'
        });
      }
      await Promise.all(removals.map(item => removeAchievement(item.id)));
      this.modal.close();
      this.app.showMessage(translate('yearly_planner_achievements_saved'), 'success');
      await this.onSaved?.();
    } catch (err) {
      debugError('Error saving objective achievements:', err);
      this.app.showMessage(translate('yearly_planner_error_saving'), 'error');
    }
  }
}
