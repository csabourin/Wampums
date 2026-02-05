import { translate } from "./app.js";
import { debugError, debugLog } from "./utils/DebugUtils.js";
import { escapeHTML } from "./utils/SecurityUtils.js";
import { formatDate, getTodayISO } from "./utils/DateUtils.js";
import {
  getPermissionSlips,
  savePermissionSlip,
  signPermissionSlip,
  sendPermissionSlipEmails,
  sendPermissionSlipReminders,
  getResourceDashboard,
  archivePermissionSlip
} from "./api/api-endpoints.js";
import { getGroups } from "./api/api-endpoints.js";
import { getParticipants } from "./api/api-endpoints.js";
import { deleteCachedData } from "./indexedDB.js";
import { setContent } from "./utils/DOMUtils.js";
import { withButtonLoading } from "./utils/PerformanceUtils.js";

export class PermissionSlipDashboard {
  constructor(app, options = {}) {
    this.app = app;
    this.activityId = options.activityId || null;
    this.activity = null; // Store activity details when activityId provided
    this.activityDate = getTodayISO();
    this.permissionSlips = [];
    this.allPermissionSlips = []; // All slips across all dates for quick links
    this.dashboardSummary = { permission_summary: [] };
    this.groups = [];
    this.participants = [];
    this.selectedAudience = null;
    this.selectedParticipantIds = [];
    this.showCreateForm = false;
  }

  async init() {
    try {
      // Load activity details if activityId provided
      if (this.activityId) {
        await this.loadActivity();
      }
      await this.loadData();
      this.render();
      this.attachEventHandlers();
    } catch (error) {
      debugError("Error initializing permission slip dashboard:", error);
      this.app.showMessage(translate("permission_slip_error_loading"), "error");
    }
  }

  async loadActivity() {
    try {
      const { getActivity } = await import('./api/api-activities.js');
      this.activity = await getActivity(this.activityId);
      this.activityDate = this.activity.activity_date;
      debugLog('Loaded activity:', this.activity);
    } catch (error) {
      debugError('Error loading activity:', error);
      throw error;
    }
  }

  async loadData(forceRefresh = false) {
    // Build params based on whether we're viewing by activity or date
    let params = {};
    let slipParams = {};

    if (this.activityId) {
      // Activity mode: filter by activity_id
      params.activity_id = this.activityId;
      slipParams.activity_id = this.activityId;
    } else {
      // Legacy mode: filter by meeting_date
      params.meeting_date = this.activityDate;
    }

    const [slipsResponse, allSlipsResponse, summaryResponse, groupsResponse, participantsResponse] = await Promise.all([
      getPermissionSlips(slipParams, { forceRefresh }), // Slips for this activity/date
      this.activityId ? Promise.resolve({ data: { permission_slips: [] } }) : getPermissionSlips({}, { forceRefresh }), // All slips for quick links (only in legacy mode)
      getResourceDashboard(params, { forceRefresh }),
      getGroups(),
      getParticipants()
    ]);

    this.permissionSlips = slipsResponse?.data?.permission_slips || slipsResponse?.permission_slips || [];

    // In activity mode, don't load all slips (not needed for quick links)
    if (this.activityId) {
      this.allPermissionSlips = this.permissionSlips;
    } else {
      this.allPermissionSlips = allSlipsResponse?.data?.permission_slips || allSlipsResponse?.permission_slips || [];
    }

    this.dashboardSummary = summaryResponse?.data || summaryResponse || { permission_summary: [] };
    this.groups = groupsResponse?.data || groupsResponse?.groups || [];
    this.participants = participantsResponse?.data || participantsResponse?.participants || [];
  }

  async refreshData(forceRefresh = false) {
    await this.loadData(forceRefresh);
    this.render();
    this.attachEventHandlers();
  }

