// MeetingPrep.js
// Meeting preparation module. Works on the unified meeting calendar shared
// with the yearly planner: dates, themes, cancellations and the activity
// timeline all come from the same year_plan_meetings-backed API.
import { translate } from '../../app.js';
import { debugLog, debugError } from '../../utils/DebugUtils.js';
import { setContent } from '../../utils/DOMUtils.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { isoToDateString, formatDate } from '../../utils/DateUtils.js';
import { formatHonorText } from '../../utils/HonorUtils.js';
import { BaseModule } from '../../utils/BaseModule.js';
import { hasPermission } from '../../utils/PermissionUtils.js';
import { openModal } from '../../utils/ModalUtils.js';
import { setButtonLoading } from '../../utils/SkeletonUtils.js';
import {
  getNextWeekdayDate,
  nextDateAfter,
  previousDateBefore,
  normalizeDateString,
  addOneWeek
} from '../../utils/MeetingDateUtils.js';
import { getUpcomingBirthdays } from '../../utils/BirthdayUtils.js';
import { getActiveSectionConfig, getHonorLabel } from '../../utils/meetingSections.js';
import {
  mergeTimelineWithTemplates,
  normalizeMeetingDurationMinutes,
} from '../../utils/MeetingPlanUtils.js';
import { getUnitVocabulary } from '../../utils/UnitVocabularyUtils.js';
import { deleteCachedData, clearYearlyPlannerCaches } from '../../indexedDB.js';
import { getMountPoint, resolveMountOptions } from '../../utils/PageMount.js';
import { ActivityManager } from '../ActivityManager.js';
import { PrintManager } from '../PrintManager.js';
import { aiGenerateText } from '../AI.js';
import { MeetingAutosave, MEETING_SAVE_STATES } from './MeetingAutosave.js';
import {
  getMeetingActivities,
  getAnimateurs,
  getHonorsHistory,
  getParticipants,
  getBadgeSystemSettings,
  getReunionPreparation,
  saveReunionPreparation,
  getReunionDates,
  getReminder,
  saveReminder
} from '../../api/api-endpoints.js';
import { createReminder, getMeetingReminders } from '../../api/api-yearly-planner.js';

const DEFAULT_MEETING_LENGTH_MINUTES = 90;

const SAVE_STATUS_TRANSLATIONS = {
  [MEETING_SAVE_STATES.SAVED]: 'meeting_autosave_saved',
  [MEETING_SAVE_STATES.DIRTY]: 'meeting_autosave_unsaved',
  [MEETING_SAVE_STATES.SAVING]: 'meeting_autosave_saving',
  [MEETING_SAVE_STATES.LOCAL]: 'meeting_autosave_local',
  [MEETING_SAVE_STATES.CONFLICT]: 'meeting_autosave_date_conflict',
  [MEETING_SAVE_STATES.ERROR]: 'meeting_autosave_failed'
};

export class MeetingPrep extends BaseModule {
  constructor(app, options = {}) {
    super(app);
    Object.assign(this, resolveMountOptions(options));
    this.canManage = hasPermission('meetings.manage');
    this.lang = this.app.lang || localStorage.getItem('language') || 'fr';

    this.meeting = null; // Serialized meeting from the API (or a local draft)
    this.currentDate = null;
    this.meetingDates = []; // [{ date, is_cancelled, theme, is_prepared }]
    this.activitiesCatalog = [];
    this.animateurs = [];
    this.participants = [];
    this.badgeTemplates = [];
    this.recentHonors = [];
    this.recentHonorsRaw = [];
    this.organizationSettings = {};
    this.meetingSections = {};
    this.sectionConfig = null;
    this.reminder = null;
    this.returnPlanId = null;

    this.activityManager = null;
    this.printManager = null;
    this.renderAbortController = null;
    this.meetingAutosave = null;
    this.saveState = MEETING_SAVE_STATES.SAVED;
  }

  /**
   * @param {string|null} date - Optional deep-linked date (from /preparation-reunions/:date)
   */
  async init(date = null) {
    try {
      const source = new URLSearchParams(window.location.search).get('from');
      const planMatch = source?.match(/^plan:(\d+)$/);
      this.returnPlanId = planMatch ? parseInt(planMatch[1], 10) : null;

      await this.fetchData();

      this.activityManager = new ActivityManager(
        this.app, this.animateurs, this.activitiesCatalog,
        this.sectionConfig, this.badgeTemplates, this.participants
      );
      this.printManager = new PrintManager(
        this.activityManager,
        this.sectionConfig,
        this.organizationSettings.organization_info?.name || '',
      );

      this.setupAutosaveLifecycle();

      await this.loadMeeting(normalizeDateString(date) || this.getInitialDate());
    } catch (err) {
      debugError('Error initializing meeting preparation:', err);
      this.renderError();
      this.app.showMessage(translate('error_loading_preparation_reunions'), 'error');
    }
  }

  // ==========================================================================
  // DATA
  // ==========================================================================

