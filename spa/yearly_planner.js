// yearly_planner.js
// Yearly Meeting Planner module - Plan an entire year of meetings, periods, and objectives
import { translate } from './app.js';
import { debugLog, debugError } from './utils/DebugUtils.js';
import { setContent, loadStylesheet } from './utils/DOMUtils.js';
import { escapeHTML } from './utils/SecurityUtils.js';
import { formatDate, parseDate } from './utils/DateUtils.js';
import { BaseModule } from './utils/BaseModule.js';
import { hasPermission } from './utils/PermissionUtils.js';
import { skeletonTable } from './utils/SkeletonUtils.js';
import {
  getYearPlans,
  getYearPlan,
  createYearPlan,
  updateYearPlan,
  deleteYearPlan,
  createPeriod,
  updatePeriod,
  deletePeriod,
  createObjective,
  updateObjective,
  deleteObjective,
  updateYearPlanMeeting,
  addMeetingActivity,
  deleteMeetingActivity,
  getActivityLibrary,
  createLibraryActivity,
  deleteLibraryActivity,
  createDistributionRule,
  deleteDistributionRule
} from './api/api-yearly-planner.js';

const VIEW = {
  LIST: 'list',
  PLAN_DETAIL: 'plan_detail',
  MEETING_DETAIL: 'meeting_detail',
  LIBRARY: 'library'
};

export class YearlyPlanner extends BaseModule {
  constructor(app) {
    super(app);
    this.plans = [];
    this.currentPlan = null;
    this.currentMeeting = null;
    this.activityLibrary = [];
    this.view = VIEW.LIST;
    this.isLoading = true;
    this.canManage = hasPermission('meetings.manage');
    this.lang = localStorage.getItem('language') || 'en';
  }

  async init() {
    await loadStylesheet('/css/yearly-planner.css');
    this.isLoading = true;
    this.render();

    try {
      await this.loadPlans();
    } catch (err) {
      debugError('Failed to init yearly planner:', err);
    }

    this.isLoading = false;
    this.render();
    this.attachEventListeners();
  }

  async loadPlans() {
    try {
      const response = await getYearPlans();
      this.plans = response?.data || [];
      debugLog('Loaded year plans:', this.plans.length);
    } catch (err) {
      debugError('Error loading year plans:', err);
      this.plans = [];
    }
  }

  async loadPlanDetail(planId) {
    try {
      this.isLoading = true;
      this.view = VIEW.PLAN_DETAIL;
      this.render();

      const response = await getYearPlan(planId);
      this.currentPlan = response?.data || null;

      this.isLoading = false;
      this.render();
      this.attachEventListeners();
    } catch (err) {
      debugError('Error loading plan detail:', err);
      this.isLoading = false;
      this.app.showMessage(translate('yearly_planner_error_loading'), 'error');
      this.render();
    }
  }

  async loadLibrary() {
    try {
      const response = await getActivityLibrary();
      this.activityLibrary = response?.data || [];
    } catch (err) {
      debugError('Error loading activity library:', err);
      this.activityLibrary = [];
    }
  }

  // =========================================================================
  // RENDERING
  // =========================================================================

  render() {
    const container = document.getElementById('app');
    if (!container) return;

    if (this.isLoading) {
      setContent(container, this.renderLoading());
      return;
    }

    switch (this.view) {
      case VIEW.PLAN_DETAIL:
        setContent(container, this.renderPlanDetail());
        break;
      case VIEW.MEETING_DETAIL:
        setContent(container, this.renderMeetingDetail());
        break;
      case VIEW.LIBRARY:
        setContent(container, this.renderLibraryView());
        break;
      default:
        setContent(container, this.renderPlanList());
    }
  }

  renderLoading() {
    return `
      <section class="page yearly-planner">
        <header class="page__header">
          <h1>${translate('yearly_planner_title')}</h1>
        </header>
        ${skeletonTable ? skeletonTable(5) : '<div class="loading-spinner"></div>'}
      </section>
    `;
  }

  renderPlanList() {
    return `
      <section class="page yearly-planner">
        <header class="page__header">
          <h1>${translate('yearly_planner_title')}</h1>
          <div class="page__actions">
            ${this.canManage ? `
              <button class="button button--secondary" id="yp-library-btn">
                <i class="fas fa-book"></i> ${translate('yearly_planner_activity_library')}
              </button>
              <button class="button button--primary" id="yp-create-btn">
                <i class="fas fa-plus"></i> ${translate('yearly_planner_create')}
              </button>
            ` : ''}
          </div>
        </header>

        ${this.plans.length === 0 ? `
          <div class="empty-state">
            <i class="fas fa-calendar-alt empty-state__icon"></i>
            <p>${translate('yearly_planner_empty')}</p>
            ${this.canManage ? `
              <button class="button button--primary" id="yp-create-empty-btn">
                ${translate('yearly_planner_create_first')}
              </button>
            ` : ''}
          </div>
        ` : `
          <div class="yp-plan-list">
            ${this.plans.map(plan => this.renderPlanCard(plan)).join('')}
          </div>
        `}
      </section>
    `;
  }