  render() {
    const container = document.getElementById("app");
    if (!container) return;

    const permissionSummary = this.dashboardSummary?.permission_summary || [];
    const signedCount = permissionSummary.find(s => s.status === 'signed')?.count || 0;
    const pendingCount = permissionSummary.find(s => s.status === 'pending')?.count || 0;

    // Back button - different depending on mode
    const backButton = this.activityId
      ? `<a href="/activities" class="button button--ghost">← ${translate("back_to_activities")}</a>`
      : `<a href="/dashboard" class="button button--ghost">← ${translate("back")}</a>`;

    // Header - different depending on mode
    const headerHtml = this.activityId && this.activity
      ? `<div class="card">
          <h1>${escapeHTML(translate("permission_slips_for_activity"))} "${escapeHTML(this.activity.name)}"</h1>
          <p class="subtitle">
            <strong>${translate("activity_date_label")}:</strong> ${formatDate(this.activity.activity_date, this.app.lang || 'fr')}
          </p>
          ${this.activity.description ? `<p>${escapeHTML(this.activity.description)}</p>` : ''}
        </div>`
      : `<div class="card">
          <h1>${escapeHTML(translate("permission_slip_dashboard_title"))}</h1>
          <p class="subtitle">${escapeHTML(translate("permission_slip_dashboard_description"))}</p>
        </div>`;

    setContent(container, `
      ${backButton}
      <section class="page permission-slip-dashboard">
        ${headerHtml}

        ${!this.activityId ? this.renderDateQuickLinks() : ''}

        <div class="card">
          <h2>${escapeHTML(translate("dashboard_summary_title"))}</h2>
          <div class="summary-grid">
            <div class="summary-tile">
              <div class="summary-label">${escapeHTML(translate("permission_slip_status"))}</div>
              <ul class="summary-list">
                ${permissionSummary.length === 0
        ? `<li>${escapeHTML(translate("no_data_available"))}</li>`
        : permissionSummary
          .map((row) => `<li>${escapeHTML(row.status)}: <strong>${row.count}</strong></li>`)
          .join('')}
              </ul>
            </div>
          </div>
        </div>

        <div class="card">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; gap: 12px; flex-wrap: wrap;">
            ${!this.activityId ? `
              <div class="stacked" style="min-width: 240px; margin: 0;">
                <span>${escapeHTML(translate("activity_date_label"))}</span>
                <input type="date" id="activityDateInput" value="${escapeHTML(this.activityDate)}" />
              </div>
            ` : ''}
            <div style="margin-left: auto; text-align: right;">
              <h2 style="margin: 0 0 8px 0;">${escapeHTML(translate("permission_slip_section_title"))}</h2>
              <button id="toggleCreateFormBtn" class="btn primary">
                ${this.showCreateForm ? translate("cancel") : translate("permission_slip_create")}
              </button>
            </div>
          </div>

          ${this.showCreateForm ? this.renderCreateForm() : ''}

          ${this.renderPermissionSlipsTable()}
        </div>
      </section>
    `);

  }

  renderDateQuickLinks() {
    // Group ALL permission slips by date to show quick navigation
    const dateMap = new Map();

    this.allPermissionSlips.forEach(slip => {
      const date = slip.meeting_date;
      if (!dateMap.has(date)) {
        dateMap.set(date, {
          date: date,
          pending: 0,
          total: 0,
          activities: new Set()
        });
      }
      const dateInfo = dateMap.get(date);
      dateInfo.total++;
      if (slip.status === 'pending') {
        dateInfo.pending++;
      }
      if (slip.activity_title) {
        dateInfo.activities.add(slip.activity_title);
      }
    });

    if (dateMap.size === 0) {
      return '';
    }

    // Sort dates chronologically
    const sortedDates = Array.from(dateMap.entries())
      .sort((a, b) => new Date(a[0]) - new Date(b[0]));

    const hasAnyPending = sortedDates.some(([_, info]) => info.pending > 0);

    if (!hasAnyPending) {
      return '';
    }

    const dateLinks = sortedDates.map(([date, info]) => {
      const isPending = info.pending > 0;
      const isComplete = info.pending === 0;
      const statusIcon = isComplete ? '✓' : '';
      const pendingText = isPending ? ` (${info.pending})` : '';
      const activityNames = Array.from(info.activities).join(', ');

      return `
        <button
          class="date-quick-link ${isPending ? 'has-pending' : 'complete'}"
          data-date="${date}"
          title="${escapeHTML(activityNames)}"
        >
          ${formatDate(date, this.app.lang || 'fr')}${pendingText} ${statusIcon}
        </button>
      `;
    }).join('');

    return `
      <div class="card">
        <h2>${escapeHTML(translate("dates_with_pending_signatures"))}</h2>
        <p style="color: #666; font-size: 0.9em; margin-bottom: 12px;">
          ${escapeHTML(translate("click_date_to_view_signatures"))}
        </p>
        <div class="date-quick-links">
          ${dateLinks}
        </div>
      </div>
    `;
  }