  async fetchData() {
    this.organizationSettings = (await this.app.waitForOrganizationSettings()) || {};

    const [catalogResponse, animateursResponse, badgeResponse, participantsResponse, datesResponse, reminderResponse] =
      await Promise.all([
        getMeetingActivities().catch(err => {
          debugError('Error loading activity catalog:', err);
          return { data: [] };
        }),
        getAnimateurs().catch(err => {
          debugError('Error loading animateurs:', err);
          return { data: [] };
        }),
        getBadgeSystemSettings().catch(err => {
          debugError('Error loading badge settings:', err);
          return { data: { templates: [] } };
        }),
        getParticipants().catch(err => {
          debugError('Error loading participants:', err);
          return { data: [] };
        }),
        getReunionDates().catch(err => {
          debugError('Error loading meeting dates:', err);
          return { data: [] };
        }),
        getReminder().catch(err => {
          debugError('Error loading reminder:', err);
          return { data: null };
        })
      ]);

    this.activitiesCatalog = catalogResponse?.data || [];
    this.animateurs = animateursResponse?.data || [];
    const badgeSettings = badgeResponse?.data || badgeResponse || {};
    this.badgeTemplates = badgeSettings.templates || [];
    this.participants = participantsResponse?.data || [];
    this.meetingDates = datesResponse?.data || [];
    this.reminder = reminderResponse?.data || null;

    this.updateSectionConfig(this.organizationSettings.meeting_sections);
  }

  /**
   * Merge meeting section configuration and propagate to managers.
   * @param {object} meetingSections - Section-level configuration
   */
  updateSectionConfig(meetingSections) {
    const { sectionConfig, mergedConfig } = getActiveSectionConfig(
      meetingSections || this.meetingSections,
      this.organizationSettings
    );
    this.meetingSections = mergedConfig;
    this.sectionConfig = sectionConfig;
    this.activityManager?.setSectionConfig(sectionConfig);
    this.printManager?.setSectionConfig?.(sectionConfig);
  }

  /**
   * Pick the initial date: the next non-cancelled planned meeting, falling
   * back to weekday arithmetic when no calendar exists yet.
   * @returns {string} Meeting date (YYYY-MM-DD)
   */
  getInitialDate() {
    const today = new Date().toLocaleDateString('en-CA');
    const upcoming = this.meetingDates
      .filter(d => !d.is_cancelled && normalizeDateString(d.date) >= today)
      .map(d => normalizeDateString(d.date))
      .sort((a, b) => a.localeCompare(b));
    if (upcoming.length > 0) {
      return upcoming[0];
    }
    return getNextWeekdayDate(this.organizationSettings.organization_info?.meeting_day || 'Wednesday');
  }

  /**
   * Load honors awarded at the meeting preceding the given date.
   * @param {string} meetingDate - Meeting date (YYYY-MM-DD)
   */
  async updateHonorsForMeeting(meetingDate) {
    const dateList = this.meetingDates.map(d => d.date);
    const previousMeetingDate = previousDateBefore(dateList, meetingDate);
    if (!previousMeetingDate) {
      this.recentHonors = [];
      this.recentHonorsRaw = [];
      return;
    }

    try {
      const response = await getHonorsHistory({
        startDate: previousMeetingDate,
        endDate: previousMeetingDate
      });
      const honors = response?.data?.honors || response?.honors || [];
      this.recentHonorsRaw = honors;
      this.recentHonors = honors.map(h => formatHonorText(h)).filter(Boolean);
    } catch (err) {
      debugError('Error loading honors for previous meeting:', err);
      this.recentHonors = [];
      this.recentHonorsRaw = [];
    }
  }

  /**
   * Load (or draft) the meeting for a date and render the page.
   * @param {string} date - Meeting date (YYYY-MM-DD)
   * @param {Object} options - { forceRefresh }
   */
  async loadMeeting(date, options = {}) {
    const normalizedDate = normalizeDateString(date);

    if (this.meetingAutosave && this.meetingAutosave.date !== normalizedDate) {
      await this.meetingAutosave.flush();
      await this.meetingAutosave.destroy();
      this.meetingAutosave = null;
    }

    this.currentDate = normalizedDate;
    if (this.canManage) {
      this.meetingAutosave ||= this.createMeetingAutosave(normalizedDate);
    }

    try {
      await this.updateHonorsForMeeting(normalizedDate);
      const response = await getReunionPreparation(normalizedDate, options);
      const payload = response?.data || {};
      if (payload.meetingSections) {
        this.updateSectionConfig(payload.meetingSections);
      }
      this.meeting = payload.meeting || this.createDraftMeeting(normalizedDate);
      const restoredDraft = this.meetingAutosave
        ? await this.meetingAutosave.restoreDraft()
        : null;
      if (restoredDraft) {
        this.applyLocalDraft(restoredDraft.formData);
      }
      if (this.meeting.id) {
        const meetingReminder = await getMeetingReminders(this.meeting.id, { forceRefresh: true })
          .catch(err => {
            debugError('Error loading meeting reminder:', err);
            return { data: null };
          });
        this.reminder = meetingReminder?.data || this.reminder;
      }

      // Merge saved timeline with section placeholder templates
      const loaded = this.meeting.activities || [];
      const defaults = this.activityManager.initializePlaceholderActivities(loaded.length > 0 ? loaded : null);
      const total = Math.max(defaults.length, loaded.length);
      const merged = [];
      for (let i = 0; i < total; i++) {
        const draft = defaults[i] || {};
        const saved = loaded[i] || {};
        merged.push({
          ...draft,
          ...saved,
          position: i,
          isDefault: saved.isDefault === undefined ? true : saved.isDefault
        });
      }
      this.activityManager.setMeetingLength(
        this.meeting.duration_minutes
          || this.organizationSettings.meeting_length?.duration_minutes
          || DEFAULT_MEETING_LENGTH_MINUTES,
        this.meeting.duration_override || null
      );
      this.activityManager.setSelectedActivities(merged);

      this.render();
      this.attachEventListeners();
      if (restoredDraft) {
        this.meetingAutosave?.scheduleServerSave();
      } else if (this.meetingAutosave) {
        this.meetingAutosave.setBaseline(this.collectFormData());
        if (!payload.meeting) {
          this.meetingAutosave.setStatus(MEETING_SAVE_STATES.DIRTY);
        }
      }
      this.updateSaveStatus();
    } catch (err) {
      debugError('Error loading meeting:', err);
      this.app.showMessage(translate('error_loading_meeting_data'), 'error');
    }
  }

