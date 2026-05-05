import { translate } from '../../app.js';
import { debugLog, debugError } from '../../utils/DebugUtils.js';
import { setContent, loadStylesheet } from '../../utils/DOMUtils.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { formatDate } from '../../utils/DateUtils.js';
import { BaseModule } from '../../utils/BaseModule.js';
import { hasPermission } from '../../utils/PermissionUtils.js';
import { skeletonTable } from '../../utils/SkeletonUtils.js';
import {
  getYearPlans,
  getYearPlan,
  getYearPlanMeeting,
  createYearPlan,
  updateYearPlan,
  deleteYearPlan,
  createPeriod,
  deletePeriod,
  createObjective,
  deleteObjective,
  addMeetingActivity,
  deleteMeetingActivity,
  getActivityLibrary,
  createLibraryActivity,
  updateLibraryActivity,
  deleteLibraryActivity
} from '../../api/api-yearly-planner.js';
import DragDropManager from '../../utils/DragDropManager.js';

const VIEW = {
  PLAN_LIST: 'plan_list',
  PLANNER: 'planner'
};

const PERIOD_COLORS = ['#e85d04', '#2a9d8f', '#3a86ff', '#bc6c25', '#006d77', '#d62828'];
const OBJECTIVE_COLORS = ['#ef4444', '#06b6d4', '#f59e0b', '#8b5cf6', '#10b981', '#f97316'];
const MEETING_FETCH_CONCURRENCY = 6;

export class YearlyPlanner extends BaseModule {
  constructor(app) {
    super(app);
    this.view = VIEW.PLAN_LIST;
    this.isLoading = true;
    this.plans = [];
    this.currentPlan = null;
    this.activityLibrary = [];
    this.meetingActivitiesById = {};
    this.dragDropManager = null;
    this.selectedActivityId = null;
    this.librarySearch = '';
    this.libraryCategory = 'all';
    this.objectiveColorMap = {};
    this.periodColorMap = {};
    this.canView = hasPermission('meetings.view');
    this.canManage = hasPermission('meetings.manage');
    this.lang = app?.lang || localStorage.getItem('lang') || 'en';
  }

  async init() {
    await loadStylesheet('/css/yearly-planner.css');

    if (!this.canView) {
      this.isLoading = false;
      this.render();
      return;
    }

    this.isLoading = true;
    this.render();

    try {
      await this.refreshPlans();
      if (this.plans.length > 0) {
        await this.openPlan(this.plans[0].id);
      }
    } catch (error) {
      debugError('[YearlyPlanner] Failed to initialize:', error);
      this.app.showMessage(this.t('yearly_planner_error_loading', 'Unable to load year plans.'), 'error');
      this.isLoading = false;
      this.render();
      this.attachEventListeners();
    }
  }

  destroy() {
    this.destroyDragDrop();
    super.destroy();
  }

  t(key, fallback = '') {
    const value = translate(key);
    if (!value || value === key) {
      return fallback || key;
    }
    return value;
  }

  async refreshPlans() {
    const response = await getYearPlans();
    this.plans = Array.isArray(response?.data) ? response.data : [];
    debugLog('[YearlyPlanner] Loaded plans:', this.plans.length);
  }

  async openPlan(planId) {
    this.isLoading = true;
    this.view = VIEW.PLANNER;
    this.render();

    try {
      const [planResponse, libraryResponse] = await Promise.all([
        getYearPlan(planId),
        getActivityLibrary()
      ]);

      this.currentPlan = this.normalizePlan(planResponse?.data || null);
      this.activityLibrary = this.normalizeLibrary(libraryResponse?.data || []);
      this.librarySearch = '';
      this.libraryCategory = 'all';
      await this.loadMeetingActivities();
      this.isLoading = false;
      this.render();
      this.attachEventListeners();
    } catch (error) {
      debugError('[YearlyPlanner] Failed to open plan:', error);
      this.isLoading = false;
      this.currentPlan = null;
      this.app.showMessage(this.t('yearly_planner_error_loading', 'Unable to load this plan.'), 'error');
      this.render();
      this.attachEventListeners();
    }
  }