  renderCreateForm() {
    const selectedValue = this.selectedAudience || '';
    const audienceOptions = [
      { value: 'all', label: translate('all_active_participants') },
      { value: 'first-year', label: translate('first_year_participants') },
      { value: 'second-year', label: translate('second_year_participants') },
      { value: 'age-11-plus', label: translate('participants_age_11_plus') }
    ];

    const audienceOptionHtml = audienceOptions
      .map(option => `<option value="${option.value}" ${selectedValue === option.value ? 'selected' : ''}>${escapeHTML(option.label)}</option>`)
      .join('');

    const groupOptions = this.groups.map(g =>
      `<option value="group-${g.id}" ${selectedValue === `group-${g.id}` ? 'selected' : ''}>${escapeHTML(g.name)}</option>`
    ).join('');

    return `
      <form id="permissionSlipForm" class="stacked" style="border: 1px solid #ddd; padding: 20px; border-radius: 4px; margin-bottom: 20px; background: #f9f9f9;">
        ${this.activityId && this.activity ? `
          <!-- Activity mode: show activity info, hide manual entry fields -->
          <div style="background: #e7f2ee; padding: 12px; border-radius: 4px; margin-bottom: 16px;">
            <p style="margin: 0; color: #0f7a5a;"><strong>${translate("activity_label")}:</strong> ${escapeHTML(this.activity.name)}</p>
          </div>
        ` : `
          <!-- Legacy mode: show manual entry fields -->
          <div class="grid grid-2">
            <label class="stacked">
              <span>${escapeHTML(translate("activity_title_label"))} *</span>
              <input type="text" name="activity_title" required maxlength="200" />
            </label>
            <label class="stacked">
              <span>${escapeHTML(translate("deadline_date_label"))}</span>
              <input type="date" name="deadline_date" />
            </label>
          </div>

          <label class="stacked">
            <span>${escapeHTML(translate("activity_description_label"))}</span>
            <textarea id="activityDescriptionInput" rows="4" placeholder="${escapeHTML(translate("activity_description_label"))}"></textarea>
          </label>
        `}

          <label class="stacked">
            <span>${escapeHTML(translate("select_group_label"))} *</span>
          <select id="groupSelect" required>
            <option value="" ${selectedValue === '' ? 'selected' : ''}>-- ${escapeHTML(translate("select_group_label"))} --</option>
            <optgroup label="${escapeHTML(translate('participant_audience_categories'))}">
              ${audienceOptionHtml}
            </optgroup>
            <optgroup label="${escapeHTML(translate('group_categories'))}">
              ${groupOptions}
            </optgroup>
          </select>
        </label>

        <div id="participantsSection" style="display: none;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <span><strong>${escapeHTML(translate("select_participants_label"))}</strong> (<span id="selectedCount">0</span> ${escapeHTML(translate("participants_selected"))})</span>
            <div>
              <button type="button" id="selectAllBtn" class="btn link">${escapeHTML(translate("select_all_participants"))}</button>
              <button type="button" id="deselectAllBtn" class="btn link">${escapeHTML(translate("deselect_all_participants"))}</button>
            </div>
          </div>
          <div id="participantsList" style="max-height: 300px; overflow-y: auto; border: 1px solid #ddd; padding: 12px; background: white; border-radius: 4px;">
          </div>
        </div>

        <button type="submit" class="btn primary" style="margin-top: 16px;">${escapeHTML(translate("permission_slip_create"))}</button>
      </form>
    `;
  }

