import { translate } from "./app.js";
import { debugError, debugLog } from "./utils/DebugUtils.js";
import { escapeHTML } from "./utils/SecurityUtils.js";
import { formatDate, getTodayISO } from "./utils/DateUtils.js";
import { SimpleWYSIWYG, injectWYSIWYGStyles } from "./utils/SimpleWYSIWYG.js";
import {
  getPermissionSlips,
  savePermissionSlip,
  signPermissionSlip,
  sendPermissionSlipEmails,
  sendPermissionSlipReminders,
  getResourceDashboard
} from "./api/api-endpoints.js";
import { getGroups } from "./api/api-endpoints.js";
import { getParticipants } from "./api/api-endpoints.js";

export class PermissionSlipDashboard {
  constructor(app) {
    this.app = app;
    this.activityDate = getTodayISO();
    this.permissionSlips = [];
    this.dashboardSummary = { permission_summary: [] };
    this.groups = [];
    this.participants = [];
    this.selectedGroupId = null;
    this.selectedParticipantIds = [];
    this.wysiwygEditor = null;
    this.showCreateForm = false;
  }

  async init() {
    try {
      injectWYSIWYGStyles();
      await this.loadData();
      this.render();
      this.attachEventHandlers();
    } catch (error) {
      debugError("Error initializing permission slip dashboard:", error);
      this.app.showMessage(translate("permission_slip_error_loading"), "error");
    }
  }

  async loadData() {
    const [slipResponse, summaryResponse, groupsResponse, participantsResponse] = await Promise.all([
      getPermissionSlips({ meeting_date: this.activityDate }),
      getResourceDashboard({ meeting_date: this.activityDate }),
      getGroups(),
      getParticipants()
    ]);

    this.permissionSlips = slipResponse?.data?.permission_slips || slipResponse?.permission_slips || [];
    this.dashboardSummary = summaryResponse?.data || summaryResponse || { permission_summary: [] };
    this.groups = groupsResponse?.data || groupsResponse?.groups || [];
    this.participants = participantsResponse?.data || participantsResponse?.participants || [];
  }

  async refreshData() {
    await this.loadData();
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
          <label class="stacked">
            <span>${escapeHTML(translate("activity_date_label"))}</span>
            <input type="date" id="activityDateInput" value="${escapeHTML(this.activityDate)}" />
          </label>
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
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
            <h2>${escapeHTML(translate("permission_slip_section_title"))}</h2>
            <button id="toggleCreateFormBtn" class="btn primary">
              ${this.showCreateForm ? translate("cancel") : translate("permission_slip_create")}
            </button>
          </div>

          ${this.showCreateForm ? this.renderCreateForm() : ''}

          ${this.renderPermissionSlipsTable()}
        </div>
      </section>
    `;

    // Re-initialize WYSIWYG editor if create form is shown
    if (this.showCreateForm) {
      this.initWYSIWYGEditor();
    }
  }

  renderCreateForm() {
    const groupOptions = this.groups.map(g =>
      `<option value="${g.id}">${escapeHTML(g.name)}</option>`
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
          <div id="activityDescriptionEditor"></div>
        </label>

        <label class="stacked">
          <span>${escapeHTML(translate("select_group_label"))} *</span>
          <select id="groupSelect" required>
            <option value="">-- ${escapeHTML(translate("select_group_label"))} --</option>
            ${groupOptions}
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
                      ${slip.status === 'pending'
                        ? `<button class="btn link sign-slip" data-id="${slip.id}">${escapeHTML(translate("permission_slip_sign"))}</button>`
                        : '-'}
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

  initWYSIWYGEditor() {
    const editorContainer = document.getElementById("activityDescriptionEditor");
    if (editorContainer && !this.wysiwygEditor) {
      this.wysiwygEditor = new SimpleWYSIWYG(editorContainer, {
        placeholder: translate("activity_description_label"),
        initialContent: ""
      });
    }
  }

  attachEventHandlers() {
    // Activity date change
    const activityDateInput = document.getElementById("activityDateInput");
    if (activityDateInput) {
      activityDateInput.addEventListener("change", async (event) => {
        this.activityDate = event.target.value || getTodayISO();
        await this.refreshData();
      });
    }

    // Toggle create form
    const toggleBtn = document.getElementById("toggleCreateFormBtn");
    if (toggleBtn) {
      toggleBtn.addEventListener("click", (e) => {
        e.preventDefault();
        this.showCreateForm = !this.showCreateForm;
        this.wysiwygEditor = null; // Reset editor
        this.render();
        this.attachEventHandlers();
      });
    }

    // Group selection
    const groupSelect = document.getElementById("groupSelect");
    if (groupSelect) {
      groupSelect.addEventListener("change", (e) => {
        this.selectedGroupId = e.target.value ? parseInt(e.target.value) : null;
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
          await this.refreshData();
        } catch (error) {
          debugError("Error signing permission slip", error);
          this.app.showMessage(translate("permission_slip_error_loading"), "error");
        }
      });
    });
  }

  updateParticipantsList() {
    const participantsSection = document.getElementById("participantsSection");
    const participantsList = document.getElementById("participantsList");

    if (!participantsSection || !participantsList || !this.selectedGroupId) {
      if (participantsSection) participantsSection.style.display = 'none';
      return;
    }

    // Filter participants by group
    const groupParticipants = this.participants.filter(p => p.group_id === this.selectedGroupId);

    if (groupParticipants.length === 0) {
      participantsList.innerHTML = `<p>${escapeHTML(translate("no_participants_in_group"))}</p>`;
      participantsSection.style.display = 'block';
      return;
    }

    participantsList.innerHTML = groupParticipants.map(p => `
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

  updateSelectedCount() {
    const count = document.querySelectorAll('.participant-checkbox:checked').length;
    const countEl = document.getElementById('selectedCount');
    if (countEl) {
      countEl.textContent = count;
    }
  }

  async handleFormSubmit(event) {
    event.preventDefault();

    const formData = new FormData(event.target);
    const activityTitle = formData.get('activity_title');
    const deadlineDate = formData.get('deadline_date');
    const activityDescription = this.wysiwygEditor ? this.wysiwygEditor.getHTML() : '';

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
      const result = await savePermissionSlip(payload);
      this.app.showMessage(translate("permission_slip_saved"), "success");
      this.showCreateForm = false;
      this.wysiwygEditor = null;
      await this.refreshData();
    } catch (error) {
      debugError("Error saving permission slip", error);

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
      await this.refreshData();
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
      await this.refreshData();
    } catch (error) {
      debugError("Error sending reminders", error);
      this.app.showMessage(translate("email_send_error"), "error");
    }
  }
}
