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

export class PermissionSlipDashboard {
  constructor(app) {
    this.app = app;
    this.activityDate = getTodayISO();
    this.permissionSlips = [];
    this.dashboardSummary = { permission_summary: [] };
    this.groups = [];
    this.participants = [];
    this.selectedAudience = null;
    this.selectedParticipantIds = [];
    this.showCreateForm = false;
  }

  async init() {
    try {
      await this.loadData();
      this.render();
      this.attachEventHandlers();
    } catch (error) {
      debugError("Error initializing permission slip dashboard:", error);
      this.app.showMessage(translate("permission_slip_error_loading"), "error");
    }
  }

  async loadData(forceRefresh = false) {
    const params = { meeting_date: this.activityDate };
    const [slipResponse, summaryResponse, groupsResponse, participantsResponse] = await Promise.all([
      getPermissionSlips(params, { forceRefresh }),
      getResourceDashboard(params, { forceRefresh }),
      getGroups(),
      getParticipants()
    ]);

    this.permissionSlips = slipResponse?.data?.permission_slips || slipResponse?.permission_slips || [];
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

    container.innerHTML = `
      <a href="/dashboard" class="home-icon" aria-label="${translate("back_to_dashboard")}">🏠</a>
      <section class="page permission-slip-dashboard">
        <div class="card">
          <h1>${escapeHTML(translate("permission_slip_dashboard_title"))}</h1>
          <p class="subtitle">${escapeHTML(translate("permission_slip_dashboard_description"))}</p>
        </div>

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
            <div class="stacked" style="min-width: 240px; margin: 0;">
              <span>${escapeHTML(translate("activity_date_label"))}</span>
              <input type="date" id="activityDateInput" value="${escapeHTML(this.activityDate)}" />
            </div>
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
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        await this.handleFormSubmit(e);
      });
    }

    // Send emails buttons
    document.querySelectorAll('.btn-send-emails').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        const activityTitle = btn.getAttribute('data-activity-title');
        const date = btn.getAttribute('data-date');
        await this.handleSendEmails(date, activityTitle);
      });
    });

    // Send reminders buttons
    document.querySelectorAll('.btn-send-reminders').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        const activityTitle = btn.getAttribute('data-activity-title');
        const date = btn.getAttribute('data-date');
        await this.handleSendReminders(date, activityTitle);
      });
    });

    // Sign permission slip
    document.querySelectorAll(".sign-slip").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        const slipId = event.currentTarget.getAttribute("data-id");
        const signerName = prompt(translate("permission_slip_signer"));
        if (!signerName) return;

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

    document.querySelectorAll('.archive-slip').forEach((button) => {
      button.addEventListener('click', async (event) => {
        event.preventDefault();
        const slipId = event.currentTarget.getAttribute('data-id');
        if (!confirm(translate("permission_slip_archive_confirm"))) {
          return;
        }

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
      participantsList.innerHTML = `<p>${escapeHTML(translate("no_participants_in_selection"))}</p>`;
      participantsSection.style.display = 'block';
      return;
    }

    participantsList.innerHTML = filteredParticipants.map(p => `
      <label style="display: block; padding: 8px; cursor: pointer; border-bottom: 1px solid #eee;">
        <input type="checkbox" class="participant-checkbox" value="${p.id}" checked />
        ${escapeHTML(p.first_name)} ${escapeHTML(p.last_name)}
      </label>
    `).join('');

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
      meeting_date: this.activityDate,
      status: 'pending'
    };

    // Only add optional fields if they have values
    if (activityTitle && activityTitle.trim()) {
      payload.activity_title = activityTitle.trim();
    }

    if (activityDescription && activityDescription.trim()) {
      payload.activity_description = activityDescription.trim();
    }

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
    if (!confirm(`${translate("send_emails_to_parents")} - ${activityTitle}?`)) {
      return;
    }

    try {
      const payload = {
        meeting_date: date,
        activity_title: activityTitle
      };

      const result = await sendPermissionSlipEmails(payload);
      const data = result?.data || result;
      this.app.showMessage(`${translate("emails_sent_successfully")}: ${data.sent}/${data.total}`, "success");
      await this.clearPermissionSlipCaches();
      await this.refreshData(true);
    } catch (error) {
      debugError("Error sending emails", error);
      this.app.showMessage(translate("email_send_error"), "error");
    }
  }

  async handleSendReminders(date, activityTitle) {
    if (!confirm(`${translate("send_reminder_emails")} - ${activityTitle}?`)) {
      return;
    }

    try {
      const payload = {
        meeting_date: date,
        activity_title: activityTitle
      };

      const result = await sendPermissionSlipReminders(payload);
      const data = result?.data || result;
      this.app.showMessage(`${translate("reminder_sent_successfully")}: ${data.sent}/${data.total}`, "success");
      await this.clearPermissionSlipCaches();
      await this.refreshData(true);
    } catch (error) {
      debugError("Error sending reminders", error);
      this.app.showMessage(translate("email_send_error"), "error");
    }
  }
}