  /**
   * Build an unsaved draft meeting for a date without a calendar entry.
   * @param {string} date - Meeting date (YYYY-MM-DD)
   * @returns {Object} Draft meeting
   */
  createDraftMeeting(date) {
    const defaultAnimateur = this.animateurs.find(
      a => a.full_name === this.organizationSettings.organization_info?.animateur_responsable
    );
    return {
      id: null,
      date,
      meeting_date: date,
      year_plan_id: null,
      theme: null,
      is_cancelled: false,
      endroit: this.organizationSettings.organization_info?.endroit || '',
      location: this.organizationSettings.organization_info?.endroit || '',
      notes: '',
      youth_of_honor: [...this.recentHonors],
      animateur_responsable: defaultAnimateur?.id || '',
      duration_override: null,
      duration_minutes: null,
      activities: []
    };
  }

  /**
   * Build the autosave controller for one meeting-date editing context.
   * @param {string} date - Date used to scope the local recovery draft
   * @returns {MeetingAutosave} Autosave controller
   */
  createMeetingAutosave(date) {
    return new MeetingAutosave({
      date,
      capture: () => this.collectFormData(),
      isValid: (formData) => this.isFormDataValid(formData),
      save: (formData) => saveReunionPreparation(formData),
      onSaved: (response, snapshot, options) =>
        this.applyAutosaveResponse(response, snapshot, options),
      onStatus: (state) => {
        this.saveState = state;
        this.updateSaveStatus();
      },
      onManualError: (error) => {
        debugError('Error saving meeting preparation:', error);
        this.app.showMessage(translate('error_saving_reunion_preparation'), 'error');
      }
    });
  }

