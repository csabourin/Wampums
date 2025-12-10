import { translate } from "./app.js";
import { debugError } from "./utils/DebugUtils.js";
import { escapeHTML } from "./utils/SecurityUtils.js";
import { formatDate, getTodayISO } from "./utils/DateUtils.js";
import {
  getPermissionSlips,
  savePermissionSlip,
  signPermissionSlip,
  getResourceDashboard
} from "./api/api-endpoints.js";

export class PermissionSlipDashboard {
  constructor(app) {
    this.app = app;
    this.meetingDate = getTodayISO();
    this.permissionSlips = [];
    this.dashboardSummary = { permission_summary: [] };
  }

  async init() {
    try {
      await this.refreshData();
      this.render();
      this.attachEventHandlers();
    } catch (error) {
      debugError("Error initializing permission slip dashboard:", error);
      this.app.showMessage(translate("permission_slip_error_loading"), "error");
    }
  }

  async refreshData() {
    const [slipResponse, summaryResponse] = await Promise.all([
      getPermissionSlips({ meeting_date: this.meetingDate }),
      getResourceDashboard({ meeting_date: this.meetingDate })
    ]);

    this.permissionSlips = slipResponse?.data?.permission_slips || slipResponse?.permission_slips || [];
    this.dashboardSummary = summaryResponse?.data || summaryResponse || { permission_summary: [] };
  }

  render() {
    const container = document.getElementById("app");
    if (!container) {
      return;
    }

    const permissionSummary = this.dashboardSummary?.permission_summary || [];

    container.innerHTML = `
      <a href="/dashboard" class="home-icon" aria-label="${translate("back_to_dashboard")}">🏠</a>
      <section class="page permission-slip-dashboard">
        <div class="card">
          <h1>${escapeHTML(translate("permission_slip_dashboard_title"))}</h1>
          <p class="subtitle">${escapeHTML(translate("permission_slip_dashboard_description"))}</p>
          <label class="stacked">
            <span>${escapeHTML(translate("meeting_date_label"))}</span>
            <input type="date" id="meetingDateInput" value="${escapeHTML(this.meetingDate)}" />
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
          <h2>${escapeHTML(translate("permission_slip_section_title"))}</h2>
          <form id="permissionSlipForm" class="stacked">
            <div class="grid grid-2">
              <label class="stacked">
                <span>${escapeHTML(translate("permission_slip_participant_id"))}</span>
                <input type="number" name="participant_id" min="1" required />
              </label>
              <label class="stacked">
                <span>${escapeHTML(translate("permission_slip_guardian_id"))}</span>
                <input type="number" name="guardian_id" min="1" />
              </label>
            </div>
            <label class="stacked">
              <span>${escapeHTML(translate("consent_details"))}</span>
              <textarea name="consent_payload" rows="3" placeholder="{}" maxlength="2000"></textarea>
            </label>
            <button type="submit" class="btn primary">${escapeHTML(translate("permission_slip_create"))}</button>
          </form>
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>${escapeHTML(translate("permission_slip_participant_id"))}</th>
                  <th>${escapeHTML(translate("permission_slip_guardian_id"))}</th>
                  <th>${escapeHTML(translate("permission_slip_status"))}</th>
                  <th>${escapeHTML(translate("permission_slip_signed_at"))}</th>
                  <th>${escapeHTML(translate("actions"))}</th>
                </tr>
              </thead>
              <tbody>
                ${this.permissionSlips.length === 0
                  ? `<tr><td colspan="5">${escapeHTML(translate("no_data_available"))}</td></tr>`
                  : this.permissionSlips
                      .map((slip) => `
                        <tr data-slip-id="${slip.id}">
                          <td>${escapeHTML(String(slip.participant_id))}</td>
                          <td>${escapeHTML(slip.guardian_id ? String(slip.guardian_id) : '-')}</td>
                          <td>${escapeHTML(slip.status)}</td>
                          <td>${slip.signed_at ? escapeHTML(formatDate(slip.signed_at, this.app.lang || 'en')) : '-'}</td>
                          <td>
                            <button class="btn link sign-slip" data-id="${slip.id}">${escapeHTML(translate("permission_slip_sign"))}</button>
                          </td>
                        </tr>
                      `)
                      .join('')}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    `;
  }

  attachEventHandlers() {
    const meetingDateInput = document.getElementById("meetingDateInput");
    if (meetingDateInput) {
      meetingDateInput.addEventListener("change", async (event) => {
        this.meetingDate = event.target.value || getTodayISO();
        await this.refreshData();
        this.render();
        this.attachEventHandlers();
      });
    }

    const permissionSlipForm = document.getElementById("permissionSlipForm");
    if (permissionSlipForm) {
      permissionSlipForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const formData = new FormData(permissionSlipForm);
        const payload = Object.fromEntries(formData.entries());
        payload.participant_id = parseInt(payload.participant_id, 10);
        payload.guardian_id = payload.guardian_id ? parseInt(payload.guardian_id, 10) : undefined;
        payload.meeting_date = this.meetingDate;

        if (payload.consent_payload) {
          try {
            payload.consent_payload = JSON.parse(payload.consent_payload);
          } catch (parseError) {
            debugError("Invalid consent payload", parseError);
            this.app.showMessage(translate("invalid_consent_payload"), "error");
            return;
          }
        }

        try {
          await savePermissionSlip(payload);
          this.app.showMessage(translate("permission_slip_saved"), "success");
          await this.refreshData();
          this.render();
          this.attachEventHandlers();
        } catch (error) {
          debugError("Error saving permission slip", error);
          this.app.showMessage(translate("permission_slip_error_loading"), "error");
        }
      });
    }

    document.querySelectorAll(".sign-slip").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        const slipId = event.currentTarget.getAttribute("data-id");
        const signerName = prompt(translate("permission_slip_signer"));
        if (!signerName) {
          return;
        }

        try {
          await signPermissionSlip(slipId, { signed_by: signerName, signature_hash: `signed-${Date.now()}` });
          this.app.showMessage(translate("permission_slip_signed"), "success");
          await this.refreshData();
          this.render();
          this.attachEventHandlers();
        } catch (error) {
          debugError("Error signing permission slip", error);
          this.app.showMessage(translate("permission_slip_error_loading"), "error");
        }
      });
    });
  }
}