  renderPermissionSlipsTable() {
    // Group permission slips by activity
    const activitiesMap = new Map();

    this.permissionSlips.forEach(slip => {
      const key = `${slip.activity_title || 'Sans titre'}_${slip.meeting_date}`;
      if (!activitiesMap.has(key)) {
        activitiesMap.set(key, {
          title: slip.activity_title || translate("no_data_available"),
          date: slip.meeting_date,
          description: slip.activity_description,
          deadline: slip.deadline_date,
          slips: []
        });
      }
      activitiesMap.get(key).slips.push(slip);
    });

    if (activitiesMap.size === 0) {
      return `<p>${escapeHTML(translate("no_permission_slips"))}</p>`;
    }

    let html = '';

    activitiesMap.forEach((activity, key) => {
      const signedCount = activity.slips.filter(s => s.status === 'signed').length;
      const pendingCount = activity.slips.filter(s => s.status === 'pending').length;
      const emailSentCount = activity.slips.filter(s => s.email_sent).length;

      html += `
        <div class="activity-group" style="margin-bottom: 24px; border: 1px solid #ddd; border-radius: 4px; overflow: hidden;">
          <div style="background: #f5f5f5; padding: 16px; border-bottom: 1px solid #ddd;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div>
                <h3 style="margin: 0 0 8px 0;">${escapeHTML(activity.title)}</h3>
                <p style="margin: 0; color: #666;">
                  ${translate("activity_date_label")}: ${formatDate(activity.date, this.app.lang || 'fr')}
                  ${activity.deadline ? ` | ${translate("deadline_date_label")}: ${formatDate(activity.deadline, this.app.lang || 'fr')}` : ''}
                </p>
              </div>
              <div style="text-align: right;">
                <div style="margin-bottom: 8px;">
                  <strong>${escapeHTML(translate("signed_count"))}:</strong> ${signedCount} / ${activity.slips.length}
                </div>
                <div>
                  <button class="btn secondary btn-send-emails" data-activity-title="${escapeHTML(activity.title)}" data-date="${activity.date}">
                    ${escapeHTML(translate("send_emails_to_parents"))}
                  </button>
                  <button class="btn secondary btn-send-reminders" data-activity-title="${escapeHTML(activity.title)}" data-date="${activity.date}">
                    ${escapeHTML(translate("send_reminder_emails"))}
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>${escapeHTML(translate("participant"))}</th>
                  <th>${escapeHTML(translate("permission_slip_status"))}</th>
                  <th>${escapeHTML(translate("email_sent"))}</th>
                  <th>${escapeHTML(translate("permission_slip_signed_at"))}</th>
                  <th>${escapeHTML(translate("actions"))}</th>
                </tr>
              </thead>
              <tbody>
                ${activity.slips.map(slip => `
                  <tr data-slip-id="${slip.id}">
                    <td>${escapeHTML(slip.first_name)} ${escapeHTML(slip.last_name)}</td>
                    <td>
                      <span class="status-badge status-${slip.status}">${escapeHTML(translate(`permission_slip_status_${slip.status}`))}</span>
                    </td>
                    <td>${slip.email_sent ? '✓ ' + translate("email_sent") : translate("email_not_sent")}</td>
                    <td>${slip.signed_at ? escapeHTML(formatDate(slip.signed_at, this.app.lang || 'fr')) : '-'}</td>
                    <td>
                      ${[
          slip.status === 'pending'
            ? `<button class="btn link sign-slip" data-id="${slip.id}">${escapeHTML(translate("permission_slip_sign"))}</button>`
            : '',
          `<button class="btn link archive-slip" data-id="${slip.id}">${escapeHTML(translate("permission_slip_archive"))}</button>`
        ].filter(Boolean).join(' ')}
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    });

    return html;
  }