  /**
   * Protect only changes that have not reached either IndexedDB or the server.
   */
  setupAutosaveLifecycle() {
    this.addWindowEventListener('beforeunload', (event) => {
      if (!this.meetingAutosave?.hasUnsafeChanges()) return;
      event.preventDefault();
      event.returnValue = '';
    });
    this.addDocumentEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        void this.meetingAutosave?.persistDraft();
      }
    });
    this.addWindowEventListener('pagehide', () => {
      void this.meetingAutosave?.persistDraft();
    });
    this.addWindowEventListener('online', () => {
      void this.meetingAutosave?.flush();
    });
  }

  /**
   * Overlay a scoped recovery draft on the server meeting before rendering.
   * @param {Object} formData - Complete preparation draft
   */
  applyLocalDraft(formData) {
    this.meeting = {
      ...this.meeting,
      date: formData.date || this.currentDate,
      meeting_date: formData.date || this.currentDate,
      animateur_responsable: formData.animateur_responsable || null,
      youth_of_honor: formData.youth_of_honor || [],
      endroit: formData.endroit || '',
      location: formData.endroit || this.meeting.location || '',
      duration_override: formData.duration_override || null,
      notes: formData.notes || '',
      activities: Array.isArray(formData.activities) ? formData.activities : []
    };
  }

  /**
   * Start a brand new meeting one week after the currently selected one.
   */
  async createAndLoadNewMeeting() {
    const dateList = this.meetingDates.map(d => normalizeDateString(d.date));
    const base = this.currentDate || getNextWeekdayDate(this.organizationSettings.organization_info?.meeting_day || 'Tuesday');
    const newDate = nextDateAfter(dateList, base) || addOneWeek(base);
    if (!newDate) {
      return;
    }
    await this.loadMeeting(newDate);
  }

  // ==========================================================================
  // RENDERING
  // ==========================================================================

  /**
   * Back link + title, omitted when a TabbedPage host already renders them.
   *
   * @returns {string} HTML, empty when embedded.
   */
  renderHeader() {
    if (this.embedded) return '';
    return `<a href="/dashboard" class="button button--ghost button--sm">← ${translate('back')}</a>
            <h1>${translate('tile_preparation_reunions')}</h1>`;
  }

  /** @returns {string} Compact, non-banner autosave status markup. */
  renderSaveStatus() {
    const translationKey = SAVE_STATUS_TRANSLATIONS[this.saveState] ||
      SAVE_STATUS_TRANSLATIONS[MEETING_SAVE_STATES.SAVED];
    return `
      <span id="meeting-save-status" class="meeting-save-status" data-state="${this.saveState}" role="status" aria-live="polite">
        <span class="meeting-save-status__indicator" aria-hidden="true"></span>
        <span class="meeting-save-status__label">${translate(translationKey)}</span>
      </span>
    `;
  }

  /** Update the compact status and explicit Save fallback without rerendering. */
  updateSaveStatus() {
    const status = document.getElementById('meeting-save-status');
    const saveButton = document.getElementById('meeting-save-button');
    const translationKey = SAVE_STATUS_TRANSLATIONS[this.saveState] ||
      SAVE_STATUS_TRANSLATIONS[MEETING_SAVE_STATES.SAVED];

    if (status) {
      status.dataset.state = this.saveState;
      status.setAttribute(
        'aria-busy',
        this.saveState === MEETING_SAVE_STATES.SAVING ? 'true' : 'false'
      );
      const label = status.querySelector('.meeting-save-status__label');
      if (label) label.textContent = translate(translationKey);
    }
    if (saveButton) {
      saveButton.disabled = this.saveState === MEETING_SAVE_STATES.SAVED ||
        this.saveState === MEETING_SAVE_STATES.SAVING;
    }
  }

  render() {
    const container = getMountPoint(this);
    if (!container) {
      return;
    }

    const meeting = this.meeting;
    const honorLabel = getHonorLabel(this.sectionConfig, translate);
    const honorText = (Array.isArray(meeting.youth_of_honor) && meeting.youth_of_honor.length > 0
      ? meeting.youth_of_honor
      : this.recentHonors
    ).map(h => formatHonorText(h)).filter(Boolean).join('\n');

    const dateList = this.meetingDates.map(d => normalizeDateString(d.date));
    const nextDate = nextDateAfter(dateList, this.currentDate) || addOneWeek(this.currentDate);
    const birthdays = getUpcomingBirthdays(this.participants, this.currentDate, nextDate);
    const birthdayRangeLabel = birthdays.startDate && birthdays.endDate
      ? `${translate('birthdays_between')} ${formatDate(birthdays.startDate, this.lang, { month: 'long', day: 'numeric' })} - ${formatDate(birthdays.endDate, this.lang, { month: 'long', day: 'numeric' })}`
      : translate('birthdays_range_unavailable');
    const birthdayItems = birthdays.entries.length > 0
      ? `<ul class="birthday-list">
          ${birthdays.entries.map(entry => `
            <li>
              <span>${escapeHTML(entry.name || translate('unknown'))}</span>
              <span>${formatDate(entry.date, this.lang, { month: 'long', day: 'numeric' })}</span>
            </li>
          `).join('')}
        </ul>`
      : `<p class="empty-state">${translate('no_upcoming_birthdays')}</p>`;

    const content = `
      <div class="preparation-reunions">
        ${this.renderHeader()}

        ${this.renderPlanBanner(meeting)}

        <div class="meeting-controls">
          <div class="date-navigation">
            <label for="date-select" class="sr-only">${translate('select_date')}</label>
            <select id="date-select" aria-label="${translate('select_date')}">
              <option value="">${translate('select_date')}</option>
              ${this.renderDateOptions()}
            </select>
          </div>
          <div class="meeting-actions">
            ${this.canManage ? `
              <button id="new-meeting" class="button button--secondary" title="${translate('new_meeting')}">${translate('new_meeting')}</button>
              <button id="magic-generate-btn" class="button button--secondary" title="${translate('magic_generate_plan')}">✨ ${translate('magic_generate_plan')}</button>
            ` : ''}
          </div>
        </div>

        <h2>${translate('upcoming_birthdays')}</h2>
        <div class="birthday-section">
          <p class="section-description">${birthdayRangeLabel}</p>
          ${birthdayItems}
        </div>

        <form id="reunion-form" class="form-layout">
          <div class="form-row">
            <div class="form-group">
              <label for="animateur-responsable">${translate('animateur_responsable')}:</label>
              <select id="animateur-responsable" required>
                <option value="">${translate('select_animateur')}</option>
                ${this.animateurs.map(a => `<option value="${a.id}" ${String(a.id) === String(meeting.animateur_responsable || '') ? 'selected' : ''}>${escapeHTML(a.full_name)}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label for="date">${translate('date')}:</label>
              <input type="date" id="date" value="${escapeHTML(this.currentDate || '')}" required>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label for="youth-of-honor">
                ${honorLabel}:
                <small style="font-weight: normal; color: var(--color-text-muted); font-size: var(--font-size-xs);">(${translate('one_per_line')})</small>
              </label>
              <textarea id="youth-of-honor" class="honor-textarea" rows="3" placeholder="${translate('enter_names_one_per_line')}">${escapeHTML(honorText)}</textarea>
            </div>
            <div class="form-group">
              <label for="endroit">${translate('endroit')}:</label>
              <input type="text" id="endroit" value="${escapeHTML(meeting.endroit || '')}" required>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label for="duration-override">
                ${translate('special_meeting_duration')}:
                <small style="font-weight: normal; color: var(--color-text-muted); font-size: var(--font-size-xs);">(${translate('leave_empty_for_default')})</small>
              </label>
              <input type="number" id="duration-override" min="15" step="15" value="${meeting.duration_override || ''}" placeholder="${translate('duration_minutes_placeholder')}" title="${translate('duration_override_help')}">
            </div>
          </div>
          <div id="activities-container" class="activities-grid">
            <div class="activities-grid__toolbar">
              <button type="button" id="toggle-quick-edit" class="button button--ghost">${translate('toggle_quick_edit_mode')}</button>
            </div>
            <div class="activities-grid__header">
              <div class="activities-grid__header-cell activities-grid__header-cell--handle" aria-hidden="true"></div>
              <div class="activities-grid__header-cell">${translate('heure_et_duree')}</div>
              <div class="activities-grid__header-cell">${translate('activite_responsable_materiel')}</div>
            </div>
            <div id="activities-list" class="activities-grid__body"></div>
          </div>
          <div class="form-group">
            <label for="notes">${translate('notes')}:</label>
            <textarea id="notes" rows="4" placeholder="${translate('meeting_notes_placeholder')}">${escapeHTML(this.getNotesWithReminder(meeting.notes || ''))}</textarea>
          </div>
          ${this.canManage ? `
            <div class="form-actions form-actions--mobile">
              ${this.renderSaveStatus()}
              <button type="submit" id="meeting-save-button" class="button button--primary" ${this.saveState === MEETING_SAVE_STATES.SAVED ? 'disabled' : ''}>${translate('save')}</button>
              <button type="button" id="print-button" class="button button--secondary">${translate('print')}</button>
            </div>
          ` : `
            <div class="form-actions form-actions--mobile">
              <button type="button" id="print-button" class="button button--secondary">${translate('print')}</button>
            </div>
          `}
        </form>

        ${this.canManage ? `
          <h2>${translate('set_reminder')}</h2>
          <form id="reminder-form" class="form-layout">
            <div class="form-group">
              <label for="reminder-text">${translate('reminder_text')}:</label>
              <textarea id="reminder-text" rows="3" placeholder="${translate('reminder_placeholder')}">${escapeHTML(this.reminder?.reminder_text || '')}</textarea>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label for="reminder-date">${translate('reminder_date')}:</label>
                <input type="date" id="reminder-date" value="${escapeHTML(isoToDateString(this.reminder?.reminder_date || '') || '')}" required>
              </div>
              <div class="form-group form-group--checkbox">
                <label for="recurring-reminder" class="label--checkbox">
                  <input type="checkbox" id="recurring-reminder" ${this.reminder?.is_recurring ? 'checked' : ''}>
                  <span>${translate('recurring_reminder')}</span>
                </label>
              </div>
            </div>
            <button type="submit" class="button button--primary">${translate('save_reminder')}</button>
          </form>
        ` : ''}

        <p class="footer-nav"><a href="/dashboard">${translate('back_to_dashboard')}</a></p>
      </div>
    `;

    setContent(container, content);
    this.activityManager.renderActivitiesTable();
  }

  /**
   * Banner connecting this preparation to the yearly plan (theme, period,
   * cancellation state, link to the planner).
   * @param {Object} meeting - Serialized meeting
   * @returns {string} HTML
   */
  renderPlanBanner(meeting) {
    if (meeting.is_cancelled) {
      return `
        <div class="alert alert--warning" role="alert">
          <strong>🚫 ${translate('meeting_cancelled_in_plan')}</strong>
          ${meeting.plan_title ? `<span> — ${escapeHTML(meeting.plan_title)}</span>` : ''}
        </div>
      `;
    }
    if (!meeting.year_plan_id && !meeting.theme) {
      return '';
    }
    const parts = [];
    if (meeting.theme) {
      parts.push(`<strong>${translate('yearly_planner_theme')}:</strong> ${escapeHTML(meeting.theme)}`);
    }
    if (meeting.period_title) {
      parts.push(`<strong>${translate('period')}:</strong> ${escapeHTML(meeting.period_title)}`);
    }
    if (meeting.plan_title) {
      parts.push(`<strong>${translate('yearly_planner_title')}:</strong> ${escapeHTML(meeting.plan_title)}`);
    }
    return `
      <div class="alert alert--info meeting-plan-banner">
        <span>📅 ${parts.join(' · ')}</span>
        <a href="${this.returnPlanId ? `/yearly-planner/${this.returnPlanId}` : '/yearly-planner'}"
           class="button button--small button--ghost">${translate('open_yearly_planner')}</a>
      </div>
    `;
  }

  renderDateOptions() {
    const dates = [...this.meetingDates];
    const current = normalizeDateString(this.currentDate);
    if (current && !dates.some(d => normalizeDateString(d.date) === current)) {
      dates.push({ date: current, is_cancelled: false, theme: null, is_prepared: false });
    }
    return dates
      .map(d => ({ ...d, date: normalizeDateString(d.date) }))
      .sort((a, b) => b.date.localeCompare(a.date))
      .map(d => {
        const flags = [
          d.is_cancelled ? '🚫' : '',
          d.is_prepared ? '✓' : ''
        ].filter(Boolean).join(' ');
        const theme = d.theme ? ` — ${d.theme}` : '';
        const label = `${formatDate(d.date, this.lang, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}${theme}${flags ? ` ${flags}` : ''}`;
        return `<option value="${d.date}" ${d.date === current ? 'selected' : ''}>${escapeHTML(label)}</option>`;
      })
      .join('');
  }

  /**
   * Append the active reminder to the notes preview (display only, like the
   * legacy behavior).
   * @param {string} notes - Saved notes
   * @returns {string} Notes with reminder appended when relevant
   */
  getNotesWithReminder(notes) {
    if (!this.reminder?.reminder_text) {
      return notes;
    }
    if (notes.includes(this.reminder.reminder_text)) {
      return notes;
    }
    const reminderDate = new Date(this.reminder.reminder_date);
    if (this.reminder.is_recurring || reminderDate >= new Date()) {
      return `${notes}\n\n${translate('reminder_text')}: ${this.reminder.reminder_text}`.trim();
    }
    return notes;
  }

  renderError() {
    const content = `
      <div class="preparation-reunions">
        ${this.renderHeader()}
        <div class="error-message">
          <p>${translate('error_loading_preparation_reunions')}</p>
          <p><a href="/dashboard">${translate('back_to_dashboard')}</a></p>
        </div>
      </div>
    `;
    setContent(getMountPoint(this), content);
  }

  // ==========================================================================
  // EVENT LISTENERS
  // ==========================================================================

  attachEventListeners() {
    if (this.isDestroyed) {
      return;
    }

    // Loading or saving a meeting replaces the form. Release every handler
    // from the previous form before binding the newly rendered controls.
    this.renderAbortController?.abort();
    this.renderAbortController = new AbortController();
    const renderSignal = this.renderAbortController.signal;
    const listen = (element, event, handler, options = {}) => {
      element?.addEventListener(event, handler, { ...options, signal: renderSignal });
    };

    // Block Enter-key submits inside the activity grid
    listen(document.getElementById('reunion-form'), 'keydown', (e) => {
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.type !== 'submit') {
        e.preventDefault();
      }
    });

    listen(document.getElementById('date-select'), 'change', (e) => {
      if (e.target.value) {
        this.loadMeeting(e.target.value);
      }
    });

    listen(document.getElementById('new-meeting'), 'click', () => this.createAndLoadNewMeeting());
    listen(document.getElementById('magic-generate-btn'), 'click', () => this.handleMagicGenerate());
    listen(document.getElementById('print-button'), 'click', () => this.printManager.printPreparation());
    const reunionForm = document.getElementById('reunion-form');
    listen(reunionForm, 'submit', (e) => this.handleSubmit(e));
    listen(reunionForm, 'input', () => this.scheduleMeetingAutosave());
    listen(reunionForm, 'change', () => this.scheduleMeetingAutosave());
    listen(reunionForm, 'activitieschange', () => this.scheduleMeetingAutosave({ immediate: true }));
    listen(document.getElementById('reminder-form'), 'submit', (e) => this.handleReminderSubmit(e));
    listen(document.getElementById('toggle-quick-edit'), 'click', () => this.toggleQuickEditMode());

    const activitiesContainer = document.getElementById('activities-container');

    listen(activitiesContainer, 'change', (e) => {
      const row = e.target.closest('.activity-row');
      if (!row) {
        return;
      }
      if (e.target.classList.contains('activity-select')) {
        this.activityManager.updateActivityDetails(e.target);
        e.target.setAttribute('data-default', 'false');
        row.setAttribute('data-default', 'false');
      } else if (e.target.classList.contains('activity-responsable')) {
        if (e.target.value === 'other') {
          this.activityManager.switchResponsableToInput(e.target);
        } else {
          e.target.setAttribute('data-default', 'false');
          row.setAttribute('data-default', 'false');
        }
      }
    });

    listen(activitiesContainer, 'input', (e) => {
      const row = e.target.closest('.activity-row');
      if (!row) {
        return;
      }
      if (e.target.classList.contains('activity-time') ||
          e.target.classList.contains('activity-duration') ||
          e.target.classList.contains('activity-materiel')) {
        e.target.setAttribute('data-default', 'false');
        row.setAttribute('data-default', 'false');
      }
    });

    listen(activitiesContainer, 'click', (e) => {
      if (e.target.classList.contains('description-btn')) {
        e.preventDefault();
        e.stopPropagation();
        this.showDescriptionModal(e.target.getAttribute('data-description'));
      } else if (e.target.classList.contains('edit-activity-btn')) {
        this.activityManager.toggleActivityEdit(e.target.closest('.activity-row'));
      } else if (e.target.classList.contains('insert-here-btn')) {
        this.activityManager.addActivityRow(e.target.dataset.position);
      } else if (e.target.classList.contains('delete-row-btn')) {
        this.activityManager.deleteActivityRow(e.target.dataset.position);
      }
    });
  }

  toggleQuickEditMode() {
    const container = document.getElementById('activities-container');
    if (!container) {
      return;
    }
    this.activityManager.setQuickEditActive(!this.activityManager.quickEditActive);
    container.querySelectorAll('.delete-row-btn').forEach(btn => btn.classList.toggle('hidden'));
    container.querySelectorAll('.insert-here-divider').forEach(divider => divider.classList.toggle('hidden'));
    document.getElementById('toggle-quick-edit')?.classList.toggle('active');
  }

  /**
   * Capture the full form after a user edit and schedule local/server saves.
   * @param {Object} options - Scheduling options
   * @param {boolean} [options.immediate] - Bypass server debounce for structural edits
   */
  scheduleMeetingAutosave({ immediate = false } = {}) {
    if (!this.canManage || !this.meetingAutosave) return;
    this.meetingAutosave.markDirty({ immediate });
  }

  showDescriptionModal(description) {
    const { overlay } = openModal({
      id: 'activity-description-modal',
      title: translate('description'),
      body: '<p id="description-text"></p>'
    });
    overlay.querySelector('#description-text').textContent = description || '';
  }

  // ==========================================================================
  // SAVE
  // ==========================================================================

  /**
   * Collect the complete form without surfacing validation. This snapshot is
   * safe for local recovery even while required fields are incomplete.
   * @returns {Object} Meeting preparation payload
   */
  collectFormData() {
    const honorValues = document.getElementById('youth-of-honor').value
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);

    const durationOverrideField = document.getElementById('duration-override');
    const durationOverride = durationOverrideField?.value
      ? parseInt(durationOverrideField.value, 10)
      : null;

    const formData = {
      animateur_responsable: document.getElementById('animateur-responsable').value || null,
      date: isoToDateString(document.getElementById('date').value),
      youth_of_honor: honorValues,
      endroit: document.getElementById('endroit').value,
      activities: this.activityManager.getSelectedActivitiesFromDOM(),
      notes: document.getElementById('notes').value
    };
    if (durationOverride) {
      formData.duration_override = durationOverride;
    }
    return formData;
  }

  /**
   * Test whether a local draft is complete enough for a server autosave.
   * Browser-native required-field validation stays silent in this path.
   * @param {Object} formData - Meeting preparation payload
   * @returns {boolean} True when the server may accept the full snapshot
   */
  isFormDataValid(formData) {
    const form = document.getElementById('reunion-form');
    const honorValid = !this.sectionConfig?.honorField?.required ||
      formData.youth_of_honor.length > 0;
    return Boolean(formData.date && honorValid && form?.checkValidity());
  }

  /**
   * Collect and validate an explicit Save request.
   * @returns {Object} Valid meeting preparation payload
   */
  extractFormData() {
    const formData = this.collectFormData();
    if (this.sectionConfig?.honorField?.required && formData.youth_of_honor.length === 0) {
      this.app.showMessage(translate('meeting_section_honor_required'), 'error');
      throw new Error('Honoree required for this section');
    }
    return formData;
  }

  /**
   * Merge a normalized save response into the live form without rerendering or
   * stealing focus. Server activity IDs are adopted after the latest save.
   * @param {Object} response - API response
   * @param {Object} snapshot - Payload revision that was saved
   * @param {Object} options - { isLatest }
   */
  async applyAutosaveResponse(response, snapshot, { isLatest }) {
    const savedMeeting = response?.data;
    if (!savedMeeting) return;

    this.meeting = { ...this.meeting, ...savedMeeting };
    if (isLatest) {
      this.currentDate = normalizeDateString(
        savedMeeting.date || savedMeeting.meeting_date || snapshot.formData.date
      );
      const currentActivities = this.activityManager.getSelectedActivitiesFromDOM();
      const savedActivities = savedMeeting.activities || [];
      if (currentActivities.length === savedActivities.length) {
        const mergedActivities = currentActivities.map((activity, index) => ({
          ...savedActivities[index],
          ...activity,
          id: savedActivities[index]?.id || activity.id,
          position: index
        }));
        this.activityManager.setSelectedActivities(mergedActivities);
        document.querySelectorAll('#activities-list .activity-row')
          .forEach((row, index) => {
            if (mergedActivities[index]?.id) {
              row.dataset.id = mergedActivities[index].id;
            }
            row.dataset.position = String(index);
          });
      }
    }

    const savedDate = normalizeDateString(
      savedMeeting.date || savedMeeting.meeting_date || snapshot.formData.date
    );
    const existingDate = this.meetingDates.find(
      entry => normalizeDateString(entry.date) === savedDate
    );
    if (existingDate) {
      existingDate.is_prepared = true;
    } else if (savedDate) {
      this.meetingDates.push({ date: savedDate, is_prepared: true, is_cancelled: false });
    }
    const dateSelect = document.getElementById('date-select');
    if (dateSelect) {
      setContent(
        dateSelect,
        `<option value="">${translate('select_date')}</option>${this.renderDateOptions()}`
      );
    }

    try {
      await Promise.all([
        deleteCachedData('reunion_dates'),
        deleteCachedData(`reunion_preparation_${snapshot.formData.date}`),
        clearYearlyPlannerCaches()
      ]);
    } catch (error) {
      // The server write already succeeded; cache cleanup must not turn a
      // successful autosave into a false failure state.
      debugError('Unable to clear meeting caches after autosave:', error);
    }
  }

  async handleSubmit(e) {
    e.preventDefault();
    e.stopPropagation();

    let formData;
    try {
      formData = this.extractFormData();
    } catch (err) {
      debugError('Validation error saving meeting preparation:', err);
      return;
    }

    this.meetingAutosave?.markDirty({ formData, immediate: false, force: true });
    const submitButton = e.target.querySelector('button[type="submit"]');
    setButtonLoading(submitButton, true);
    try {
      await this.meetingAutosave?.flush({ manual: true });
    } catch (err) {
      debugError('Error saving meeting preparation:', err);
      this.app.showMessage(translate('error_saving_reunion_preparation'), 'error');
    } finally {
      setButtonLoading(submitButton, false);
      this.updateSaveStatus();
    }
  }

  async handleReminderSubmit(e) {
    e.preventDefault();
    e.stopPropagation();

    const reminderData = {
      reminder_text: document.getElementById('reminder-text').value,
      reminder_date: document.getElementById('reminder-date').value,
      is_recurring: document.getElementById('recurring-reminder').checked
    };

    try {
      if (this.meeting?.id) {
        await createReminder(this.meeting.id, {
          channel: 'email',
          scheduled_at: `${reminderData.reminder_date}T09:00:00`,
          custom_message: reminderData.reminder_text,
          is_recurring: reminderData.is_recurring
        });
      } else {
        await saveReminder(reminderData);
      }
      this.reminder = { ...this.reminder, ...reminderData };
      this.app.showMessage(translate('reminder_saved_successfully'), 'success');
    } catch (err) {
      debugError('Error saving reminder:', err);
      this.app.showMessage(translate('error_saving_reminder'), 'error');
    }
  }

  // ==========================================================================
  // AI GENERATION
  // ==========================================================================

  handleMagicGenerate() {
    const dateVal = document.getElementById('date')?.value;
    if (!dateVal) {
      this.app.showMessage(translate('please_select_date_first'), 'warning');
      return;
    }

    const { overlay, close } = openModal({
      id: 'ai-focus-modal',
      title: translate('meeting_focus_prompt'),
      body: `
        <form id="ai-focus-form">
          <div class="form-group">
            <label for="meeting-focus">${translate('meeting_focus_label')}</label>
            <textarea id="meeting-focus" name="focus" rows="4" placeholder="${translate('meeting_focus_placeholder')}" required></textarea>
            <small>${translate('meeting_focus_hint')}</small>
          </div>
          <div class="modal-actions">
            <button type="button" class="button button--secondary" data-modal-close>${translate('cancel')}</button>
            <button type="submit" class="button button--primary">${translate('generate')}</button>
          </div>
        </form>
      `
    });

    overlay.querySelector('#ai-focus-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const focus = overlay.querySelector('#meeting-focus').value.trim();
      if (!focus) {
        return;
      }
      close();
      await this.runMagicGenerate(dateVal, focus);
    });
  }

  async runMagicGenerate(dateVal, focus) {
    const btn = document.getElementById('magic-generate-btn');
    setButtonLoading(btn, true);

    try {
      const templates = this.sectionConfig?.activityTemplates || [];
      const mostRecentHonor = this.recentHonorsRaw.length > 0 ? this.recentHonorsRaw[0] : null;
      const allowedResponsables = this.animateurs.map(a => a.full_name).filter(Boolean);

      const vocabulary = getUnitVocabulary(this.organizationSettings, this.lang);
      const glossary = [
        { term: vocabulary.individual_achievement, definition: translate('unit_vocabulary_term_individual_achievement') },
        { term: vocabulary.group_achievement, definition: translate('unit_vocabulary_term_group_achievement') },
        { term: vocabulary.subgroup_singular, definition: translate('unit_vocabulary_term_subgroup_singular') },
      ].filter(({ term }) => Boolean(term));
      const meetingDurationMinutes = normalizeMeetingDurationMinutes(
        this.meeting?.duration_override
          || this.meeting?.duration_minutes
          || this.organizationSettings.meeting_length?.duration_minutes
          || DEFAULT_MEETING_LENGTH_MINUTES,
        DEFAULT_MEETING_LENGTH_MINUTES,
      );

      const payload = {
        date: dateVal,
        section: vocabulary.collective_name || this.sectionConfig?.name || 'Unit',
        locale: this.lang,
        vocabulary,
        duration: `${meetingDurationMinutes} minutes`,
        focus,
        theme: this.meeting?.theme || null,
        activityTemplates: templates.map(t => ({
          time: t.time,
          duration: t.duration,
          activity: translate(t.activityKey) || t.activityKey,
          type: translate(t.typeKey) || t.typeKey
        })),
        recentHonor: mostRecentHonor ? {
          name: mostRecentHonor.participant_name,
          honor: mostRecentHonor.honor_name,
          date: mostRecentHonor.date_awarded
        } : null,
        glossary,
        meetingDefaults: {
          mandatoryAgenda: [
            { time: '18:45', duration: '00:05', activity: translate('activity_welcome_cubs') },
            { duration: '00:10', activity: `${translate('attendance')} / ${vocabulary.honor_singular || translate('youth_of_honor')}` }
          ],
          instructions: 'Include the mandatory agenda at the very start of the plan, at the meeting start time. Respect the provided unit vocabulary and activity templates.'
        },
        constraints: {
          useTemplateActivities: true,
          templateStrictness: 'strict-order-duration',
          noInventedNames: true,
          allowedResponsables,
          missingResponsablePolicy: 'leaveEmpty',
          outputSchema: {
            type: 'object',
            fields: ['timeline[]', 'time', 'duration', 'activity', 'responsable', 'materials|materiel']
          },
          instructions: 'Do not add or remove blocks beyond mandatoryAgenda + provided activityTemplates. Only choose responsibles from allowedResponsables; otherwise leave empty.'
        }
      };

      const response = await aiGenerateText('meeting_plan', payload);
      const plan = response.data?.data || response.data;
      debugLog('AI meeting plan:', plan);

      const mergedActivities = mergeTimelineWithTemplates(
        plan.timeline, templates, allowedResponsables, translate
      );
      this.activityManager.setSelectedActivities(mergedActivities);
      this.activityManager.renderActivitiesTable();
      this.scheduleMeetingAutosave({ immediate: true });

      this.app.showMessage(translate('plan_generated_success'), 'success');
    } catch (err) {
      let msg = err.message;
      if (err.error?.code === 'AI_BUDGET_EXCEEDED') {
        msg = translate('ai_budget_exceeded');
      }
      this.app.showMessage(`${translate('error_generating_plan')}: ${msg}`, 'error');
      debugError('Magic Generate failed', err);
    } finally {
      setButtonLoading(btn, false);
    }
  }

  destroy() {
    if (this.isDestroyed) {
      return;
    }
    const autosave = this.meetingAutosave;
    if (autosave?.latestSnapshot) {
      void autosave.flush().finally(() => autosave.destroy());
    } else {
      void autosave?.destroy();
    }
    this.activityManager?.destroy();
    super.destroy();
    this.renderAbortController?.abort();
  }
}