  normalizePlan(plan) {
    if (!plan) return null;

    const periods = Array.isArray(plan.periods)
      ? [...plan.periods].sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)))
      : [];
    const meetings = Array.isArray(plan.meetings)
      ? [...plan.meetings].sort((a, b) => String(a.meeting_date).localeCompare(String(b.meeting_date)))
      : [];
    const objectives = Array.isArray(plan.objectives)
      ? [...plan.objectives].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
      : [];

    this.periodColorMap = {};
    periods.forEach((period, index) => {
      this.periodColorMap[String(period.id)] = PERIOD_COLORS[index % PERIOD_COLORS.length];
    });

    this.objectiveColorMap = {};
    objectives.forEach((objective, index) => {
      this.objectiveColorMap[String(objective.id)] = OBJECTIVE_COLORS[index % OBJECTIVE_COLORS.length];
    });

    return {
      ...plan,
      periods,
      meetings,
      objectives
    };
  }

  normalizeLibrary(library) {
    if (!Array.isArray(library)) return [];

    return library.map((activity) => ({
      ...activity,
      objective_ids: this.normalizeIdArray(activity.objective_ids)
    }));
  }

  normalizeIdArray(value) {
    let raw = value;

    if (typeof raw === 'string') {
      try {
        raw = JSON.parse(raw);
      } catch (_error) {
        raw = [];
      }
    }

    if (!Array.isArray(raw)) return [];

    const numeric = raw
      .map((entry) => Number.parseInt(entry, 10))
      .filter((entry) => Number.isFinite(entry));

    return [...new Set(numeric)];
  }

  normalizeMeetingActivities(activities) {
    if (!Array.isArray(activities)) return [];

    return activities.map((activity) => ({
      ...activity,
      objective_ids: this.normalizeIdArray(activity.objective_ids)
    }));
  }

  async loadMeetingActivities() {
    const meetings = this.currentPlan?.meetings || [];
    const cache = {};

    const worker = async (meeting) => {
      const response = await getYearPlanMeeting(meeting.id);
      const details = response?.data || {};
      cache[meeting.id] = this.normalizeMeetingActivities(details.activities || []);
    };

    await this.runBatched(meetings, MEETING_FETCH_CONCURRENCY, worker);
    this.meetingActivitiesById = cache;
  }

  async runBatched(items, size, task) {
    let index = 0;
    const workers = new Array(size).fill(null).map(async () => {
      while (index < items.length) {
        const current = items[index];
        index += 1;
        try {
          await task(current);
        } catch (error) {
          debugError('[YearlyPlanner] batched task failed:', error);
        }
      }
    });

    await Promise.all(workers);
  }

  render() {
    const appNode = document.getElementById('app');
    if (!appNode) return;

    if (!this.canView) {
      setContent(
        appNode,
        `<section class="yearly-planner"><p class="yearly-planner__error">${escapeHTML(
          this.t('not_authorized', 'You are not authorized to access this page.')
        )}</p></section>`
      );
      return;
    }

    if (this.isLoading) {
      setContent(appNode, this.renderLoading());
      return;
    }

    if (this.view === VIEW.PLANNER && this.currentPlan) {
      setContent(appNode, this.renderPlanner());
      return;
    }

    setContent(appNode, this.renderPlanList());
  }

  renderLoading() {
    return `
      <section class="yearly-planner">
        <header class="yearly-planner__header">
          <h1>${escapeHTML(this.t('yearly_planner_title', 'Yearly Meeting Planner'))}</h1>
        </header>
        ${skeletonTable ? skeletonTable(6) : '<div class="loading-spinner"></div>'}
      </section>
    `;
  }

  renderPlanList() {
    const cards = this.plans
      .map((plan) => {
        const periodCount = Number(plan.period_count || 0);
        const meetingCount = Number(plan.meeting_count || 0);
        return `
          <article class="plan-card" data-plan-id="${plan.id}">
            <h3 class="plan-card__title">${escapeHTML(plan.title || this.t('untitled', 'Untitled'))}</h3>
            <p class="plan-card__meta">
              ${escapeHTML(formatDate(plan.start_date, this.lang, { year: 'numeric', month: 'short', day: 'numeric' }))}
              -
              ${escapeHTML(formatDate(plan.end_date, this.lang, { year: 'numeric', month: 'short', day: 'numeric' }))}
            </p>
            <p class="plan-card__stats">
              ${meetingCount} ${escapeHTML(this.t('yearly_planner_meetings', 'meetings'))}
              &middot;
              ${periodCount} ${escapeHTML(this.t('yearly_planner_periods', 'periods'))}
            </p>
            <div class="plan-card__actions">
              <button class="button button--primary yp-open-plan-btn" data-plan-id="${plan.id}">
                ${escapeHTML(this.t('yearly_planner_open', 'Open Plan'))}
              </button>
              ${
                this.canManage
                  ? `<button class="button button--ghost yp-delete-plan-btn" data-plan-id="${plan.id}">${escapeHTML(
                      this.t('delete', 'Delete')
                    )}</button>`
                  : ''
              }
            </div>
          </article>
        `;
      })
      .join('');

    return `
      <section class="yearly-planner">
        <header class="yearly-planner__header">
          <h1>${escapeHTML(this.t('yearly_planner_title', 'Yearly Meeting Planner'))}</h1>
          ${
            this.canManage
              ? `<button id="yp-create-plan-btn" class="button button--primary">${escapeHTML(
                  this.t('create_year_plan', 'Create Year Plan')
                )}</button>`
              : ''
          }
        </header>

        ${
          this.plans.length === 0
            ? `<div class="yearly-planner__empty">
                <p>${escapeHTML(this.t('yearly_planner_empty', 'No year plans yet.'))}</p>
                ${
                  this.canManage
                    ? `<button id="yp-create-first-plan-btn" class="button button--primary">${escapeHTML(
                        this.t('create_year_plan', 'Create Year Plan')
                      )}</button>`
                    : ''
                }
              </div>`
            : `<div class="plan-list">${cards}</div>`
        }
      </section>
    `;
  }

  renderPlanner() {
    const plan = this.currentPlan;
    const filteredLibrary = this.getFilteredLibrary();

    return `
      <section class="yearly-planner">
        <header class="yearly-planner__header yearly-planner__header--planner">
          <button class="button button--ghost" id="yp-back-to-plans">&larr; ${escapeHTML(
            this.t('back', 'Back')
          )}</button>
          <h1>${escapeHTML(this.t('yearly_planner_title', 'Yearly Meeting Planner'))}: ${escapeHTML(
            plan.title || ''
          )}</h1>
          ${
            this.canManage
              ? `<button class="button button--secondary" id="yp-edit-plan-btn">${escapeHTML(
                  this.t('edit', 'Edit')
                )}</button>`
              : ''
          }
        </header>

        <div class="planner-toolbar">
          <details class="library-panel" ${this.activityLibrary.length > 0 ? 'open' : ''}>
            <summary>${escapeHTML(this.t('activity_library', 'Activity Library'))}</summary>
            <div class="library-panel__content">
              <div class="library-panel__controls">
                <input
                  type="search"
                  id="yp-library-search"
                  value="${escapeHTML(this.librarySearch)}"
                  placeholder="${escapeHTML(this.t('search_activities', 'Search activities'))}"
                />
                <select id="yp-library-category">
                  ${this.renderLibraryCategoryOptions()}
                </select>
                ${
                  this.canManage
                    ? `<button class="button button--secondary" id="yp-add-library-activity">${escapeHTML(
                        this.t('add_activity', 'Add Activity')
                      )}</button>`
                    : ''
                }
              </div>
              ${
                filteredLibrary.length === 0
                  ? `<p class="library-panel__empty">${escapeHTML(
                      this.t('yearly_planner_library_empty', 'No activities in the library.')
                    )}</p>`
                  : `<div class="library-panel__items">
                      ${filteredLibrary.map((activity) => this.renderLibraryItem(activity)).join('')}
                    </div>`
              }
            </div>
          </details>

          <details class="objectives-panel" open>
            <summary>${escapeHTML(this.t('objectives', 'Objectives'))}</summary>
            <div class="objectives-panel__content">
              <div class="objectives-panel__actions">
                ${
                  this.canManage
                    ? `<button class="button button--ghost" id="yp-add-period-btn">${escapeHTML(
                        this.t('add_period', 'Add Period')
                      )}</button>
                       <button class="button button--ghost" id="yp-add-objective-btn">${escapeHTML(
                         this.t('add_objective', 'Add Objective')
                       )}</button>`
                    : ''
                }
              </div>
              ${this.renderObjectiveProgress()}
            </div>
          </details>
        </div>

        <div class="period-list">
          ${this.renderMeetingSections()}
        </div>

        ${this.renderFloatingIndicator()}
      </section>
    `;
  }

  renderLibraryCategoryOptions() {
    const categories = this.getLibraryCategories();

    const options = [`<option value="all">${escapeHTML(this.t('all', 'All'))}</option>`]
      .concat(
        categories.map(
          (category) =>
            `<option value="${escapeHTML(category)}" ${
              this.libraryCategory === category ? 'selected' : ''
            }>${escapeHTML(category)}</option>`
        )
      )
      .join('');

    return options;
  }

  renderLibraryItem(activity) {
    const durationLabel = this.getActivityDurationLabel(activity);
    const payload = escapeHTML(JSON.stringify(activity));

    return `
      <div
        class="library-panel__item"
        data-activity-id="${activity.id}"
        data-activity-payload="${payload}"
        title="${escapeHTML(this.t('assign_activity', 'Assign activity'))}"
      >
        <div class="library-panel__item-main">
          <strong>${escapeHTML(activity.name || '')}</strong>
          <span>${escapeHTML(durationLabel)}</span>
          ${
            activity.category
              ? `<span class="library-panel__category">${escapeHTML(activity.category)}</span>`
              : ''
          }
          ${this.renderObjectiveDots(activity.objective_ids)}
        </div>
        ${
          this.canManage
            ? `<div class="library-panel__item-actions" data-ignore-assign="true">
                <button class="button button--tiny yp-edit-library-btn" data-ignore-assign="true" data-activity-id="${
                  activity.id
                }">${escapeHTML(this.t('edit', 'Edit'))}</button>
                <button class="button button--tiny button--danger yp-delete-library-btn" data-ignore-assign="true" data-activity-id="${
                  activity.id
                }">${escapeHTML(this.t('delete', 'Delete'))}</button>
              </div>`
            : ''
        }
      </div>
    `;
  }

  renderObjectiveDots(objectiveIds) {
    const ids = Array.isArray(objectiveIds) ? objectiveIds : [];
    if (ids.length === 0) return '';

    return `
      <span class="objective-dots">
        ${ids
          .map((id) => {
            const objective = this.getObjectiveById(id);
            return `<span
              class="objective-dot"
              style="--objective-color:${this.getObjectiveColor(id)}"
              title="${escapeHTML(objective?.title || this.t('objective', 'Objective'))}"
            ></span>`;
          })
          .join('')}
      </span>
    `;
  }

  renderObjectiveProgress() {
    const objectives = this.currentPlan?.objectives || [];
    if (objectives.length === 0) {
      return `<p class="objectives-panel__empty">${escapeHTML(
        this.t('yearly_planner_no_objectives', 'No objectives yet.')
      )}</p>`;
    }

    const progress = this.calculateObjectiveProgress();

    return `
      <ul class="objective-progress-list">
        ${objectives
          .map((objective) => {
            const count = progress[objective.id] || 0;
            return `<li class="objective-progress-item" data-objective-id="${objective.id}">
              <span class="objective-progress-item__title">
                <span class="objective-dot" style="--objective-color:${this.getObjectiveColor(objective.id)}"></span>
                ${escapeHTML(objective.title || this.t('objective', 'Objective'))}
              </span>
              <span class="objective-progress-item__value">${count}</span>
              ${
                this.canManage
                  ? `<button class="button button--tiny button--danger yp-delete-objective-btn" data-objective-id="${
                      objective.id
                    }">${escapeHTML(this.t('delete', 'Delete'))}</button>`
                  : ''
              }
            </li>`;
          })
          .join('')}
      </ul>
    `;
  }

  calculateObjectiveProgress() {
    const progress = {};
    const meetings = this.currentPlan?.meetings || [];

    meetings.forEach((meeting) => {
      const activities = this.meetingActivitiesById[meeting.id] || [];
      const uniqueObjectiveIds = new Set();

      activities.forEach((activity) => {
        this.normalizeIdArray(activity.objective_ids).forEach((objectiveId) => {
          uniqueObjectiveIds.add(objectiveId);
        });
      });

      uniqueObjectiveIds.forEach((objectiveId) => {
        progress[objectiveId] = Number(progress[objectiveId] || 0) + 1;
      });
    });

    return progress;
  }

  renderMeetingSections() {
    const plan = this.currentPlan;
    const periodMeetings = {};

    (plan.periods || []).forEach((period) => {
      periodMeetings[period.id] = [];
    });

    const unassignedKey = '__unassigned__';
    periodMeetings[unassignedKey] = [];

    (plan.meetings || []).forEach((meeting) => {
      if (meeting.period_id && periodMeetings[meeting.period_id]) {
        periodMeetings[meeting.period_id].push(meeting);
      } else {
        periodMeetings[unassignedKey].push(meeting);
      }
    });

    const sections = [];

    (plan.periods || []).forEach((period) => {
      sections.push(this.renderPeriodSection(period, periodMeetings[period.id] || []));
    });

    if ((periodMeetings[unassignedKey] || []).length > 0) {
      sections.push(
        this.renderPeriodSection(
          {
            id: unassignedKey,
            title: this.t('yearly_planner_unassigned', 'Unassigned'),
            start_date: null,
            end_date: null
          },
          periodMeetings[unassignedKey]
        )
      );
    }

    if (sections.length === 0) {
      return `<div class="yearly-planner__empty">${escapeHTML(
        this.t('yearly_planner_no_meetings', 'No meetings generated for this plan.')
      )}</div>`;
    }

    return sections.join('');
  }

  renderPeriodSection(period, meetings) {
    const dateRange = period.start_date && period.end_date
      ? `${formatDate(period.start_date, this.lang, { month: 'short', day: 'numeric' })} - ${formatDate(
          period.end_date,
          this.lang,
          { month: 'short', day: 'numeric' }
        )}`
      : '';

    const periodColor = this.getPeriodColor(period.id);

    return `
      <section class="period-section" data-period-id="${period.id}">
        <header class="period-divider" style="--period-color:${periodColor}">
          <span>${escapeHTML(this.t('periods', 'Periods'))}: ${escapeHTML(period.title || '')}</span>
          ${dateRange ? `<small>${escapeHTML(dateRange)}</small>` : ''}
          ${
            this.canManage && period.id !== '__unassigned__'
              ? `<button class="button button--tiny button--danger yp-delete-period-btn" data-period-id="${period.id}">${escapeHTML(
                  this.t('delete', 'Delete')
                )}</button>`
              : ''
          }
        </header>

        <div class="meeting-list">
          ${meetings.map((meeting) => this.renderMeetingRow(meeting, periodColor)).join('')}
        </div>
      </section>
    `;
  }

  renderMeetingRow(meeting, periodColor) {
    const activities = this.meetingActivitiesById[meeting.id] || [];

    return `
      <article class="meeting-row" data-meeting-id="${meeting.id}" data-meeting-date="${escapeHTML(
      meeting.meeting_date
    )}" style="--period-color:${periodColor}">
        <header class="meeting-row__header">
          <div>
            <h3>${escapeHTML(
              formatDate(meeting.meeting_date, this.lang, {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                year: 'numeric'
              })
            )}</h3>
            ${meeting.start_time ? `<small>${escapeHTML(String(meeting.start_time).slice(0, 5))}</small>` : ''}
          </div>
          <a
            class="meeting-row__detail"
            data-ignore-assign="true"
            href="/preparation-reunions?date=${encodeURIComponent(meeting.meeting_date)}"
            data-meeting-date="${escapeHTML(meeting.meeting_date)}"
          >${escapeHTML(this.t('edit_in_detail', 'Edit in detail'))}</a>
        </header>

        <div class="meeting-row__activities">
          ${
            activities.length === 0
              ? `<p class="meeting-row__empty">${escapeHTML(
                  this.t('tap_to_assign', 'Tap an activity, then tap this meeting to assign.')
                )}</p>`
              : activities.map((activity) => this.renderMeetingActivityChip(meeting.id, activity)).join('')
          }
        </div>
      </article>
    `;
  }

  renderMeetingActivityChip(meetingId, activity) {
    const duration = Number.parseInt(activity.duration_minutes, 10);
    const durationLabel = Number.isFinite(duration) ? `${duration}m` : '';

    return `
      <span class="activity-chip" data-ignore-assign="true">
        <span>${escapeHTML(activity.name || '')} ${durationLabel ? `- ${escapeHTML(durationLabel)}` : ''}</span>
        ${this.renderObjectiveDots(activity.objective_ids)}
        ${
          this.canManage
            ? `<button
                class="activity-chip__remove"
                data-ignore-assign="true"
                data-meeting-id="${meetingId}"
                data-meeting-activity-id="${activity.id}"
                aria-label="${escapeHTML(this.t('remove_from_meeting', 'Remove from meeting'))}"
              >&times;</button>`
            : ''
        }
      </span>
    `;
  }

  renderFloatingIndicator() {
    const selectedActivity = this.getSelectedActivityFromState();
    if (!selectedActivity) return '';

    return `
      <div class="floating-indicator" id="yp-floating-indicator">
        <span>${escapeHTML(this.t('floating_assign_hint', 'Assigning'))}: ${escapeHTML(
      selectedActivity.name || ''
    )}</span>
        <button class="button button--ghost" id="yp-done-assigning">${escapeHTML(
          this.t('done_assigning', 'Done')
        )}</button>
      </div>
    `;
  }

  attachEventListeners() {
    this.destroyDragDrop();

    // Plan list controls
    this.addEventListener(document.getElementById('yp-create-plan-btn'), 'click', () =>
      this.showPlanModal()
    );
    this.addEventListener(document.getElementById('yp-create-first-plan-btn'), 'click', () =>
      this.showPlanModal()
    );

    this.addEventListeners(document.querySelectorAll('.yp-open-plan-btn'), 'click', async (event) => {
      const id = Number.parseInt(event.currentTarget.dataset.planId, 10);
      if (Number.isFinite(id)) {
        await this.openPlan(id);
      }
    });

    this.addEventListeners(document.querySelectorAll('.yp-delete-plan-btn'), 'click', async (event) => {
      const id = Number.parseInt(event.currentTarget.dataset.planId, 10);
      if (!Number.isFinite(id)) return;
      await this.handleDeletePlan(id);
    });

    // Planner controls
    this.addEventListener(document.getElementById('yp-back-to-plans'), 'click', async () => {
      this.view = VIEW.PLAN_LIST;
      this.currentPlan = null;
      this.isLoading = true;
      this.render();
      await this.refreshPlans();
      this.isLoading = false;
      this.render();
      this.attachEventListeners();
    });

    this.addEventListener(document.getElementById('yp-edit-plan-btn'), 'click', () =>
      this.showPlanModal(this.currentPlan)
    );

    this.addEventListener(document.getElementById('yp-library-search'), 'input', (event) => {
      this.librarySearch = String(event.target.value || '');
      this.render();
      this.attachEventListeners();
    });

    this.addEventListener(document.getElementById('yp-library-category'), 'change', (event) => {
      this.libraryCategory = String(event.target.value || 'all');
      this.render();
      this.attachEventListeners();
    });

    this.addEventListener(document.getElementById('yp-add-library-activity'), 'click', () =>
      this.showLibraryActivityModal()
    );

    this.addEventListeners(document.querySelectorAll('.yp-edit-library-btn'), 'click', (event) => {
      const id = Number.parseInt(event.currentTarget.dataset.activityId, 10);
      const activity = this.activityLibrary.find((item) => Number(item.id) === id);
      if (activity) this.showLibraryActivityModal(activity);
    });

    this.addEventListeners(document.querySelectorAll('.yp-delete-library-btn'), 'click', async (event) => {
      const id = Number.parseInt(event.currentTarget.dataset.activityId, 10);
      if (!Number.isFinite(id)) return;
      await this.handleDeleteLibraryActivity(id);
    });

    this.addEventListener(document.getElementById('yp-add-period-btn'), 'click', () => this.showPeriodModal());
    this.addEventListener(document.getElementById('yp-add-objective-btn'), 'click', () =>
      this.showObjectiveModal()
    );

    this.addEventListeners(document.querySelectorAll('.yp-delete-period-btn'), 'click', async (event) => {
      const id = Number.parseInt(event.currentTarget.dataset.periodId, 10);
      if (!Number.isFinite(id)) return;
      await this.handleDeletePeriod(id);
    });

    this.addEventListeners(document.querySelectorAll('.yp-delete-objective-btn'), 'click', async (event) => {
      const id = Number.parseInt(event.currentTarget.dataset.objectiveId, 10);
      if (!Number.isFinite(id)) return;
      await this.handleDeleteObjective(id);
    });

    this.addEventListeners(document.querySelectorAll('.activity-chip__remove'), 'click', async (event) => {
      const meetingId = Number.parseInt(event.currentTarget.dataset.meetingId, 10);
      const meetingActivityId = Number.parseInt(event.currentTarget.dataset.meetingActivityId, 10);
      if (!Number.isFinite(meetingId) || !Number.isFinite(meetingActivityId)) return;
      await this.handleRemoveMeetingActivity(meetingId, meetingActivityId);
    });

    this.addEventListeners(document.querySelectorAll('.meeting-row__detail'), 'click', (event) => {
      event.preventDefault();
      const date = event.currentTarget.dataset.meetingDate;
      this.navigateToMeetingDetail(date);
    });

    this.addEventListeners(document.querySelectorAll('.meeting-row'), 'click', (event) => {
      if (event.defaultPrevented) return;
      if (event.target.closest('[data-ignore-assign="true"]')) return;
      if (this.dragDropManager?.hasSelection()) return;

      const date = event.currentTarget.dataset.meetingDate;
      this.navigateToMeetingDetail(date);
    });

    this.setupDragDrop();
    this.updateFloatingIndicator();
  }

  setupDragDrop() {
    this.destroyDragDrop();

    if (!this.canManage) return;

    this.dragDropManager = new DragDropManager({
      onAssign: async ({ activity, meeting }) => {
        await this.assignActivityToMeeting(activity, meeting);
      },
      onSelectionChange: (activity) => {
        this.selectedActivityId = activity?.id || null;
        this.updateFloatingIndicator();
      }
    });

    document.querySelectorAll('.library-panel__item').forEach((element) => {
      const payload = element.dataset.activityPayload;
      if (!payload) return;

      try {
        const activity = JSON.parse(payload);
        this.dragDropManager.registerActivityElement(element, activity);
      } catch (error) {
        debugError('[YearlyPlanner] Invalid activity payload:', error);
      }
    });

    document.querySelectorAll('.meeting-row').forEach((element) => {
      const meetingId = Number.parseInt(element.dataset.meetingId, 10);
      const meeting = this.currentPlan?.meetings?.find((entry) => Number(entry.id) === meetingId);
      if (!meeting) return;
      this.dragDropManager.registerMeetingZone(element, meeting);
    });

    this.dragDropManager.restoreSelection(this.selectedActivityId);
    this.updateFloatingIndicator();
  }

  destroyDragDrop() {
    if (this.dragDropManager) {
      this.dragDropManager.destroy();
      this.dragDropManager = null;
    }
  }

  getFilteredLibrary() {
    const searchTerm = this.librarySearch.trim().toLowerCase();
    const category = this.libraryCategory;

    return this.activityLibrary.filter((activity) => {
      if (category !== 'all' && (activity.category || '').toLowerCase() !== category.toLowerCase()) {
        return false;
      }

      if (!searchTerm) return true;

      const text = `${activity.name || ''} ${activity.description || ''}`.toLowerCase();
      return text.includes(searchTerm);
    });
  }

  getLibraryCategories() {
    const categories = this.activityLibrary
      .map((activity) => (activity.category || '').trim())
      .filter(Boolean);

    return [...new Set(categories)].sort((a, b) => a.localeCompare(b, this.lang));
  }

  getObjectiveById(id) {
    return (this.currentPlan?.objectives || []).find((objective) => Number(objective.id) === Number(id));
  }

  getObjectiveColor(id) {
    return this.objectiveColorMap[String(id)] || OBJECTIVE_COLORS[Math.abs(Number(id) || 0) % OBJECTIVE_COLORS.length];
  }

  getPeriodColor(id) {
    return this.periodColorMap[String(id)] || PERIOD_COLORS[Math.abs(Number(id) || 0) % PERIOD_COLORS.length];
  }

  getActivityDurationLabel(activity) {
    const min = Number.parseInt(activity.estimated_duration_min, 10);
    const max = Number.parseInt(activity.estimated_duration_max, 10);

    if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
      return `${min}-${max} min`;
    }

    if (Number.isFinite(min)) {
      return `${min} min`;
    }

    return this.t('duration_minutes_placeholder', 'Duration');
  }

  async assignActivityToMeeting(activity, meeting) {
    if (!this.canManage) {
      this.app.showMessage(this.t('not_authorized', 'Not authorized'), 'error');
      return;
    }

    const existing = this.meetingActivitiesById[meeting.id] || [];

    const payload = {
      activity_library_id: Number(activity.id),
      name: activity.name,
      description: activity.description || null,
      duration_minutes: Number.parseInt(activity.estimated_duration_min, 10) || null,
      objective_ids: this.normalizeIdArray(activity.objective_ids),
      sort_order: existing.length
    };

    await addMeetingActivity(meeting.id, payload);
    this.app.showMessage(this.t('activity_assigned_success', 'Activity assigned'), 'success');

    const updated = await getYearPlanMeeting(meeting.id);
    this.meetingActivitiesById[meeting.id] = this.normalizeMeetingActivities(updated?.data?.activities || []);

    this.render();
    this.attachEventListeners();
  }

  async handleRemoveMeetingActivity(meetingId, meetingActivityId) {
    if (!this.canManage) return;

    await deleteMeetingActivity(meetingActivityId);
    const current = this.meetingActivitiesById[meetingId] || [];
    this.meetingActivitiesById[meetingId] = current.filter(
      (entry) => Number(entry.id) !== Number(meetingActivityId)
    );

    this.app.showMessage(this.t('activity_removed_success', 'Activity removed'), 'success');
    this.render();
    this.attachEventListeners();
  }

  async handleDeletePlan(planId) {
    if (!this.canManage) return;
    if (!window.confirm(this.t('yearly_planner_confirm_delete_plan', 'Delete this year plan?'))) return;

    await deleteYearPlan(planId);
    await this.refreshPlans();

    if (this.currentPlan?.id === planId) {
      this.currentPlan = null;
      this.view = VIEW.PLAN_LIST;
    }

    this.app.showMessage(this.t('yearly_planner_plan_deleted', 'Year plan deleted'), 'success');
    this.render();
    this.attachEventListeners();
  }

  async handleDeleteLibraryActivity(activityId) {
    if (!this.canManage) return;
    if (!window.confirm(this.t('yearly_planner_confirm_delete_library', 'Delete this activity?'))) return;

    await deleteLibraryActivity(activityId);
    this.activityLibrary = this.activityLibrary.filter((entry) => Number(entry.id) !== Number(activityId));
    this.app.showMessage(this.t('yearly_planner_library_activity_deleted', 'Library activity deleted'), 'success');
    this.render();
    this.attachEventListeners();
  }

  async handleDeletePeriod(periodId) {
    if (!this.canManage) return;
    if (!window.confirm(this.t('yearly_planner_confirm_delete_period', 'Delete this period?'))) return;

    await deletePeriod(periodId);
    await this.openPlan(this.currentPlan.id);
  }

  async handleDeleteObjective(objectiveId) {
    if (!this.canManage) return;
    if (!window.confirm(this.t('yearly_planner_confirm_delete_objective', 'Delete this objective?'))) return;

    await deleteObjective(objectiveId);
    await this.openPlan(this.currentPlan.id);
  }

  navigateToMeetingDetail(date) {
    if (!date) return;

    const target = `/preparation-reunions?date=${encodeURIComponent(date)}`;
    if (this.app?.router) {
      this.app.router.navigate(target);
      return;
    }

    window.location.assign(target);
  }

  getSelectedActivityFromState() {
    if (!this.selectedActivityId) return null;
    return (
      this.activityLibrary.find((activity) => Number(activity.id) === Number(this.selectedActivityId)) ||
      null
    );
  }

  updateFloatingIndicator() {
    const root = document.querySelector('.yearly-planner');
    if (!root) return;

    const existing = root.querySelector('#yp-floating-indicator');
    if (existing) existing.remove();

    const markup = this.renderFloatingIndicator();
    if (!markup) return;

    const wrapper = document.createElement('div');
    setContent(wrapper, markup);
    const indicator = wrapper.firstElementChild;
    if (!indicator) return;

    root.appendChild(indicator);
    this.addEventListener(indicator.querySelector('#yp-done-assigning'), 'click', () => {
      this.selectedActivityId = null;
      this.dragDropManager?.clearSelection();
      this.updateFloatingIndicator();
    });
  }

  showModal({ title, body, onSave }) {
    const modal = document.createElement('div');
    modal.className = 'yp-modal-overlay';
    modal.innerHTML = `
      <div class="yp-modal">
        <header class="yp-modal__header">
          <h2>${escapeHTML(title)}</h2>
          <button class="button button--ghost yp-modal-close" aria-label="${escapeHTML(
            this.t('close', 'Close')
          )}">&times;</button>
        </header>
        <div class="yp-modal__body">${body}</div>
        <footer class="yp-modal__footer">
          <button class="button button--secondary yp-modal-cancel">${escapeHTML(
            this.t('cancel', 'Cancel')
          )}</button>
          <button class="button button--primary yp-modal-save">${escapeHTML(
            this.t('save', 'Save')
          )}</button>
        </footer>
      </div>
    `;

    const close = () => modal.remove();

    modal.querySelector('.yp-modal-close')?.addEventListener('click', close);
    modal.querySelector('.yp-modal-cancel')?.addEventListener('click', close);
    modal.addEventListener('click', (event) => {
      if (event.target === modal) close();
    });

    modal.querySelector('.yp-modal-save')?.addEventListener('click', async () => {
      try {
        await onSave(modal);
        close();
      } catch (error) {
        debugError('[YearlyPlanner] Modal save failed:', error);
        this.app.showMessage(this.t('yearly_planner_error_creating', 'Unable to save changes.'), 'error');
      }
    });

    document.body.appendChild(modal);
  }

  showPlanModal(existingPlan = null) {
    const isEdit = Boolean(existingPlan && existingPlan.id);

    this.showModal({
      title: isEdit
        ? this.t('yearly_planner_title', 'Yearly Meeting Planner')
        : this.t('create_year_plan', 'Create Year Plan'),
      body: `
        <label>${escapeHTML(this.t('yearly_planner_plan_title', 'Plan title'))}</label>
        <input id="yp-plan-title" type="text" value="${escapeHTML(existingPlan?.title || '')}" />

        <label>${escapeHTML(this.t('yearly_planner_start_date', 'Start date'))}</label>
        <input id="yp-plan-start" type="date" value="${escapeHTML(existingPlan?.start_date || '')}" />

        <label>${escapeHTML(this.t('yearly_planner_end_date', 'End date'))}</label>
        <input id="yp-plan-end" type="date" value="${escapeHTML(existingPlan?.end_date || '')}" />

        <label>${escapeHTML(this.t('yearly_planner_default_location', 'Default location'))}</label>
        <input id="yp-plan-location" type="text" value="${escapeHTML(existingPlan?.default_location || '')}" />

        <label>${escapeHTML(this.t('yearly_planner_recurrence', 'Meeting frequency'))}</label>
        <select id="yp-plan-recurrence">
          <option value="weekly" ${existingPlan?.recurrence_pattern === 'weekly' ? 'selected' : ''}>${escapeHTML(
            this.t('yearly_planner_weekly', 'Weekly')
          )}</option>
          <option value="biweekly" ${
            existingPlan?.recurrence_pattern === 'biweekly' ? 'selected' : ''
          }>${escapeHTML(this.t('yearly_planner_biweekly', 'Biweekly'))}</option>
        </select>

        <label>${escapeHTML(this.t('yearly_planner_blackout_dates', 'Blackout dates (YYYY-MM-DD, comma separated)'))}</label>
        <textarea id="yp-plan-blackout" rows="2">${escapeHTML(
          Array.isArray(existingPlan?.blackout_dates) ? existingPlan.blackout_dates.join(', ') : ''
        )}</textarea>
      `,
      onSave: async (modal) => {
        const title = String(modal.querySelector('#yp-plan-title')?.value || '').trim();
        const startDate = String(modal.querySelector('#yp-plan-start')?.value || '').trim();
        const endDate = String(modal.querySelector('#yp-plan-end')?.value || '').trim();
        const defaultLocation = String(modal.querySelector('#yp-plan-location')?.value || '').trim();
        const recurrence = String(modal.querySelector('#yp-plan-recurrence')?.value || 'weekly');
        const blackoutDates = this.parseCsvDates(modal.querySelector('#yp-plan-blackout')?.value || '');

        if (!title || !startDate || !endDate) {
          throw new Error('required_fields');
        }

        const payload = {
          title,
          start_date: startDate,
          end_date: endDate,
          default_location: defaultLocation || null,
          recurrence_pattern: recurrence,
          blackout_dates: blackoutDates
        };

        let createdPlanId = null;
        if (isEdit) {
          await updateYearPlan(existingPlan.id, payload);
        } else {
          const response = await createYearPlan(payload);
          createdPlanId = Number(response?.data?.id || response?.id || null);
        }

        await this.refreshPlans();

        if (isEdit && this.currentPlan?.id === existingPlan.id) {
          await this.openPlan(existingPlan.id);
        } else if (!isEdit && createdPlanId) {
          await this.openPlan(createdPlanId);
        } else if (!isEdit && this.plans.length > 0) {
          await this.openPlan(this.plans[0].id);
        } else {
          this.view = VIEW.PLAN_LIST;
          this.render();
          this.attachEventListeners();
        }
      }
    });
  }

  parseCsvDates(value) {
    if (!value) return [];

    const items = String(value)
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);

    return items.filter((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry));
  }

  showPeriodModal() {
    this.showModal({
      title: this.t('add_period', 'Add Period'),
      body: `
        <label>${escapeHTML(this.t('yearly_planner_period_title', 'Period title'))}</label>
        <input id="yp-period-title" type="text" />

        <label>${escapeHTML(this.t('yearly_planner_start_date', 'Start date'))}</label>
        <input id="yp-period-start" type="date" />

        <label>${escapeHTML(this.t('yearly_planner_end_date', 'End date'))}</label>
        <input id="yp-period-end" type="date" />
      `,
      onSave: async (modal) => {
        const title = String(modal.querySelector('#yp-period-title')?.value || '').trim();
        const startDate = String(modal.querySelector('#yp-period-start')?.value || '').trim();
        const endDate = String(modal.querySelector('#yp-period-end')?.value || '').trim();

        if (!title || !startDate || !endDate) {
          throw new Error('required_fields');
        }

        await createPeriod(this.currentPlan.id, {
          title,
          start_date: startDate,
          end_date: endDate
        });

        await this.openPlan(this.currentPlan.id);
      }
    });
  }

  showObjectiveModal() {
    const periods = this.currentPlan?.periods || [];

    this.showModal({
      title: this.t('add_objective', 'Add Objective'),
      body: `
        <label>${escapeHTML(this.t('yearly_planner_objective_title', 'Objective title'))}</label>
        <input id="yp-objective-title" type="text" />

        <label>${escapeHTML(this.t('yearly_planner_objective_description', 'Description'))}</label>
        <textarea id="yp-objective-description" rows="2"></textarea>

        <label>${escapeHTML(this.t('periods', 'Periods'))}</label>
        <select id="yp-objective-period">
          <option value="">${escapeHTML(this.t('yearly_planner_none', 'None'))}</option>
          ${periods
            .map(
              (period) =>
                `<option value="${period.id}">${escapeHTML(period.title || this.t('periods', 'Period'))}</option>`
            )
            .join('')}
        </select>
      `,
      onSave: async (modal) => {
        const title = String(modal.querySelector('#yp-objective-title')?.value || '').trim();
        const description = String(modal.querySelector('#yp-objective-description')?.value || '').trim();
        const periodIdRaw = String(modal.querySelector('#yp-objective-period')?.value || '').trim();

        if (!title) throw new Error('required_fields');

        await createObjective(this.currentPlan.id, {
          title,
          description,
          period_id: periodIdRaw ? Number.parseInt(periodIdRaw, 10) : null,
          scope: 'unit'
        });

        await this.openPlan(this.currentPlan.id);
      }
    });
  }

  showLibraryActivityModal(existingActivity = null) {
    const isEdit = Boolean(existingActivity?.id);
    const objectives = this.currentPlan?.objectives || [];
    const selectedObjectiveIds = this.normalizeIdArray(existingActivity?.objective_ids || []);

    this.showModal({
      title: isEdit
        ? this.t('edit', 'Edit')
        : this.t('yearly_planner_add_library_activity', 'Add library activity'),
      body: `
        <label>${escapeHTML(this.t('activity_label', 'Activity'))}</label>
        <input id="yp-lib-name" type="text" value="${escapeHTML(existingActivity?.name || '')}" />

        <label>${escapeHTML(this.t('activity_description_label', 'Description'))}</label>
        <textarea id="yp-lib-description" rows="2">${escapeHTML(existingActivity?.description || '')}</textarea>

        <label>${escapeHTML(this.t('yearly_planner_category', 'Category'))}</label>
        <input id="yp-lib-category" type="text" value="${escapeHTML(existingActivity?.category || '')}" />

        <label>${escapeHTML(this.t('yearly_planner_min_duration', 'Min duration'))}</label>
        <input id="yp-lib-min-duration" type="number" min="5" value="${escapeHTML(
          existingActivity?.estimated_duration_min || ''
        )}" />

        <label>${escapeHTML(this.t('yearly_planner_max_duration', 'Max duration'))}</label>
        <input id="yp-lib-max-duration" type="number" min="5" value="${escapeHTML(
          existingActivity?.estimated_duration_max || ''
        )}" />

        <label>${escapeHTML(this.t('yearly_planner_material', 'Material'))}</label>
        <textarea id="yp-lib-material" rows="2">${escapeHTML(existingActivity?.material || '')}</textarea>

        <fieldset class="yp-objective-selector">
          <legend>${escapeHTML(this.t('objectives', 'Objectives'))}</legend>
          ${
            objectives.length === 0
              ? `<p>${escapeHTML(this.t('yearly_planner_no_objectives', 'No objectives yet.'))}</p>`
              : objectives
                  .map(
                    (objective) =>
                      `<label>
                        <input
                          type="checkbox"
                          class="yp-lib-objective"
                          value="${objective.id}"
                          ${selectedObjectiveIds.includes(Number(objective.id)) ? 'checked' : ''}
                        />
                        <span>${escapeHTML(objective.title || this.t('objective', 'Objective'))}</span>
                      </label>`
                  )
                  .join('')
          }
        </fieldset>
      `,
      onSave: async (modal) => {
        const name = String(modal.querySelector('#yp-lib-name')?.value || '').trim();
        const description = String(modal.querySelector('#yp-lib-description')?.value || '').trim();
        const category = String(modal.querySelector('#yp-lib-category')?.value || '').trim();
        const minDuration = Number.parseInt(modal.querySelector('#yp-lib-min-duration')?.value || '', 10);
        const maxDuration = Number.parseInt(modal.querySelector('#yp-lib-max-duration')?.value || '', 10);
        const material = String(modal.querySelector('#yp-lib-material')?.value || '').trim();

        const objectiveIds = Array.from(modal.querySelectorAll('.yp-lib-objective:checked'))
          .map((checkbox) => Number.parseInt(checkbox.value, 10))
          .filter((value) => Number.isFinite(value));

        if (!name) {
          throw new Error('required_fields');
        }

        const payload = {
          name,
          description: description || null,
          category: category || null,
          estimated_duration_min: Number.isFinite(minDuration) ? minDuration : null,
          estimated_duration_max: Number.isFinite(maxDuration) ? maxDuration : null,
          material: material || null,
          objective_ids: objectiveIds
        };

        if (isEdit) {
          await updateLibraryActivity(existingActivity.id, payload);
          this.activityLibrary = this.activityLibrary.map((entry) =>
            Number(entry.id) === Number(existingActivity.id)
              ? { ...entry, ...payload, id: existingActivity.id, objective_ids: objectiveIds }
              : entry
          );
        } else {
          const response = await createLibraryActivity(payload);
          const created = response?.data || response;
          this.activityLibrary.unshift({
            ...created,
            objective_ids: this.normalizeIdArray(created?.objective_ids || objectiveIds)
          });
        }

        this.render();
        this.attachEventListeners();
      }
    });
  }
}