  attachEventHandlers() {
    // Date quick links
    document.querySelectorAll('.date-quick-link').forEach(button => {
      button.addEventListener('click', async (e) => {
        e.preventDefault();
        const date = e.currentTarget.getAttribute('data-date');
        if (date) {
          this.activityDate = date;
          await this.clearPermissionSlipCaches();
          await this.refreshData(true);
          // Scroll to the activity date input to show context
          const dateInput = document.getElementById("activityDateInput");
          if (dateInput) {
            dateInput.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }
      });
    });

    // Activity date change
    const activityDateInput = document.getElementById("activityDateInput");
    if (activityDateInput) {
      activityDateInput.addEventListener("change", async (event) => {
        this.activityDate = event.target.value || getTodayISO();
        await this.clearPermissionSlipCaches();
        await this.refreshData(true);
      });
    }

    // Toggle create form
    const toggleBtn = document.getElementById("toggleCreateFormBtn");
    if (toggleBtn) {
      toggleBtn.addEventListener("click", (e) => {
        e.preventDefault();
        this.showCreateForm = !this.showCreateForm;
        this.render();
        this.attachEventHandlers();
      });
    }

    // Group selection
    const groupSelect = document.getElementById("groupSelect");
    if (groupSelect) {
      groupSelect.addEventListener("change", (e) => {
        this.selectedAudience = e.target.value || null;
        this.updateParticipantsList();
      });
    }

    // Select all / Deselect all
    const selectAllBtn = document.getElementById("selectAllBtn");
    const deselectAllBtn = document.getElementById("deselectAllBtn");

    if (selectAllBtn) {
      selectAllBtn.addEventListener("click", (e) => {
        e.preventDefault();
        document.querySelectorAll('.participant-checkbox').forEach(cb => {
          cb.checked = true;
        });
        this.updateSelectedCount();
      });
    }

    if (deselectAllBtn) {
      deselectAllBtn.addEventListener("click", (e) => {
        e.preventDefault();
        document.querySelectorAll('.participant-checkbox').forEach(cb => {
          cb.checked = false;
        });
        this.updateSelectedCount();
      });
    }

    // Form submission
    const form = document.getElementById("permissionSlipForm");
    if (form) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const submitBtn = form.querySelector('button[type="submit"]');
        withButtonLoading(submitBtn, () => this.handleFormSubmit(e));
      });
    }

    // Send emails buttons
    document.querySelectorAll('.btn-send-emails').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const activityTitle = btn.getAttribute('data-activity-title');
        const date = btn.getAttribute('data-date');
        withButtonLoading(btn, () => this.handleSendEmails(date, activityTitle));
      });
    });

    // Send reminders buttons
    document.querySelectorAll('.btn-send-reminders').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const activityTitle = btn.getAttribute('data-activity-title');
        const date = btn.getAttribute('data-date');
        withButtonLoading(btn, () => this.handleSendReminders(date, activityTitle));
      });
    });

    // Sign permission slip
    document.querySelectorAll(".sign-slip").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        const slipId = event.currentTarget.getAttribute("data-id");
        const signerName = prompt(translate("permission_slip_signer"));
        if (!signerName) return;

        withButtonLoading(event.currentTarget, async () => {
          try {
            await signPermissionSlip(slipId, { signed_by: signerName, signature_hash: `signed-${Date.now()}` });
            this.app.showMessage(translate("permission_slip_signed"), "success");
            await this.clearPermissionSlipCaches();
            await this.refreshData(true);
          } catch (error) {
            debugError("Error signing permission slip", error);
            this.app.showMessage(translate("permission_slip_error_loading"), "error");
          }
        });
      });
    });

    document.querySelectorAll('.archive-slip').forEach((button) => {
      button.addEventListener('click', async (event) => {
        event.preventDefault();
        const slipId = event.currentTarget.getAttribute('data-id');
        if (!confirm(translate("permission_slip_archive_confirm"))) {
          return;
        }

        withButtonLoading(event.currentTarget, async () => {
          try {
            await archivePermissionSlip(slipId);
            this.app.showMessage(translate("permission_slip_archived"), "success");
            await this.clearPermissionSlipCaches();
            await this.refreshData(true);
          } catch (error) {
            debugError("Error archiving permission slip", error);
            this.app.showMessage(translate("permission_slip_error_loading"), "error");
          }
        });
      });
    });

    if (this.showCreateForm && this.selectedAudience) {
      this.updateParticipantsList();
    }
  }

  updateParticipantsList() {
    const participantsSection = document.getElementById("participantsSection");
    const participantsList = document.getElementById("participantsList");

    if (!participantsSection || !participantsList || !this.selectedAudience) {
      if (participantsSection) participantsSection.style.display = 'none';
      return;
    }

    const filteredParticipants = this.filterParticipantsByAudience(this.selectedAudience);

    if (filteredParticipants.length === 0) {
      setContent(participantsList, `<p>${escapeHTML(translate("no_participants_in_selection"))}</p>`);
      participantsSection.style.display = 'block';
      return;
    }

    setContent(participantsList, filteredParticipants.map(p => `
      <label style="display: block; padding: 8px; cursor: pointer; border-bottom: 1px solid #eee;">
        <input type="checkbox" class="participant-checkbox" value="${p.id}" checked />
        ${escapeHTML(p.first_name)} ${escapeHTML(p.last_name)}
      </label>
    `).join(''));

    participantsSection.style.display = 'block';

    // Attach checkbox change handlers
    document.querySelectorAll('.participant-checkbox').forEach(cb => {
      cb.addEventListener('change', () => this.updateSelectedCount());
    });

    this.updateSelectedCount();
  }

  filterParticipantsByAudience(audience) {
    if (!audience) {
      return [];
    }

    if (audience === 'all') {
      return this.participants;
    }

    if (audience === 'first-year' || audience === 'second-year') {
      const targetYear = audience === 'first-year' ? 0 : 1;
      return this.participants.filter((participant) => {
        const yearsWithOrg = this.getYearsWithOrganization(participant.inscription_date);
        return yearsWithOrg !== null && yearsWithOrg === targetYear;
      });
    }

    if (audience === 'age-11-plus') {
      return this.participants.filter((participant) => {
        const age = this.getParticipantAge(participant.date_naissance || participant.date_of_birth);
        return age !== null && age >= 11;
      });
    }

    if (audience.startsWith('group-')) {
      const groupId = parseInt(audience.replace('group-', ''), 10);
      if (Number.isNaN(groupId)) {
        return [];
      }
      return this.participants.filter((p) => p.group_id === groupId);
    }

    return [];
  }

  getParticipantAge(dateString) {
    if (!dateString) return null;
    const birthDate = new Date(dateString);
    if (Number.isNaN(birthDate.getTime())) return null;

    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    const dayDiff = today.getDate() - birthDate.getDate();

    if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
      age -= 1;
    }

    return age;
  }

  getYearsWithOrganization(inscriptionDate) {
    if (!inscriptionDate) return null;
    const startDate = new Date(inscriptionDate);
    if (Number.isNaN(startDate.getTime())) return null;

    const now = new Date();
    let years = now.getFullYear() - startDate.getFullYear();
    const monthDiff = now.getMonth() - startDate.getMonth();
    const dayDiff = now.getDate() - startDate.getDate();

    if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
      years -= 1;
    }

    return years >= 0 ? years : null;
  }

  updateSelectedCount() {
    const count = document.querySelectorAll('.participant-checkbox:checked').length;
    const countEl = document.getElementById('selectedCount');
    if (countEl) {
      countEl.textContent = count;
    }
  }

  buildCacheKey(base, params = {}) {
    const searchParams = new URLSearchParams();
    Object.keys(params || {}).sort().forEach((key) => {
      if (params[key] !== undefined && params[key] !== null) {
        searchParams.append(key, params[key]);
      }
    });
    const query = searchParams.toString();
    return query ? `${base}?${query}` : base;
  }

  async clearPermissionSlipCaches() {
    try {
      const params = { meeting_date: this.activityDate };
      const permissionCacheKey = this.buildCacheKey('v1/resources/permission-slips', params);
      const dashboardCacheKey = this.buildCacheKey('v1/resources/status/dashboard', params);
      await deleteCachedData(permissionCacheKey);
      await deleteCachedData(dashboardCacheKey);
    } catch (error) {
      debugError('Error clearing permission slip caches', error);
    }
  }

  async handleFormSubmit(event) {
    event.preventDefault();

    const formData = new FormData(event.target);
    const activityTitle = formData.get('activity_title');
    const deadlineDate = formData.get('deadline_date');
    const descriptionInput = document.getElementById('activityDescriptionInput');
    const activityDescription = descriptionInput?.value || '';

    // Get selected participant IDs
    const participantIds = Array.from(document.querySelectorAll('.participant-checkbox:checked'))
      .map(cb => parseInt(cb.value));

    if (participantIds.length === 0) {
      this.app.showMessage(translate("select_at_least_one_participant"), "error");
      return;
    }

    // Build payload, only including non-empty values
    const payload = {
      participant_ids: participantIds,
      status: 'pending'
    };

    // If activityId provided, use it (new mode)
    if (this.activityId) {
      payload.activity_id = this.activityId;
    } else {
      // Legacy mode: use manual entry
      payload.meeting_date = this.activityDate;

      if (activityTitle && activityTitle.trim()) {
        payload.activity_title = activityTitle.trim();
      }

      if (activityDescription && activityDescription.trim()) {
        payload.activity_description = activityDescription.trim();
      }
    }

    // Deadline is optional in both modes
    if (deadlineDate && deadlineDate.trim()) {
      payload.deadline_date = deadlineDate;
    }

    try {
      debugLog("Sending permission slip payload:", payload);

      // Optimistic update - immediately add new slips to UI
      const optimisticSlips = participantIds.map((pid, index) => {
        const participant = this.participants.find(p => p.id === pid);
        return {
          id: `temp-${Date.now()}-${index}`,
          participant_id: pid,
          first_name: participant?.first_name || 'Loading...',
          last_name: participant?.last_name || '',
          meeting_date: this.activityDate,
          activity_title: payload.activity_title || '',
          activity_description: payload.activity_description || '',
          deadline_date: payload.deadline_date || null,
          status: 'pending',
          email_sent: false,
          signed_at: null,
          _optimistic: true // Mark as optimistic
        };
      });

      // Add optimistic slips to state
      this.permissionSlips = [...optimisticSlips, ...this.permissionSlips];

      // Re-render immediately with optimistic data
      this.render();
      this.attachEventHandlers();

      // Save to server
      const result = await savePermissionSlip(payload);

      // Clear cache to ensure fresh data on next load
      if (window.storageUtils) {
        await window.storageUtils.clearCacheByPattern('v1/resources/permission-slips');
        await window.storageUtils.clearCacheByPattern('v1/resources/status/dashboard');
      }

      await this.clearPermissionSlipCaches();

      this.app.showMessage(translate("permission_slip_saved"), "success");
      this.showCreateForm = false;

      // Refresh with real data from server
      await this.refreshData(true);
    } catch (error) {
      debugError("Error saving permission slip", error);

      // Rollback optimistic updates on error
      this.permissionSlips = this.permissionSlips.filter(slip => !slip._optimistic);
      this.render();
      this.attachEventHandlers();

      // Show detailed validation errors if available
      if (error.message.includes('Validation') && error.response?.errors) {
        const errorMessages = error.response.errors.map(e => e.msg).join(', ');
        this.app.showMessage(`${translate("permission_slip_error_loading")}: ${errorMessages}`, "error");
      } else {
        this.app.showMessage(translate("permission_slip_error_loading"), "error");
      }
    }
  }

  async handleSendEmails(date, activityTitle) {
    if (!confirm(`${translate("send_emails_confirm")} "${activityTitle}"?\n\n${translate("emails_only_not_sent_note")}`)) {
      return;
    }

    try {
      const payload = {};

      // Prefer activity_id if available
      if (this.activityId) {
        payload.activity_id = this.activityId;
      } else {
        payload.meeting_date = date;
        payload.activity_title = activityTitle;
      }

      const result = await sendPermissionSlipEmails(payload);
      const data = result?.data || result;
      const message = result?.message || "";

      // Show appropriate message based on response
      if (data.sent === 0 && data.total === 0) {
        // Check message to determine which translation to use
        if (message.includes("No pending")) {
          this.app.showMessage(translate("no_pending_permission_slips"), "info");
        } else {
          this.app.showMessage(translate("all_permission_slips_emailed"), "info");
        }
      } else {
        this.app.showMessage(`${translate("emails_sent_successfully")}: ${data.sent}/${data.total}`, "success");
      }
      await this.clearPermissionSlipCaches();
      await this.refreshData(true);
    } catch (error) {
      debugError("Error sending emails", error);
      this.app.showMessage(translate("email_send_error"), "error");
    }
  }

  async handleSendReminders(date, activityTitle) {
    if (!confirm(`${translate("send_reminder_confirm")} "${activityTitle}"?\n\n${translate("reminder_only_unsigned_note")}`)) {
      return;
    }

    try {
      const payload = {};

      // Prefer activity_id if available
      if (this.activityId) {
        payload.activity_id = this.activityId;
      } else {
        payload.meeting_date = date;
        payload.activity_title = activityTitle;
      }

      const result = await sendPermissionSlipReminders(payload);
      const data = result?.data || result;
      const message = result?.message || "";

      // Show appropriate message based on response
      if (data.sent === 0) {
        // Check message to determine which translation to use
        if (message.includes("signed")) {
          this.app.showMessage(translate("all_sent_slips_signed"), "info");
        } else if (message.includes("24 hours") || message.includes("recently")) {
          this.app.showMessage(translate("reminder_cooldown_active"), "warning");
        } else {
          this.app.showMessage(`${translate("reminder_sent_successfully")}: 0/${data.total}`, "info");
        }
      } else {
        this.app.showMessage(`${translate("reminder_sent_successfully")}: ${data.sent}/${data.total}`, "success");
      }
      await this.clearPermissionSlipCaches();
      await this.refreshData(true);
    } catch (error) {
      debugError("Error sending reminders", error);
      this.app.showMessage(translate("email_send_error"), "error");
    }
  }
}