  renderPlanCard(plan) {
    const startDate = formatDate(plan.start_date, this.lang);
    const endDate = formatDate(plan.end_date, this.lang);
    const safeName = escapeHTML(plan.title);
    const meetingCount = plan.meeting_count || 0;
    const periodCount = plan.period_count || 0;

    return `
      <div class="yp-plan-card" data-plan-id="${plan.id}">
        <div class="yp-plan-card__header">
          <h3 class="yp-plan-card__title">${safeName}</h3>
          ${this.canManage ? `
            <button class="button button--small button--danger yp-delete-plan-btn" data-id="${plan.id}" title="${translate('delete')}">
              <i class="fas fa-trash"></i>
            </button>
          ` : ''}
        </div>
        <div class="yp-plan-card__meta">
          <span><i class="fas fa-calendar"></i> ${startDate} — ${endDate}</span>
          <span><i class="fas fa-layer-group"></i> ${periodCount} ${translate('yearly_planner_periods')}</span>
          <span><i class="fas fa-calendar-check"></i> ${meetingCount} ${translate('yearly_planner_meetings')}</span>
        </div>
        <button class="button button--primary button--block yp-open-plan-btn" data-id="${plan.id}">
          ${translate('yearly_planner_open')}
        </button>
      </div>
    `;
  }

  renderPlanDetail() {
    if (!this.currentPlan) {
      return `<p>${translate('yearly_planner_not_found')}</p>`;
    }

    const plan = this.currentPlan;
    const safeName = escapeHTML(plan.title);
    const periods = plan.periods || [];
    const meetings = plan.meetings || [];
    const objectives = plan.objectives || [];

    // Separate root and sub objectives
    const rootObjectives = objectives.filter(o => !o.parent_id);
    const subObjectiveMap = {};
    objectives.filter(o => o.parent_id).forEach(o => {
      if (!subObjectiveMap[o.parent_id]) subObjectiveMap[o.parent_id] = [];
      subObjectiveMap[o.parent_id].push(o);
    });

    const today = new Date().toISOString().split('T')[0];

    return `
      <section class="page yearly-planner">
        <header class="page__header">
          <button class="button button--text yp-back-btn" id="yp-back-to-list">
            <i class="fas fa-arrow-left"></i> ${translate('back')}
          </button>
          <h1>${safeName}</h1>
        </header>

        <div class="yp-plan-meta">
          <span><i class="fas fa-calendar"></i> ${formatDate(plan.start_date, this.lang)} — ${formatDate(plan.end_date, this.lang)}</span>
          ${plan.default_location ? `<span><i class="fas fa-map-marker-alt"></i> ${escapeHTML(plan.default_location)}</span>` : ''}
          <span><i class="fas fa-repeat"></i> ${plan.recurrence_pattern === 'biweekly' ? translate('yearly_planner_biweekly') : translate('yearly_planner_weekly')}</span>
        </div>

        <!-- Tabs -->
        <div class="yp-tabs" role="tablist">
          <button class="yp-tab yp-tab--active" data-tab="timeline" role="tab">${translate('yearly_planner_tab_timeline')}</button>
          <button class="yp-tab" data-tab="periods" role="tab">${translate('yearly_planner_tab_periods')}</button>
          <button class="yp-tab" data-tab="objectives" role="tab">${translate('yearly_planner_tab_objectives')}</button>
        </div>

        <!-- Timeline Tab -->
        <div class="yp-tab-content yp-tab-content--active" id="yp-tab-timeline">
          ${this.renderTimeline(meetings, periods, today)}
        </div>

        <!-- Periods Tab -->
        <div class="yp-tab-content" id="yp-tab-periods" style="display:none;">
          ${this.renderPeriodsTab(periods)}
        </div>

        <!-- Objectives Tab -->
        <div class="yp-tab-content" id="yp-tab-objectives" style="display:none;">
          ${this.renderObjectivesTab(rootObjectives, subObjectiveMap, periods)}
        </div>
      </section>
    `;
  }

  renderTimeline(meetings, periods, today) {
    if (meetings.length === 0) {
      return `<div class="empty-state"><p>${translate('yearly_planner_no_meetings')}</p></div>`;
    }

    // Group meetings by period
    const periodMap = {};
    periods.forEach(p => { periodMap[p.id] = p; });

    let currentPeriodId = null;
    let html = '<div class="yp-timeline">';

    for (const meeting of meetings) {
      // Period header
      if (meeting.period_id !== currentPeriodId) {
        if (currentPeriodId !== null) html += '</div>'; // Close previous group
        currentPeriodId = meeting.period_id;
        const period = periodMap[meeting.period_id];
        html += `
          <div class="yp-timeline-group">
            <h3 class="yp-timeline-group__title">
              ${period ? escapeHTML(period.title) : translate('yearly_planner_unassigned')}
            </h3>
        `;
      }

      const isLocked = meeting.meeting_date < today;
      const isCancelled = meeting.is_cancelled;
      const stateClass = isCancelled ? 'yp-meeting--cancelled' : isLocked ? 'yp-meeting--locked' : '';
      const activityCount = meeting.activity_count || 0;

      html += `
        <div class="yp-meeting ${stateClass}" data-meeting-id="${meeting.id}">
          <div class="yp-meeting__date">
            <span class="yp-meeting__day">${formatDate(meeting.meeting_date, this.lang)}</span>
            ${meeting.start_time ? `<span class="yp-meeting__time">${meeting.start_time.substring(0, 5)}</span>` : ''}
          </div>
          <div class="yp-meeting__info">
            ${meeting.theme ? `<span class="yp-meeting__theme">${escapeHTML(meeting.theme)}</span>` : ''}
            ${meeting.location ? `<span class="yp-meeting__location"><i class="fas fa-map-marker-alt"></i> ${escapeHTML(meeting.location)}</span>` : ''}
            <span class="yp-meeting__activities">${activityCount} ${translate('activities')}</span>
          </div>
          <div class="yp-meeting__status">
            ${isCancelled ? `<span class="badge badge--danger">${translate('yearly_planner_cancelled')}</span>` :
              isLocked ? `<span class="badge badge--muted"><i class="fas fa-lock"></i> ${translate('yearly_planner_locked')}</span>` :
              `<button class="button button--small yp-edit-meeting-btn" data-id="${meeting.id}">${translate('edit')}</button>`}
          </div>
        </div>
      `;
    }

    if (currentPeriodId !== null) html += '</div>'; // Close last group
    html += '</div>';
    return html;
  }

  renderPeriodsTab(periods) {
    return `
      <div class="yp-periods">
        ${this.canManage ? `
          <button class="button button--primary" id="yp-add-period-btn">
            <i class="fas fa-plus"></i> ${translate('yearly_planner_add_period')}
          </button>
        ` : ''}
        ${periods.length === 0 ? `
          <div class="empty-state"><p>${translate('yearly_planner_no_periods')}</p></div>
        ` : periods.map(p => `
          <div class="yp-period-card" data-period-id="${p.id}">
            <div class="yp-period-card__header">
              <h4>${escapeHTML(p.title)}</h4>
              ${this.canManage ? `
                <div class="yp-period-card__actions">
                  <button class="button button--small yp-edit-period-btn" data-id="${p.id}"><i class="fas fa-edit"></i></button>
                  <button class="button button--small button--danger yp-delete-period-btn" data-id="${p.id}"><i class="fas fa-trash"></i></button>
                </div>
              ` : ''}
            </div>
            <div class="yp-period-card__meta">
              <span>${formatDate(p.start_date, this.lang)} — ${formatDate(p.end_date, this.lang)}</span>
              <span>${p.objective_count || 0} ${translate('yearly_planner_objectives')}</span>
              <span>${p.meeting_count || 0} ${translate('yearly_planner_meetings')}</span>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  renderObjectivesTab(rootObjectives, subObjectiveMap, periods) {
    return `
      <div class="yp-objectives">
        ${this.canManage ? `
          <button class="button button--primary" id="yp-add-objective-btn">
            <i class="fas fa-plus"></i> ${translate('yearly_planner_add_objective')}
          </button>
        ` : ''}
        ${rootObjectives.length === 0 ? `
          <div class="empty-state"><p>${translate('yearly_planner_no_objectives')}</p></div>
        ` : rootObjectives.map(obj => `
          <div class="yp-objective" data-objective-id="${obj.id}">
            <div class="yp-objective__header">
              <h4>${escapeHTML(obj.title)}</h4>
              <span class="badge">${obj.scope === 'participant' ? translate('yearly_planner_scope_participant') : translate('yearly_planner_scope_unit')}</span>
              ${obj.period_title ? `<span class="badge badge--info">${escapeHTML(obj.period_title)}</span>` : ''}
              ${obj.achievement_count > 0 ? `<span class="badge badge--success">${obj.achievement_count} ✓</span>` : ''}
              ${this.canManage ? `
                <button class="button button--small button--danger yp-delete-obj-btn" data-id="${obj.id}"><i class="fas fa-trash"></i></button>
              ` : ''}
            </div>
            ${obj.description ? `<p class="yp-objective__desc">${escapeHTML(obj.description)}</p>` : ''}
            ${(subObjectiveMap[obj.id] || []).length > 0 ? `
              <div class="yp-sub-objectives">
                ${subObjectiveMap[obj.id].map(sub => `
                  <div class="yp-sub-objective">
                    <span>${escapeHTML(sub.title)}</span>
                    ${sub.achievement_count > 0 ? `<span class="badge badge--success">${sub.achievement_count} ✓</span>` : ''}
                    ${this.canManage ? `
                      <button class="button button--tiny button--danger yp-delete-obj-btn" data-id="${sub.id}"><i class="fas fa-times"></i></button>
                    ` : ''}
                  </div>
                `).join('')}
              </div>
            ` : ''}
          </div>
        `).join('')}
      </div>
    `;
  }

  renderMeetingDetail() {
    if (!this.currentMeeting) {
      return `<p>${translate('meeting_not_found')}</p>`;
    }

    const m = this.currentMeeting;
    const isLocked = m.is_locked;
    const activities = m.activities || [];

    return `
      <section class="page yearly-planner">
        <header class="page__header">
          <button class="button button--text" id="yp-back-to-plan">
            <i class="fas fa-arrow-left"></i> ${translate('back')}
          </button>
          <h1>${formatDate(m.meeting_date, this.lang)}</h1>
          ${isLocked ? `<span class="badge badge--muted"><i class="fas fa-lock"></i> ${translate('yearly_planner_locked')}</span>` : ''}
        </header>

        <div class="yp-meeting-detail">
          <div class="yp-meeting-detail__info">
            ${m.theme ? `<p><strong>${translate('yearly_planner_theme')}:</strong> ${escapeHTML(m.theme)}</p>` : ''}
            ${m.location ? `<p><strong>${translate('meeting_location')}:</strong> ${escapeHTML(m.location)}</p>` : ''}
            ${m.start_time ? `<p><strong>${translate('meeting_time')}:</strong> ${m.start_time.substring(0, 5)} — ${m.end_time ? m.end_time.substring(0, 5) : ''}</p>` : ''}
            ${m.notes ? `<p><strong>${translate('notes')}:</strong> ${escapeHTML(m.notes)}</p>` : ''}
          </div>

          <h3>${translate('activities')} (${activities.length})</h3>

          ${!isLocked && this.canManage ? `
            <button class="button button--primary" id="yp-add-activity-btn">
              <i class="fas fa-plus"></i> ${translate('add_activity')}
            </button>
          ` : ''}

          ${activities.length === 0 ? `
            <div class="empty-state"><p>${translate('no_activities_scheduled')}</p></div>
          ` : `
            <div class="yp-activity-list">
              ${activities.map(a => `
                <div class="yp-activity-item" data-activity-id="${a.id}">
                  <div class="yp-activity-item__info">
                    <strong>${escapeHTML(a.name)}</strong>
                    ${a.duration_minutes ? `<span class="yp-activity-item__duration">${a.duration_minutes} min</span>` : ''}
                    ${a.description ? `<p>${escapeHTML(a.description)}</p>` : ''}
                    ${(a.objective_ids || []).length > 0 ? `
                      <span class="badge badge--info"><i class="fas fa-bullseye"></i> ${a.objective_ids.length} ${translate('yearly_planner_objectives')}</span>
                    ` : ''}
                    ${a.series_id ? `<span class="badge"><i class="fas fa-link"></i> ${translate('yearly_planner_multi_meeting')}</span>` : ''}
                  </div>
                  ${!isLocked && this.canManage ? `
                    <button class="button button--small button--danger yp-remove-activity-btn" data-id="${a.id}">
                      <i class="fas fa-trash"></i>
                    </button>
                  ` : ''}
                </div>
              `).join('')}
            </div>
          `}
        </div>
      </section>
    `;
  }

  renderLibraryView() {
    return `
      <section class="page yearly-planner">
        <header class="page__header">
          <button class="button button--text" id="yp-back-from-library">
            <i class="fas fa-arrow-left"></i> ${translate('back')}
          </button>
          <h1>${translate('yearly_planner_activity_library')}</h1>
          ${this.canManage ? `
            <button class="button button--primary" id="yp-add-library-btn">
              <i class="fas fa-plus"></i> ${translate('yearly_planner_add_library_activity')}
            </button>
          ` : ''}
        </header>

        <div class="yp-library-search">
          <input type="text" id="yp-library-search-input" class="input"
            placeholder="${translate('yearly_planner_search_activities')}" />
        </div>

        ${this.activityLibrary.length === 0 ? `
          <div class="empty-state"><p>${translate('yearly_planner_library_empty')}</p></div>
        ` : `
          <div class="yp-library-list">
            ${this.activityLibrary.map(a => `
              <div class="yp-library-item" data-lib-id="${a.id}">
                <div class="yp-library-item__info">
                  <strong>${escapeHTML(a.name)}</strong>
                  ${a.category ? `<span class="badge">${escapeHTML(a.category)}</span>` : ''}
                  ${a.description ? `<p>${escapeHTML(a.description)}</p>` : ''}
                  <div class="yp-library-item__meta">
                    ${a.estimated_duration_min ? `<span>${a.estimated_duration_min}–${a.estimated_duration_max || a.estimated_duration_min} min</span>` : ''}
                    ${a.times_used > 0 ? `<span>${translate('yearly_planner_used')} ${a.times_used}×</span>` : ''}
                    ${a.avg_rating ? `<span><i class="fas fa-star"></i> ${a.avg_rating}</span>` : ''}
                  </div>
                </div>
                ${this.canManage ? `
                  <button class="button button--small button--danger yp-delete-lib-btn" data-id="${a.id}">
                    <i class="fas fa-trash"></i>
                  </button>
                ` : ''}
              </div>
            `).join('')}
          </div>
        `}
      </section>
    `;
  }

  // =========================================================================
  // MODALS
  // =========================================================================

  showCreatePlanModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'yp-modal';
    modal.innerHTML = `
      <div class="modal">
        <div class="modal__header">
          <h2>${translate('yearly_planner_create')}</h2>
          <button class="modal__close" id="yp-modal-close">&times;</button>
        </div>
        <div class="modal__body">
          <div class="form-group">
            <label>${translate('yearly_planner_plan_title')}</label>
            <input type="text" id="yp-plan-title" class="input" required />
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>${translate('yearly_planner_start_date')}</label>
              <input type="date" id="yp-plan-start" class="input" required />
            </div>
            <div class="form-group">
              <label>${translate('yearly_planner_end_date')}</label>
              <input type="date" id="yp-plan-end" class="input" required />
            </div>
          </div>
          <div class="form-group">
            <label>${translate('yearly_planner_default_location')}</label>
            <input type="text" id="yp-plan-location" class="input" />
          </div>
          <div class="form-group">
            <label>${translate('yearly_planner_recurrence')}</label>
            <select id="yp-plan-recurrence" class="input">
              <option value="weekly">${translate('yearly_planner_weekly')}</option>
              <option value="biweekly">${translate('yearly_planner_biweekly')}</option>
            </select>
          </div>
        </div>
        <div class="modal__footer">
          <button class="button button--secondary" id="yp-modal-cancel">${translate('cancel')}</button>
          <button class="button button--primary" id="yp-modal-save">${translate('save')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#yp-modal-close').addEventListener('click', () => modal.remove());
    modal.querySelector('#yp-modal-cancel').addEventListener('click', () => modal.remove());
    modal.querySelector('#yp-modal-save').addEventListener('click', () => this.handleCreatePlan(modal));
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
  }

  showCreatePeriodModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'yp-modal';
    modal.innerHTML = `
      <div class="modal">
        <div class="modal__header">
          <h2>${translate('yearly_planner_add_period')}</h2>
          <button class="modal__close" id="yp-modal-close">&times;</button>
        </div>
        <div class="modal__body">
          <div class="form-group">
            <label>${translate('yearly_planner_period_title')}</label>
            <input type="text" id="yp-period-title" class="input" required />
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>${translate('yearly_planner_start_date')}</label>
              <input type="date" id="yp-period-start" class="input" required />
            </div>
            <div class="form-group">
              <label>${translate('yearly_planner_end_date')}</label>
              <input type="date" id="yp-period-end" class="input" required />
            </div>
          </div>
        </div>
        <div class="modal__footer">
          <button class="button button--secondary" id="yp-modal-cancel">${translate('cancel')}</button>
          <button class="button button--primary" id="yp-modal-save">${translate('save')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#yp-modal-close').addEventListener('click', () => modal.remove());
    modal.querySelector('#yp-modal-cancel').addEventListener('click', () => modal.remove());
    modal.querySelector('#yp-modal-save').addEventListener('click', () => this.handleCreatePeriod(modal));
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
  }

  showCreateObjectiveModal() {
    const periods = this.currentPlan?.periods || [];
    const objectives = this.currentPlan?.objectives || [];
    const rootObjectives = objectives.filter(o => !o.parent_id);

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'yp-modal';
    modal.innerHTML = `
      <div class="modal">
        <div class="modal__header">
          <h2>${translate('yearly_planner_add_objective')}</h2>
          <button class="modal__close" id="yp-modal-close">&times;</button>
        </div>
        <div class="modal__body">
          <div class="form-group">
            <label>${translate('yearly_planner_objective_title')}</label>
            <input type="text" id="yp-obj-title" class="input" required />
          </div>
          <div class="form-group">
            <label>${translate('yearly_planner_objective_description')}</label>
            <textarea id="yp-obj-desc" class="input" rows="3"></textarea>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>${translate('period')}</label>
              <select id="yp-obj-period" class="input">
                <option value="">${translate('yearly_planner_none')}</option>
                ${periods.map(p => `<option value="${p.id}">${escapeHTML(p.title)}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label>${translate('yearly_planner_scope')}</label>
              <select id="yp-obj-scope" class="input">
                <option value="unit">${translate('yearly_planner_scope_unit')}</option>
                <option value="participant">${translate('yearly_planner_scope_participant')}</option>
              </select>
            </div>
          </div>
          <div class="form-group">
            <label>${translate('yearly_planner_parent_objective')}</label>
            <select id="yp-obj-parent" class="input">
              <option value="">${translate('yearly_planner_none')}</option>
              ${rootObjectives.map(o => `<option value="${o.id}">${escapeHTML(o.title)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="modal__footer">
          <button class="button button--secondary" id="yp-modal-cancel">${translate('cancel')}</button>
          <button class="button button--primary" id="yp-modal-save">${translate('save')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#yp-modal-close').addEventListener('click', () => modal.remove());
    modal.querySelector('#yp-modal-cancel').addEventListener('click', () => modal.remove());
    modal.querySelector('#yp-modal-save').addEventListener('click', () => this.handleCreateObjective(modal));
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
  }

  showMeetingEditModal(meeting) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'yp-modal';
    modal.innerHTML = `
      <div class="modal">
        <div class="modal__header">
          <h2>${translate('yearly_planner_edit_meeting')}</h2>
          <button class="modal__close" id="yp-modal-close">&times;</button>
        </div>
        <div class="modal__body">
          <div class="form-group">
            <label>${translate('yearly_planner_theme')}</label>
            <input type="text" id="yp-meeting-theme" class="input" value="${escapeHTML(meeting.theme || '')}" />
          </div>
          <div class="form-group">
            <label>${translate('meeting_location')}</label>
            <input type="text" id="yp-meeting-location" class="input" value="${escapeHTML(meeting.location || '')}" />
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>${translate('meeting_time')}</label>
              <input type="time" id="yp-meeting-start" class="input" value="${meeting.start_time ? meeting.start_time.substring(0, 5) : ''}" />
            </div>
            <div class="form-group">
              <label>${translate('yearly_planner_end_time')}</label>
              <input type="time" id="yp-meeting-end" class="input" value="${meeting.end_time ? meeting.end_time.substring(0, 5) : ''}" />
            </div>
          </div>
          <div class="form-group">
            <label>${translate('notes')}</label>
            <textarea id="yp-meeting-notes" class="input" rows="3">${escapeHTML(meeting.notes || '')}</textarea>
          </div>
          <div class="form-group">
            <label class="checkbox-label">
              <input type="checkbox" id="yp-meeting-cancel" ${meeting.is_cancelled ? 'checked' : ''} />
              ${translate('yearly_planner_cancel_meeting')}
            </label>
          </div>
        </div>
        <div class="modal__footer">
          <button class="button button--secondary" id="yp-modal-cancel">${translate('cancel')}</button>
          <button class="button button--primary" id="yp-modal-save">${translate('save')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#yp-modal-close').addEventListener('click', () => modal.remove());
    modal.querySelector('#yp-modal-cancel').addEventListener('click', () => modal.remove());
    modal.querySelector('#yp-modal-save').addEventListener('click', () => this.handleUpdateMeeting(modal, meeting.id));
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
  }

  showAddActivityModal(meetingId) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'yp-modal';
    modal.innerHTML = `
      <div class="modal">
        <div class="modal__header">
          <h2>${translate('add_activity')}</h2>
          <button class="modal__close" id="yp-modal-close">&times;</button>
        </div>
        <div class="modal__body">
          <div class="form-group">
            <label>${translate('activity_label')}</label>
            <input type="text" id="yp-act-name" class="input" required />
          </div>
          <div class="form-group">
            <label>${translate('activity_description_label')}</label>
            <textarea id="yp-act-desc" class="input" rows="2"></textarea>
          </div>
          <div class="form-group">
            <label>${translate('duration_minutes')}</label>
            <input type="number" id="yp-act-duration" class="input" min="5" max="300" />
          </div>
        </div>
        <div class="modal__footer">
          <button class="button button--secondary" id="yp-modal-cancel">${translate('cancel')}</button>
          <button class="button button--primary" id="yp-modal-save">${translate('save')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#yp-modal-close').addEventListener('click', () => modal.remove());
    modal.querySelector('#yp-modal-cancel').addEventListener('click', () => modal.remove());
    modal.querySelector('#yp-modal-save').addEventListener('click', () => this.handleAddActivity(modal, meetingId));
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
  }

  showAddLibraryActivityModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'yp-modal';
    modal.innerHTML = `
      <div class="modal">
        <div class="modal__header">
          <h2>${translate('yearly_planner_add_library_activity')}</h2>
          <button class="modal__close" id="yp-modal-close">&times;</button>
        </div>
        <div class="modal__body">
          <div class="form-group">
            <label>${translate('activity_label')}</label>
            <input type="text" id="yp-lib-name" class="input" required />
          </div>
          <div class="form-group">
            <label>${translate('activity_description_label')}</label>
            <textarea id="yp-lib-desc" class="input" rows="2"></textarea>
          </div>
          <div class="form-group">
            <label>${translate('yearly_planner_category')}</label>
            <input type="text" id="yp-lib-category" class="input" />
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>${translate('yearly_planner_min_duration')}</label>
              <input type="number" id="yp-lib-min-dur" class="input" min="5" />
            </div>
            <div class="form-group">
              <label>${translate('yearly_planner_max_duration')}</label>
              <input type="number" id="yp-lib-max-dur" class="input" min="5" />
            </div>
          </div>
          <div class="form-group">
            <label>${translate('yearly_planner_material')}</label>
            <textarea id="yp-lib-material" class="input" rows="2"></textarea>
          </div>
        </div>
        <div class="modal__footer">
          <button class="button button--secondary" id="yp-modal-cancel">${translate('cancel')}</button>
          <button class="button button--primary" id="yp-modal-save">${translate('save')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#yp-modal-close').addEventListener('click', () => modal.remove());
    modal.querySelector('#yp-modal-cancel').addEventListener('click', () => modal.remove());
    modal.querySelector('#yp-modal-save').addEventListener('click', () => this.handleAddLibraryActivity(modal));
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
  }

  // =========================================================================
  // HANDLERS
  // =========================================================================

  async handleCreatePlan(modal) {
    const title = modal.querySelector('#yp-plan-title').value.trim();
    const start_date = modal.querySelector('#yp-plan-start').value;
    const end_date = modal.querySelector('#yp-plan-end').value;
    const default_location = modal.querySelector('#yp-plan-location').value.trim();
    const recurrence_pattern = modal.querySelector('#yp-plan-recurrence').value;

    if (!title || !start_date || !end_date) {
      this.app.showMessage(translate('plan_fields_required'), 'error');
      return;
    }

    try {
      await createYearPlan({ title, start_date, end_date, default_location, recurrence_pattern });
      modal.remove();
      this.app.showMessage(translate('yearly_planner_plan_created'), 'success');
      await this.loadPlans();
      this.render();
      this.attachEventListeners();
    } catch (err) {
      debugError('Error creating plan:', err);
      this.app.showMessage(translate('yearly_planner_error_creating'), 'error');
    }
  }

  async handleCreatePeriod(modal) {
    const title = modal.querySelector('#yp-period-title').value.trim();
    const start_date = modal.querySelector('#yp-period-start').value;
    const end_date = modal.querySelector('#yp-period-end').value;

    if (!title || !start_date || !end_date) {
      this.app.showMessage(translate('plan_fields_required'), 'error');
      return;
    }

    try {
      await createPeriod(this.currentPlan.id, { title, start_date, end_date });
      modal.remove();
      this.app.showMessage(translate('yearly_planner_period_created'), 'success');
      await this.loadPlanDetail(this.currentPlan.id);
    } catch (err) {
      debugError('Error creating period:', err);
      this.app.showMessage(translate('yearly_planner_error_creating'), 'error');
    }
  }

  async handleCreateObjective(modal) {
    const title = modal.querySelector('#yp-obj-title').value.trim();
    const description = modal.querySelector('#yp-obj-desc').value.trim();
    const period_id = modal.querySelector('#yp-obj-period').value || null;
    const scope = modal.querySelector('#yp-obj-scope').value;
    const parent_id = modal.querySelector('#yp-obj-parent').value || null;

    if (!title) {
      this.app.showMessage(translate('plan_fields_required'), 'error');
      return;
    }

    try {
      await createObjective(this.currentPlan.id, {
        title, description,
        period_id: period_id ? parseInt(period_id) : null,
        scope,
        parent_id: parent_id ? parseInt(parent_id) : null
      });
      modal.remove();
      this.app.showMessage(translate('yearly_planner_objective_created'), 'success');
      await this.loadPlanDetail(this.currentPlan.id);
    } catch (err) {
      debugError('Error creating objective:', err);
      this.app.showMessage(translate('yearly_planner_error_creating'), 'error');
    }
  }

  async handleUpdateMeeting(modal, meetingId) {
    const theme = modal.querySelector('#yp-meeting-theme').value.trim();
    const location = modal.querySelector('#yp-meeting-location').value.trim();
    const start_time = modal.querySelector('#yp-meeting-start').value;
    const end_time = modal.querySelector('#yp-meeting-end').value;
    const notes = modal.querySelector('#yp-meeting-notes').value.trim();
    const is_cancelled = modal.querySelector('#yp-meeting-cancel').checked;

    try {
      await updateYearPlanMeeting(meetingId, {
        theme: theme || null,
        location: location || null,
        start_time: start_time || null,
        end_time: end_time || null,
        notes: notes || null,
        is_cancelled
      });
      modal.remove();
      this.app.showMessage(translate('yearly_planner_meeting_updated'), 'success');
      await this.loadPlanDetail(this.currentPlan.id);
    } catch (err) {
      debugError('Error updating meeting:', err);
      this.app.showMessage(translate('yearly_planner_error_updating'), 'error');
    }
  }

  async handleAddActivity(modal, meetingId) {
    const name = modal.querySelector('#yp-act-name').value.trim();
    const description = modal.querySelector('#yp-act-desc').value.trim();
    const duration_minutes = parseInt(modal.querySelector('#yp-act-duration').value) || null;

    if (!name) {
      this.app.showMessage(translate('plan_fields_required'), 'error');
      return;
    }

    try {
      await addMeetingActivity(meetingId, { name, description, duration_minutes });
      modal.remove();
      this.app.showMessage(translate('yearly_planner_activity_added'), 'success');

      // Reload meeting detail
      const { getYearPlanMeeting } = await import('./api/api-yearly-planner.js');
      const response = await getYearPlanMeeting(meetingId);
      this.currentMeeting = response?.data || this.currentMeeting;
      this.render();
      this.attachEventListeners();
    } catch (err) {
      debugError('Error adding activity:', err);
      this.app.showMessage(translate('yearly_planner_error_creating'), 'error');
    }
  }

  async handleAddLibraryActivity(modal) {
    const name = modal.querySelector('#yp-lib-name').value.trim();
    const description = modal.querySelector('#yp-lib-desc').value.trim();
    const category = modal.querySelector('#yp-lib-category').value.trim();
    const estimated_duration_min = parseInt(modal.querySelector('#yp-lib-min-dur').value) || null;
    const estimated_duration_max = parseInt(modal.querySelector('#yp-lib-max-dur').value) || null;
    const material = modal.querySelector('#yp-lib-material').value.trim();

    if (!name) {
      this.app.showMessage(translate('plan_fields_required'), 'error');
      return;
    }

    try {
      await createLibraryActivity({
        name, description, category,
        estimated_duration_min, estimated_duration_max, material
      });
      modal.remove();
      this.app.showMessage(translate('yearly_planner_library_activity_added'), 'success');
      await this.loadLibrary();
      this.render();
      this.attachEventListeners();
    } catch (err) {
      debugError('Error adding library activity:', err);
      this.app.showMessage(translate('yearly_planner_error_creating'), 'error');
    }
  }

  async handleDeletePlan(planId) {
    if (!confirm(translate('yearly_planner_confirm_delete_plan'))) return;

    try {
      await deleteYearPlan(planId);
      this.app.showMessage(translate('yearly_planner_plan_deleted'), 'success');
      await this.loadPlans();
      this.render();
      this.attachEventListeners();
    } catch (err) {
      debugError('Error deleting plan:', err);
      this.app.showMessage(translate('yearly_planner_error_deleting'), 'error');
    }
  }

  async handleDeletePeriod(periodId) {
    if (!confirm(translate('yearly_planner_confirm_delete_period'))) return;

    try {
      await deletePeriod(periodId);
      this.app.showMessage(translate('yearly_planner_period_deleted'), 'success');
      await this.loadPlanDetail(this.currentPlan.id);
    } catch (err) {
      debugError('Error deleting period:', err);
      this.app.showMessage(translate('yearly_planner_error_deleting'), 'error');
    }
  }

  async handleDeleteObjective(objId) {
    if (!confirm(translate('yearly_planner_confirm_delete_objective'))) return;

    try {
      await deleteObjective(objId);
      this.app.showMessage(translate('yearly_planner_objective_deleted'), 'success');
      await this.loadPlanDetail(this.currentPlan.id);
    } catch (err) {
      debugError('Error deleting objective:', err);
      this.app.showMessage(translate('yearly_planner_error_deleting'), 'error');
    }
  }

  async handleDeleteLibraryActivity(libId) {
    if (!confirm(translate('yearly_planner_confirm_delete_library'))) return;

    try {
      await deleteLibraryActivity(libId);
      this.app.showMessage(translate('yearly_planner_library_activity_deleted'), 'success');
      await this.loadLibrary();
      this.render();
      this.attachEventListeners();
    } catch (err) {
      debugError('Error deleting library activity:', err);
      this.app.showMessage(translate('yearly_planner_error_deleting'), 'error');
    }
  }

  async handleRemoveActivity(activityId) {
    if (!confirm(translate('yearly_planner_confirm_remove_activity'))) return;

    try {
      await deleteMeetingActivity(activityId);
      this.app.showMessage(translate('yearly_planner_activity_removed'), 'success');

      // Reload meeting
      if (this.currentMeeting) {
        const { getYearPlanMeeting } = await import('./api/api-yearly-planner.js');
        const response = await getYearPlanMeeting(this.currentMeeting.id);
        this.currentMeeting = response?.data || this.currentMeeting;
        this.render();
        this.attachEventListeners();
      }
    } catch (err) {
      debugError('Error removing activity:', err);
      this.app.showMessage(translate('yearly_planner_error_deleting'), 'error');
    }
  }

  // =========================================================================
  // EVENT LISTENERS
  // =========================================================================

  attachEventListeners() {
    // Plan list view
    document.getElementById('yp-create-btn')?.addEventListener('click', () => this.showCreatePlanModal(), { signal: this.signal });
    document.getElementById('yp-create-empty-btn')?.addEventListener('click', () => this.showCreatePlanModal(), { signal: this.signal });

    document.getElementById('yp-library-btn')?.addEventListener('click', async () => {
      this.view = VIEW.LIBRARY;
      await this.loadLibrary();
      this.render();
      this.attachEventListeners();
    }, { signal: this.signal });

    document.querySelectorAll('.yp-open-plan-btn').forEach(btn => {
      btn.addEventListener('click', () => this.loadPlanDetail(parseInt(btn.dataset.id)), { signal: this.signal });
    });

    document.querySelectorAll('.yp-delete-plan-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.handleDeletePlan(parseInt(btn.dataset.id));
      }, { signal: this.signal });
    });

    // Plan detail view
    document.getElementById('yp-back-to-list')?.addEventListener('click', async () => {
      this.view = VIEW.LIST;
      this.currentPlan = null;
      await this.loadPlans();
      this.render();
      this.attachEventListeners();
    }, { signal: this.signal });

    // Tabs
    document.querySelectorAll('.yp-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.yp-tab').forEach(t => t.classList.remove('yp-tab--active'));
        document.querySelectorAll('.yp-tab-content').forEach(c => {
          c.classList.remove('yp-tab-content--active');
          c.style.display = 'none';
        });
        tab.classList.add('yp-tab--active');
        const target = document.getElementById(`yp-tab-${tab.dataset.tab}`);
        if (target) {
          target.classList.add('yp-tab-content--active');
          target.style.display = '';
        }
      }, { signal: this.signal });
    });

    // Period actions
    document.getElementById('yp-add-period-btn')?.addEventListener('click', () => this.showCreatePeriodModal(), { signal: this.signal });
    document.querySelectorAll('.yp-delete-period-btn').forEach(btn => {
      btn.addEventListener('click', () => this.handleDeletePeriod(parseInt(btn.dataset.id)), { signal: this.signal });
    });

    // Objective actions
    document.getElementById('yp-add-objective-btn')?.addEventListener('click', () => this.showCreateObjectiveModal(), { signal: this.signal });
    document.querySelectorAll('.yp-delete-obj-btn').forEach(btn => {
      btn.addEventListener('click', () => this.handleDeleteObjective(parseInt(btn.dataset.id)), { signal: this.signal });
    });

    // Meeting actions
    document.querySelectorAll('.yp-edit-meeting-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const meetingId = parseInt(btn.dataset.id);
        const meeting = this.currentPlan?.meetings?.find(m => m.id === meetingId);
        if (meeting) this.showMeetingEditModal(meeting);
      }, { signal: this.signal });
    });

    document.querySelectorAll('.yp-meeting').forEach(el => {
      el.addEventListener('click', async (e) => {
        if (e.target.closest('.yp-edit-meeting-btn')) return;
        const meetingId = parseInt(el.dataset.meetingId);
        if (!meetingId) return;
        try {
          const { getYearPlanMeeting } = await import('./api/api-yearly-planner.js');
          const response = await getYearPlanMeeting(meetingId);
          this.currentMeeting = response?.data || null;
          this.view = VIEW.MEETING_DETAIL;
          this.render();
          this.attachEventListeners();
        } catch (err) {
          debugError('Error loading meeting:', err);
        }
      }, { signal: this.signal });
    });

    // Meeting detail view
    document.getElementById('yp-back-to-plan')?.addEventListener('click', () => {
      this.view = VIEW.PLAN_DETAIL;
      this.currentMeeting = null;
      this.render();
      this.attachEventListeners();
    }, { signal: this.signal });

    document.getElementById('yp-add-activity-btn')?.addEventListener('click', () => {
      if (this.currentMeeting) this.showAddActivityModal(this.currentMeeting.id);
    }, { signal: this.signal });

    document.querySelectorAll('.yp-remove-activity-btn').forEach(btn => {
      btn.addEventListener('click', () => this.handleRemoveActivity(parseInt(btn.dataset.id)), { signal: this.signal });
    });

    // Library view
    document.getElementById('yp-back-from-library')?.addEventListener('click', () => {
      this.view = VIEW.LIST;
      this.render();
      this.attachEventListeners();
    }, { signal: this.signal });

    document.getElementById('yp-add-library-btn')?.addEventListener('click', () => this.showAddLibraryActivityModal(), { signal: this.signal });

    document.querySelectorAll('.yp-delete-lib-btn').forEach(btn => {
      btn.addEventListener('click', () => this.handleDeleteLibraryActivity(parseInt(btn.dataset.id)), { signal: this.signal });
    });

    // Library search
    const searchInput = document.getElementById('yp-library-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        const term = searchInput.value.toLowerCase();
        document.querySelectorAll('.yp-library-item').forEach(item => {
          const name = item.querySelector('strong')?.textContent?.toLowerCase() || '';
          item.style.display = name.includes(term) ? '' : 'none';
        });
      }, { signal: this.signal });
    }
  }
}
